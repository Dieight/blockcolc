import { buildingCpuCacheBytes,prepareBuildingCpuCache,type BuildingCpuCache } from '@blockcolc/voxel/building-cpu-cache';
import { packWorldSceneCache,worldSceneCacheBytes,type WorldSceneCache } from '@blockcolc/voxel/world-scene-cache';
import { createDerivedCacheStorage,optionalIndexedDB,DERIVED_CACHE_DB,SCENE_CACHE_BUDGET,BUILDING_CACHE_BUDGET } from './derived-cache-storage';
import { derivedCacheTransferBuffers,type DerivedCacheRequest,type DerivedCacheResponse } from './derived-cache-protocol';

const scope=globalThis as unknown as {
  onmessage:((event:MessageEvent<DerivedCacheRequest>)=>void)|null;
  postMessage(message:DerivedCacheResponse,transfer?:Transferable[]):void;
};
scope.onmessage=event=>{void (async()=>{
  const request=event.data;
  if(!request||!Number.isSafeInteger(request.id)||!['scene','building'].includes(request.kind)
    ||!['classic-island','natural-valley','ocean-island','mosaic-coast'].includes(request.environment)
    ||!['read','write'].includes(request.operation))return;
  try{
    const building=request.kind==='building',storage=createDerivedCacheStorage(request.environment,optionalIndexedDB(),
      `${DERIVED_CACHE_DB}${building?'-buildings':''}`,building?BUILDING_CACHE_BUDGET:SCENE_CACHE_BUDGET);
    if(request.operation==='read'){
      if(!building)throw new Error('Scene reads remain local');
      const stored=await storage.read();
      const value=prepareBuildingCpuCache(stored);
      if(value&&stored&&typeof stored==='object'&&'recipes' in stored&&Array.isArray(stored.recipes)
        &&value.entry.recipes.length<stored.recipes.length){
        // Rewrite only a pruned, disposable old namespace, while its buffers
        // are still worker-owned. Never transfer then try to save detached data.
        await storage.write(value.entry,buildingCpuCacheBytes(value.entry));
      }
      scope.postMessage({id:request.id,ok:true,value},derivedCacheTransferBuffers(value));
    }else{
      const size=building?buildingCpuCacheBytes(request.entry as BuildingCpuCache):worldSceneCacheBytes(request.entry as WorldSceneCache);
      if(size<=(building?BUILDING_CACHE_BUDGET:SCENE_CACHE_BUDGET))
        await storage.write(building?request.entry:packWorldSceneCache(request.entry as WorldSceneCache),size);
      scope.postMessage({id:request.id,ok:true});
    }
  }catch{scope.postMessage({id:request.id,ok:false});}
})();};
