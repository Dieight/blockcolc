import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CloudStore} from '../src/store.mjs';
import {createCloudServer} from '../src/server.mjs';
import {ExternalFocusBridge,MutsumiGuestClient,projectMutsumiDashboard} from '../src/external-focus.mjs';

const NOW=Date.parse('2026-11-15T10:00:00Z');
const source={id:'mutsumi-public',origin:'https://platform.arcol.site',accountUsername:'mutsumi_focus',name:'Mutsumi Focus',timeZone:'Asia/Shanghai'};
const dashboard=()=>({now:'2026-11-15T18:00:00+08:00',focus:{active:null,recent:[{id:42,client_token:'must-not-cross-boundary',effective_seconds:900}]},
  today_focus:{count:3,seconds:1800},focus_items:[{id:2,label:'Reading',name:'read'}],
  focus_leaderboard:{entries:[{date:'2026-11-14',seconds:3600},{date:'2026-11-15',seconds:1700}],today:{date:'2026-11-15',seconds:1800}},
  daily_settlement:{report:{timezone:'Asia/Shanghai',closing_note:'private-note'}},scores:[{score:100}],daily_plan:{tasks:['private task']}});
const active=()=>({started_at:'2026-11-15T09:30:00+00:00',ended_at:null,paused_at:null,planned_minutes:25,subject:'Study',mode:'Read',focus_item_id:2,client_token:'secret-client'});
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const guest=()=>new Response('',{headers:{'Set-Cookie':'guest_session=guest-only; Path=/; HttpOnly; Secure'}});
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'blockcolc-external-'));let now=NOW;
  const store=new CloudStore(directory,{clock:()=>now}),configuration=join(directory,'external.json');writeFileSync(configuration,JSON.stringify([source]));
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});return {store,configuration,setNow:value=>{now=value;}};
}
async function reader(store,name='reader'){
  const login=await store.register({username:name,password:'synthetic-correct-password',name,deviceId:'synthetic_device_12345',deviceName:'test',timeZone:'UTC'});
  const session=store.authenticate(login.token);store.updateAccount(session,{friendsEnabled:true});return {login,session};
}

test('public projection has an explicit allowlist, exact dates and no duplicated daily total',()=>{
  const value=projectMutsumiDashboard(dashboard(),{now:NOW});
  assert.deepEqual(value.projection,{focusing:false,focusState:'idle',currentName:null,startedAt:null,endsAt:null,days:[{date:'2026-11-15',actualFocusMs:1800000},{date:'2026-11-14',actualFocusMs:3600000}]});
  assert.equal(value.timeZone,'Asia/Shanghai');
  for(const secret of ['client_token','secret','private','scores','recent','planned_minutes'])assert.ok(!JSON.stringify(value).includes(secret));
});

test('active, paused and finished observations never fabricate a finish time from planned minutes',()=>{
  const data=dashboard();data.focus.active=active();
  let value=projectMutsumiDashboard(data,{now:NOW}).projection;assert.equal(value.focusing,true);assert.equal(value.currentName,'Reading');assert.equal(value.startedAt,'2026-11-15T09:30:00.000Z');assert.equal(value.endsAt,null);
  data.focus.active.paused_at='2026-11-15T09:55:00+00:00';value=projectMutsumiDashboard(data,{now:NOW}).projection;assert.equal(value.focusing,false);assert.equal(value.focusState,'paused');
  data.focus.active.ended_at='2026-11-15T09:56:00+00:00';value=projectMutsumiDashboard(data,{now:NOW}).projection;assert.equal(value.focusState,'idle');assert.equal(value.currentName,null);
});

test('malformed, old and ambiguous observations are rejected rather than published as idle',()=>{
  for(const modify of [d=>{delete d.focus.active;},d=>{d.focus.active=[];},d=>{d.today_focus.seconds=-1;},d=>{d.today_focus.seconds=1.5;},d=>{d.focus_leaderboard.entries[0].date='2026-02-31';},d=>{d.now='2026-11-15T10:00:00';},d=>{d.focus.active={...active(),started_at:'2026-11-16T10:00:00Z'};}]){
    const data=dashboard();modify(data);assert.throws(()=>projectMutsumiDashboard(data,{now:NOW}));
  }
  assert.throws(()=>projectMutsumiDashboard(dashboard(),{now:NOW+3600000}),{code:'EXTERNAL_STALE'});
});

test('source date follows its timezone across UTC midnight, not the reader or host timezone',()=>{
  const data=dashboard();data.now='2026-11-16T00:30:00+08:00';data.focus_leaderboard.today.date='2026-11-16';
  const value=projectMutsumiDashboard(data,{now:Date.parse(data.now)}).projection;
  assert.equal(value.days[0].date,'2026-11-16');assert.equal(value.days[0].actualFocusMs,1800000);
});

test('guest cookie and same-origin redirects are reused with GET requests only',async()=>{
  const calls=[];const client=new MutsumiGuestClient({username:'source_owner',fetcher:async(url,init)=>{
    calls.push({url,init});
    if(calls.length===1)return new Response(null,{status:302,headers:{Location:'/source_owner/','Set-Cookie':'guest_session=public; Path=/; HttpOnly; Secure'}});
    if(url.endsWith('/api/dashboard'))return json(dashboard());return new Response('public dashboard');
  }});
  await client.dashboard();await client.dashboard();assert.equal(calls.length,4);
  assert.equal(calls[0].url,'https://platform.arcol.site/source_owner/guest');
  for(const call of calls){assert.equal(call.init.method,'GET');assert.equal(call.init.redirect,'manual');assert.ok(!call.init.headers.Authorization);assert.ok(!call.init.body);}
  assert.equal(calls[2].init.headers.Cookie,'guest_session=public');assert.equal(calls[3].init.headers.Cookie,'guest_session=public');
});

test('an expired guest session is refreshed once without a login/reporting key',async()=>{
  let sessions=0,reads=0;const client=new MutsumiGuestClient({fetcher:async url=>{
    if(url.endsWith('/guest')){sessions++;return guest();}
    return ++reads===1?new Response('{}',{status:401}):json(dashboard());
  }});
  assert.ok((await client.dashboard()).focus);assert.equal(sessions,2);assert.equal(reads,2);
  const blocked=new MutsumiGuestClient({fetcher:async url=>url.endsWith('/guest')?guest():new Response('{}',{status:401})});
  await assert.rejects(blocked.dashboard(),{code:'EXTERNAL_HTTP_401'});
});

test('cross-origin redirects cannot receive guest cookies; oversized and HTML responses are rejected',async()=>{
  const calls=[];const redirect=new MutsumiGuestClient({fetcher:async(url,init)=>{calls.push({url,init});return new Response(null,{status:302,headers:{Location:'https://elsewhere.invalid/','Set-Cookie':'guest_session=private; Path=/'}});}});
  await assert.rejects(redirect.dashboard(),{code:'EXTERNAL_REDIRECT'});assert.equal(calls.length,1);
  for(const body of ['x'.repeat(2*1024*1024+1),'<html>login required</html>']){
    const client=new MutsumiGuestClient({fetcher:async url=>url.endsWith('/guest')?guest():new Response(body)});await assert.rejects(client.dashboard());
  }
});

test('a public source has one durable account, no login and explicit read-only friend consent',async t=>{
  const {store,configuration,setNow}=fixture(t);let calls=0;
  const fetcher=async url=>{calls++;return url.endsWith('/guest')?guest():json(dashboard());};
  let bridge=new ExternalFocusBridge(store,{configuration,fetcher});await bridge.poll();
  const first=bridge.descriptions()[0],{session}=await reader(store);
  assert.equal(store.friends(session).length,0);store.invite(session,first.friendCode);
  let friend=store.friends(session)[0];assert.equal(friend.status,'accepted');assert.equal(friend.readOnly,true);assert.equal(friend.source.kind,'mutsumi-focus');assert.equal(friend.days[0].actualFocusMs,1800000);
  assert.ok(!Object.hasOwn(friend,'sharing'));assert.ok(!Object.hasOwn(friend,'visible'));
  assert.equal(store.db.prepare('SELECT count(*) n FROM entries WHERE user=?').get(first.account).n,0);
  assert.equal(store.db.prepare('SELECT count(*) n FROM devices WHERE user=?').get(first.account).n,0);
  await assert.rejects(store.login({username:source.accountUsername,password:'synthetic-correct-password',deviceId:'another_device_12345',deviceName:'test'}),{code:'LOGIN_FAILED'});
  assert.throws(()=>store.friendPolicy(session,first.account,{status:true,name:true,time:true,daily:true}),{code:'READ_ONLY_FRIEND'});
  await bridge.stop();bridge=new ExternalFocusBridge(store,{configuration,fetcher});assert.equal(bridge.descriptions()[0].account,first.account);assert.equal(bridge.descriptions()[0].friendCode,first.friendCode);
  assert.equal(store.friends(session)[0].days.length,2);setNow(NOW+91000);friend=store.friends(session)[0];assert.equal(friend.stale,true);assert.equal(friend.focusing,undefined);assert.equal(friend.days,undefined);
  store.relation(session,first.account,'remove');assert.equal(store.friends(session).length,0);await bridge.stop();assert.equal(calls,2);
});

test('failed or revoked reads hide stale facts without changing a local/cloud workspace',async t=>{
  const {store,configuration}=fixture(t);let failRead=false,invalidSchema=false;
  const bridge=new ExternalFocusBridge(store,{configuration,fetcher:async url=>{
    if(url.endsWith('/guest'))return guest();if(failRead)return new Response('{}',{status:403});return json(invalidSchema?{}:dashboard());
  }});await bridge.poll();const sourceAccount=bridge.descriptions()[0],{session}=await reader(store);store.invite(session,sourceAccount.friendCode);
  const before=JSON.stringify(store.workspace(session)),projection=store.db.prepare('SELECT projection FROM external_sources').get().projection;
  failRead=true;await bridge.poll({force:true});assert.equal(store.friends(session)[0].stale,true);assert.equal(store.friends(session)[0].days,undefined);
  failRead=false;invalidSchema=true;await bridge.poll({force:true});assert.equal(store.db.prepare('SELECT projection FROM external_sources').get().projection,projection);
  invalidSchema=false;await bridge.poll({force:true});assert.equal(store.friends(session)[0].days.length,2);assert.equal(JSON.stringify(store.workspace(session)),before);
  await bridge.stop();writeFileSync(configuration,'[]');const disabled=new ExternalFocusBridge(store,{configuration});assert.equal(store.friends(session)[0].stale,true);assert.equal(store.db.prepare('SELECT projection FROM external_sources').get().projection,null);await disabled.stop();
});

test('polls are coalesced and shutdown cancels outstanding reads before the store closes',async t=>{
  const {store,configuration}=fixture(t);let calls=0;
  const bridge=new ExternalFocusBridge(store,{configuration,fetcher:async(_url,init)=>{
    calls++;return await new Promise((resolve,reject)=>{if(init.signal.aborted)reject(init.signal.reason);else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
  }});
  const first=bridge.poll(),second=bridge.poll();assert.equal(first,second);await bridge.stop();await first;assert.equal(calls,1);assert.equal(bridge.descriptions()[0].available,false);
});

test('a configured identity cannot silently become a different remote user',async t=>{
  const {store,configuration}=fixture(t),bridge=new ExternalFocusBridge(store,{configuration});const account=bridge.descriptions()[0];await bridge.stop();
  writeFileSync(configuration,JSON.stringify([{...source,username:'different_owner'}]));
  assert.throws(()=>new ExternalFocusBridge(store,{configuration}),{code:'EXTERNAL_IDENTITY_CHANGED'});
  assert.equal(store.account(account.account).friendCode,account.friendCode);
});

test('normal friends still require acceptance and their disclosure policy remains independent',async t=>{
  const {store,configuration}=fixture(t),bridge=new ExternalFocusBridge(store,{configuration});
  const {session:a}=await reader(store,'alice'),{login:bLogin,session:b}=await reader(store,'bob');
  store.invite(a,bLogin.account.friendCode);assert.equal(store.friends(a)[0].status,'pending');store.relation(b,a.user,'accept');
  const friend=store.friends(a)[0];assert.equal(friend.readOnly,undefined);assert.equal(friend.days,undefined);assert.equal(friend.currentName,undefined);await bridge.stop();
});

test('HTTP friend code reads the imported projection only after authenticated opt-in',async t=>{
  const {store,configuration}=fixture(t),bridge=new ExternalFocusBridge(store,{configuration,fetcher:async url=>url.endsWith('/guest')?guest():json(dashboard())});await bridge.poll();
  const account=bridge.descriptions()[0],{login}=await reader(store),server=createCloudServer(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+login.token,'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/v1/friends')).status,401);assert.deepEqual(await(await fetch(base+'/v1/friends',{headers})).json(),{friends:[]});
  assert.equal((await fetch(base+'/v1/friends/invite',{method:'POST',headers,body:JSON.stringify({code:account.friendCode})})).status,200);
  const body=await(await fetch(base+'/v1/friends',{headers})).json();assert.equal(body.friends[0].name,'Mutsumi Focus');assert.equal(body.friends[0].readOnly,true);assert.equal(body.friends[0].days[0].actualFocusMs,1800000);await bridge.stop();
});
