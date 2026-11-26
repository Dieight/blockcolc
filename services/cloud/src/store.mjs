import { DatabaseSync } from 'node:sqlite';
import { randomBytes,randomUUID,scrypt,timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync,writeFileSync,readFileSync,existsSync,renameSync,unlinkSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError,fail,sha,canonical,hashPattern,assembleDomain,assetKeys,validateExtra,validateKey,validatePlanDomain,sharing,defaultSharing,accountDate } from './wire.mjs';
import { Integrations } from './integrations.mjs';
import { SyncV2, focusEffect, focusEntry, hasOverlappingHistory } from './sync-v2.mjs';
const derive=promisify(scrypt),DAY=86400000;
const random=()=>randomBytes(32).toString('base64url');
const cleanDevice=(id,name)=>{fail(typeof id==='string'&&/^[a-zA-Z0-9_-]{16,80}$/.test(id),'INVALID_DEVICE');fail(typeof name==='string'&&name.length>0&&name.length<=64);};

export class CloudStore {
  constructor(directory,{clock=Date.now,quotaBytes=200*1024*1024}={}){
    mkdirSync(directory,{recursive:true,mode:0o700});this.directory=directory;this.clock=clock;this.quota=quotaBytes;
    this.db=new DatabaseSync(join(directory,'cloud.db'));this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,code TEXT UNIQUE NOT NULL,zone TEXT NOT NULL,sharing TEXT NOT NULL,friends_enabled INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,id TEXT NOT NULL,name TEXT NOT NULL,last_seen INTEGER NOT NULL,PRIMARY KEY(user,id));
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,device TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_device ON sessions(user,device,expires);
      CREATE TABLE IF NOT EXISTS heads(user TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,epoch TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,owner TEXT,execution INTEGER NOT NULL DEFAULT 0,changed INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_entries(user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,key TEXT NOT NULL,canonical TEXT NOT NULL,sha TEXT NOT NULL,
        package TEXT GENERATED ALWAYS AS (CASE WHEN key IN ('$/activeFocusSession','@plan') OR key GLOB 'focusHistory/*' OR key GLOB 'progressReports/*' THEN 'focus' ELSE 'building' END) STORED,
        PRIMARY KEY(user,key));
      CREATE INDEX IF NOT EXISTS sync_entries_package ON sync_entries(user,package,key);
      CREATE TABLE IF NOT EXISTS receipts(user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,id TEXT NOT NULL,request_sha TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(user,id));
      CREATE TABLE IF NOT EXISTS assets(user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,sha TEXT NOT NULL,bytes INTEGER NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(user,sha));
      CREATE TABLE IF NOT EXISTS backup_blocks(user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,sha TEXT NOT NULL,canonical TEXT NOT NULL,PRIMARY KEY(user,sha));
      CREATE TABLE IF NOT EXISTS backups(user TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,date TEXT NOT NULL,at INTEGER NOT NULL,manifest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS friends(a TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,b TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,status TEXT NOT NULL,sender TEXT NOT NULL,PRIMARY KEY(a,b));
      CREATE TABLE IF NOT EXISTS friend_sharing(user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,friend TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,value TEXT NOT NULL,PRIMARY KEY(user,friend));
      CREATE TABLE IF NOT EXISTS presence(user TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,value TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS external_sources(id TEXT PRIMARY KEY,user TEXT UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,kind TEXT NOT NULL,origin TEXT NOT NULL,remote_account TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,projection TEXT,updated INTEGER,expires INTEGER NOT NULL DEFAULT 0,error TEXT);`);
    if(!this.db.prepare('PRAGMA table_info(external_sources)').all().some(c=>c.name==='remote_account'))this.db.exec("ALTER TABLE external_sources ADD COLUMN remote_account TEXT NOT NULL DEFAULT ''");
    this.authInFlight=0;
    this.integrations=new Integrations(this);
    this.sync=new SyncV2(this);
  }
  transaction(work){this.db.exec('BEGIN IMMEDIATE');try{const result=work();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  close(){this.db.close();}
  account(user){const a=this.db.prepare('SELECT id,username,name,code,zone,sharing,friends_enabled FROM accounts WHERE id=?').get(user);fail(a,'UNAUTHORIZED',401);
    return {id:a.id,username:a.username,name:a.name,friendCode:a.code,timeZone:a.zone,sharing:JSON.parse(a.sharing),friendsEnabled:!!a.friends_enabled};}
  async password(password,salt){fail(typeof password==='string'&&password.length>=10&&password.length<=256,'PASSWORD_LENGTH');
    fail(this.authInFlight<3,'AUTH_BUSY',429);this.authInFlight++;
    try{return Buffer.from(await derive(password,salt,32,{N:16384,r:8,p:1,maxmem:32*1024*1024})).toString('hex');}finally{this.authInFlight--;}}
  async register({username,password,name,deviceId,deviceName,timeZone='UTC'}){
    cleanDevice(deviceId,deviceName);
    const {id}=await this.createAccount({username,password,name,timeZone});
    return this.session(id,deviceId,deviceName);
  }
  async createAccount({username,password,name,timeZone='UTC'}){
    fail(typeof username==='string'&&/^[a-zA-Z0-9_]{3,32}$/.test(username),'USERNAME_FORMAT');username=username.toLowerCase();
    fail(typeof name==='string'&&name.trim().length>0&&name.length<=64);accountDate(this.clock(),timeZone);
    const salt=random(),digest=await this.password(password,salt),id=randomUUID(),now=this.clock();
    this.transaction(()=>{fail(!this.db.prepare('SELECT id FROM accounts WHERE username=?').get(username),'USERNAME_TAKEN',409);
      this.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,username,name.trim(),salt,digest,randomBytes(9).toString('hex').toUpperCase(),timeZone,canonical(defaultSharing()),0,now);
      this.db.prepare('INSERT INTO heads(user,epoch,changed) VALUES(?,?,?)').run(id,randomUUID(),now);});
    return {id,salt};
  }
  async login({username,password,deviceId,deviceName}){
    cleanDevice(deviceId,deviceName);
    const {id}=await this.verifyCredentials({username,password});
    return this.session(id,deviceId,deviceName);
  }
  async verifyCredentials({username,password}){
    fail(typeof username==='string'&&username.length<=32,'LOGIN_FAILED',401);
    const a=this.db.prepare('SELECT id,salt,password FROM accounts WHERE username=?').get(username.toLowerCase());
    const digest=await this.password(password,a?.salt??'blockcolc-nonexistent-user');
    fail(a&&!this.db.prepare('SELECT 1 FROM external_sources WHERE user=?').get(a.id)&&timingSafeEqual(Buffer.from(a.password,'hex'),Buffer.from(digest,'hex')),'LOGIN_FAILED',401);
    fail(this.db.prepare('SELECT password FROM accounts WHERE id=?').get(a.id)?.password===a.password,'LOGIN_FAILED',401);
    return {id:a.id,salt:a.salt};
  }
  session(user,device,name){const token=random(),now=this.clock();this.transaction(()=>{
    const active=this.devices({user,device});
    fail(active.some(d=>d.current)||active.length<16,'DEVICE_LIMIT',409);
    this.db.prepare('INSERT INTO devices VALUES(?,?,?,?) ON CONFLICT(user,id) DO UPDATE SET name=excluded.name,last_seen=excluded.last_seen').run(user,device,name,now);
    this.db.prepare('DELETE FROM sessions WHERE user=? AND device=?').run(user,device);
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(token),user,device,now+90*DAY);
  });return {token,account:this.account(user)};}
  authenticate(token,{touch=true}={}){fail(typeof token==='string'&&token.length<=128,'UNAUTHORIZED',401);const now=this.clock();
    const s=this.db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(sha(token),now);
    fail(s,'UNAUTHORIZED',401);
    if(touch)this.db.prepare('UPDATE devices SET last_seen=? WHERE user=? AND id=? AND last_seen<?').run(now,s.user,s.device,now-300000);
    return s;}
  assertSession(s){const row=this.db.prepare('SELECT * FROM sessions WHERE token=?').get(s.token);fail(row&&row.user===s.user&&row.device===s.device&&row.expires>this.clock(),'UNAUTHORIZED',401);}
  logout(s){this.transaction(()=>{this.assertSession(s);this.removeDevice(s.user,s.device);});}
  devices(s){return this.db.prepare(`SELECT d.id,d.name,d.last_seen FROM devices d WHERE d.user=? AND EXISTS
    (SELECT 1 FROM sessions s WHERE s.user=d.user AND s.device=d.id AND s.expires>?) ORDER BY d.last_seen DESC`).all(s.user,this.clock()).map(d=>({...d,current:d.id===s.device}));}
  removeDevice(user,id){
    this.db.prepare('DELETE FROM sessions WHERE user=? AND device=?').run(user,id);
    this.db.prepare('DELETE FROM devices WHERE user=? AND id=?').run(user,id);
    if(this.db.prepare('UPDATE heads SET owner=NULL,execution=execution+1 WHERE user=? AND owner=?').run(user,id).changes){
      this.integrations.forgetNativeReservations(user);
      if(!this.integrations.externalBusy(user))this.db.prepare('DELETE FROM presence WHERE user=?').run(user);
    }
  }
  revokeDevice(s,id){fail(typeof id==='string');this.transaction(()=>{this.assertSession(s);this.removeDevice(s.user,id);});}
  updateAccount(s,input){this.assertSession(s);const current=this.account(s.user),policy=input.sharing==null?current.sharing:sharing(input.sharing);
    const name=input.name??current.name,zone=input.timeZone??current.timeZone,enabled=input.friendsEnabled??current.friendsEnabled;
    fail(typeof enabled==='boolean'&&typeof name==='string'&&name.trim().length>0&&name.length<=64);accountDate(this.clock(),zone);
    this.transaction(()=>{
      this.db.prepare('UPDATE accounts SET name=?,zone=?,sharing=?,friends_enabled=? WHERE id=?').run(name.trim(),zone,canonical(policy),enabled?1:0,s.user);
      if(zone!==current.timeZone)this.sync.refreshDayTotals(s.user,zone);
    });
    // Filter friends' access on read so permission changes apply immediately.
    return this.account(s.user);}
  async changePassword(session,input){
    await this.replacePassword(session.user,input,{
      authorize:()=>this.assertSession(session),
      keepAppToken:session.token,
    });
  }
  async replacePassword(user,{currentPassword,password},{authorize,keepAppToken=null,renewViewer=()=>{}}){
    authorize();
    const previous=this.db.prepare('SELECT salt,password FROM accounts WHERE id=?').get(user);
    fail(previous,'UNAUTHORIZED',401);
    fail(typeof currentPassword==='string'&&currentPassword.length>=10&&currentPassword.length<=256,'CURRENT_PASSWORD_INVALID');
    const actual=await this.password(currentPassword,previous.salt);
    fail(timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(previous.password,'hex')),'CURRENT_PASSWORD_INVALID');
    fail(currentPassword!==password,'PASSWORD_UNCHANGED');
    const salt=random(),digest=await this.password(password,salt);
    this.transaction(()=>{
      authorize();
      const updated=this.db.prepare('UPDATE accounts SET salt=?,password=? WHERE id=? AND salt=? AND password=?')
        .run(salt,digest,user,previous.salt,previous.password);
      fail(updated.changes===1,'CURRENT_PASSWORD_INVALID',409);
      this.db.prepare('DELETE FROM sessions WHERE user=? AND token IS NOT ?').run(user,keepAppToken);
      renewViewer(salt);
    });
  }
  entries(user){return Object.fromEntries(this.db.prepare('SELECT key,canonical FROM sync_entries WHERE user=? ORDER BY key').all(user).map(r=>[r.key,r.canonical]));}
  head(user){const h=this.db.prepare('SELECT * FROM heads WHERE user=?').get(user);fail(h,'UNAUTHORIZED',401);return h;}
  assetPath(user,key){fail(hashPattern.test(key));return join(this.directory,'assets',user,key);}
  putAsset(s,key,body){this.assertSession(s);fail(hashPattern.test(key)&&Buffer.isBuffer(body));fail(body.length<=100*1024*1024,'ASSET_TOO_LARGE',413);fail(sha(body)===key,'ASSET_DIGEST');
    try{new TextDecoder('utf-8',{fatal:true}).decode(body);}catch{throw new ApiError(400,'ASSET_ENCODING');}
    const previous=this.db.prepare('SELECT bytes FROM assets WHERE user=? AND sha=?').get(s.user,key);
    if(previous&&existsSync(this.assetPath(s.user,key))&&sha(readFileSync(this.assetPath(s.user,key)))===key)return {present:true};
    const used=this.db.prepare('SELECT coalesce(sum(bytes),0) n FROM assets WHERE user=?').get(s.user).n;fail(used+body.length-(previous?.bytes??0)<=this.quota,'STORAGE_QUOTA',413);
    const path=this.assetPath(s.user,key);mkdirSync(join(this.directory,'assets',s.user),{recursive:true,mode:0o700});
    const staging=path+'.'+randomUUID()+'.part';try{writeFileSync(staging,body,{mode:0o600,flag:'wx'});renameSync(staging,path);
      this.db.prepare('INSERT OR IGNORE INTO assets VALUES(?,?,?,?)').run(s.user,key,body.length,this.clock());}finally{if(existsSync(staging))unlinkSync(staging);}
    return {present:true};
  }
  asset(user,key){fail(this.db.prepare('SELECT 1 FROM assets WHERE user=? AND sha=?').get(user,key),'MISSING_ASSET',409);
    let bytes;try{bytes=readFileSync(this.assetPath(user,key));}catch{throw new ApiError(503,'ASSET_UNAVAILABLE');}
    fail(sha(bytes)===key,'ASSET_CORRUPT',503);return bytes.toString('utf8');}
  assetStatus(s,keys){fail(Array.isArray(keys)&&keys.length<=1024&&keys.every(k=>hashPattern.test(k)));return {missing:keys.filter(key=>{
    if(!this.db.prepare('SELECT 1 FROM assets WHERE user=? AND sha=?').get(s.user,key))return true;
    try{return sha(readFileSync(this.assetPath(s.user,key)))!==key;}catch{return true;}
  })};}
  workspace(s){const h=this.head(s.user);return {schema:1,epoch:h.epoch,revision:h.revision,entries:this.entries(s.user),execution:{owner:h.owner,generation:h.execution},devices:this.devices(s),backup:this.backupInfo(s)};}
  claim(s,{generation,takeover=false}){this.assertSession(s);return this.transaction(()=>{const h=this.head(s.user);fail(Number.isSafeInteger(generation)&&generation===h.execution,'EXECUTION_CHANGED',409);
    fail(h.owner==null||h.owner===s.device||takeover===true,'EXECUTING_ELSEWHERE',409);
    if(h.owner!==s.device){
      this.db.prepare('UPDATE heads SET owner=?,execution=execution+1,changed=? WHERE user=?').run(s.device,this.clock(),s.user);
      this.integrations.forgetNativeReservations(s.user);
      if(!this.integrations.externalBusy(s.user))this.db.prepare('DELETE FROM presence WHERE user=?').run(s.user);
    }
    const actual=this.head(s.user);return {owner:actual.owner,generation:actual.execution};});}
  release(s,{generation}){return this.transaction(()=>{const h=this.head(s.user);fail(h.owner===s.device&&h.execution===generation,'EXECUTION_CHANGED',409);
    this.db.prepare('UPDATE heads SET owner=NULL,execution=execution+1,changed=? WHERE user=?').run(this.clock(),s.user);
    this.integrations.forgetNativeReservations(s.user);
    if(!this.integrations.externalBusy(s.user))this.db.prepare('DELETE FROM presence WHERE user=?').run(s.user);
    return {owner:null,generation:h.execution+1};});}
  commit(s,input,{protocol2=false}={}){this.assertSession(s);fail(input&&typeof input.requestId==='string'&&/^[a-zA-Z0-9_:-]{8,128}$/.test(input.requestId));
    fail(Array.isArray(input.changes)&&input.changes.length<=100000);const requestSha=sha(canonical(input));
    return this.transaction(()=>{
      const response=result=>protocol2?{...result,state:this.sync.pull(s,{epoch:input.knownEpoch,known:input.known??{}})}:result;
      const replay=this.db.prepare('SELECT request_sha,result FROM receipts WHERE user=? AND id=?').get(s.user,input.requestId);
      if(replay){fail(replay.request_sha===requestSha,'REQUEST_ID_REUSED',409);return response(JSON.parse(replay.result));}
      this.integrations.expire(s.user,this.clock());
      const h=this.head(s.user);fail(h.epoch===input.epoch,'WORKSPACE_REPLACED',409);
      const previous=this.entries(s.user),conflicts=[],seen=new Set(),accepted=[];
      for(const change of input.changes){
        validateKey(change.key);fail(!seen.has(change.key));seen.add(change.key);
        fail(change.before===null||hashPattern.test(change.before));fail(change.canonical===null||typeof change.canonical==='string');
        const current=previous[change.key]??null;
        if(change.canonical===current&&protocol2)continue;
        const actual=current==null?null:sha(current);
        if(actual!==change.before&&change.canonical!==current)conflicts.push(change.key);
        else accepted.push(change);
      }
      if(conflicts.length&&!protocol2)throw new ApiError(409,'SYNC_CONFLICT',{keys:conflicts});
      let protectedChange=accepted.some(c=>focusEntry(c.key))||conflicts.some(focusEntry);
      let canAcquire=protocol2&&protectedChange&&h.owner!==s.device&&!this.sync.locked(s.user);
      let changes=accepted;
      if(protocol2&&protectedChange&&(conflicts.some(focusEffect)||h.owner!==s.device&&!canAcquire||input.execution!==h.execution||
        this.integrations.externalBusy(s.user)||hasOverlappingHistory(changes,previous))){
        // A focus transition and its dependent effects form one transaction.
        for(const change of accepted)if(focusEffect(change.key))conflicts.push(change.key);
        changes=accepted.filter(change=>!focusEffect(change.key));
        protectedChange=false;
        canAcquire=false;
      }
      if(protectedChange&&changes.length){
        fail((h.owner===s.device||canAcquire)&&input.execution===h.execution,'EXECUTION_CHANGED',409);
        fail(!this.integrations.externalBusy(s.user),'EXTERNAL_FOCUS_IN_PROGRESS',409);
        this.integrations.assertNativeIntervals(s.user,changes);
      }
      const entries={...previous};
      for(const change of changes){
        if(change.canonical==null)delete entries[change.key];
        else{fail(Buffer.byteLength(change.canonical)<=4*1024*1024,'ENTITY_TOO_LARGE',413);JSON.parse(change.canonical);entries[change.key]=change.canonical;}
      }
      if(protocol2&&!changes.length){
        const result={epoch:h.epoch,revision:h.revision,winners:Object.fromEntries(conflicts.map(key=>[key,previous[key]??null]))};
        this.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)').run(s.user,input.requestId,requestSha,canonical(result),this.clock());
        return response(result);
      }
      for(const key of ['@preferences','@plan'])if(entries[key]!=null)validateExtra(key,entries[key]);
      validatePlanDomain(entries,assembleDomain(entries,key=>this.asset(s.user,key)));
      const size=Object.values(entries).reduce((sum,text)=>sum+Buffer.byteLength(text),0);fail(size<=100*1024*1024,'WORKSPACE_TOO_LARGE',413);
      if(canAcquire)this.db.prepare('UPDATE heads SET owner=?,execution=execution+1 WHERE user=?').run(s.device,s.user);
      for(const change of changes){if(change.canonical==null)this.db.prepare('DELETE FROM sync_entries WHERE user=? AND key=?').run(s.user,change.key);
        else this.db.prepare('INSERT INTO sync_entries VALUES(?,?,?,?) ON CONFLICT(user,key) DO UPDATE SET canonical=excluded.canonical,sha=excluded.sha').run(s.user,change.key,change.canonical,sha(change.canonical));}
      if(protectedChange&&(JSON.parse(entries['$/activeFocusSession']??'null')||JSON.parse(entries['@plan']??'{}').plan?.hasStarted||changes.some(c=>c.key.startsWith('focusHistory/')))){
        this.integrations.forgetNativeReservations(s.user);
      }
      this.db.prepare('UPDATE heads SET revision=revision+1,changed=? WHERE user=?').run(this.clock(),s.user);
      this.sync.record(s.user,changes.map(change=>change.key));
      const result={epoch:h.epoch,revision:h.revision+1};
      if(protocol2)result.winners=Object.fromEntries(conflicts.map(key=>[key,previous[key]??null]));
      this.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)').run(s.user,input.requestId,requestSha,canonical(result),this.clock());
      this.db.prepare('DELETE FROM receipts WHERE user=? AND created<?').run(s.user,this.clock()-30*DAY);
      return response(result);
    });
  }
  replace(s,{revision,entries,requestId,execution}){this.assertSession(s);fail(Number.isSafeInteger(revision)&&entries&&typeof entries==='object'&&!Array.isArray(entries));
    fail(typeof requestId==='string'&&/^[a-zA-Z0-9_:-]{8,128}$/.test(requestId));
    const keepExecution=execution!==undefined;
    const requestSha=sha(canonical(keepExecution?{revision,entries,requestId,execution}:{revision,entries,requestId}));
    // A deliberate whole-workspace choice gets a new epoch. No stale device
    // can silently reapply changes made against the discarded history.
    return this.transaction(()=>{const replay=this.db.prepare('SELECT request_sha,result FROM receipts WHERE user=? AND id=?').get(s.user,requestId);
      if(replay){fail(replay.request_sha===requestSha,'REQUEST_ID_REUSED',409);return JSON.parse(replay.result);}
      this.integrations.expire(s.user,this.clock());
      fail(!this.integrations.externalBusy(s.user),'EXTERNAL_FOCUS_IN_PROGRESS',409);
      const h=this.head(s.user);fail(h.revision===revision,'SYNC_CONFLICT',409);
      if(keepExecution)fail(Number.isSafeInteger(execution)&&h.execution===execution&&h.owner===s.device,'EXECUTION_CHANGED',409);
      for(const key of ['@preferences','@plan'])if(entries[key]!=null)validateExtra(key,entries[key]);validatePlanDomain(entries,assembleDomain(entries,k=>this.asset(s.user,k)));
      const oldKeys=Object.keys(this.entries(s.user));
      this.db.prepare('DELETE FROM sync_entries WHERE user=?').run(s.user);
      for(const [key,value]of Object.entries(entries))this.db.prepare('INSERT INTO sync_entries VALUES(?,?,?,?)').run(s.user,key,value,sha(value));
      this.db.prepare('UPDATE heads SET epoch=?,revision=revision+1,owner=?,execution=execution+1,changed=? WHERE user=?').run(randomUUID(),keepExecution?s.device:null,this.clock(),s.user);
      this.integrations.forgetNativeReservations(s.user);
      this.sync.record(s.user,[...new Set([...oldKeys,...Object.keys(entries)])],{reset:true});
      this.db.prepare('DELETE FROM presence WHERE user=?').run(s.user);const result=this.workspace(s);
      this.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)').run(s.user,requestId,requestSha,canonical(result),this.clock());return result;});
  }
  backupInfo(s){const row=this.db.prepare('SELECT date,at FROM backups WHERE user=?').get(s.user);return row?{date:row.date,createdAt:new Date(row.at).toISOString()}:null;}
  capture(user,date=undefined){const account=this.account(user),day=date??accountDate(this.clock(),account.timeZone),entries=this.entries(user);if(!Object.keys(entries).length)return null;
    fail(/^\d{4}-\d{2}-\d{2}$/.test(day));const old=this.db.prepare('SELECT date FROM backups WHERE user=?').get(user);if(old&&old.date>day)return this.backupInfo({user});
    // Validate all referenced bytes before replacing the sole recovery root.
    assembleDomain(entries,key=>this.asset(user,key));
    if(entries['@preferences']!=null)validateExtra('@preferences',entries['@preferences']);
    return this.transaction(()=>{const manifest={schema:1,entries:{},assets:[...assetKeys(entries)]};
      for(const [key,wire] of Object.entries(entries)){if(key==='@plan')continue;const digest=sha(wire);manifest.entries[key]=digest;
        this.db.prepare('INSERT OR IGNORE INTO backup_blocks VALUES(?,?,?)').run(user,digest,wire);}
      this.db.prepare('INSERT INTO backups VALUES(?,?,?,?) ON CONFLICT(user) DO UPDATE SET date=excluded.date,at=excluded.at,manifest=excluded.manifest').run(user,day,this.clock(),canonical(manifest));
      const referenced=new Set(Object.values(manifest.entries));for(const row of this.db.prepare('SELECT sha FROM backup_blocks WHERE user=?').all(user))if(!referenced.has(row.sha))this.db.prepare('DELETE FROM backup_blocks WHERE user=? AND sha=?').run(user,row.sha);
      return this.backupInfo({user});});
  }
  daily(){for(const row of this.db.prepare('SELECT id,zone FROM accounts').all()){
    const today=accountDate(this.clock(),row.zone),date=new Date(Date.parse(today+'T00:00:00Z')-DAY).toISOString().slice(0,10),last=this.db.prepare('SELECT date FROM backups WHERE user=?').get(row.id);
    if(!last||last.date<date)this.capture(row.id,date);
  }this.collect();}
  restore(s,{revision,requestId}){const backup=this.db.prepare('SELECT manifest FROM backups WHERE user=?').get(s.user);fail(backup,'NO_BACKUP',404);
    const manifest=JSON.parse(backup.manifest),entries={};for(const [key,digest]of Object.entries(manifest.entries)){
      const wire=this.db.prepare('SELECT canonical FROM backup_blocks WHERE user=? AND sha=?').get(s.user,digest)?.canonical;fail(wire&&sha(wire)===digest,'BACKUP_CORRUPT',503);entries[key]=wire;}
    // A restored active session remains a fact, but no local automatic grant
    // or execution permission is resurrected by this snapshot.
    return this.replace(s,{revision,entries,requestId});}
  collect(){for(const account of this.db.prepare('SELECT id FROM accounts').all()){
    const used=assetKeys(this.entries(account.id)),root=this.db.prepare('SELECT manifest FROM backups WHERE user=?').get(account.id);
    if(root)for(const key of JSON.parse(root.manifest).assets)used.add(key);
    for(const asset of this.db.prepare('SELECT sha,created FROM assets WHERE user=?').all(account.id))if(!used.has(asset.sha)&&asset.created<this.clock()-DAY){
      const file=this.assetPath(account.id,asset.sha);if(existsSync(file))unlinkSync(file);this.db.prepare('DELETE FROM assets WHERE user=? AND sha=?').run(account.id,asset.sha);}
  }this.db.prepare('DELETE FROM sessions WHERE expires<?').run(this.clock());}
  pair(a,b){return [a,b].sort();}
  invite(s,code){fail(this.account(s.user).friendsEnabled,'FRIENDS_DISABLED',409);fail(typeof code==='string'&&/^[A-F0-9]{18}$/.test(code));
    const other=this.db.prepare('SELECT id,friends_enabled FROM accounts WHERE code=?').get(code);fail(other&&other.friends_enabled&&other.id!==s.user,'FRIEND_NOT_FOUND',404);
    const [a,b]=this.pair(s.user,other.id);const previous=this.db.prepare('SELECT * FROM friends WHERE a=? AND b=?').get(a,b);
    fail(!previous,'INVITE_ALREADY_EXISTS',409);
    // Public external sources have no person or login session to accept an
    // invitation. The reader explicitly adds this read-only source instead.
    const external=this.db.prepare('SELECT 1 FROM external_sources WHERE user=? AND enabled=1').get(other.id);
    this.db.prepare('INSERT INTO friends VALUES(?,?,?,?)').run(a,b,external?'accepted':'pending',s.user);return {sent:true};}
  relation(s,id,action){const [a,b]=this.pair(s.user,id),row=this.db.prepare('SELECT * FROM friends WHERE a=? AND b=?').get(a,b);fail(row,'FRIEND_NOT_FOUND',404);
    if(action==='accept'){fail(row.status==='pending'&&row.sender!==s.user&&this.account(s.user).friendsEnabled);this.db.prepare("UPDATE friends SET status='accepted' WHERE a=? AND b=?").run(a,b);}
    else if(action==='remove'){this.transaction(()=>{this.db.prepare('DELETE FROM friends WHERE a=? AND b=?').run(a,b);this.db.prepare('DELETE FROM friend_sharing WHERE (user=? AND friend=?) OR (user=? AND friend=?)').run(a,b,b,a);});}
    else fail(false);return {ok:true};}
  friendPolicy(s,id,value){const [a,b]=this.pair(s.user,id);fail(this.db.prepare("SELECT 1 FROM friends WHERE a=? AND b=? AND status='accepted'").get(a,b),'FRIEND_NOT_FOUND',404);
    fail(!this.db.prepare('SELECT 1 FROM external_sources WHERE user=?').get(id),'READ_ONLY_FRIEND',409);
    if(value===null)this.db.prepare('DELETE FROM friend_sharing WHERE user=? AND friend=?').run(s.user,id);
    else this.db.prepare('INSERT INTO friend_sharing VALUES(?,?,?) ON CONFLICT(user,friend) DO UPDATE SET value=excluded.value').run(s.user,id,canonical(sharing(value)));return {ok:true};}
  presence(s,value,execution){this.assertSession(s);const h=this.head(s.user);fail(h.owner===s.device&&h.execution===execution,'EXECUTION_CHANGED',409);
    if(this.integrations.externalBusy(s.user)){
      fail(value?.currentName==null,'EXTERNAL_FOCUS_IN_PROGRESS',409);
      return {ok:true};
    }
    fail(value&&typeof value==='object'&&Object.keys(value).sort().join()==='currentName,estimatedElapsedMs,estimatedEndsAt,startedAt,todayActualFocusMs');
    const now=this.clock();fail(Number.isSafeInteger(value.todayActualFocusMs)&&value.todayActualFocusMs>=0&&value.todayActualFocusMs<=DAY);
    const timed=value.estimatedEndsAt!==null;
    if(value.currentName!=null){fail(typeof value.currentName==='string'&&value.currentName.length<=512);
      const start=Date.parse(value.startedAt),end=Date.parse(value.estimatedEndsAt);
      fail(typeof value.startedAt==='string'&&Number.isFinite(start)&&start<=now+30000);
      if(timed)fail(typeof value.estimatedEndsAt==='string'&&Number.isFinite(end)&&end>start&&end-start<=DAY);
      fail(Number.isSafeInteger(value.estimatedElapsedMs)&&value.estimatedElapsedMs>=0&&value.estimatedElapsedMs<=(timed?end:now+30000)-start);
    }else fail(value.startedAt===null&&value.estimatedEndsAt===null&&value.estimatedElapsedMs===0);
    const expires=timed?Math.min(now+90000,Date.parse(value.estimatedEndsAt)):now+90000;
    this.db.prepare('INSERT INTO presence VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET value=excluded.value,expires=excluded.expires').run(s.user,canonical({...value,updatedAt:new Date(now).toISOString()}),expires);
    return {ok:true};}
  liveStatus(user){
    const row=this.db.prepare('SELECT value,expires FROM presence WHERE user=?').get(user);
    const external=row?{value:JSON.parse(row.value),persistent:false,expires:row.expires}:null;
    const saved=this.sync.live(user);
    if(external&&external.expires>this.clock()&&(external.value.externalState||
      (saved?.value.updatedAt??'')<=external.value.updatedAt))return external;
    return saved??external;
  }
  dayTotals(user,zone){
    return this.sync.dayTotals(user,zone)??this.calculateDayTotals(user,zone);
  }
  calculateDayTotals(user,zone){
    const history=this.db.prepare("SELECT canonical FROM sync_entries WHERE user=? AND key LIKE 'focusHistory/%'").all(user),totals={};
    for(const record of history){const value=JSON.parse(record.canonical).value;let cursor=Date.parse(value.startedAt),end=cursor+value.actualDurationMs;
      while(cursor<end){const day=accountDate(cursor,zone);let next=end;
        if(accountDate(end-1,zone)!==day){let low=cursor+1,high=Math.min(end,cursor+30*3600000);
          while(low<high){const mid=Math.floor((low+high)/2);if(accountDate(mid,zone)===day)low=mid+1;else high=mid;}next=low;}
        totals[day]=(totals[day]??0)+next-cursor;cursor=next;}}
    return totals;
  }
  visibleFriendPolicy(account,viewer){
    const row=this.db.prepare('SELECT value FROM friend_sharing WHERE user=? AND friend=?').get(account.id,viewer);
    return row?JSON.parse(row.value):account.sharing;
  }
  friendDayRows(account){
    return Object.entries(this.dayTotals(account.id,account.timeZone)).sort(([a],[b])=>b.localeCompare(a))
      .map(([date,actualFocusMs])=>({date,actualFocusMs}));
  }
  externalAvailable(source){
    return source.enabled&&!source.error&&source.expires>this.clock()&&source.projection!=null;
  }
  friendHistory(s,id){
    const [a,b]=this.pair(s.user,id);
    fail(this.account(s.user).friendsEnabled&&this.db.prepare("SELECT 1 FROM friends WHERE a=? AND b=? AND status='accepted'").get(a,b),
      'FRIEND_NOT_FOUND',404);
    const account=this.account(id);
    const external=this.db.prepare('SELECT * FROM external_sources WHERE user=?').get(id);
    const today=accountDate(this.clock(),account.timeZone);
    if(external){
      fail(this.externalAvailable(external),'HISTORY_UNAVAILABLE',503);
      return {days:JSON.parse(external.projection).days,today,complete:false};
    }
    fail(account.friendsEnabled&&this.visibleFriendPolicy(account,s.user).daily,'HISTORY_UNAVAILABLE',403);
    return {days:this.friendDayRows(account),today,complete:true};
  }
  friends(s,{summary=false}={}){if(!this.account(s.user).friendsEnabled)return [];return this.db.prepare('SELECT * FROM friends WHERE a=? OR b=?').all(s.user,s.user).map(row=>{
    const id=row.a===s.user?row.b:row.a,account=this.account(id),base={id,name:account.name,status:row.status,incoming:row.sender!==s.user};
    const external=this.db.prepare('SELECT * FROM external_sources WHERE user=?').get(id);
    if(external){
      base.readOnly=true;base.source={kind:external.kind,name:'Mutsumi Focus',origin:external.origin};
      if(row.status!=='accepted')return base;
      if(!this.externalAvailable(external)){base.stale=true;return base;}
      const {days,...live}=JSON.parse(external.projection);
      if(summary)base.historyRevision=sha(canonical(days));
      else base.days=days.slice(0,366);
      return {...base,...live,updatedAt:new Date(external.updated).toISOString()};
    }
    const override=this.db.prepare('SELECT value FROM friend_sharing WHERE user=? AND friend=?').get(s.user,id);base.sharing=override?JSON.parse(override.value):null;
    if(row.status!=='accepted'||!account.friendsEnabled)return base;
    const policy=this.visibleFriendPolicy(account,s.user);
    const live=this.liveStatus(id),snapshot=live?.value;
    base.visible=policy;if(policy.time)base.updatedAt=snapshot?.updatedAt??null;
    if(live&&(live.persistent||live.expires>this.clock())){
      if(policy.status){
        base.focusing=snapshot.currentName!=null&&snapshot.externalState!=='rest';
        if(snapshot.sourceName)base.source={kind:'integration',name:snapshot.sourceName};
        if(snapshot.externalState)base.state=snapshot.externalState;
      }
      if(policy.name)base.currentName=snapshot.externalState?snapshot.taskName:snapshot.currentName;
      if(policy.time){base.startedAt=snapshot.startedAt;base.endsAt=snapshot.estimatedEndsAt;
        if(snapshot.estimated)base.estimated=true;
        if(snapshot.currentName!=null&&snapshot.estimatedEndsAt===null)base.waitingForEnd=true;
      }
    }else if(policy.status||policy.name||policy.time)base.stale=true;
    if(policy.daily){
      if(summary){
        const head=this.head(id);
        base.historyRevision=[head.epoch,this.sync.packageHeads(id).focus.revision,account.timeZone,accountDate(this.clock(),account.timeZone)].join(':');
      }else base.days=this.friendDayRows(account).slice(0,366);
    }
    return base;
  });}
}
