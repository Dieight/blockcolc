import {expect,test} from '@playwright/test';
import {parseJava16xResourcePack} from '@blockcolc/resource-pack';
import {strToU8,zipSync} from 'fflate';
import {syntheticShapePng} from './original-shape-pack-fixture';
import {waitForPreparedWorld} from './world-ready';

function animatedPack(){
  const files:Record<string,Uint8Array>={'pack.mcmeta':strToU8(JSON.stringify({pack:{pack_format:97,description:'Authored retained-root fixture'}}))};
  for(const block of ['stone','oak_leaves','water']){
    const texture=block==='water'?'water_still':block;
    files[`assets/minecraft/blockstates/${block}.json`]=strToU8(JSON.stringify({variants:{'':{model:`minecraft:block/${block}`}}}));
    files[`assets/minecraft/models/block/${block}.json`]=strToU8(JSON.stringify({parent:'minecraft:block/cube_all',textures:{all:`minecraft:block/${texture}`}}));
    files[`assets/minecraft/textures/block/${texture}.png`]=syntheticShapePng(block==='water'?32:16,block==='oak_leaves');
  }
  files['assets/minecraft/textures/block/water_still.png.mcmeta']=strToU8(JSON.stringify({animation:{frametime:2,frames:[0,1],interpolate:true}}));
  return {id:'retained-root-pack',manifest:parseJava16xResourcePack(zipSync(files))};
}

for(const packed of [false,true])test(`unchanged world layers retain geometry, shadows and texture uses with ${packed?'imported':'original'} materials`,async({page},info)=>{
  test.setTimeout(240_000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/WebGL|Shader|GL_INVALID/.test(message.text()))errors.push(message.text());});
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00+08:00'));
  await page.addInitScript(()=>localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({lightingQuality:'performance'})));
  await page.goto('/');await page.getByRole('button',{name:'开始建造',exact:true}).click();await waitForPreparedWorld(page);
  await page.getByRole('button',{name:'任务',exact:true}).click();
  const pack=packed?animatedPack():null;
  const result=await page.evaluate(async selected=>{
    const voxel=(window as any).__blockcolcVoxelTest as typeof import('@blockcolc/voxel');
    const blueprint=voxel.validateBlueprint({schemaVersion:1,id:'retention-fixture',title:'Fixture',bounds:{minX:0,maxX:2,minY:0,maxY:1,minZ:0,maxZ:1},voxels:[
      {x:0,y:0,z:0,buildOrder:0,materialId:'stone',sourceBlockId:'minecraft:stone'},
      {x:1,y:0,z:0,buildOrder:2000,materialId:'wood',sourceBlockId:'minecraft:oak_leaves'},
      {x:2,y:0,z:0,buildOrder:3000,materialId:'glass',sourceBlockId:'minecraft:water',sourceBlockState:{level:'0'}},
      {x:1,y:1,z:1,buildOrder:10000,materialId:'stone',sourceBlockId:'minecraft:stone'},
    ]});
    const campfire=voxel.validateBlueprint({schemaVersion:1,id:'retention-campfire',title:'Camp',bounds:{minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0},voxels:[
      {x:0,y:0,z:0,buildOrder:0,materialId:'wood',sourceBlockId:'minecraft:campfire',campfire:{slots:[]}},
    ]});
    const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','Retained world fixture');canvas.style.cssText='position:fixed;top:80px;left:10px;width:300px;height:300px;z-index:100';document.body.append(canvas);
    let cpuEntry:unknown=null;
    const renderOptions={environmentStyle:'ocean-island' as const,worldSeed:'retention-world',lightingQuality:'cinematic' as const,constructionOutlineVisibility:'all' as const,resolveBlueprint:(id:string)=>id===campfire.id?campfire:blueprint,
      buildingCpuCache:{read:async()=>cpuEntry,write:(value:unknown)=>{cpuEntry=structuredClone(value);}}};
    let app=voxel.createVoxelRenderer(canvas,renderOptions);
    app.setReducedMotion(true);
    const reward={rewardId:'retained-reward',resourceId:'retained-resource',date:'2026-10-15',blueprint,localPosition:{x:5,z:5},rotationQuarterTurns:0 as const};
    let worlds=[0,1,2].map(settlementIndex=>({projectId:`retain-${settlementIndex}`,blueprintId:settlementIndex===2?campfire.id:blueprint.id,
      settlementIndex,buildingCompletionBasisPoints:10000,buildingConditionBasisPoints:10000,isActive:settlementIndex===0,isMonument:false,
      importedDecorations:settlementIndex===0?[reward]:[]}));
    const sample=()=>{const d=app.getDiagnostics();return {hits:Number(canvas.dataset.buildingMeshCacheHits),rewards:Number(canvas.dataset.rewardMeshCacheHits),
      scenery:canvas.dataset.sceneryMeshCacheHit==='true',staticCpuHits:Number(canvas.dataset.staticCpuCacheHits),staticCpuMisses:Number(canvas.dataset.staticCpuCacheMisses),objects:Number(canvas.dataset.sceneryObjectCount),cutout:d.cutoutShadowMeshCount,animated:d.animatedTextureCount,
      textured:d.texturedVoxelCount,shapes:d.originalStaticShapeVoxelCount,flowers:d.naturalFlowerPackPlacementCount,geometries:d.memory.geometries,textures:d.memory.textures};};
    try{
      await app.initializeWorlds(worlds,selected);await app.preparePresentationFrame();const initial=sample();
      app.setWorlds(worlds);await app.preparePresentationFrame();const retained=sample();
      app.setLightingQuality('performance');app.setWorlds(worlds);app.setLightingQuality('cinematic');app.setWorlds(worlds);await app.preparePresentationFrame();const qualityReturn=sample();
      worlds=worlds.map((world,index)=>index===0?{...world,buildingCompletionBasisPoints:5000}:world);
      app.setWorlds(worlds);await app.preparePresentationFrame();const partial=sample();
      // Equal public IDs and formats do not make a newly built atlas the same owner.
      if(selected)await app.setResourcePack({id:selected.id,manifest:selected.manifest});
      else await app.setResourcePack(null);
      await app.preparePresentationFrame();const changedAtlas=sample();
      for(let repeat=0;repeat<3;repeat++){app.setWorlds(worlds);await app.preparePresentationFrame();}
      const repeated=sample();
      worlds=worlds.map((world,index)=>index===0?{...world,importedDecorations:[]}:world);
      app.setWorlds(worlds);await app.preparePresentationFrame();const removedReward=sample();
      app.dispose();app=voxel.createVoxelRenderer(canvas,renderOptions);app.setReducedMotion(true);
      await app.initializeWorlds(worlds,selected);await app.preparePresentationFrame();const restored=sample();
      (window as any).__retentionFixture={app,canvas};
      return {initial,retained,qualityReturn,partial,changedAtlas,repeated,removedReward,restored};
    }catch(error){app.dispose();canvas.remove();throw error;}
  },pack);
  try{
    expect(result.retained.hits).toBe(2);expect(result.retained.rewards).toBe(1);expect(result.retained.scenery).toBe(true);
    expect(result.qualityReturn.hits).toBe(2);expect(result.qualityReturn.scenery).toBe(true);
    expect(result.retained.cutout).toBe(result.initial.cutout);expect(result.retained.animated).toBe(result.initial.animated);
    expect(result.retained.textured).toBe(result.initial.textured);expect(result.retained.shapes).toBe(result.initial.shapes);
    expect(result.partial.hits).toBe(1);expect(result.partial.scenery).toBe(true);expect(result.partial.rewards).toBe(1);
    expect(result.partial.animated).toBe(result.initial.animated);
    if(packed){expect(result.initial.animated).toBeGreaterThan(0);expect(result.initial.cutout).toBeGreaterThan(0);expect(result.changedAtlas.hits).toBe(0);expect(result.changedAtlas.scenery).toBe(false);}
    expect(result.repeated.geometries).toBe(result.changedAtlas.geometries);expect(result.repeated.textures).toBe(result.changedAtlas.textures);
    expect(result.removedReward.rewards).toBe(0);expect(result.removedReward.scenery).toBe(false);
    expect(result.restored.scenery).toBe(false);expect(result.restored.textured).toBe(result.removedReward.textured);expect(result.restored.shapes).toBe(result.removedReward.shapes);
    if(!packed){expect(result.initial.staticCpuMisses).toBeGreaterThan(0);expect(result.restored.staticCpuHits).toBeGreaterThan(0);expect(result.restored.staticCpuMisses).toBe(0);}
    await info.attach('retained-layer-counters.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
    await page.getByLabel('Retained world fixture',{exact:true}).screenshot({path:info.outputPath('retained-world.png')});expect(errors).toEqual([]);
  }finally{await page.evaluate(()=>{const {app,canvas}=(window as any).__retentionFixture;app.dispose();canvas.remove();delete (window as any).__retentionFixture;});}
});
