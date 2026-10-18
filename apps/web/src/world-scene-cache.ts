import type { WorldSceneCache,WorldSceneCachePort,TerrainEnvironmentStyle,BuildingCpuCache,BuildingCpuCachePort } from '@blockcolc/voxel';
import { prepareBuildingCpuCache } from '@blockcolc/voxel/building-cpu-cache';
import { queueIdleWork } from './idle-work';
import { createDerivedCacheStorage,optionalIndexedDB,DERIVED_CACHE_DB,SCENE_CACHE_BUDGET,BUILDING_CACHE_BUDGET } from './derived-cache-storage';
import { derivedCacheWorkerClient } from './derived-cache-worker-client';
import type { DerivedCacheKind } from './derived-cache-protocol';

/** Separate, disposable database. Custom/test database adapters stay local. */
export function createWorldSceneCachePort(environment:TerrainEnvironmentStyle,bytes:(entry:WorldSceneCache)=>number,
  schedule=queueIdleWork,database:IDBFactory|undefined=optionalIndexedDB(),encode:(entry:WorldSceneCache)=>unknown=entry=>entry):WorldSceneCachePort{
  const port=createDerivedCachePort('scene',environment,bytes,schedule,database,SCENE_CACHE_BUDGET,encode);
  // OnePlus measured an extra whole-graph clone on a worker scene read. Keep
  // this packed read local; only encoding/writing the scene runs off-thread.
  return port;
}
export function createBuildingCpuCachePort(environment:TerrainEnvironmentStyle,bytes:(entry:BuildingCpuCache)=>number,
  schedule=queueIdleWork,database:IDBFactory|undefined=optionalIndexedDB()):BuildingCpuCachePort{
  const port=createDerivedCachePort('building',environment,bytes,schedule,database,BUILDING_CACHE_BUDGET,entry=>entry);
  return {...port,readPrepared:port.offThread?async()=>{
    try{return await port.workerRead() as ReturnType<typeof prepareBuildingCpuCache>;}catch{return prepareBuildingCpuCache(await port.read());}
  }:undefined};
}
function createDerivedCachePort<T>(kind:DerivedCacheKind,environment:string,bytes:(entry:T)=>number,schedule:typeof queueIdleWork,
  database:IDBFactory|undefined,maximum:number,encode:(entry:T)=>unknown){
  const name=`${DERIVED_CACHE_DB}${kind==='building'?'-buildings':''}`;
  const storage=createDerivedCacheStorage(environment,database,name,maximum);
  const offThread=typeof Worker==='function'&&database!==undefined&&database===optionalIndexedDB();
  return {
    offThread,
    read:()=>storage.read(),
    workerRead:()=>derivedCacheWorkerClient().request({kind,environment,operation:'read'}),
    write(entry:T){
      schedule(`${name}:current`,async()=>{
        if(offThread){
          try{await derivedCacheWorkerClient().request({kind,environment,operation:'write',entry});return;}
          catch{schedule(`${name}:fallback`,async()=>{
            try{const size=bytes(entry);if(Number.isFinite(size)&&size>=0&&size<=maximum)await storage.write(encode(entry),size);}catch{/* Optional cache only. */}
          });return;}
        }
        try{const size=bytes(entry);if(Number.isFinite(size)&&size>=0&&size<=maximum)await storage.write(encode(entry),size);}catch{/* Optional cache only. */}
      },{backgroundDispatch:offThread});
    },
  };
}
