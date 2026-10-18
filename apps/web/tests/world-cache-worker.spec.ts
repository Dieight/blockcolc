import {test,expect} from '@playwright/test';
import {waitForPreparedWorld} from './world-ready';

test('default background queue persists both caches under continuous short idle slots',async({page})=>{
  test.setTimeout(90_000);
  await page.addInitScript(()=>{
    localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({lightingQuality:'performance'}));
    Object.defineProperty(window,'requestIdleCallback',{configurable:true,value:(callback:IdleRequestCallback)=>window.setTimeout(()=>callback({didTimeout:false,timeRemaining:()=>3}),0)});
    Object.defineProperty(window,'cancelIdleCallback',{configurable:true,value:(id:number)=>clearTimeout(id)});
  });
  await page.goto('/');await page.getByRole('button',{name:'开始建造',exact:true}).click();await waitForPreparedWorld(page);
  await expect.poll(()=>page.evaluate(async()=>{
    const databases=await indexedDB.databases();
    for(const name of ['blockcolc-derived-world-scene','blockcolc-derived-world-scene-buildings']){
      if(!databases.some(database=>database.name===name))return false;
      const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      try{
        if(!db.objectStoreNames.contains('headers'))return false;
        const header=await new Promise<{bytes:number}|undefined>((resolve,reject)=>{const r=db.transaction('headers').objectStore('headers').get('ocean-island');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        if(!header||header.bytes<=0)return false;
      }finally{db.close();}
    }
    return true;
  }),{timeout:25_000}).toBe(true);
});

for(const [denied,environment] of [[false,'natural-valley'],[true,'natural-valley'],[false,'mosaic-coast']] as const)test(`derived cache read/write ${denied?'falls back when worker is denied':'uses a real worker'} (${environment})`,async({page},info)=>{
  test.setTimeout(180_000);const errors:string[]=[],workers:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('worker',worker=>workers.push(worker.url()));
  await page.clock.setFixedTime(new Date('2026-10-16T12:00:00+08:00'));
  if(denied)await page.addInitScript(()=>{Object.defineProperty(window,'Worker',{value:class{constructor(){throw new DOMException('denied','SecurityError');}}});});
  await page.goto('/');await page.getByRole('button',{name:'开始建造',exact:true}).click();await waitForPreparedWorld(page);
  await page.getByRole('button',{name:'任务',exact:true}).click();
  const result=await page.evaluate(async environment=>{
    const voxel=(window as any).__blockcolcVoxelTest as typeof import('@blockcolc/voxel');
    const ports=(window as any).__blockcolcDerivedCacheTest as typeof import('../src/world-scene-cache');
    const jobs:Array<()=>void|Promise<void>>=[],schedule=(_key:string,job:()=>void|Promise<void>)=>{jobs.push(job);return()=>{};};
    const options={environmentStyle:environment,worldSeed:'worker-test',lightingQuality:'performance' as const,
      worldSceneCache:ports.createWorldSceneCachePort(environment,voxel.worldSceneCacheBytes,schedule,undefined,voxel.packWorldSceneCache),
      buildingCpuCache:ports.createBuildingCpuCachePort(environment,voxel.buildingCpuCacheBytes,schedule)};
    const worlds=[{projectId:'worker-cache-fixture',blueprintId:'builtin-small-workshop',settlementIndex:0,buildingCompletionBasisPoints:5000,buildingConditionBasisPoints:10000,isActive:true,isMonument:false}];
    const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;width:280px;height:280px';document.body.append(canvas);
    let renderer=voxel.createVoxelRenderer(canvas,options);renderer.setReducedMotion(true);
    const sample=()=>({scene:canvas.dataset.worldSceneCacheRead,building:canvas.dataset.buildingCpuCacheRead,plan:canvas.dataset.sceneryPlanCacheHit,
      table:canvas.dataset.terrainSurfaceTableCacheHit, ground:canvas.dataset.precipitationGroundCacheHit,
      groundSize:canvas.dataset.precipitationGroundSize, groundBounds:canvas.dataset.precipitationGroundBounds,
      geometryBytes:Number(canvas.dataset.terrainGenerationBytes), tableBytes:Number(canvas.dataset.terrainSurfaceTableBytes), indexBytes:Number(canvas.dataset.terrainSurfaceIndexBytes),
      staticHits:Number(canvas.dataset.staticCpuCacheHits),staticMisses:Number(canvas.dataset.staticCpuCacheMisses),shapes:renderer.getDiagnostics().originalStaticShapeVoxelCount});
    const pixels=()=>{
      renderer.resetCamera();const target=document.createElement('canvas');target.width=280;target.height=280;
      if(!renderer.capturePresentation(target))throw new Error('No fixture frame');
      return target.getContext('2d')!.getImageData(0,0,280,280).data;
    };
    try{
      await renderer.initializeWorlds(worlds,null);await renderer.preparePresentationFrame();const initial=sample();
      while(jobs.length)await jobs.shift()!();
      // Writes must not detach buffers still used by the visible world.
      renderer.setWorlds(worlds);await renderer.preparePresentationFrame();const afterWrite=sample(),beforePixels=pixels();
      renderer.dispose();renderer=voxel.createVoxelRenderer(canvas,options);renderer.setReducedMotion(true);
      await renderer.initializeWorlds(worlds,null);await renderer.preparePresentationFrame();const restored=sample();
      const afterPixels=pixels();let different=0,visible=0;
      for(let i=0;i<afterPixels.length;i+=4){
        if(beforePixels[i+3]!>0)visible++;
        if(Math.max(...[0,1,2].map(channel=>Math.abs(beforePixels[i+channel]!-afterPixels[i+channel]!)))>3)different++;
      }
      // Corruption is a miss, never a trusted prepared receipt.
      const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('blockcolc-derived-world-scene-buildings',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('scenes','readwrite');tx.objectStore('scenes').put({slot:environment,entry:{revision:999,recipes:[]}});tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}
      const rejected=await options.buildingCpuCache.readPrepared?.();
      return {initial,afterWrite,restored,rejected:rejected??null,visible,pixelDifference:different/(280*280)};
    }finally{renderer.dispose();canvas.remove();}
  },environment);
  expect(result.restored.scene).toBe('restored');expect(result.restored.building).toBe('restored');expect(result.restored.plan).toBe('true');
  expect(result.initial.table).toBe('false');expect(result.afterWrite.table).toBe('true');expect(result.restored.table).toBe('false');
  expect(result.initial.ground).toBe('false');expect(result.afterWrite.ground).toBe('true');expect(result.restored.ground).toBe('false');
  expect(result.restored.groundSize).toBe(result.initial.groundSize);expect(result.restored.groundSize).not.toBe('1:1');
  expect(result.restored.groundBounds).toBe(result.initial.groundBounds);
  expect(result.afterWrite.geometryBytes).toBe(result.initial.geometryBytes);
  expect(result.afterWrite.tableBytes).toBe(result.initial.tableBytes);expect(result.afterWrite.indexBytes).toBe(result.initial.indexBytes);
  expect(result.initial.tableBytes).toBeGreaterThan(0);expect(result.initial.indexBytes).toBeGreaterThan(0);
  expect(result.restored.staticHits).toBeGreaterThan(0);expect(result.restored.staticMisses).toBe(0);
  expect(result.afterWrite.shapes).toBe(result.initial.shapes);expect(result.restored.shapes).toBe(result.initial.shapes);expect(result.rejected).toBeNull();
  expect(result.visible).toBeGreaterThan(60_000);expect(result.pixelDifference).toBeLessThan(.005);
  if(!denied)expect(workers.some(url=>url.includes('derived-cache.worker'))).toBe(true);
  expect(errors).toEqual([]);await info.attach('worker-cache-results',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
