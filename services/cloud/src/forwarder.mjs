import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {canonical,fail,accountDate} from './wire.mjs';
const empty=()=>({currentName:null,startedAt:null,estimatedElapsedMs:0,estimatedEndsAt:null,todayActualFocusMs:0});

/** One durable, coalesced private projection per operator-bound account.
 * The owner authorized this personal destination independently of friends'
 * visibility. There is no client-side forwarding switch or public binding API. */
export class RelayForwarder {
  constructor(store,{configuration,fetcher=fetch}={}){
    this.store=store;this.fetcher=fetcher;this.running=false;
    this.config=configuration?JSON.parse(readFileSync(configuration,'utf8')):{};
    store.db.exec(`CREATE TABLE IF NOT EXISTS forwarding_enabled(user TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS forwarding_sequence(user TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,epoch TEXT NOT NULL,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS forwarding_expiry(user TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,at INTEGER NOT NULL);`);
    store.db.exec(`CREATE TABLE IF NOT EXISTS forwarding_delivery(user TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,version INTEGER NOT NULL,status INTEGER,part TEXT NOT NULL,checked INTEGER NOT NULL,delivered INTEGER);`);
    store.db.exec(`CREATE TABLE IF NOT EXISTS forwarding_ready(user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,epoch TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(user,epoch));
      CREATE TABLE IF NOT EXISTS forwarding_handoff(user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,epoch TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(user,epoch));`);
    for(const target of Object.values(this.config)){
      const url=new URL(target.url);fail(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&typeof target.token==='string'&&target.token.length>=32);
      if(target.sourceEpoch!=null)fail(/^[a-zA-Z0-9_-]{16,80}$/.test(target.sourceEpoch));
      if(target.previousSourceEpoch!=null)fail(typeof target.sourceEpoch==='string'&&/^[a-zA-Z0-9_-]{16,80}$/.test(target.previousSourceEpoch)&&target.sourceEpoch!==target.previousSourceEpoch);
      if(target.initialHistoryCount!=null)fail(typeof target.sourceEpoch==='string'&&Number.isSafeInteger(target.initialHistoryCount)&&target.initialHistoryCount>0&&target.initialHistoryCount<=1000000);
      if(target.enrolledDate!=null)fail(typeof target.enrolledDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(target.enrolledDate)&&Number.isFinite(Date.parse(target.enrolledDate+'T00:00:00Z'))&&new Date(target.enrolledDate+'T00:00:00Z').toISOString().slice(0,10)===target.enrolledDate&&target.enrolledDate<=accountDate(store.clock(),'Asia/Shanghai'));
    }
  }
  available(user){return Object.hasOwn(this.config,user)&&!this.store.db.prepare('SELECT 1 FROM external_sources WHERE user=?').get(user);}
  ready(user,target){
    if(target.initialHistoryCount==null)return true;
    if(this.store.db.prepare('SELECT 1 FROM forwarding_ready WHERE user=? AND epoch=?').get(user,target.sourceEpoch))return true;
    const count=this.store.db.prepare("SELECT count(*) n FROM entries WHERE user=? AND key LIKE 'focusHistory/%'").get(user).n;
    if(count<target.initialHistoryCount){
      this.store.db.prepare("INSERT INTO forwarding_delivery VALUES(?,0,NULL,'awaiting-history',?,NULL) ON CONFLICT(user) DO UPDATE SET status=NULL,part='awaiting-history',checked=excluded.checked").run(user,this.store.clock());
      return false;
    }
    this.store.db.prepare('INSERT OR IGNORE INTO forwarding_ready VALUES(?,?,?)').run(user,target.sourceEpoch,this.store.clock());
    return true;
  }
  policyChanged(session){const live=this.store.db.prepare('SELECT value,expires FROM presence WHERE user=?').get(session.user);
    const snapshot=live&&live.expires>this.store.clock()?JSON.parse(live.value):empty();delete snapshot.updatedAt;this.offer(session,{snapshot});
  }
  offer(session,{snapshot}){
    const user=session.user,target=this.config[user];if(!target||!this.available(user)||!this.ready(user,target))return;
    const now=this.store.clock();
    const start=Date.parse(snapshot.startedAt),end=Date.parse(snapshot.estimatedEndsAt);
    const live=snapshot.currentName&&start<=now&&end>now?{currentName:snapshot.currentName,startedAt:snapshot.startedAt,estimatedEndsAt:snapshot.estimatedEndsAt,estimatedElapsedMs:Math.min(now,end)-start}:empty();
    const totals=this.store.dayTotals(user,'Asia/Shanghai'),today=accountDate(now,'Asia/Shanghai'),days=[];
    live.todayActualFocusMs=Math.max(snapshot.todayActualFocusMs,totals[today]??0);
    for(let i=365;i>=0;i--){const date=new Date(Date.parse(today+'T00:00:00Z')-i*86400000).toISOString().slice(0,10);if(target.enrolledDate&&date<target.enrolledDate)continue;days.push({date,actualFocusMs:totals[date]??0,confirmed:date<today});}
    this.store.transaction(()=>{
      const old=this.store.db.prepare('SELECT * FROM forwarding_sequence WHERE user=?').get(user);
      const epoch=target.sourceEpoch??old?.epoch??randomUUID(),revision=Math.max((old?.revision??0)+1,now);
      this.store.db.prepare('INSERT INTO forwarding_sequence VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET epoch=excluded.epoch,revision=excluded.revision').run(user,epoch,revision);
      const meta={schemaVersion:1,sourceEpoch:epoch,revision,capturedAt:new Date(now).toISOString()};
      this.store.db.prepare('INSERT INTO forwarding(user,version,value) VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET version=excluded.version,value=excluded.value,attempts=0,after=0')
        .run(user,revision,canonical({live:{...meta,snapshot:live},days:{...meta,days}}));
      // Keep expiry after successful delivery too. Otherwise an offline App
      // would never enqueue the clear once the outbound row had been removed.
      if(live.currentName)this.store.db.prepare('INSERT INTO forwarding_expiry VALUES(?,?) ON CONFLICT(user) DO UPDATE SET at=excluded.at').run(user,Math.min(now+90000,end));
      else this.store.db.prepare('DELETE FROM forwarding_expiry WHERE user=?').run(user);
    });
  }
  async drain(){if(this.running)return;this.running=true;
    try{
      for(const row of this.store.db.prepare('SELECT user FROM forwarding_expiry WHERE at<=? LIMIT 8').all(this.store.clock())){
        this.offer({user:row.user},{snapshot:empty()});
        // Removed targets cannot keep the expiry scan stuck on the same rows.
        this.store.db.prepare('DELETE FROM forwarding_expiry WHERE user=?').run(row.user);
      }
      for(const row of this.store.db.prepare('SELECT * FROM forwarding WHERE after<=? LIMIT 8').all(this.store.clock())){
      const target=this.config[row.user];if(!target||!this.available(row.user)||!this.ready(row.user,target))continue;
      let status=null,part='connection';
      try{const value=JSON.parse(row.value);
        if(target.sourceEpoch&&value.live.sourceEpoch!==target.sourceEpoch){
          this.offer({user:row.user},{snapshot:value.live.snapshot});continue;
        }
        // Protocol fixes replace queued bytes under a new version. A retry
        // of an old version must remain immutable, including partial success.
        if(target.enrolledDate&&value.days.days.some(day=>day.date<target.enrolledDate)){
          this.offer({user:row.user},{snapshot:value.live.snapshot});continue;
        }
        // Retried revisions are immutable even if the reply was lost. Expiry
        // is a new fenced clear, rather than altered bytes under the old ID.
        if(value.live.snapshot.estimatedEndsAt&&Date.parse(value.live.snapshot.estimatedEndsAt)<=this.store.clock()){
          this.offer({user:row.user},{snapshot:{...empty(),todayActualFocusMs:value.live.snapshot.todayActualFocusMs}});continue;
        }
        // An explicit, idempotent handoff fences the old phone uploader.
        // A lost reply retries the same pair before any live/day replacement.
        if(target.previousSourceEpoch&&!this.store.db.prepare('SELECT 1 FROM forwarding_handoff WHERE user=? AND epoch=?').get(row.user,target.sourceEpoch)){
          part='handoff';
          const response=await this.fetcher(target.url.replace(/\/$/,'')+'/api/upload/epoch',{method:'POST',headers:{Authorization:'Bearer '+target.token,'Content-Type':'application/json'},
            body:JSON.stringify({previousSourceEpoch:target.previousSourceEpoch,sourceEpoch:target.sourceEpoch}),signal:AbortSignal.timeout(10000)});
          status=response.status;await response.body?.cancel();if(!response.ok)throw new Error('Forward handoff failed');
          this.store.db.prepare('INSERT OR IGNORE INTO forwarding_handoff VALUES(?,?,?)').run(row.user,target.sourceEpoch,this.store.clock());
        }
        for(const [section,path]of [['live','/api/upload/live'],['days','/api/upload/days']]){
          part=section;status=null;
          const response=await this.fetcher(target.url.replace(/\/$/,'')+path,{method:'POST',headers:{Authorization:'Bearer '+target.token,'Content-Type':'application/json'},body:JSON.stringify(value[section]),signal:AbortSignal.timeout(10000)});
          status=response.status;await response.body?.cancel();if(!response.ok)throw new Error('Forward delivery failed');
        }
        this.store.db.prepare("INSERT INTO forwarding_delivery VALUES(?,?,?,?,?,?) ON CONFLICT(user) DO UPDATE SET version=excluded.version,status=excluded.status,part=excluded.part,checked=excluded.checked,delivered=excluded.delivered").run(row.user,row.version,status,'complete',this.store.clock(),this.store.clock());
        this.store.db.prepare('DELETE FROM forwarding WHERE user=? AND value=?').run(row.user,row.value);
      }catch{
        this.store.db.prepare('INSERT INTO forwarding_delivery VALUES(?,?,?,?,?,NULL) ON CONFLICT(user) DO UPDATE SET version=excluded.version,status=excluded.status,part=excluded.part,checked=excluded.checked').run(row.user,row.version,status,part,this.store.clock());
        this.store.db.prepare('UPDATE forwarding SET attempts=attempts+1,after=? WHERE user=? AND value=?').run(this.store.clock()+Math.min(300000,5000*2**Math.min(row.attempts,6)),row.user,row.value);
      }
    }}finally{this.running=false;}
  }
}
