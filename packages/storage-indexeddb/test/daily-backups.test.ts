import 'fake-indexeddb/auto';
import { execute, addLocalDays, createInitialState } from '@blockcolc/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbStateRepository, StorageConflictError } from '../src/index.js';
import { parseDailyManifest, prepareDailyBackup, retainedDailyBackups, dailyBackupStoredBytes, expandDailyBackup } from '../src/daily-backups.js';
import { projectState } from './fixture.js';

let sequence=0;
const repositories:IndexedDbStateRepository[]=[];
function fixture() {
  const name=`daily-${++sequence}`; let now=new Date('2026-07-24T00:00:00.000Z'); let id=0;
  const repository=new IndexedDbStateRepository({databaseName:name,now:()=>now,newId:()=>`rollback-${++id}`});
  repositories.push(repository);
  return {name,repository,setNow:(value:string)=>{now=new Date(value);}};
}
async function database(name:string) { return await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}); }
async function readBlocks(name:string) { const db=await database(name); try {return await new Promise<any[]>((resolve,reject)=>{const r=db.transaction('dailyBackupBlocks').objectStore('dailyBackupBlocks').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});} finally{db.close();} }
afterEach(()=>{repositories.splice(0).forEach(r=>r.close());vi.restoreAllMocks();});
describe('daily content-addressed history',()=>{
  it('merges unchanged history records and restores either checkpoint without a delta replay chain',async()=>{
    const started=execute(projectState(),{type:'StartFocus',sessionId:'sample',subtaskId:'subtask-1',plannedDurationMs:60000},{now:()=>new Date('2026-07-23T09:00:00.000Z')});
    if(!started.ok)throw Error(started.message);
    const completed=execute(started.state,{type:'CompleteFocus'},{now:()=>new Date('2026-07-23T09:01:00.000Z')});
    if(!completed.ok)throw Error(completed.message);
    const state=completed.state,session=state.focusHistory[0]!;
    const record=(i:number)=>{const start=Date.parse(session.startedAt)+i*60000,end=start+60000;return{...session,id:`history-${i}`,startedAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),completedAt:new Date(end).toISOString()};};
    state.focusHistory=Array.from({length:256},(_,i)=>record(i));
    state.dailyGoals=state.dailyGoals.map(goal=>({...goal,reachedAt:record(goal.targetPomodoros-1).completedAt}));
    const first=await prepareDailyBackup(state,'2026-07-23','2026-07-24T00:00:00.000Z',1);
    const next=structuredClone(state);next.focusHistory.push(record(256));
    const second=await prepareDailyBackup(next,'2026-07-24','2026-07-25T00:00:00.000Z',2);
    const priorIds=new Set(first.blocks.map(block=>block.id));const added=second.blocks.filter(block=>!priorIds.has(block.id));
    expect(added).toHaveLength(2); // One appended record chunk + root, not the other 256 records.
    expect(added.reduce((bytes,block)=>bytes+block.data.byteLength,0)).toBeLessThan(first.manifest.snapshotBytes*.12);
    expect(await expandDailyBackup(first.manifest,first.blocks)).toEqual(state);
    expect(await expandDailyBackup(second.manifest,second.blocks)).toEqual(next);
    // Version-one histories remain readable; upgrading does not remove an old index.
    const data=new TextEncoder().encode(JSON.stringify(state));
    const hash=await crypto.subtle.digest('SHA-256',data);const id=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const legacy={...first.manifest,stateBlock:id,blocks:[{id,bytes:data.byteLength}],snapshotBytes:data.byteLength};
    expect(await expandDailyBackup(legacy,[{id,data}])).toEqual(state);
  });
  it('upgrades a version-one database without replacing app data or operation rollback points',async()=>{
    const f=fixture(),state=projectState();
    await new Promise<void>((resolve,reject)=>{const r=indexedDB.open(f.name,1);r.onupgradeneeded=()=>{r.result.createObjectStore('appState',{keyPath:'id'}).put({id:'current',revision:5,state});r.result.createObjectStore('rollbackBackups',{keyPath:'id'}).put({id:'old',createdAt:'2026-07-23T10:00:00.000Z',reason:'before-import',sourceChecksum:'a'.repeat(64),state});r.result.createObjectStore('metadata',{keyPath:'id'}).put({id:'schema',version:1});};r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);});
    expect(await f.repository.load()).toEqual({state,revision:5});
    await f.repository.createDailyBackup('2026-07-23');
    expect((await f.repository.listRollbackBackups()).map(x=>x.id)).toEqual(['old']);
    const db=await database(f.name);expect(db.version).toBe(2);db.close();
  });
  it('keeps one merged checkpoint, reuses immutable blocks, and restores exports independently',async()=>{
    const f=fixture();const result=execute(projectState(),{type:'ImportBuildingBlueprint',blueprint:{schemaVersion:1,id:'one-block',title:'One block',bounds:{minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0},voxels:[{x:0,y:0,z:0,materialId:'stone',stage:'foundation',buildOrder:0}]}},{now:()=>new Date('2026-07-23T09:00:00.000Z')});
    if(!result.ok)throw new Error(result.message);
    await f.repository.save(result.state,0);
    await f.repository.createDailyBackup('2026-07-23');
    const exportedFirst=await f.repository.exportDailyBackup('2026-07-23');
    const firstBlocks=new Set((await readBlocks(f.name)).map(block=>block.id));
    const changed=structuredClone(result.state);changed.projects[0]!.title='Next day';await f.repository.save(changed,1);
    f.setNow('2026-07-25T00:00:00.000Z');await f.repository.createDailyBackup('2026-07-24');
    const mergedBlocks=await readBlocks(f.name);
    expect(mergedBlocks.length).toBe(5); // Only latest root/project, shared tasks/resources/blueprint.
    expect(mergedBlocks.filter(block=>firstBlocks.has(block.id))).toHaveLength(3);
    expect((await f.repository.load()).revision).toBe(2);
    const second=fixture();await second.repository.replaceFromImport(exportedFirst,0);
    expect((await second.repository.load()).state).toEqual(result.state);
    const unbacked=structuredClone(changed);unbacked.projects[0]!.title='Later edit';await f.repository.save(unbacked,2);
    const restored=await f.repository.restoreDailyBackup('2026-07-24',3);
    expect(await f.repository.load()).toEqual({state:changed,revision:4});
    await f.repository.restoreRollback(restored.rollbackBackupId,4);
    expect((await f.repository.load()).state).toEqual(unbacked);
    expect((await f.repository.listDailyBackups()).backups).toHaveLength(1);
    await expect(f.repository.exportDailyBackup('2026-07-23')).rejects.toThrow('不存在');
  });
  it('captures one snapshot per date despite concurrent checks, without changing the live revision',async()=>{
    const f=fixture();await f.repository.save(projectState(),0);
    const [a,b]=await Promise.all([f.repository.createDailyBackup('2026-07-23'),f.repository.createDailyBackup('2026-07-23')]);expect(a).toEqual(b);
    expect((await f.repository.listDailyBackups()).backups).toHaveLength(1);expect((await f.repository.load()).revision).toBe(1);
  });
  it.each([false,true])('upgrades old multi-date archives only after validating the newest root (corrupt=%s)',async corrupt=>{
    const f=fixture();await f.repository.save(projectState(),0);
    const a=await prepareDailyBackup(projectState(),'2026-07-23','2026-07-24T00:00:00.000Z',1);
    const b=await prepareDailyBackup(projectState('Latest archived'),'2026-07-24','2026-07-25T00:00:00.000Z',1);
    const db=await database(f.name);
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['dailyBackups','dailyBackupBlocks'],'readwrite');
      for(const backup of [a,b]){tx.objectStore('dailyBackups').put(backup.manifest);for(const block of backup.blocks)tx.objectStore('dailyBackupBlocks').put(block);}
      if(corrupt){const root=b.blocks.find(block=>block.id===b.manifest.stateBlock)!;root.data[0]=(root.data[0]??0)^1;tx.objectStore('dailyBackupBlocks').put(root);}
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
    });db.close();
    if(corrupt){await expect(f.repository.createDailyBackup('2026-07-24')).rejects.toThrow('校验失败');expect((await f.repository.listDailyBackups()).backups).toHaveLength(2);}
    else {
      expect((await f.repository.createDailyBackup('2026-07-24'))!.date).toBe('2026-07-24');
      expect((await f.repository.listDailyBackups()).backups).toHaveLength(1);
      expect((await readBlocks(f.name)).length).toBe(b.blocks.length);
    }
    expect((await f.repository.load()).state).toEqual(projectState());expect((await f.repository.load()).revision).toBe(1);
  });
  it('does not invent yesterday for a first-day installation, or archive current/future dates',async()=>{
    const f=fixture();expect(await f.repository.createDailyBackup('2026-07-23')).toBeNull();
    await f.repository.save(projectState(),0);
    expect(await f.repository.createDailyBackup('2026-07-22')).toBeNull();
    await expect(f.repository.createDailyBackup('2026-07-24')).rejects.toThrow('已结束');
    await f.repository.save(createInitialState('Asia/Shanghai',[1]),1);expect(await f.repository.createDailyBackup('2026-07-23')).toBeNull();
  });
  it('rolls thirty-two days into one root, removing only unreferenced blocks, not operation backups',async()=>{
    const f=fixture();let state=projectState();await f.repository.save(state,0);
    const imported=await f.repository.replaceFromImport(await f.repository.exportBackup(),1);
    for(let index=0;index<32;index++) {
      const date=addLocalDays('2026-07-23',index);f.setNow(`${addLocalDays(date,1)}T00:00:00.000Z`);
      state=structuredClone(state);state.projects[0]!.title=`Day ${index}`;await f.repository.save(state,index+2);await f.repository.createDailyBackup(date);
    }
    const history=await f.repository.listDailyBackups();expect(history.backups).toHaveLength(1);expect(history.backups[0]!.date).toBe(addLocalDays('2026-07-23',31));expect((await readBlocks(f.name)).length).toBe(3);
    expect((await f.repository.listRollbackBackups()).map(x=>x.id)).toEqual([imported.rollbackBackupId]);
  });
  it('rejects stale revisions and corrupt or missing contents before changing live records or rollback points',async()=>{
    const f=fixture();await f.repository.save(projectState(),0);await f.repository.createDailyBackup('2026-07-23');
    await expect(f.repository.restoreDailyBackup('2026-07-23',0)).rejects.toBeInstanceOf(StorageConflictError);
    const before=await f.repository.load();const blocks=await readBlocks(f.name);const db=await database(f.name);
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction('dailyBackupBlocks','readwrite');const b=blocks[0];b.data[0]^=1;tx.objectStore('dailyBackupBlocks').put(b);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
    await expect(f.repository.restoreDailyBackup('2026-07-23',1)).rejects.toThrow('校验失败');expect(await f.repository.load()).toEqual(before);expect(await f.repository.listRollbackBackups()).toEqual([]);
    await expect(f.repository.restoreDailyBackup('2026-07-21',1)).rejects.toThrow('不存在');
  });
  it('retries a concurrent app save after hashing, never saving a torn revision',async()=>{
    const f=fixture();await f.repository.save(projectState(),0);
    const original=globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);let once=true;
    vi.spyOn(globalThis.crypto.subtle,'digest').mockImplementation(async(...args)=>{if(once){once=false;await f.repository.save(projectState('Concurrent edit'),1);}return original(...args);});
    expect((await f.repository.createDailyBackup('2026-07-23'))!.sourceRevision).toBe(2);
    expect((await f.repository.previewImport(await f.repository.exportDailyBackup('2026-07-23'))).summary.activeProjectTitle).toBe('Concurrent edit');
  });
  it('a write failure aborts the entire archive, preserving existing history',async()=>{
    const f=fixture();await f.repository.save(projectState(),0);await f.repository.createDailyBackup('2026-07-23');const before=await f.repository.listDailyBackups();f.setNow('2026-07-25T00:00:00.000Z');
    const put=IDBObjectStore.prototype.put;vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args){if(this.name==='dailyBackups')throw new DOMException('Quota','QuotaExceededError');return put.apply(this,args);});
    await expect(f.repository.createDailyBackup('2026-07-24')).rejects.toThrow('Quota');expect(await f.repository.listDailyBackups()).toEqual(before);expect((await f.repository.load()).revision).toBe(1);
  });
  it('counts shared contents once, trims to payload budget, and preserves future dates after a clock correction',async()=>{
    const a=await prepareDailyBackup(projectState(),'2026-07-23','2026-07-24T00:00:00.000Z',1);
    const b={...a.manifest,id:'2026-07-24',date:'2026-07-24'};
    const one=dailyBackupStoredBytes([a.manifest]);expect(dailyBackupStoredBytes([a.manifest,b])).toBeLessThan(one*2);
    expect(retainedDailyBackups([a.manifest,b],'2026-07-23').map(x=>x.id)).toEqual(['2026-07-24']);
    expect(retainedDailyBackups([a.manifest,b],'2026-07-24',{days:30,bytes:one}).map(x=>x.id)).toEqual(['2026-07-24']);
    await expect(expandDailyBackup(a.manifest,[])).rejects.toThrow('缺失');
    expect(()=>parseDailyManifest({...a.manifest,createdAt:'nonsense'})).toThrow('索引');
  });
});
