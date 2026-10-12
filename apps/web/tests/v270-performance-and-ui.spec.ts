import { expect,test,type Page } from '@playwright/test';
import { waitForPreparedWorld } from './world-ready';
import { choosePlanEndTime } from './focus-plan-controls';
import { readPersistedDomainState } from './persisted-domain-state';
import { fixBusinessDate } from './fixed-business-date';

async function setup(page:Page,minimal=false,theme='light',glass=100) {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(({minimal,theme,glass})=>{
    if(!localStorage.getItem('blockcolc-focus-preferences-v1'))localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({
      lightingQuality:'performance',constructionOutlineVisibility:'current',themeMode:theme,minimalMode:minimal,focusGlassTransparency:glass,
      focusMinutes:25,breakMinutes:5,
    }));
  },{minimal,theme,glass});
  await page.goto('/');await page.getByRole('button',{name:'开始建造',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await expect(page.locator('.world-screen')).toHaveAttribute('data-minimal-mode',String(minimal));
  return waitForPreparedWorld(page);
}
async function storedScene(page:Page) {
  return page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('blockcolc-derived-world-scene',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try {
      if(!db.objectStoreNames.contains('scenes'))return null;
      return await new Promise<boolean>((resolve,reject)=>{const request=db.transaction('scenes').objectStore('scenes').get('ocean-island');request.onsuccess=()=>resolve(Boolean(request.result));request.onerror=()=>reject(request.error);});
    } finally { db.close(); }
  });
}

test('restores persisted terrain/mesh/scenery after a real page reload and falls back on corrupt cache',async({page},info)=>{
  test.setTimeout(120_000);
  const canvas=await setup(page);
  await expect(canvas).toHaveAttribute('data-world-scene-cache-read','miss');
  await expect(page.locator('[data-route-mounted="true"]')).toHaveCount(3,{timeout:25_000});
  await expect.poll(async()=>Boolean(await storedScene(page)),{timeout:25_000}).toBe(true);
  await expect.poll(()=>page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open('blockcolc-derived-world-scene-buildings',1);request.onsuccess=()=>resolve(request.result);});
    try{return await new Promise<boolean>(resolve=>{if(!db.objectStoreNames.contains('scenes')){resolve(false);return;}const request=db.transaction('scenes').objectStore('scenes').get('ocean-island');request.onsuccess=()=>resolve(Boolean(request.result));});}finally{db.close();}
  }),{timeout:25_000}).toBe(true);
  const before=await canvas.evaluate(c=>({cells:c.dataset.terrainCellCount,triangles:c.dataset.terrainRenderTriangles,objects:c.dataset.sceneryObjectCount}));
  await page.reload();await waitForPreparedWorld(page);
  await expect(canvas).toHaveAttribute('data-world-scene-cache-read','restored');
  await expect(canvas).toHaveAttribute('data-building-cpu-cache-read','restored');
  expect(Number(await canvas.getAttribute('data-building-cpu-cache-hits'))).toBeGreaterThan(0);
  await expect(canvas).toHaveAttribute('data-terrain-generation-cache-hit','true');
  await expect(canvas).toHaveAttribute('data-scenery-plan-cache-hit','true');
  expect(await canvas.evaluate(c=>({cells:c.dataset.terrainCellCount,triangles:c.dataset.terrainRenderTriangles,objects:c.dataset.sceneryObjectCount}))).toEqual(before);
  await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open('blockcolc-derived-world-scene',1);request.onsuccess=()=>resolve(request.result);});
    try {await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('scenes','readwrite'),store=tx.objectStore('scenes'),request=store.get('ocean-island');
      request.onsuccess=()=>{const entry=request.result;entry.entry.terrain.data.positions[0]=NaN;store.put(entry);};
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
    });}finally{db.close();}
  });
  await page.reload();await waitForPreparedWorld(page);
  await expect(canvas).toHaveAttribute('data-world-scene-cache-read','invalid');
  await expect(canvas).toHaveAttribute('data-terrain-generation-cache-hit','false');
  await expect(canvas).toHaveAttribute('data-scenery-plan-cache-hit','false');
  await page.screenshot({path:info.outputPath('recovered-world.png')});
});

for(const minimal of [false,true])test(`progressive cold startup exposes the ${minimal?'minimal clock':'ordinary timer'} before the world is ready`,async({page},info)=>{
  test.setTimeout(120_000);
  await fixBusinessDate(page,new Date('2026-10-08T08:00:00Z'));
  await setup(page,minimal);
  await page.evaluate(()=>{
    const key='blockcolc-focus-preferences-v1',preferences=JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key,JSON.stringify({...preferences,progressiveStartup:true}));
  });
  await page.addInitScript(()=>{
    const original=WebGL2RenderingContext.prototype.clientWaitSync;
    let released=false;
    WebGL2RenderingContext.prototype.clientWaitSync=function(sync,flags,timeout){return released?original.call(this,sync,flags,timeout):this.TIMEOUT_EXPIRED;};
    (window as any).releaseProgressiveWorld=()=>{released=true;};
  });
  await page.reload();
  try{
    await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','false');
    await expect(page.locator('.boot-page--world')).toBeVisible();
    await expect(page.locator('.boot-page:not(.boot-page--world)')).toHaveCount(0);
    if(minimal){
      const clock=page.locator('.minimal-clock-gesture');
      await expect(clock).toBeVisible();
      for(let step=0;step<5;step++)await clock.press('ArrowUp');
      await clock.press('Enter');
    }else await page.getByRole('button',{name:'开始 1 轮',exact:true}).click();
    await expect.poll(async()=>(await readPersistedDomainState(page)).state.activeFocusSession?.id).toBeTruthy();
    await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','false');
    await expect(page.locator('.focus-panel .timer')).toBeVisible();
    expect(await page.locator('.focus-panel .timer').evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===e||e.contains(hit);})).toBe(true);
    await page.screenshot({path:info.outputPath('operable-clock-world-loading.png')});
  }finally{await page.evaluate(()=>(window as any).releaseProgressiveWorld());}
  await waitForPreparedWorld(page);
  expect((await readPersistedDomainState(page)).state.activeFocusSession).not.toBeNull();
  await expect(page.locator('.boot-page--world')).toHaveCount(0);
});

test('CPU building geometry survives renderer replacement and unchanged live buildings are retained',async({page},info)=>{
  test.setTimeout(120_000);await setup(page);
  const result=await page.evaluate(async()=>{
    const voxel=(window as any).__blockcolcVoxelTest as typeof import('@blockcolc/voxel');
    const blueprint=voxel.validateBlueprint({schemaVersion:1,id:'derived-geometry-test',title:'Geometry',bounds:{minX:0,maxX:2,minY:0,maxY:1,minZ:0,maxZ:0},voxels:[
      {x:0,y:0,z:0,materialId:'stone',buildOrder:10000},
      {x:1,y:0,z:0,materialId:'wood',buildOrder:10000,sourceBlockId:'minecraft:oak_stairs',sourceBlockState:{facing:'east',half:'bottom',shape:'straight'}},
      {x:2,y:1,z:0,materialId:'glass',buildOrder:10000,sourceBlockId:'minecraft:glass_pane',sourceBlockState:{east:'true',west:'true',north:'false',south:'false'}},
    ]});
    let entry:unknown=null;
    const canvas=document.createElement('canvas');canvas.style.cssText='width:180px;height:180px';document.body.append(canvas);
    const options={worldSeed:'building-cache-test',environmentStyle:'classic-island' as const,lightingQuality:'performance' as const,resolveBlueprint:()=>blueprint,
      buildingCpuCache:{read:async()=>entry,write:(next:unknown)=>{entry=structuredClone(next);}}};
    const worlds=[0,1].map(settlementIndex=>({projectId:`cpu-${settlementIndex}`,blueprintId:blueprint.id,buildingCompletionBasisPoints:10000,buildingConditionBasisPoints:10000,isMonument:false,settlementIndex}));
    let app=voxel.createVoxelRenderer(canvas,options);app.setVisible(false);app.setReducedMotion(true);
    try{
      await app.initializeWorlds(worlds,null);
      const first={fallback:app.getDiagnostics().fallbackVoxelCount,shapes:app.getDiagnostics().originalStaticShapeVoxelCount,batches:app.getDiagnostics().originalStaticShapeBatchCount};
      app.setWorlds(worlds);const unchanged=Number(canvas.dataset.buildingMeshCacheHits);
      app.setWorlds(worlds.map((world,index)=>index===0?{...world,buildingCompletionBasisPoints:5000}:world));
      const partial=Number(canvas.dataset.buildingMeshCacheHits);
      app.dispose();
      app=voxel.createVoxelRenderer(canvas,options);app.setVisible(false);app.setReducedMotion(true);
      await app.initializeWorlds(worlds,null);
      const restored={fallback:app.getDiagnostics().fallbackVoxelCount,shapes:app.getDiagnostics().originalStaticShapeVoxelCount,batches:app.getDiagnostics().originalStaticShapeBatchCount};
      return {first,restored,unchanged,partial,read:canvas.dataset.buildingCpuCacheRead,cpu:Number(canvas.dataset.buildingCpuCacheHits),geometry:Number(canvas.dataset.originalGeometryCacheHits)};
    }finally{app.dispose();canvas.remove();}
  });
  expect(result.unchanged).toBe(2);expect(result.partial).toBe(1);expect(result.read).toBe('restored');expect(result.cpu).toBe(2);
  expect(result.geometry).toBeGreaterThan(0);expect(result.first.shapes).toBeGreaterThan(0);expect(result.restored).toEqual(result.first);
  await info.attach('cpu-building-reuse.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});

test('statistics disclosures keep the same plus/minus center while expanding',async({page})=>{
  test.setTimeout(120_000);await setup(page);
  await page.getByRole('button',{name:'统计',exact:true}).click();
  for(const name of ['.monument-statistics','.achievements-disclosure']){
    const details=page.locator(name),summary=details.locator(':scope > summary'),icon=summary.locator('.pixel-disclosure');
    // Summary.click may scroll a lower disclosure into view. Compare the icon
    // against its own summary, not the viewport's changing scroll position.
    const center=()=>icon.evaluate(e=>{const r=e.getBoundingClientRect(),s=e.closest('summary')!.getBoundingClientRect();return{x:r.x+r.width/2-s.x,y:r.y+r.height/2-s.y,width:r.width,height:r.height};});
    const before=await center();await summary.click();
    expect(await details.evaluate(e=>(e as HTMLDetailsElement).open)).toBe(true);
    expect(await center()).toEqual(before);await summary.click();expect(await center()).toEqual(before);
  }
});

for(const minimal of [false,true])test(`a ${minimal?'minimal':'marathon'} next-round ready face has no plan entry and report growth does not move framing`,async({page},info)=>{
  test.setTimeout(120_000);const now=Date.parse('2026-10-08T08:00:00Z');await page.clock.setFixedTime(new Date(now));
  const canvas=await setup(page,minimal);
  if(minimal){
    const clock=page.locator('.minimal-clock-gesture');for(let step=0;step<11;step++)await clock.press('ArrowUp');await clock.press('Enter');
  }else{
    await page.getByRole('button',{name:'调整本次计划',exact:true}).click();const sheet=page.getByRole('dialog',{name:'安排下一轮'});
    await sheet.getByRole('button',{name:'按结束时间',exact:true}).click();await choosePlanEndTime(sheet,'16:55');
    await sheet.getByRole('button',{name:'确认计划',exact:true}).click();await page.getByRole('button',{name:'开始到 16:55',exact:true}).click();
  }
  const complete=async()=>{
    if(!await page.getByRole('button',{name:'结束本次专注',exact:true}).isVisible())await page.locator('.immersive-hint').dblclick();
    await page.getByRole('button',{name:'结束本次专注',exact:true}).click();await page.getByRole('button',{name:/提前完成本轮/}).click();
  };
  await complete();await page.clock.setFixedTime(new Date(now+6*60000));
  await expect(page.locator('.minimal-ready-clock')).toBeVisible();
  await expect(page.getByRole('button',{name:'调整本次计划',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'取消计划',exact:true})).toHaveCount(0);
  await page.locator('.minimal-ready-clock').press('Enter');
  await expect.poll(async()=>(await readPersistedDomainState(page)).state.activeFocusSession?.id).toBeTruthy();
  const before=await canvas.evaluate(c=>({bottom:c.dataset.immersiveFramingBottom,right:c.dataset.immersiveFramingRight}));
  await complete();await expect(page.locator('.marathon-progress-report')).toBeVisible();
  const after=await canvas.evaluate(c=>({bottom:c.dataset.immersiveFramingBottom,right:c.dataset.immersiveFramingRight}));
  expect(after).toEqual(before);
  await info.attach('report-framing.json',{body:JSON.stringify({before,after}),contentType:'application/json'});
  await page.screenshot({path:info.outputPath('stable-report-framing.png')});
});

test('saves/coalesces heavy settings without preparing a hidden renderer and applies on returning to the world',async({page},info)=>{
  test.setTimeout(120_000);const canvas=await setup(page);
  const initial=await canvas.evaluate(c=>({generation:c.dataset.rendererGeneration,rebuilds:c.dataset.worldRebuildCount,quality:c.dataset.requestedLightingQuality,outline:c.dataset.constructionOutlineVisibility}));
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const environment=page.getByRole('group',{name:'聚落环境'}),quality=page.getByRole('group',{name:'光影质量'}),outline=page.getByRole('group',{name:'施工轮廓'});
  for(const name of ['山谷','空岛','海岛']){
    await environment.getByRole('button',{name,exact:true}).click();
    await expect(environment.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');
  }
  await quality.getByRole('button',{name:'均衡',exact:true}).click();
  await outline.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(quality.getByRole('button',{name:'均衡',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.boot-page')).toHaveCount(0);
  expect(await canvas.evaluate(c=>({generation:c.dataset.rendererGeneration,rebuilds:c.dataset.worldRebuildCount,quality:c.dataset.requestedLightingQuality,outline:c.dataset.constructionOutlineVisibility}))).toEqual(initial);
  // Light settings are not part of the deferred world settings.
  await page.getByRole('group',{name:'深色模式'}).getByRole('button',{name:'深色',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'计时',exact:true}).click();await waitForPreparedWorld(page);
  await expect(canvas).toHaveAttribute('data-renderer-generation',initial.generation!);
  await expect(canvas).toHaveAttribute('data-world-rebuild-count',initial.rebuilds!);
  await expect(canvas).toHaveAttribute('data-requested-lighting-quality','balanced');
  await expect(canvas).toHaveAttribute('data-construction-outline-visibility','off');
  // A genuinely different final environment recreates once, on return only.
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await environment.getByRole('button',{name:'空岛',exact:true}).click();
  await expect(environment.getByRole('button',{name:'空岛',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(canvas).toHaveAttribute('data-renderer-generation',initial.generation!);
  await page.getByRole('button',{name:'计时',exact:true}).click();await waitForPreparedWorld(page);
  await expect(canvas).toHaveAttribute('data-environment-style','classic-island');
  await expect(canvas).toHaveAttribute('data-renderer-generation',String(Number(initial.generation)+1));
  await page.screenshot({path:info.outputPath('deferred-settings.png')});
});

test('finishes interrupted cold presentation before announcing a ready world on return',async({page},info)=>{
  test.setTimeout(120_000);await setup(page);
  await page.evaluate(()=>localStorage.setItem('v270-hidden-boot','true'));
  await page.addInitScript(()=>{
    if(localStorage.getItem('v270-hidden-boot')!=='true')return;
    let hidden=true;
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
    (window as any).restoreWorldVisibility=()=>{hidden=false;document.dispatchEvent(new Event('visibilitychange'));};
  });
  await page.reload();
  const canvas=page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-initial-presentation-ready','false');
  await expect(canvas).toHaveAttribute('data-initial-presentation-preparation-ms',/\d/);
  await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','false');
  expect(await page.locator('.boot-page').count()).toBeGreaterThan(0);
  await page.evaluate(()=>{
    const target=window as any;target.prematureWorldReady=false;
    const watch=new MutationObserver(()=>{
      if(document.querySelector('.world-screen')?.getAttribute('data-world-ready')==='true'
        &&document.querySelector('canvas[aria-label="项目建筑世界"]')?.getAttribute('data-initial-presentation-ready')!=='true')target.prematureWorldReady=true;
    });watch.observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-world-ready']});
    target.stopReadyWatch=()=>watch.disconnect();target.restoreWorldVisibility();
  });
  await waitForPreparedWorld(page);await expect(canvas).toHaveAttribute('data-initial-presentation-ready','true');
  expect(await page.evaluate(()=>{const target=window as any;target.stopReadyWatch();return target.prematureWorldReady;})).toBe(false);
  await expect(canvas).toHaveAttribute('data-renderer-generation','1');
  await page.screenshot({path:info.outputPath('resumed-cold-presentation.png')});
});

test('a failed cold GPU preparation exposes retry without keeping the startup loader over it',async({page})=>{
  test.setTimeout(120_000);await setup(page);
  await page.evaluate(()=>localStorage.setItem('v270-gpu-failure','true'));
  await page.addInitScript(()=>{
    if(localStorage.getItem('v270-gpu-failure')!=='true')return;
    const original=WebGL2RenderingContext.prototype.fenceSync;let fail=true;
    WebGL2RenderingContext.prototype.fenceSync=function(condition,flags){return fail?null:original.call(this,condition,flags);};
    (window as any).allowPreparedGpu=()=>{fail=false;};
  });
  await page.reload();
  const retry=page.getByRole('button',{name:'重试画面设置',exact:true});
  await expect(retry).toBeVisible();await expect(page.locator('.boot-page')).toHaveCount(0);
  await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','false');
  await page.evaluate(()=>(window as any).allowPreparedGpu());await retry.click();
  const canvas=await waitForPreparedWorld(page);
  await expect(canvas).toHaveAttribute('data-initial-presentation-ready','true');
  await expect(retry).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'我的第一座工坊',exact:true})).toBeVisible();
});

for(const changeQuality of [false,true])test(`adopts hidden task changes under the returning loader ${changeQuality?'with new quality':'without a settings change'}`,async({page},info)=>{
  test.setTimeout(120_000);const canvas=await setup(page);
  await page.getByRole('button',{name:'任务',exact:true}).click();
  await page.getByRole('button',{name:'新增任务',exact:true}).click();
  await page.getByLabel('大型任务').fill('隐藏世界采用检查');
  await page.getByRole('button',{name:'开始建造',exact:true}).click();await waitForPreparedWorld(page);
  const before=await canvas.evaluate(c=>({generation:c.dataset.rendererGeneration,rebuilds:Number(c.dataset.worldRebuildCount)}));
  await page.getByRole('button',{name:'任务',exact:true}).click();
  await page.locator('.choice-menu-trigger').click();
  await page.getByRole('option',{name:/我的第一座工坊/}).click();
  await expect(page.locator('.choice-menu-trigger')).toContainText('我的第一座工坊');
  await expect(canvas).toHaveAttribute('data-world-rebuild-count',String(before.rebuilds));
  if(changeQuality){
    await page.getByRole('button',{name:'设置',exact:true}).click();
    await page.getByRole('group',{name:'光影质量'}).getByRole('button',{name:'均衡',exact:true}).click();
  }
  await expect(canvas).toHaveAttribute('data-requested-lighting-quality','performance');
  await page.evaluate(()=>{
    const target=window as any;target.returnRebuilds=[];
    const canvas=document.querySelector('canvas[aria-label="项目建筑世界"]')!;
    const watch=new MutationObserver(records=>{
      if(!records.some(record=>record.attributeName==='data-world-rebuild-count'))return;
      target.returnRebuilds.push({rebuilds:Number(canvas.getAttribute('data-world-rebuild-count')),
        loader:Boolean(document.querySelector('.boot-page')),ready:document.querySelector('.world-screen')?.getAttribute('data-world-ready')});
    });watch.observe(canvas,{attributes:true,attributeFilter:['data-world-rebuild-count']});target.stopReturnWatch=()=>watch.disconnect();
  });
  await page.getByRole('button',{name:'计时',exact:true}).click();await waitForPreparedWorld(page);
  const observations=await page.evaluate(()=>{const target=window as any;target.stopReturnWatch();return target.returnRebuilds as Array<{rebuilds:number;loader:boolean;ready:string}>;});
  await info.attach('hidden-world-adoption.json',{body:JSON.stringify(observations,null,2),contentType:'application/json'});
  expect(observations.some(entry=>entry.rebuilds>before.rebuilds)).toBe(true);
  expect(observations.filter(entry=>entry.rebuilds>before.rebuilds).every(entry=>entry.loader&&entry.ready==='false')).toBe(true);
  await expect(canvas).toHaveAttribute('data-renderer-generation',before.generation!);
  await expect(canvas).toHaveAttribute('data-requested-lighting-quality',changeQuality?'balanced':'performance');
  expect(await canvas.evaluate(c=>Number(c.dataset.renderedWorldRebuildCount))).toBe(Number(await canvas.getAttribute('data-world-rebuild-count')));
  await expect(page.locator('#world-summary')).toContainText('我的第一座工坊，林边工坊，正在建造');
});

for(const [theme,glass] of [['light',0],['light',100],['dark',0],['dark',100]] as const) {
  test(`end-focus actions use fixed edge-aligned glass in ${theme} at timer clarity ${glass}`,async({page},info)=>{
    test.setTimeout(90_000);await page.setViewportSize({width:390,height:844});await setup(page,false,theme,glass);
    await page.getByRole('button',{name:'开始 1 轮',exact:true}).click();
    await page.locator('.immersive-hint').dblclick();
    const stop=page.getByRole('button',{name:'结束本次专注',exact:true});await expect(stop).toBeVisible();
    const stopFilter=await stop.evaluate(e=>getComputedStyle(e).backdropFilter);
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-focus-preferences-v1')!).focusGlassTransparency)).toBe(glass);
    expect(stopFilter).toBe('blur(22px) saturate(1.3)');await stop.click();
    const dialog=page.getByRole('dialog',{name:'如何结束这次专注？'});
    const panel=async()=>dialog.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {left:r.left,right:r.right,bottom:r.bottom,filter:s.backdropFilter,background:s.backgroundImage,color:s.color,border:s.borderRadius};});
    const normal=await panel();expect(normal.left).toBe(0);expect(normal.right).toBe(390);expect(normal.bottom).toBe(844);expect(normal.border).toBe('0px');expect(normal.filter).toBe(stopFilter);
    await page.screenshot({path:info.outputPath(`fixed-stop-${theme}-${glass}.png`)});
    await dialog.getByRole('button',{name:/中断本轮/}).click();
    await expect(page.getByRole('dialog',{name:'这次为什么中断？'})).toBeVisible();
    const reasons=await page.locator('.end-focus-dialog').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,filter:getComputedStyle(e).backdropFilter};});
    expect(reasons).toEqual({left:0,right:390,bottom:844,filter:stopFilter});
    await page.getByRole('button',{name:'关闭结束专注窗口',exact:true}).click();
  });
}

test('the nested cancellation sheet keeps fixed glass and safe edges with a two-round marathon',async({page},info)=>{
  test.setTimeout(90_000);await page.setViewportSize({width:390,height:844});
  await page.clock.setFixedTime(new Date('2026-10-08T08:00:00Z'));
  await setup(page,false,'dark',100);
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();
  const plan=page.getByRole('dialog',{name:'安排下一轮'});
  await plan.getByRole('button',{name:'按结束时间',exact:true}).click();
  await choosePlanEndTime(plan,'17:00');
  await plan.getByRole('button',{name:'确认计划',exact:true}).click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-round-plan-v1')!).totalRounds)).toBe(2);
  await page.getByRole('button',{name:'开始到 17:00',exact:true}).click();
  await page.locator('.immersive-hint').dblclick();
  await page.getByRole('button',{name:'结束本次专注',exact:true}).click();
  await page.getByRole('button',{name:/取消整个计划/,exact:false}).click();
  const sheet=page.getByRole('dialog',{name:'取消整个多轮计划？'});
  const style=await sheet.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {left:r.left,right:r.right,bottom:r.bottom,filter:s.backdropFilter,radius:s.borderRadius};});
  expect(style).toEqual({left:0,right:390,bottom:844,filter:'blur(22px) saturate(1.3)',radius:'0px'});
  const confirm=sheet.getByRole('button',{name:'确认取消整个计划',exact:true});await expect(confirm).toBeDisabled();
  await sheet.getByRole('button',{name:'优先级变化',exact:true}).click();await expect(confirm).toBeEnabled();
  await expect(sheet.getByLabel('补充说明（可选）')).toBeVisible();
  expect(await sheet.getByLabel('补充说明（可选）').evaluate(e=>getComputedStyle(e,'::placeholder').color)).toBe(await sheet.evaluate(e=>getComputedStyle(e).color));
  await page.screenshot({path:info.outputPath('fixed-cancellation-sheet.png')});
  await sheet.getByRole('button',{name:'返回',exact:true}).click();
  await page.getByRole('button',{name:'关闭结束专注窗口',exact:true}).click();
  await expect(page.locator('.end-focus-dialog')).toHaveCount(0);
  await expect(page.locator('.world-screen')).toHaveClass(/is-focusing/);
});

for(const viewport of [{width:390,height:844},{width:448,height:998},{width:820,height:390}]) {
  test(`portal return stays full-screen and burns a centered opening at ${viewport.width}x${viewport.height}`,async({page},info)=>{
    test.setTimeout(90_000);await page.setViewportSize(viewport);const canvas=await setup(page,true);
    await canvas.evaluate(e=>e.dataset.residencyProbe='preserved');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>{
      const target=window as any;target.portalSamples=[];target.flameSamples=[];let running=true;
      const tick=()=>{
        const layer=document.querySelector<HTMLElement>('.mode-portal');
        if(layer?.dataset.direction==='leave'){
          const flame=layer.querySelector<HTMLElement>('.mode-portal__flame');
          const fire=flame?.querySelector<HTMLCanvasElement>('.mode-portal__flame-canvas');
          if(flame&&!flame.hidden&&fire)target.flameSamples.push({shape:flame.dataset.shape,width:fire.width,height:fire.height,frame:flame.dataset.flameFrame,
            smoothing:fire.getContext('2d')!.imageSmoothingEnabled,pixels:getComputedStyle(fire).imageRendering});
          const cover=layer.querySelector<HTMLCanvasElement>('.mode-portal__reveal-cover');
          if(cover){const progress=Number(cover.dataset.revealProgress),r=cover.getBoundingClientRect(),ctx=cover.getContext('2d')!;
            if(progress>.01&&progress<.4)target.portalSamples.push({x:r.x,y:r.y,width:r.width,height:r.height,centerAlpha:ctx.getImageData(Math.floor(cover.width/2),Math.floor(cover.height/2),1,1).data[3],cornerAlpha:ctx.getImageData(1,1,1,1).data[3],progress});
          }
        }
        if(running)requestAnimationFrame(tick);
      };target.stopPortalWatch=()=>{running=false;};requestAnimationFrame(tick);
    });
    await page.getByRole('button',{name:'返回完整模式',exact:true}).press('Enter');
    if(viewport.width===390){
      await expect(page.locator('.mode-portal__flame')).toBeVisible();
      await page.screenshot({path:info.outputPath('continuous-pixel-fire.png')});
    }
    await expect(page.locator('.world-screen')).toHaveAttribute('data-minimal-mode','false');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-mode-portal-active','false',{timeout:20_000});
    const samples=await page.evaluate(()=>{const target=window as any;target.stopPortalWatch();return {cover:target.portalSamples,flame:target.flameSamples};});
    await info.attach('portal-viewport-samples.json',{body:JSON.stringify(samples,null,2),contentType:'application/json'});
    expect(samples.cover.length).toBeGreaterThan(3);expect(samples.flame.length).toBeGreaterThan(3);
    for(const sample of samples.cover){expect(sample).toMatchObject({x:0,y:0,width:viewport.width,height:viewport.height,centerAlpha:0,cornerAlpha:255});}
    expect(samples.flame.every((sample:any)=>sample.shape==='advected-column'&&sample.width===60&&sample.height===104&&sample.smoothing===false&&sample.pixels==='pixelated')).toBe(true);
    expect(new Set(samples.flame.map((sample:any)=>sample.frame)).size).toBeGreaterThan(2);
    await expect(canvas).toHaveAttribute('data-residency-probe','preserved');
    await expect(page.locator('.mode-portal')).toHaveCount(0);
    expect(await page.locator('.app-shell').evaluate(e=>(e as HTMLElement).inert)).toBe(false);
    await page.screenshot({path:info.outputPath('return-native-layout.png')});
  });
}
