import {expect,test} from '@playwright/test';
import type * as THREE from 'three';
import {parseJava16xResourcePack} from '@blockcolc/resource-pack';
import {zipSync,strToU8} from 'fflate';
import {syntheticShapePng} from './original-shape-pack-fixture';

function terrainPack(){
  const files:Record<string,Uint8Array>={'pack.mcmeta':strToU8(JSON.stringify({pack:{pack_format:97,description:'Authored terrain tint/mip fixture'}}))};
  for(const block of ['grass_block','dirt','stone']){
    files[`assets/minecraft/blockstates/${block}.json`]=strToU8(JSON.stringify({variants:{'':{model:`minecraft:block/${block}`}}}));
    files[`assets/minecraft/models/block/${block}.json`]=strToU8(JSON.stringify({textures:{all:`minecraft:block/${block}`},elements:[{from:[0,0,0],to:[16,16,16],
      faces:Object.fromEntries(['up','down','north','south','east','west'].map(face=>[face,{texture:'#all',...(block==='grass_block'&&face==='up'?{tintindex:0}:{})}]))}]}));
    files[`assets/minecraft/textures/block/${block}.png`]=syntheticShapePng(16);
  }
  return {id:'terrain-appearance-fixture',manifest:parseJava16xResourcePack(zipSync(files))};
}

test('renders integrated landforms in every environment with original and independently filtered pack terrain',async({page},info)=>{
  test.setTimeout(360_000);const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/WebGL|Shader|GL_INVALID/.test(message.text()))errors.push(message.text());});
  await page.setViewportSize({width:960,height:768});await page.clock.setFixedTime(new Date('2026-10-17T15:00:00+08:00'));
  await page.goto('/');await page.waitForFunction(()=>!!(window as any).__blockcolcVoxelTest);
  await page.evaluate(()=>{
    const scope=window as any,voxel=scope.__blockcolcVoxelTest;
    const temporary=new voxel.LightingPostProcessor({capabilities:{maxSamples:0}});
    const prototype=Object.getPrototypeOf(Object.getPrototypeOf(temporary.quadScene)),old=prototype.onBeforeRender;temporary.dispose();
    scope.terrainAppearance={app:null,scene:null};
    prototype.onBeforeRender=function(renderer:THREE.WebGLRenderer,scene:THREE.Scene,...args:any[]){
      if(renderer.domElement.getAttribute('aria-label')==='Terrain appearance fixture'&&scene.getObjectByName('worldLightRig'))scope.terrainAppearance.scene=scene;
      old.call(this,renderer,scene,...args);
    };
    const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','Terrain appearance fixture');
    canvas.style.cssText='position:fixed;inset:0;width:960px;height:640px;z-index:999999;touch-action:none';document.body.append(canvas);
  });
  const observations=[];
  for(const style of ['classic-island','natural-valley','ocean-island','mosaic-coast'] as const)for(const packed of [false,true]){
    const result=await page.evaluate(async({style,selected})=>{
      const scope=window as any,voxel=scope.__blockcolcVoxelTest;
      scope.terrainAppearance.app?.dispose();scope.terrainAppearance.scene=null;
      const app=voxel.createVoxelRenderer(document.querySelector('[aria-label="Terrain appearance fixture"]'),{
        environmentStyle:style,worldSeed:'world-default',terrainGenerationVersion:4,lightingQuality:'balanced',
        initialEnvironment:{weather:{kind:'clear',cloudIntensity:0},astronomy:null,debug:{date:Date.parse('2026-10-17T15:00:00+08:00')}}});
      scope.terrainAppearance.app=app;app.setReducedMotion(true);app.setVisible(false);
      await app.initializeWorlds(Array.from({length:24},(_,settlementIndex)=>({projectId:`appearance-${settlementIndex}`,settlementIndex,blueprintId:'builtin-small-workshop',
        buildingCompletionBasisPoints:10000,buildingConditionBasisPoints:10000,isMonument:false})),selected);
      app.setVisible(true);await app.prepareInitialPresentation();
      const scene=scope.terrainAppearance.scene as THREE.Scene,terrain:THREE.Mesh[]=[];
      scene.traverse(node=>{if(node.userData.terrainTriangles!==undefined)terrain.push(node as THREE.Mesh);});
      const materials=terrain.flatMap(mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material]) as THREE.MeshStandardMaterial[];
      const crops=materials.filter(material=>material.map?.name.startsWith('blockcolc-terrain-tile'));
      return {style,packed:!!selected,terrain:terrain.length,triangles:terrain.map(mesh=>mesh.userData.terrainTriangles),
        cast:terrain.every(mesh=>mesh.castShadow),receive:terrain.every(mesh=>mesh.receiveShadow),
        tiles:crops.map(material=>({color:material.color.getHex(),mip:material.map!.generateMipmaps,min:material.map!.minFilter,anisotropy:material.map!.anisotropy})),
        diagnostics:app.getDiagnostics()};
    },{style,selected:packed?terrainPack():null});
    expect(result.terrain).toBe(1);expect(result.cast).toBe(true);expect(result.receive).toBe(true);
    if(packed){expect(result.tiles.length).toBeGreaterThanOrEqual(3);expect(result.tiles.every(tile=>tile.mip&&tile.min===1008&&tile.anisotropy>=1&&tile.anisotropy<=4)).toBe(true);
      expect(result.tiles.some(tile=>tile.color===0x91bd59)).toBe(true);}
    observations.push(result);
    const canvas=page.getByLabel('Terrain appearance fixture');await canvas.dispatchEvent('wheel',{deltaY:100000});
    await canvas.screenshot({path:info.outputPath(`${style}-${packed?'pack':'original'}.png`)});
    await canvas.dispatchEvent('pointerdown',{pointerId:10,clientX:450,clientY:280,pointerType:'touch'});
    await canvas.dispatchEvent('pointermove',{pointerId:10,clientX:650,clientY:280,pointerType:'touch'});
    await canvas.dispatchEvent('pointerup',{pointerId:10,clientX:650,clientY:280,pointerType:'touch'});
    await page.evaluate(async()=>{await(window as any).terrainAppearance.app.preparePresentationFrame();});
    await canvas.screenshot({path:info.outputPath(`${style}-${packed?'pack':'original'}-turned.png`)});
  }
  expect(errors).toEqual([]);await info.attach('integrated-terrain',{body:JSON.stringify(observations,null,2),contentType:'application/json'});
  await page.evaluate(()=>(window as any).terrainAppearance.app.dispose());
});
