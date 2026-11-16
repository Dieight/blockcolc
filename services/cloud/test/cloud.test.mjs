import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CloudStore} from '../src/store.mjs';
import {createCloudServer} from '../src/server.mjs';
import {createInitialState,execute} from '../build/domain.mjs';
import {canonical,sha,splitDomain} from '../src/wire.mjs';
import {RelayForwarder} from '../src/forwarder.mjs';
import {request as httpRequest} from 'node:http';

function fixture(t){const directory=mkdtempSync(join(tmpdir(),'blockcolc-cloud-'));let now=Date.parse('2026-11-15T10:00:00Z');
  const store=new CloudStore(directory,{clock:()=>now});t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,directory,setNow:value=>{now=Date.parse(value);}};
}
async function user(store,name='alice',device='device_a_12345678'){
  const login=await store.register({username:name,password:'correct horse battery staple',name,deviceId:device,deviceName:'test',timeZone:'UTC'});
  return {login,session:store.authenticate(login.token)};
}
async function otherDevice(store,name='alice'){
  const login=await store.login({username:name,password:'correct horse battery staple',deviceId:'device_b_12345678',deviceName:'tablet'});return store.authenticate(login.token);
}
function push(store,s,entries,old={},extra={}){const h=store.head(s.user);
  const keys=new Set([...Object.keys(entries),...Object.keys(old)]);const changes=[...keys].filter(k=>entries[k]!==old[k]).map(key=>({key,before:old[key]==null?null:sha(old[key]),canonical:entries[key]??null}));
  return store.commit(s,{requestId:crypto.randomUUID(),epoch:h.epoch,execution:h.execution,changes,...extra});
}
function seed(store,s){store.claim(s,{generation:0});const domain=createInitialState();const {entries}=splitDomain(domain);push(store,s,entries);return {domain,entries};}
function note(domain,id,text){const result=execute(domain,{type:'AddQuickNote',noteId:id,text},{now:()=>new Date('2026-11-15T10:00:00Z')});assert.equal(result.ok,true);return result.state;}

test('authentication, device revocation and hashed credentials',async t=>{
  const {store}=fixture(t),{login,session}=await user(store);assert.equal(store.account(session.user).username,'alice');
  assert.notEqual(store.db.prepare('SELECT password FROM accounts').get().password,'correct horse battery staple');
  assert.notEqual(store.db.prepare('SELECT token FROM sessions').get().token,login.token);
  await assert.rejects(store.login({username:'alice',password:'wrong password',deviceId:'device_b_12345678',deviceName:'tablet'}),{code:'LOGIN_FAILED'});
  const b=await otherDevice(store);store.claim(b,{generation:0});store.revokeDevice(session,b.device);
  assert.throws(()=>store.claim(b,{generation:1}),{code:'UNAUTHORIZED'});assert.throws(()=>push(store,b,splitDomain(createInitialState()).entries),{code:'UNAUTHORIZED'});assert.equal(store.head(session.user).owner,null);
});
test('disjoint device edits merge; same record conflicts without partial writes',async t=>{
  const {store}=fixture(t),{session:a}=await user(store),{domain,entries:base}=seed(store,a),b=await otherDevice(store);
  const left=splitDomain(note(domain,'note-left','left')).entries,right=splitDomain(note(domain,'note-right','right')).entries;
  push(store,a,left,base);push(store,b,right,base);assert.ok(store.entries(a.user)['quickNotes/note-left']);assert.ok(store.entries(a.user)['quickNotes/note-right']);
  const current=store.entries(a.user),old=current['quickNotes/note-left'];
  const change=(text)=>({requestId:crypto.randomUUID(),epoch:store.head(a.user).epoch,changes:[{key:'quickNotes/note-left',before:sha(old),canonical:canonical({...JSON.parse(old),value:{...JSON.parse(old).value,text}})}]});
  store.commit(a,change('first'));const before=canonical(store.workspace(a));assert.throws(()=>store.commit(b,change('second')),{code:'SYNC_CONFLICT'});assert.equal(canonical(store.workspace(a)),before);
});
test('execution takeover fences stale mutations and idempotent requests',async t=>{
  const {store}=fixture(t),{session:a}=await user(store),{entries}=seed(store,a),b=await otherDevice(store);
  assert.throws(()=>store.claim(b,{generation:1}),{code:'EXECUTING_ELSEWHERE'});assert.equal(store.claim(b,{generation:1,takeover:true}).generation,2);
  const input={requestId:'request-12345678',epoch:store.head(a.user).epoch,execution:1,changes:[{key:'$/activeFocusSession',before:sha('null'),canonical:'null'}]};
  assert.throws(()=>store.commit(a,input),{code:'EXECUTION_CHANGED'});input.execution=2;const receipt=store.commit(b,input);assert.deepEqual(store.commit(b,input),receipt);
  assert.throws(()=>store.commit(b,{...input,execution:3}),{code:'REQUEST_ID_REUSED'});
  const restore={revision:store.head(a.user).revision,entries,requestId:'replace-12345678'};const replaced=store.replace(b,restore);
  assert.deepEqual(store.replace(b,restore),replaced);assert.notEqual(replaced.epoch,input.epoch);
  assert.throws(()=>store.commit(a,{...input,requestId:'request-stale123'}),{code:'WORKSPACE_REPLACED'});
});
test('rolling backup deduplicates, restores atomically, and preserves previous root on corruption',async t=>{
  const {store,setNow}=fixture(t),{session}=await user(store),{domain,entries}=seed(store,session);
  store.capture(session.user);const firstCount=store.db.prepare('SELECT count(*) n FROM backup_blocks').get().n;
  store.capture(session.user);assert.equal(store.db.prepare('SELECT count(*) n FROM backup_blocks').get().n,firstCount);
  const changed=splitDomain(note(domain,'note-1','saved')).entries;push(store,session,changed,entries);setNow('2026-11-17T00:00:01Z');store.daily();
  assert.equal(store.backupInfo(session).date,'2026-11-16');assert.equal(store.db.prepare('SELECT count(*) n FROM backups').get().n,1);
  push(store,session,splitDomain(note(domain,'note-2','later')).entries,changed);
  const restored=store.restore(session,{revision:store.head(session.user).revision,requestId:'restore-12345678'});
  assert.ok(restored.entries['quickNotes/note-1']);assert.equal(restored.entries['quickNotes/note-2'],undefined);assert.equal(restored.execution.owner,null);
  const before=canonical(store.workspace(session));store.db.prepare("UPDATE backup_blocks SET canonical='corrupt' WHERE rowid=(SELECT min(rowid) FROM backup_blocks)").run();
  assert.throws(()=>store.restore(session,{revision:store.head(session.user).revision,requestId:'restore-22345678'}),{code:'BACKUP_CORRUPT'});assert.equal(canonical(store.workspace(session)),before);
});
test('asset bytes are per account, validated, and repairable after interrupted/corrupt storage',async t=>{
  const {store}=fixture(t),{session:a}=await user(store),{session:b}=await user(store,'bob');const text='{"only":"immutable blueprint fixture"}',key=sha(text);
  assert.throws(()=>store.putAsset(a,key,Buffer.from('wrong')),{code:'ASSET_DIGEST'});store.putAsset(a,key,Buffer.from(text));assert.equal(store.asset(a.user,key),text);
  assert.throws(()=>store.asset(b.user,key),{code:'MISSING_ASSET'});writeFileSync(store.assetPath(a.user,key),'corrupt');
  assert.throws(()=>store.asset(a.user,key),{code:'ASSET_CORRUPT'});assert.deepEqual(store.assetStatus(a,[key]),{missing:[key]});
  store.putAsset(a,key,Buffer.from(text));assert.equal(store.asset(a.user,key),text);assert.deepEqual(store.assetStatus(a,[key]),{missing:[]});
});

test('a dense legal 60-cubed blueprint travels over HTTP, deduplicates and survives rolling restore',async t=>{
  const {store}=fixture(t),{login,session}=await user(store);store.claim(session,{generation:0});
  const server=createCloudServer(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const blueprint={schemaVersion:1,id:'dense-60',title:'Dense 60',bounds:{minX:0,maxX:59,minY:0,maxY:59,minZ:0,maxZ:59},
    voxels:Array.from({length:216000},(_,i)=>({x:i%60,y:Math.floor(i/3600),z:Math.floor(i/60)%60,materialId:'stone',stage:'foundation',buildOrder:Math.min(i,10000)}))};
  const domain=createInitialState();domain.buildingBlueprintResources=[{id:'dense-60',displayName:'Dense 60',blueprint,importedAt:'2026-11-15T10:00:00.000Z'}];
  const {entries,assets}=splitDomain(domain),[[key,wire]]=Object.entries(assets);
  assert.ok(Buffer.byteLength(wire)>16*1024*1024);
  const headers={authorization:'Bearer '+login.token,'content-type':'application/json'};
  const put=()=>fetch(base+'/v1/assets/'+key,{method:'PUT',headers,body:wire});
  assert.equal((await put()).status,200);assert.equal((await put()).status,200);
  const downloaded=await fetch(base+'/v1/assets/'+key,{headers});assert.equal(downloaded.status,200);assert.equal(sha(await downloaded.text()),key);
  push(store,session,entries);store.capture(session.user);const oldEpoch=store.head(session.user).epoch;
  push(store,session,splitDomain(note(domain,'after-backup','later edit')).entries,entries);
  const restored=store.restore(session,{revision:store.head(session.user).revision,requestId:'large-restore-12345678'});
  assert.notEqual(restored.epoch,oldEpoch);assert.deepEqual(restored.entries,entries);
  assert.equal(store.db.prepare('SELECT count(*) n FROM assets WHERE user=?').get(session.user).n,1);
  assert.equal(store.db.prepare('SELECT count(*) n FROM backups WHERE user=?').get(session.user).n,1);
  assert.equal(sha(store.asset(session.user,key)),key);
});
test('friend consent and independent disclosure filters exclude hidden facts',async t=>{
  const {store,setNow}=fixture(t),{session:a}=await user(store),{login:bLogin,session:b}=await user(store,'bob');seed(store,a);
  store.updateAccount(a,{friendsEnabled:true});store.updateAccount(b,{friendsEnabled:true});store.invite(a,bLogin.account.friendCode);store.relation(b,a.user,'accept');
  const snap={currentName:'private task',startedAt:'2026-11-15T09:55:00.000Z',estimatedElapsedMs:300000,estimatedEndsAt:'2026-11-15T10:20:00.000Z',todayActualFocusMs:600000};
  store.presence(a,snap,1);let friend=store.friends(b)[0];assert.equal(friend.currentName,undefined);assert.equal(friend.startedAt,undefined);assert.equal(friend.updatedAt,undefined);assert.equal(friend.stale,undefined);assert.equal(friend.days,undefined);
  store.friendPolicy(a,b.user,{status:false,name:true,time:false,daily:false});friend=store.friends(b)[0];assert.equal(friend.currentName,'private task');assert.equal(friend.startedAt,undefined);assert.equal(friend.focusing,undefined);assert.equal(friend.updatedAt,undefined);
  setNow('2026-11-15T10:21:00Z');assert.equal(store.friends(b)[0].currentName,undefined);
  store.updateAccount(a,{friendsEnabled:false});assert.equal(store.friends(b)[0].currentName,undefined);
});
test('private forwarding retries do not block commits, revisions persist and friend policies stay independent',async t=>{
  const {store,directory,setNow}=fixture(t),{session}=await user(store);seed(store,session);
  const config=join(directory,'synthetic-forwarding.json');writeFileSync(config,JSON.stringify({[session.user]:{url:'https://synthetic.invalid',token:'synthetic-token-for-tests-only-12345678',sourceEpoch:'synthetic_source_123456789'}}));
  let failed=true;const sent=[];const fetcher=async(url,request)=>{sent.push({url,value:JSON.parse(request.body)});if(failed)throw new Error('offline');return new Response('{}');};
  let forwarder=new RelayForwarder(store,{configuration:config,fetcher});
  store.updateAccount(session,{friendsEnabled:true,sharing:{status:true,name:true,time:true,daily:true}});
  const snapshot={currentName:'approved',startedAt:'2026-11-15T09:55:00.000Z',estimatedElapsedMs:300000,estimatedEndsAt:'2026-11-15T10:20:00.000Z',todayActualFocusMs:300000};
  store.presence(session,snapshot,1);forwarder.offer(session,{snapshot});
  const queued=store.db.prepare('SELECT value FROM forwarding').get().value;await forwarder.drain();assert.equal(store.db.prepare('SELECT count(*) n FROM forwarding').get().n,1);
  const before=store.head(session.user).revision;push(store,session,store.entries(session.user),store.entries(session.user));assert.equal(store.head(session.user).revision,before+1);
  setNow('2026-11-15T10:00:10Z');failed=false;await forwarder.drain();assert.equal(store.db.prepare('SELECT count(*) n FROM forwarding').get().n,0);assert.equal(JSON.stringify(sent[0].value),JSON.stringify(sent[1].value));
  // The workspace commit invalidates its prior presence receipt. Renew the
  // observed live state before testing an unrelated friends-policy change.
  store.presence(session,snapshot,1);
  const version=JSON.parse(queued).live.revision;forwarder=new RelayForwarder(store,{configuration:config,fetcher});forwarder.policyChanged(session);
  const newer=JSON.parse(store.db.prepare('SELECT value FROM forwarding').get().value);assert.ok(newer.live.revision>version);
  store.updateAccount(session,{friendsEnabled:false,sharing:{status:false,name:false,time:false,daily:false}});forwarder.policyChanged(session);await forwarder.drain();
  const lastLive=sent.filter(x=>x.url.endsWith('/live')).at(-1).value;assert.equal(lastLive.snapshot.currentName,'approved');assert.equal(lastLive.snapshot.startedAt,snapshot.startedAt);assert.equal(lastLive.snapshot.todayActualFocusMs,300000);
  assert.ok(sent.at(-1).value.days.every(day=>day.actualFocusMs===0));
});
test('HTTP protocol rejects malformed/unauthorized bodies and survives',async t=>{
  const {store}=fixture(t),server=createCloudServer(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(url+'/v1/workspace')).status,401);assert.equal((await fetch(url+'/v1/login',{method:'POST',body:'{'})).status,400);
  assert.deepEqual(await(await fetch(url+'/healthz')).json(),{ok:true,protocol:1});
});

test('legacy dates respect enrollment and a bad queued range is replaced under a new version',async t=>{
  const {store,directory}=fixture(t),{session}=await user(store);seed(store,session);
  const config=join(directory,'legacy-dates.json'),target={url:'https://synthetic.invalid',token:'synthetic-token-for-tests-only-12345678',sourceEpoch:'synthetic_source_123456789'};
  writeFileSync(config,JSON.stringify({[session.user]:target}));let sends=0;
  const fetcher=async(url,request)=>{sends++;const body=JSON.parse(request.body);
    if(url.endsWith('/days')&&body.days.some(day=>day.date<'2026-11-14'))return new Response('{}',{status:409});return new Response('{}');};
  let relay=new RelayForwarder(store,{configuration:config,fetcher});
  relay.offer(session,{snapshot:{currentName:null,startedAt:null,estimatedEndsAt:null,estimatedElapsedMs:0,todayActualFocusMs:120000}});
  const old=JSON.parse(store.db.prepare('SELECT value FROM forwarding').get().value);assert.equal(old.days.days.length,366);
  writeFileSync(config,JSON.stringify({[session.user]:{...target,enrolledDate:'2026-11-14'}}));relay=new RelayForwarder(store,{configuration:config,fetcher});
  await relay.drain();assert.equal(sends,0);const replacement=JSON.parse(store.db.prepare('SELECT value FROM forwarding').get().value);
  assert.ok(replacement.live.revision>old.live.revision);assert.equal(old.days.days.length,366);assert.deepEqual(replacement.days.days.map(day=>day.date),['2026-11-14','2026-11-15']);
  await relay.drain();assert.equal(sends,2);assert.equal(store.db.prepare('SELECT count(*) n FROM forwarding').get().n,0);
  assert.equal(store.db.prepare('SELECT status FROM forwarding_delivery').get().status,200);
});

test('private binding is not a public account option or a client-controlled API',async t=>{
  const {store,directory}=fixture(t),{login,session}=await user(store),{session:other}=await user(store,'bob');
  const config=join(directory,'owner-only.json');writeFileSync(config,JSON.stringify({[session.user]:{url:'https://synthetic.invalid',token:'synthetic-token-for-tests-only-12345678',enrolledDate:'2026-11-14'}}));
  const relay=new RelayForwarder(store,{configuration:config,fetcher:async()=>new Response('{}')});
  const snapshot={currentName:null,startedAt:null,estimatedEndsAt:null,estimatedElapsedMs:0,todayActualFocusMs:0};
  relay.offer(other,{snapshot});assert.equal(store.db.prepare('SELECT count(*) n FROM forwarding').get().n,0);relay.offer(session,{snapshot});assert.equal(store.db.prepare('SELECT count(*) n FROM forwarding').get().n,1);
  const server=createCloudServer(store,{forwarder:relay});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+login.token,'Content-Type':'application/json'};
  const account=await(await fetch(base+'/v1/account',{headers})).json();assert.equal(account.externalForwardingAvailable,undefined);assert.equal(account.externalForwardingEnabled,undefined);
  assert.equal((await fetch(base+'/v1/forwarding',{method:'POST',headers,body:'{"enabled":false}'})).status,404);
});

test('legacy handoff waits for the initial history and stays ready after an intentional deletion',async t=>{
  const {store,directory}=fixture(t),{session}=await user(store);seed(store,session);
  const config=join(directory,'handoff-ready.json'),target={url:'https://synthetic.invalid',token:'synthetic-token-for-tests-only-12345678',
    sourceEpoch:'cloud_owner_source_123456789',previousSourceEpoch:'phone_owner_source_123456789',initialHistoryCount:2,enrolledDate:'2026-11-14'};
  writeFileSync(config,JSON.stringify({[session.user]:target}));
  const sent=[],fetcher=async(url,request)=>{sent.push({url,body:JSON.parse(request.body)});return new Response('{}');};
  const snapshot={currentName:null,startedAt:null,estimatedEndsAt:null,estimatedElapsedMs:0,todayActualFocusMs:0};
  let relay=new RelayForwarder(store,{configuration:config,fetcher});relay.offer(session,{snapshot});await relay.drain();
  assert.equal(sent.length,0);assert.equal(store.db.prepare('SELECT part FROM forwarding_delivery').get().part,'awaiting-history');
  // Minimal private history rows isolate the handoff/count transport rule.
  for(let i=0;i<2;i++){const wire=canonical({ordinal:i,value:{startedAt:'2026-11-15T09:00:00Z',actualDurationMs:60000}});
    store.db.prepare('INSERT INTO entries VALUES(?,?,?,?)').run(session.user,'focusHistory/synthetic-'+i,wire,sha(wire));}
  relay.offer(session,{snapshot});await relay.drain();
  assert.deepEqual(sent.map(x=>new URL(x.url).pathname),['/api/upload/epoch','/api/upload/live','/api/upload/days']);
  assert.deepEqual(sent[0].body,{previousSourceEpoch:target.previousSourceEpoch,sourceEpoch:target.sourceEpoch});
  assert.equal(sent[2].body.days.at(-1).actualFocusMs,120000);
  store.db.prepare("DELETE FROM entries WHERE user=? AND key LIKE 'focusHistory/%'").run(session.user);
  relay=new RelayForwarder(store,{configuration:config,fetcher});relay.offer(session,{snapshot});await relay.drain();
  assert.equal(sent.filter(x=>x.url.endsWith('/epoch')).length,1);assert.equal(sent.at(-1).body.days.at(-1).actualFocusMs,0);
});

test('a lost epoch reply retries the same handoff before publishing and fences old queued frames',async t=>{
  const {store,directory,setNow}=fixture(t),{session}=await user(store);seed(store,session);
  const config=join(directory,'handoff-retry.json'),original={url:'https://synthetic.invalid',token:'synthetic-token-for-tests-only-12345678',sourceEpoch:'phone_owner_source_123456789'};
  const snapshot={currentName:null,startedAt:null,estimatedEndsAt:null,estimatedElapsedMs:0,todayActualFocusMs:0};
  writeFileSync(config,JSON.stringify({[session.user]:original}));new RelayForwarder(store,{configuration:config}).offer(session,{snapshot});
  const old=store.db.prepare('SELECT value FROM forwarding').get().value;
  writeFileSync(config,JSON.stringify({[session.user]:{...original,sourceEpoch:'cloud_owner_source_123456789',previousSourceEpoch:original.sourceEpoch}}));
  const sent=[];let lost=true;const fetcher=async(url,request)=>{sent.push({url,body:request.body});if(lost)throw Error('Reply lost');return new Response('{}');};
  let relay=new RelayForwarder(store,{configuration:config,fetcher});await relay.drain();
  assert.equal(sent.length,0);assert.notEqual(store.db.prepare('SELECT value FROM forwarding').get().value,old);
  await relay.drain();assert.equal(sent.length,1);assert.equal(store.db.prepare('SELECT part FROM forwarding_delivery').get().part,'handoff');
  lost=false;setNow('2026-11-15T10:00:10Z');relay=new RelayForwarder(store,{configuration:config,fetcher});await relay.drain();
  assert.equal(sent[0].body,sent[1].body);assert.equal(sent.length,4);assert.equal(store.db.prepare('SELECT count(*) n FROM forwarding').get().n,0);
});

test('delivery diagnostics identify a rejected section without retaining bodies or credentials',async t=>{
  const {store,directory,setNow}=fixture(t),{session}=await user(store);const config=join(directory,'receipt.json');writeFileSync(config,JSON.stringify({[session.user]:{url:'https://synthetic.invalid',token:'synthetic-token-for-tests-only-12345678'}}));
  let reject=true;const relay=new RelayForwarder(store,{configuration:config,fetcher:async url=>new Response('{}',{status:reject&&url.endsWith('/days')?409:200})});
  relay.offer(session,{snapshot:{currentName:null,startedAt:null,estimatedEndsAt:null,estimatedElapsedMs:0,todayActualFocusMs:0}});await relay.drain();
  let receipt=store.db.prepare('SELECT * FROM forwarding_delivery').get();assert.equal(receipt.status,409);assert.equal(receipt.part,'days');assert.equal(receipt.delivered,null);assert.ok(!JSON.stringify(receipt).includes('token'));
  reject=false;setNow('2026-11-15T10:00:10Z');await relay.drain();receipt=store.db.prepare('SELECT * FROM forwarding_delivery').get();assert.equal(receipt.status,200);assert.equal(receipt.part,'complete');assert.equal(receipt.delivered,store.clock());
});

test('a delivered live projection is cleared after expiry even when its device goes offline',async t=>{
  const {store,directory,setNow}=fixture(t),{session}=await user(store);seed(store,session);
  const config=join(directory,'expiry-forwarding.json');writeFileSync(config,JSON.stringify({[session.user]:{url:'https://synthetic.invalid',token:'synthetic-token-for-tests-only-12345678'}}));
  const sent=[];const fetcher=async(url,request)=>{sent.push({url,body:JSON.parse(request.body)});return new Response('{}');};
  let relay=new RelayForwarder(store,{configuration:config,fetcher});
  store.updateAccount(session,{friendsEnabled:true,sharing:{status:true,name:true,time:true,daily:false}});
  const snapshot={currentName:'approved',startedAt:'2026-11-15T09:55:00.000Z',estimatedElapsedMs:300000,estimatedEndsAt:'2026-11-15T10:20:00.000Z',todayActualFocusMs:300000};
  store.presence(session,snapshot,1);relay.offer(session,{snapshot});await relay.drain();
  const first=sent.findLast(x=>x.url.endsWith('/live')).body;assert.equal(first.snapshot.currentName,'approved');
  assert.equal(store.db.prepare('SELECT count(*) n FROM forwarding').get().n,0);
  relay=new RelayForwarder(store,{configuration:config,fetcher});setNow('2026-11-15T10:01:31Z');await relay.drain();
  const cleared=sent.findLast(x=>x.url.endsWith('/live')).body;assert.equal(cleared.snapshot.currentName,null);assert.ok(cleared.revision>first.revision);
  assert.equal(store.db.prepare('SELECT count(*) n FROM forwarding_expiry').get().n,0);
  const count=sent.length;await relay.drain();assert.equal(sent.length,count);
  store.presence(session,snapshot,1);store.release(session,{generation:1});assert.equal(store.db.prepare('SELECT count(*) n FROM presence').get().n,0);
});

test('live plans must reference the same project, task, history and deadline as the domain',async t=>{
  const {store}=fixture(t),{session}=await user(store);store.claim(session,{generation:0});
  const created=execute(createInitialState(),{type:'CreateProject',projectId:'project',title:'Cloud plan',blueprintId:'cottage',subtasks:[{id:'task',title:'Focus'}]},
    {now:()=>new Date('2026-11-15T10:00:00Z')});assert.equal(created.ok,true);
  const {entries}=splitDomain(created.state);
  const plan={id:'plan-1',projectId:'project',subtaskId:'task',mode:'ROUNDS',totalRounds:2,completedSessionIds:[],phase:'READY',focusDurationMs:1500000,
    restDurationMs:300000,currentSessionId:null,phaseEndsAt:null,exactEndAt:null,terminalRest:false,cancelled:false,cancellationCategory:null,cancellationNote:null,hasStarted:false};
  entries['@plan']=canonical({plan,automaticEnabled:false});push(store,session,entries);
  const before=store.entries(session.user);
  for(const change of [{projectId:'missing'},{subtaskId:'missing'},{hasStarted:true,completedSessionIds:['missing-session']},{terminalRest:true},{phaseEndsAt:'2026-11-15T11:00:00Z'}]){
    assert.throws(()=>push(store,session,{...entries,'@plan':canonical({plan:{...plan,...change},automaticEnabled:false})},before),{code:'PLAN_CONFLICT'});
    assert.deepEqual(store.entries(session.user),before);
  }
  store.capture(session.user);const restored=store.restore(session,{revision:store.head(session.user).revision,requestId:'restore-plan-12345678'});
  assert.equal(restored.entries['@plan'],undefined);assert.equal(restored.execution.owner,null);
});

test('revoking a session while its request body is still arriving prevents the write',async t=>{
  const {store}=fixture(t),{login,session}=await user(store);store.updateAccount(session,{friendsEnabled:true});
  const server=createCloudServer(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=new Promise((resolve,reject)=>{
    const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:'/v1/account',method:'PATCH',headers:{authorization:'Bearer '+login.token,'content-type':'application/json','transfer-encoding':'chunked'}},res=>{
      let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));
    });req.on('error',reject);req.flushHeaders();req.write('{"name":');
    setTimeout(()=>{store.logout(session);req.end('"should not save"}');},40);
  });
  assert.deepEqual(await response,{status:401,body:{error:'UNAUTHORIZED'}});assert.equal(store.account(session.user).name,'alice');
});
