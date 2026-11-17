import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {accountDate,canonical,fail} from './wire.mjs';

const KIND='mutsumi-focus',ORIGIN='https://platform.arcol.site',MAX_BYTES=2*1024*1024;
const random=()=>randomBytes(32).toString('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const seconds=value=>Number.isSafeInteger(value)&&value>=0&&value<=86400;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const instant=value=>typeof value==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));

/** Only public focus facts cross this boundary. Never store the dashboard,
 * cookies, client tokens, exam results, plans, check-ins or reported sessions
 * as if they had been completed inside blockcolc. */
export function projectMutsumiDashboard(value,{now=Date.now(),timeZone='Asia/Shanghai'}={}){
  fail(object(value)&&object(value.focus)&&Object.hasOwn(value.focus,'active')&&object(value.today_focus)&&seconds(value.today_focus.seconds)&&instant(value.now),'EXTERNAL_SCHEMA');
  const observedAt=Date.parse(value.now);
  fail(Math.abs(now-observedAt)<=5*60000,'EXTERNAL_STALE');
  const reportedZone=value.daily_settlement?.report?.timezone;
  if(typeof reportedZone==='string'){accountDate(now,reportedZone);timeZone=reportedZone;}
  const today=accountDate(observedAt,timeZone),totals=new Map();
  const leaderboard=value.focus_leaderboard;
  if(leaderboard!=null){
    fail(object(leaderboard)&&Array.isArray(leaderboard.entries)&&leaderboard.entries.length<=10000,'EXTERNAL_SCHEMA');
    for(const row of leaderboard.entries){
      fail(object(row)&&date(row.date)&&seconds(row.seconds),'EXTERNAL_SCHEMA');
      if(row.date<=today)totals.set(row.date,row.seconds*1000);
    }
    if(leaderboard.today!=null)fail(object(leaderboard.today)&&leaderboard.today.date===today&&seconds(leaderboard.today.seconds),'EXTERNAL_SCHEMA');
  }
  // The current total already contains active focus; do not add recent
  // sessions, the heatmap and the all-time total to it again.
  totals.set(today,value.today_focus.seconds*1000);
  const active=value.focus.active;
  let currentName=null,startedAt=null,focusState='idle';
  if(active!==null){
    fail(object(active)&&instant(active.started_at)&&(active.ended_at==null||instant(active.ended_at))&&(active.paused_at==null||instant(active.paused_at)),'EXTERNAL_SCHEMA');
    if(active.ended_at==null){
      const start=Date.parse(active.started_at);fail(start<=observedAt+30000,'EXTERNAL_SCHEMA');
      startedAt=new Date(start).toISOString();focusState=active.paused_at?'paused':'focus';
      const item=Array.isArray(value.focus_items)?value.focus_items.find(row=>object(row)&&row.id===active.focus_item_id):null;
      const name=item?.label??item?.name??active.mode??active.subject;
      fail(typeof name==='string'&&name.trim().length>0&&name.length<=512,'EXTERNAL_SCHEMA');currentName=name.trim();
    }
  }
  return {observedAt,timeZone,projection:{focusing:focusState==='focus',focusState,currentName,startedAt,
    // A planned duration on the other app is not a promised finish time.
    endsAt:null,days:[...totals].sort(([a],[b])=>b.localeCompare(a)).map(([date,actualFocusMs])=>({date,actualFocusMs}))}};
}

async function readBounded(response){
  fail(response.body,'EXTERNAL_RESPONSE');
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;fail(length<=MAX_BYTES,'EXTERNAL_RESPONSE_TOO_LARGE');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks,length).toString('utf8');
}

/** Dedicated, memory-only guest session; redirects and cookies never leave
 * the configured public origin. This client has no reporting credentials. */
export class MutsumiGuestClient {
  constructor({username,fetcher=fetch,timeoutMs=10000,signal}={}){
    fail(username==null||typeof username==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(username));
    this.guest=username?'/'+encodeURIComponent(username)+'/guest':'/guest';
    this.fetcher=fetcher;this.timeoutMs=timeoutMs;this.signal=signal;this.cookies=new Map();this.ready=false;
  }
  async request(path){
    let url=new URL(path,ORIGIN);
    const signal=this.signal?AbortSignal.any([this.signal,AbortSignal.timeout(this.timeoutMs)]):AbortSignal.timeout(this.timeoutMs);
    for(let hop=0;hop<4;hop++){
      fail(url.origin===ORIGIN&&!url.username&&!url.password,'EXTERNAL_REDIRECT');
      const cookie=[...this.cookies.values()].filter(c=>url.pathname===c.path||url.pathname.startsWith(c.path.endsWith('/')?c.path:c.path+'/')).map(c=>c.value).join('; ');
      const response=await this.fetcher(url.href,{method:'GET',redirect:'manual',signal,headers:{Accept:'application/json','User-Agent':'blockcolc-cloud/1',...(cookie?{Cookie:cookie}:{})}});
      for(const line of response.headers.getSetCookie()){
        const [pair,...attributes]=line.split(';').map(v=>v.trim()),at=pair.indexOf('=');if(at<1)continue;
        const name=pair.slice(0,at);let path='/',allowed=true,remove=false;
        for(const entry of attributes){const [key,...parts]=entry.split('='),value=parts.join('=');
          if(key.toLowerCase()==='domain'&&value.replace(/^\./,'').toLowerCase()!=='platform.arcol.site')allowed=false;
          if(key.toLowerCase()==='path')path=value.startsWith('/')?value:'/';
          if(key.toLowerCase()==='max-age'&&Number(value)<=0)remove=true;
          if(key.toLowerCase()==='expires'&&Date.parse(value)<=Date.now())remove=true;
        }
        if(allowed){if(remove)this.cookies.delete(name+'|'+path);else this.cookies.set(name+'|'+path,{path,value:pair});}
      }
      if([301,302,303,307,308].includes(response.status)){
        await response.body?.cancel();const location=response.headers.get('location');fail(location,'EXTERNAL_REDIRECT');url=new URL(location,url);continue;
      }
      return response;
    }
    throw Error('External redirect limit');
  }
  async openGuest(){
    const response=await this.request(this.guest);await response.body?.cancel();
    fail(response.ok,'EXTERNAL_GUEST');this.ready=true;
  }
  async dashboard(){
    if(!this.ready)await this.openGuest();
    let response=await this.request('/api/dashboard');
    if(response.status===401){await response.body?.cancel();this.cookies.clear();this.ready=false;await this.openGuest();response=await this.request('/api/dashboard');}
    if(!response.ok){await response.body?.cancel();fail(false,'EXTERNAL_HTTP_'+response.status);}
    const text=await readBounded(response);
    try{return JSON.parse(text);}catch{throw Error('External JSON unavailable');}
  }
}

export class ExternalFocusBridge {
  constructor(store,{configuration,fetcher=fetch,timeoutMs=10000}={}){
    this.store=store;this.abort=new AbortController();this.clients=new Map();this.running=null;this.next=new Map();
    const sources=configuration?JSON.parse(readFileSync(configuration,'utf8')):[];
    fail(Array.isArray(sources)&&sources.length<=16);
    const ids=new Set(),names=new Set();
    for(const source of sources){
      fail(object(source)&&Object.keys(source).every(k=>['id','origin','username','accountUsername','name','timeZone'].includes(k)));
      fail(typeof source.id==='string'&&/^[a-z0-9_-]{3,64}$/.test(source.id)&&!ids.has(source.id));ids.add(source.id);
      fail(source.origin===ORIGIN&&/^[a-z0-9_]{3,32}$/.test(source.accountUsername)&&!names.has(source.accountUsername));names.add(source.accountUsername);
      fail(typeof source.name==='string'&&source.name.trim().length>0&&source.name.length<=64);
      accountDate(store.clock(),source.timeZone??'Asia/Shanghai');
      this.clients.set(source.id,new MutsumiGuestClient({...source,fetcher,timeoutMs,signal:this.abort.signal}));
    }
    store.transaction(()=>{
      for(const source of sources){
        const prior=store.db.prepare('SELECT * FROM external_sources WHERE id=?').get(source.id);
        if(prior){
          fail(store.account(prior.user).username===source.accountUsername&&prior.remote_account===(source.username??''),'EXTERNAL_IDENTITY_CHANGED');
          store.db.prepare('UPDATE accounts SET name=? WHERE id=?').run(source.name.trim(),prior.user);
          store.db.prepare('UPDATE external_sources SET origin=?,enabled=1 WHERE id=?').run(source.origin,source.id);
        }else{
          fail(!store.db.prepare('SELECT 1 FROM accounts WHERE username=?').get(source.accountUsername),'EXTERNAL_ACCOUNT_EXISTS');
          const user=randomUUID(),now=store.clock();
          store.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?,?,?)').run(user,source.accountUsername,source.name.trim(),random(),random(),randomBytes(9).toString('hex').toUpperCase(),source.timeZone??'Asia/Shanghai',canonical({status:true,name:true,time:true,daily:true}),1,now);
          store.db.prepare('INSERT INTO heads(user,epoch,changed) VALUES(?,?,?)').run(user,randomUUID(),now);
          store.db.prepare('INSERT INTO external_sources(id,user,kind,origin,remote_account) VALUES(?,?,?,?,?)').run(source.id,user,KIND,source.origin,source.username??'');
        }
      }
      for(const row of store.db.prepare('SELECT id FROM external_sources WHERE kind=?').all(KIND))if(!ids.has(row.id))store.db.prepare("UPDATE external_sources SET enabled=0,projection=NULL,expires=0,error='SOURCE_DISABLED' WHERE id=?").run(row.id);
    });
  }
  descriptions(){return [...this.clients.keys()].map(id=>{const row=this.store.db.prepare('SELECT * FROM external_sources WHERE id=?').get(id),account=this.store.account(row.user);return {id,account:account.id,username:account.username,name:account.name,friendCode:account.friendCode,syncedAt:row.updated?new Date(row.updated).toISOString():null,available:!!row.projection&&!row.error&&row.expires>this.store.clock()};});}
  poll({force=false}={}){
    if(this.running)return this.running;
    this.running=this.run(force).finally(()=>{this.running=null;});return this.running;
  }
  async run(force){
    for(const [id,client]of this.clients){
      if(this.abort.signal.aborted)return;
      if(!force&&(this.next.get(id)??0)>this.store.clock())continue;
      try{
        const row=this.store.db.prepare('SELECT user FROM external_sources WHERE id=?').get(id);
        const {projection,observedAt,timeZone}=projectMutsumiDashboard(await client.dashboard(),{now:this.store.clock(),timeZone:this.store.account(row.user).timeZone});
        if(this.abort.signal.aborted)return;
        this.store.transaction(()=>{
          this.store.db.prepare('UPDATE accounts SET zone=? WHERE id=?').run(timeZone,row.user);
          this.store.db.prepare('UPDATE external_sources SET projection=?,updated=?,expires=?,error=NULL WHERE id=?').run(canonical(projection),observedAt,this.store.clock()+90000,id);
        });
        this.next.set(id,this.store.clock()+30000);
      }catch{
        if(this.abort.signal.aborted)return;
        // Keep the last good receipt for diagnosis, but stop publishing it as
        // current data immediately. No raw exception, URL or body is logged.
        this.store.db.prepare("UPDATE external_sources SET error='UNAVAILABLE',expires=0 WHERE id=?").run(id);
        this.next.set(id,this.store.clock()+60000);
      }
    }
  }
  async stop(){this.abort.abort();await this.running;}
}
