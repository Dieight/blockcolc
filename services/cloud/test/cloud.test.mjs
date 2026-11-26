import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CloudStore} from '../src/store.mjs';
import {createCloudServer} from '../src/server.mjs';
import {FocusViewerStore} from '../src/focus-viewer-store.mjs';
import {createInitialState,execute} from '../build/domain.mjs';
import {canonical,sha,splitDomain} from '../src/wire.mjs';
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
test('logout hides the signed-out device, preserves the other device, and fences replacement',async t=>{
  const {store}=fixture(t),{session:a}=await user(store),{entries}=seed(store,a),b=await otherDevice(store);
  store.logout(a);
  assert.deepEqual(store.devices(b).map(d=>[d.id,d.current]),[[b.device,true]]);
  const head=store.workspace(b);
  assert.equal(head.execution.owner,null);
  const claimed=store.claim(b,{generation:head.execution.generation});
  store.revokeDevice(b,a.device);
  assert.deepEqual(store.workspace(b).execution,claimed);
  const input={revision:head.revision,entries,execution:claimed.generation,requestId:'owned-replacement-123'};
  assert.throws(()=>store.replace(a,input),{code:'UNAUTHORIZED'});
  const replaced=store.replace(b,input);
  assert.notEqual(replaced.epoch,head.epoch);
  assert.deepEqual(replaced.execution,{owner:b.device,generation:claimed.generation+1});
  assert.deepEqual(store.replace(b,input),replaced);
  assert.deepEqual(store.workspace(b),replaced);
  assert.throws(()=>store.replace(b,{...input,revision:replaced.revision,requestId:'stale-owned-replacement-123'}),{code:'EXECUTION_CHANGED'});
});
test('extended focus stays live without a fixed end and respects friend time sharing',async t=>{
  const {store,setNow}=fixture(t),{session:a}=await user(store),{session:b}=await user(store,'bob');
  const viewingDevice=await otherDevice(store);
  const {generation}=store.claim(a,{generation:0});
  const policy={status:true,name:true,time:true,daily:false};
  store.updateAccount(a,{friendsEnabled:true,sharing:policy});store.updateAccount(b,{friendsEnabled:true});
  store.invite(b,store.account(a.user).friendCode);store.relation(a,b.user,'accept');
  const snapshot={currentName:'专注中',startedAt:'2026-11-15T09:00:00.000Z',estimatedEndsAt:null,estimatedElapsedMs:3600000,todayActualFocusMs:0};
  store.presence(a,snapshot,generation);
  const viewer=new FocusViewerStore(store,{owner:a.user,from:'2026-11-14'});
  const live=viewer.snapshot().live.snapshot;
  assert.equal(live.waitingForEnd,true);assert.equal(live.estimatedEndsAt,null);assert.equal(live.currentName,'专注中');
  const friend=()=>store.friends(b).find(row=>row.id===a.user);
  assert.equal(friend().waitingForEnd,true);assert.equal(friend().focusing,true);
  store.logout(viewingDevice);
  assert.equal(friend().focusing,true);
  store.updateAccount(a,{sharing:{...policy,time:false}});assert.equal(friend().waitingForEnd,undefined);
  setNow('2026-11-15T10:01:31Z');
  assert.equal(viewer.snapshot().live.snapshot.currentName,null);assert.equal(friend().stale,true);
});
test('the workspace and viewer retain the planned round when a short extension is synced',async t=>{
  const {store,setNow}=fixture(t),{session}=await user(store);
  const {generation}=store.claim(session,{generation:0});
  let domain=createInitialState();
  const run=(command,time)=>{
    const result=execute(domain,command,{now:()=>new Date(time)});
    assert.equal(result.ok,true,result.error);domain=result.state;
  };
  const originalStart='2026-11-15T09:59:00.000Z';
  const extensionStart='2026-11-15T10:00:00.000Z';
  const firstId='session:short-extension:1:initial';
  const extensionId='session:short-extension:extension:MINIMAL:1';
  run({type:'CreateProject',projectId:'project',title:'Focus',blueprintId:'cottage',subtasks:[{id:'task',title:'Task'}]},originalStart);
  const start=(id,at)=>run({type:'StartFocus',sessionId:id,projectId:'project',subtaskId:null,
    plannedDurationMs:60000,marathon:true,deferredSettlement:true},at);
  start(firstId,originalStart);
  const basePlan={id:'short-extension',projectId:'project',subtaskId:null,mode:'MINIMAL',totalRounds:1,completedSessionIds:[],
    phase:'FOCUS',focusDurationMs:60000,restDurationMs:0,currentSessionId:firstId,phaseEndsAt:extensionStart,exactEndAt:extensionStart,
    terminalRest:false,cancelled:false,cancellationCategory:null,cancellationNote:null,hasStarted:true,extendAfterPlan:true};
  let previous={};
  const commit=plan=>{
    const {entries}=splitDomain(domain);
    entries['@plan']=canonical({plan,automaticEnabled:false});
    push(store,session,entries,previous);
    previous=entries;
  };
  setNow('2026-11-15T09:59:30Z');commit(basePlan);
  store.presence(session,{currentName:'专注中',startedAt:originalStart,estimatedEndsAt:extensionStart,
    estimatedElapsedMs:30000,todayActualFocusMs:0},generation);
  const viewer=new FocusViewerStore(store,{owner:session.user,from:'2026-11-15'});
  assert.equal(viewer.snapshot().live.snapshot.estimatedEndsAt,extensionStart);

  run({type:'CompleteFocus'},extensionStart);start(extensionId,extensionStart);
  const extending={...basePlan,completedSessionIds:[firstId],currentSessionId:extensionId,phaseEndsAt:domain.activeFocusSession.endsAt,
    extensionStartedAt:extensionStart,extensionRounds:0};
  setNow('2026-11-15T10:00:10Z');commit(extending);
  store.presence(session,{currentName:'专注中',startedAt:extensionStart,estimatedEndsAt:null,
    estimatedElapsedMs:10000,todayActualFocusMs:60000},generation);
  const live=viewer.snapshot().live.snapshot;
  assert.equal(live.waitingForEnd,true);
  assert.equal(live.todayActualFocusMs,60000);

  const stop='2026-11-15T10:00:23.000Z';
  run({type:'CancelFocus'},stop);
  setNow(stop);commit({...extending,phase:'REPORT',currentSessionId:null,phaseEndsAt:null});
  store.presence(session,{currentName:null,startedAt:null,estimatedEndsAt:null,estimatedElapsedMs:0,todayActualFocusMs:83000},generation);
  assert.equal(viewer.snapshot().live.snapshot.currentName,null);
  assert.equal(viewer.snapshot().live.snapshot.todayActualFocusMs,83000);
  const saved=store.workspace(session).entries;
  assert.equal(JSON.parse(saved['focusHistory/'+firstId]).value.status,'completed');
  assert.equal(JSON.parse(saved['focusHistory/'+extensionId]).value.actualDurationMs,23000);
  assert.equal(JSON.parse(saved['@plan']).plan.extensionRounds,0);
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
test('multiple friend summaries keep history behind separate per-friend disclosure',async t=>{
  const {store}=fixture(t);
  const {session:reader,login}=await user(store,'reader');
  const {session:shared,login:sharedLogin}=await user(store,'shared');
  const {session:privateFriend,login:privateLogin}=await user(store,'hidden');
  const {session:pending,login:pendingLogin}=await user(store,'pending');
  for(const session of [reader,shared,privateFriend,pending])store.updateAccount(session,{friendsEnabled:true});
  for(const code of [sharedLogin,privateLogin,pendingLogin].map(value=>value.account.friendCode))store.invite(reader,code);
  store.relation(shared,reader.user,'accept');
  store.relation(privateFriend,reader.user,'accept');
  store.updateAccount(shared,{sharing:{status:true,name:true,time:true,daily:true}});
  seed(store,shared);
  store.presence(shared,{currentName:'Shared task',startedAt:'2026-11-15T09:55:00.000Z',
    estimatedElapsedMs:300000,estimatedEndsAt:'2026-11-15T10:20:00.000Z',todayActualFocusMs:0},1);
  for(let i=0;i<370;i++){
    const startedAt=new Date(Date.UTC(2026,10,15,8)-i*86400000).toISOString();
    const wire=canonical({ordinal:i,value:{startedAt,actualDurationMs:60000}});
    store.db.prepare('INSERT INTO sync_entries VALUES(?,?,?,?)').run(shared.user,'focusHistory/day-'+i,wire,sha(wire));
  }
  const server=createCloudServer(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port;
  const get=path=>fetch(origin+'/v1/friends/'+path,{headers:{Authorization:'Bearer '+login.token}});
  const overview=(await(await get('summary')).json()).friends;
  assert.equal(overview.length,3);
  const active=overview.find(friend=>friend.id===shared.user);
  assert.equal(active.currentName,'Shared task');
  assert.equal(active.startedAt,'2026-11-15T09:55:00.000Z');
  assert.equal(active.endsAt,'2026-11-15T10:20:00.000Z');
  assert.equal(typeof active.historyRevision,'string');
  assert.ok(overview.every(friend=>!Object.hasOwn(friend,'days')));
  assert.ok(overview.filter(friend=>friend.id!==shared.user).every(friend=>!Object.hasOwn(friend,'historyRevision')));
  const all=await(await get('history/'+shared.user)).json();
  assert.equal(all.today,'2026-11-15');
  assert.equal(all.complete,true);
  assert.equal(all.days.length,370);
  assert.equal(all.days.at(-1).date,new Date(Date.UTC(2026,10,15)-369*86400000).toISOString().slice(0,10));
  assert.equal(store.friends(reader).find(friend=>friend.id===shared.user).days.length,366);
  assert.equal((await get('history/'+privateFriend.user)).status,403);
  assert.equal((await get('history/'+pending.user)).status,404);
  store.friendPolicy(shared,reader.user,{status:false,name:false,time:false,daily:false});
  assert.equal((await get('history/'+shared.user)).status,403);
});

test('HTTP protocol rejects malformed/unauthorized bodies and survives',async t=>{
  const {store}=fixture(t),server=createCloudServer(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(url+'/v1/workspace')).status,401);assert.equal((await fetch(url+'/v1/login',{method:'POST',body:'{'})).status,400);
  assert.deepEqual(await(await fetch(url+'/healthz')).json(),{ok:true,protocol:1});
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
