import { expect,test } from '@playwright/test';
import type { VoxelRenderer } from '@blockcolc/voxel';
import type * as THREE from 'three';
type SkyField=Record<'bcSkyStars'|'bcSkyGalaxy'|'bcSkyAurora'|'bcSkyReflectionGain',{value:number}>;
type Probe=Window&{__blockcolcVoxelTest:typeof import('@blockcolc/voxel');__v256World:VoxelRenderer;__v256ReflectionField?:SkyField;__v256WaterFields?:SkyField[];__v256Terrain?:THREE.Mesh[];__v256Gpu?:THREE.WebGLRenderer;__v256Sun?:THREE.DirectionalLight;__v256Scene?:THREE.Scene;__v256Camera?:THREE.Camera;__v256Picked?:string[]};

test('all four settlements compile the same stars, galaxy and reflective field; only mosaic coast has aurora',async({page},info)=>{
 test.setTimeout(240000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/WebGLProgram|shader error|INVALID_OPERATION/i.test(message.text()))errors.push(message.text());});
 await page.goto('/');await page.waitForFunction(()=>Boolean((window as unknown as Probe).__blockcolcVoxelTest));
 await page.evaluate(()=>{
  const w=window as unknown as Probe,c=document.createElement('canvas');c.setAttribute('aria-label','各聚落共享星河诊断');c.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:9999';document.body.append(c);
  const temporary=new w.__blockcolcVoxelTest.LightingPostProcessor({capabilities:{maxSamples:0}} as THREE.WebGLRenderer),scene=(temporary as unknown as {quadScene:THREE.Scene}).quadScene;
  const prototype=Object.getPrototypeOf(Object.getPrototypeOf(scene)) as THREE.Object3D,before=prototype.onBeforeRender;temporary.dispose();
  prototype.onBeforeRender=function(renderer,scene,camera,geometry,material,group){
   if(renderer.domElement===c&&this.userData.terrainTriangles){w.__v256Gpu=renderer;w.__v256Scene=scene;w.__v256Camera=camera;}
   before.call(this,renderer,scene,camera,geometry,material,group);
  };
 });
 const canvas=page.getByLabel('各聚落共享星河诊断'),observations:unknown[]=[];
 for(const style of ['classic-island','natural-valley','ocean-island','mosaic-coast'] as const){
  await page.evaluate(async style=>{
   const w=window as unknown as Probe;w.__v256World?.dispose();w.__v256Scene=undefined;w.__v256Gpu=undefined;
   w.__v256World=w.__blockcolcVoxelTest.createVoxelRenderer(document.querySelector<HTMLCanvasElement>('[aria-label="各聚落共享星河诊断"]')!,{environmentStyle:style,worldSeed:'mosaic-coast-regression',lightingQuality:'performance',terrainGenerationVersion:4,initialEnvironment:{weather:{kind:'clear'},astronomy:null,debug:{date:Date.parse('2026-10-26T16:00:00Z')}}});
   w.__v256World.setReducedMotion(true);
   await w.__v256World.initializeWorlds(Array.from({length:style==='mosaic-coast'?24:1},(_,index)=>({projectId:`night-${index}`,settlementIndex:index,blueprintId:'builtin-small-workshop',buildingCompletionBasisPoints:10000,buildingConditionBasisPoints:10000,isMonument:false})),null);
   await w.__v256World.prepareInitialPresentation();
  },style);
  await expect(canvas).toHaveAttribute('data-environment-style',style);await expect.poll(()=>page.evaluate(()=>Boolean((window as unknown as Probe).__v256Scene))).toBe(true);
  const sky=await page.evaluate(()=>{
   const w=window as unknown as Probe,dome=w.__v256Scene!.getObjectByName('threeLayerSkyDome') as THREE.Mesh,material=dome.material as THREE.Material;
   const field=(w.__v256Gpu!.properties.get(material) as {uniforms:SkyField}).uniforms;w.__v256ReflectionField=field;
   return{stars:field.bcSkyStars.value,galaxy:field.bcSkyGalaxy.value,aurora:field.bcSkyAurora.value,reflections:document.querySelector<HTMLCanvasElement>('[aria-label="各聚落共享星河诊断"]')!.dataset.nightSkyReflections};
  });
  expect(sky.stars).toBeGreaterThan(.6);expect(sky.galaxy).toBeGreaterThan(.36);expect(sky.aurora>0).toBe(style==='mosaic-coast');expect(sky.reflections).toBe('directional-shared');observations.push({style,...sky});
  const enabled=await canvas.screenshot({path:info.outputPath(`${style}-shared-fullmoon-night.png`)});
  await page.evaluate(()=>{const w=window as unknown as Probe,f=w.__v256ReflectionField!;f.bcSkyStars.value=0;f.bcSkyGalaxy.value=0;f.bcSkyAurora.value=0;w.__v256World.setWorldColorAdjustment(null);});
  const disabled=await canvas.screenshot({path:info.outputPath(`${style}-night-field-control.png`)});
  expect(enabled.equals(disabled),`${style} must render the compiled night field, not only label its dataset`).toBe(false);
  if(style==='mosaic-coast'){
   await page.evaluate(()=>{const w=window as unknown as Probe;w.__v256World.setEnvironmentDebugOverride({date:Date.parse('2026-10-04T07:00:00Z'),weather:{kind:'clear'}});});
   await expect(canvas).toHaveAttribute('data-environment-transition-active','false');
   await canvas.screenshot({path:info.outputPath('mosaic-poplar-groves-and-warm-coral-sea.png')});
   const reefs=await page.evaluate(()=>{
    const w=window as unknown as Probe,root=w.__v256Scene!.getObjectByName('world-scenery')!;
    return root.children.filter(child=>child.name.includes(':reef:')).map(child=>{
      const position=child.getWorldPosition(w.__v256Scene!.position.clone()).project(w.__v256Camera!);
      return{x:position.x,y:position.y,z:position.z};
    });
   });
   const visible=reefs.filter(position=>Math.abs(position.x)<.9&&Math.abs(position.y)<.9&&position.z<1);
   expect(visible.length,'Near-shore coral must fall inside the common 24-building view').toBeGreaterThan(0);
   const area=(await canvas.boundingBox())!,point=visible[0]!;
   await page.screenshot({path:info.outputPath('visible-shallow-coral-detail.png'),clip:{x:area.x+(point.x+1)/2*area.width-35,y:area.y+(1-point.y)/2*area.height-35,width:70,height:70}});
   observations.push({visibleCoralShelves:visible.length,totalCoralShelves:reefs.length});
   const detail=await page.evaluate(()=>{
    const w=window as unknown as Probe,root=w.__v256Scene!.getObjectByName('world-scenery')!;
    const reef=root.children.find(child=>{
      if(!child.name.includes(':reef:'))return false;
      const p=child.getWorldPosition(child.position.clone()).project(w.__v256Camera!);
      return Math.abs(p.x)<.9&&Math.abs(p.y)<.9&&p.z<1;
    })!,point=reef.getWorldPosition(reef.position.clone());
    w.__v256World.setVisible(false);
    reef.traverse(child=>{child.visible=true;});
    const camera=w.__v256Camera! as THREE.PerspectiveCamera;camera.near=.1;camera.far=2000;camera.updateProjectionMatrix();
    w.__v256Camera!.position.copy(point).add(point.clone().set(38,58,42));
    w.__v256Camera!.lookAt(point);w.__v256Camera!.updateMatrixWorld();
    w.__v256Gpu!.setRenderTarget(null);w.__v256Gpu!.clear(true,true,true);
    w.__v256Gpu!.render(w.__v256Scene!,w.__v256Camera!);
    const gl=w.__v256Gpu!.getContext(),pixels=new Uint8Array(32*32*4);
    gl.readPixels(Math.floor(gl.drawingBufferWidth/2)-16,Math.floor(gl.drawingBufferHeight/2)-16,32,32,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const colours=new Set(Array.from({length:1024},(_,i)=>`${pixels[i*4]}:${pixels[i*4+1]}:${pixels[i*4+2]}`));
    return {image:w.__v256Gpu!.domElement.toDataURL(),colours:colours.size};
   });
   expect(detail.colours,'The close reef image must contain geometry, not a uniform clipped sky').toBeGreaterThan(20);
   await info.attach('continuous-large-coral-reef-detail',{body:Buffer.from(detail.image.split(',')[1]!,'base64'),contentType:'image/png'});
  }
 }
 await info.attach('all-environment-night-fields',{body:JSON.stringify(observations),contentType:'application/json'});expect(errors).toEqual([]);
 await page.evaluate(()=>(window as unknown as Probe).__v256World.dispose());
});

test('ocean islands with one and twenty-four buildings retain water-only star reflections and actual terrain shadows',async({page},info)=>{
 test.setTimeout(180_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|shader error|INVALID_OPERATION/i.test(m.text()))errors.push(m.text());});
 await page.goto('/');await page.waitForFunction(()=>Boolean((window as unknown as Probe).__blockcolcVoxelTest));
 await page.evaluate(()=>{
  const w=window as unknown as Probe,c=document.createElement('canvas');c.setAttribute('aria-label','海岛星河与土锥诊断');c.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:9999';document.body.append(c);
  const t=new w.__blockcolcVoxelTest.LightingPostProcessor({capabilities:{maxSamples:0}} as THREE.WebGLRenderer),s=(t as unknown as {quadScene:THREE.Scene}).quadScene;
  const proto=Object.getPrototypeOf(Object.getPrototypeOf(s)) as THREE.Object3D,before=proto.onBeforeRender;t.dispose();
  proto.onBeforeRender=function(renderer,scene,camera,geometry,material,group){
   if(renderer.domElement===c&&this.userData.terrainTriangles){
    w.__v256Gpu=renderer;w.__v256Sun=scene.getObjectsByProperty('isDirectionalLight',true).find(light=>light.castShadow) as THREE.DirectionalLight;
    const terrains=w.__v256Terrain??=[];if(!terrains.includes(this as THREE.Mesh))terrains.push(this as THREE.Mesh);
    const f=(renderer.properties.get(material) as {uniforms?:SkyField}).uniforms;
    if(f?.bcSkyReflectionGain&&f.bcSkyReflectionGain.value>1){const fields=w.__v256WaterFields??=[];if(!fields.includes(f))fields.push(f);}
   }before.call(this,renderer,scene,camera,geometry,material,group);
  };
  w.__v256World=w.__blockcolcVoxelTest.createVoxelRenderer(c,{environmentStyle:'ocean-island',worldSeed:'world-default',lightingQuality:'cinematic',terrainGenerationVersion:4,initialEnvironment:{weather:{kind:'clear'},astronomy:null,debug:{date:Date.parse('2026-10-10T16:00:00Z')}}});
  w.__v256World.setReducedMotion(true);
 });
 const c=page.getByLabel('海岛星河与土锥诊断');
 for(const count of [1,24]){
  await page.evaluate(async count=>{const w=window as unknown as Probe;w.__v256WaterFields=[];w.__v256Terrain=[];await w.__v256World.initializeWorlds(Array.from({length:count},(_,i)=>({projectId:`island-${i}`,settlementIndex:i,blueprintId:'builtin-small-workshop',buildingCompletionBasisPoints:10000,buildingConditionBasisPoints:10000,isMonument:false})),null);await w.__v256World.prepareInitialPresentation();w.__v256World.setEnvironmentDebugOverride({date:Date.parse('2026-10-10T16:00:00Z'),weather:{kind:'clear'}});},count);
  await expect(c).toHaveAttribute('data-environment-transition-active','false');await expect.poll(()=>page.evaluate(()=>(window as unknown as Probe).__v256WaterFields?.length??0)).toBeGreaterThan(0);
  const stars=await c.screenshot({path:info.outputPath(`ocean-${count}-stars.png`)});
  await page.evaluate(()=>{const w=window as unknown as Probe;for(const f of w.__v256WaterFields??[])f.bcSkyReflectionGain.value=0;w.__v256World.setWorldColorAdjustment(null);});
  const noReflection=await c.screenshot({path:info.outputPath(`ocean-${count}-water-control.png`)});expect(stars.equals(noReflection)).toBe(false);
  expect(Number(await c.getAttribute('data-night-sky-galaxy'))).toBeGreaterThan(.95);
  await page.evaluate(()=>{const w=window as unknown as Probe;for(const f of w.__v256WaterFields??[])f.bcSkyReflectionGain.value=2.2;w.__v256World.setEnvironmentDebugOverride({date:Date.parse('2026-10-10T07:00:00Z'),weather:{kind:'clear'}});});
  await expect(c).toHaveAttribute('data-environment-transition-active','false');const shadow=await c.screenshot({path:info.outputPath(`ocean-${count}-terrain-shadow.png`)});
  expect(await page.evaluate(()=>(window as unknown as Probe).__v256Terrain!.some(m=>m.castShadow))).toBe(true);
  await page.evaluate(()=>{const w=window as unknown as Probe;for(const m of w.__v256Terrain??[])m.castShadow=false;w.__v256Sun!.shadow.needsUpdate=true;w.__v256Gpu!.shadowMap.needsUpdate=true;w.__v256World.setWorldColorAdjustment(null);});
  const noTerrainShadow=await c.screenshot({path:info.outputPath(`ocean-${count}-terrain-shadow-control.png`)});expect(shadow.equals(noTerrainShadow),'Terrain casting must change daylight without disabling building shadows').toBe(false);
  await page.evaluate(()=>{const w=window as unknown as Probe;for(const m of w.__v256Terrain??[])m.castShadow=true;w.__v256Sun!.shadow.needsUpdate=true;w.__v256Gpu!.shadowMap.needsUpdate=true;});
 }
 expect(errors).toEqual([]);await page.evaluate(()=>(window as unknown as Probe).__v256World.dispose());
});
test('regional world, far clouds, shared night reflection shaders, progress replacement and terrain reuse render without errors',async({page},info)=>{
 test.setTimeout(180_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|shader error|INVALID_OPERATION/i.test(m.text()))errors.push(m.text());});
 await page.goto('/');await page.waitForFunction(()=>Boolean((window as unknown as Probe).__blockcolcVoxelTest));
 await page.evaluate(async()=>{
  const w=window as unknown as Probe,c=document.createElement('canvas');c.setAttribute('aria-label','新地形夜空诊断');c.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;touch-action:none';document.body.append(c);
  // Inspect uniforms actually bound for the water draw, not only its datasets.
  const temporary=new w.__blockcolcVoxelTest.LightingPostProcessor({capabilities:{maxSamples:0}} as THREE.WebGLRenderer);
  const scene=(temporary as unknown as {quadScene:THREE.Scene}).quadScene;
  const proto=Object.getPrototypeOf(Object.getPrototypeOf(scene)) as THREE.Object3D,before=proto.onBeforeRender;
  temporary.dispose();
  proto.onBeforeRender=function(renderer,scene,camera,geometry,material,group){
    if(renderer.domElement===c&&this.userData.terrainTriangles&&(material as THREE.MeshStandardMaterial).roughness<.34){
      const props=renderer.properties.get(material) as {uniforms?:Partial<SkyField>};
      if(props.uniforms?.bcSkyGalaxy){w.__v256ReflectionField=props.uniforms as SkyField;const fields=w.__v256WaterFields??=[];if(!fields.includes(props.uniforms as SkyField))fields.push(props.uniforms as SkyField);}
    }
    before.call(this,renderer,scene,camera,geometry,material,group);
  };
  w.__v256World=w.__blockcolcVoxelTest.createVoxelRenderer(c,{environmentStyle:'mosaic-coast',worldSeed:'mosaic-coast-regression',lightingQuality:'cinematic',terrainGenerationVersion:4,initialEnvironment:{weather:{kind:'clear'},astronomy:null,debug:{date:Date.parse('2026-10-10T16:00:00Z')}}});
  await w.__v256World.initializeWorlds(Array.from({length:24},(_,i)=>({projectId:`p-${i}`,settlementIndex:i,blueprintId:'builtin-small-workshop',buildingCompletionBasisPoints:5000,buildingConditionBasisPoints:10000,isMonument:false})),null);
  await w.__v256World.prepareInitialPresentation();w.__v256World.setReducedMotion(true);
 });
 const c=page.getByLabel('新地形夜空诊断');await expect(c).toHaveAttribute('data-first-nonempty-frame-ms',/\d/);await expect(c).toHaveAttribute('data-environment-style','mosaic-coast');expect(Number(await c.getAttribute('data-night-sky-stars'))).toBeGreaterThan(0);expect(Number(await c.getAttribute('data-night-sky-aurora'))).toBeGreaterThan(0);await expect(c).toHaveAttribute('data-night-sky-reflections','directional-shared');
 expect(Number(await c.getAttribute('data-night-sky-galaxy'))).toBeGreaterThan(.95);
 await c.screenshot({path:info.outputPath('mosaic-moonless-night.png')});const records:unknown[]=[];
 await expect.poll(()=>page.evaluate(()=>(window as unknown as Probe).__v256ReflectionField?.bcSkyGalaxy.value??0)).toBeGreaterThan(.95);
 const withNight=await c.screenshot();
 await page.evaluate(()=>{const w=window as unknown as Probe;
  for(const f of w.__v256WaterFields??[])f.bcSkyReflectionGain.value=0;w.__v256World.setWorldColorAdjustment(null);});
 const withoutNight=await c.screenshot({path:info.outputPath('mosaic-night-field-control.png')});
 expect(withNight.equals(withoutNight),'Water-only reflection must change the frame while the sky field stays on').toBe(false);
 await page.evaluate(()=>{const w=window as unknown as Probe;for(const f of w.__v256WaterFields??[])f.bcSkyReflectionGain.value=2.2;w.__v256World.setWorldColorAdjustment(null);});
 // Geographic and local sources use the same directional field and weather gate.
 await page.evaluate(()=>(window as unknown as Probe).__v256World.setAstronomyContext({coordinates:{latitude:35,longitude:100},locationSource:'cached',schedule:null}));
 await expect(c).toHaveAttribute('data-astronomy-source','ephemeris-only');
 expect(Number(await c.getAttribute('data-night-sky-galaxy'))).toBeGreaterThan(.95);
 await c.screenshot({path:info.outputPath('mosaic-geographic-night.png')});
 await page.evaluate(()=>(window as unknown as Probe).__v256World.setEnvironmentDebugOverride({date:Date.parse('2026-10-10T16:00:00Z'),weather:{kind:'rain',thunderstorm:true}}));
 await expect(c).toHaveAttribute('data-night-sky-stars','0.000');await expect(c).toHaveAttribute('data-night-sky-galaxy','0.000');
 await page.evaluate(()=>(window as unknown as Probe).__v256World.setAstronomyContext(null));
 for(const [label,time,weather] of [['pink-sunset','2026-10-03T09:40:00Z','clear'],['blue-hour','2026-10-03T10:20:00Z','clear'],['cloudy-day','2026-10-03T06:00:00Z','cloudy']] as const){
  await page.evaluate(({time,weather})=>(window as unknown as Probe).__v256World.setEnvironmentDebugOverride({date:Date.parse(time),weather:{kind:weather}}),{time,weather});await expect(c).toHaveAttribute('data-environment-transition-active','false');await c.screenshot({path:info.outputPath(`mosaic-${label}.png`)});
  records.push(await c.evaluate(el=>({step:el.dataset.dayPhase,stars:el.dataset.nightSkyStars,galaxy:el.dataset.nightSkyGalaxy,aurora:el.dataset.nightSkyAurora,trees:el.dataset.sceneryTreeCount,nearClouds:el.dataset.cloudNearGroupCount,farClouds:el.dataset.cloudFarGroupCount,terrain:el.dataset.terrainCellCount})));
 }
 const near=Number(await c.getAttribute('data-cloud-near-group-count')),far=Number(await c.getAttribute('data-cloud-far-group-count'));expect(near).toBeGreaterThan(0);expect(far).toBeGreaterThanOrEqual(near);
 await page.evaluate(()=>{const w=window as unknown as Probe;w.__v256World.setWorlds(Array.from({length:24},(_,i)=>({projectId:`p-${i}`,settlementIndex:i,blueprintId:'builtin-small-workshop',buildingCompletionBasisPoints:7500,buildingConditionBasisPoints:10000,isMonument:false})));});
 await expect(c).toHaveAttribute('data-terrain-generation-cache-retained','true');
 await expect(c).toHaveAttribute('data-terrain-mesh-cache-hit','true');await expect(c).toHaveAttribute('data-scenery-plan-cache-hit','true');await c.screenshot({path:info.outputPath('mosaic-progress-reuses-terrain.png')});
 await page.evaluate(()=>{const w=window as unknown as Probe;w.__v256World.setVisible(false);w.__v256World.setVisible(true);w.__v256World.focusProject('p-0');});await c.screenshot({path:info.outputPath('mosaic-focused.png')});
 await page.evaluate(()=>{const w=window as unknown as Probe;w.__v256World.setEnvironmentDebugOverride({date:Date.parse('2026-10-03T07:00:00Z'),weather:{kind:'clear'}});w.__v256World.focusProject(null);w.__v256World.resetCamera();});
 await expect(c).toHaveAttribute('data-environment-transition-active','false');
 await c.screenshot({path:info.outputPath('mosaic-revised-nine-regions.png')});
 const box=(await c.boundingBox())!,azimuth=await c.getAttribute('data-camera-azimuth');
 const hit=await page.evaluate(({x,y})=>{const events:unknown[]=[];Object.assign(window,{__diagnosticInputs:events});for(const kind of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','blur'])window.addEventListener(kind,event=>{const p=event as PointerEvent,c=document.querySelector<HTMLCanvasElement>('[aria-label="新地形夜空诊断"]')!;events.push({kind,at:performance.now(),id:p.pointerId,x:p.clientX,y:p.clientY,count:c.dataset.pointerCount,azimuth:c.dataset.cameraAzimuth,target:(p.target as HTMLElement)?.getAttribute?.('aria-label')??(p.target as HTMLElement)?.tagName});},true);const element=document.elementFromPoint(x,y);return{tag:element?.tagName,label:element?.getAttribute('aria-label')};},{x:box.x+box.width*.4,y:box.y+box.height*.4});
 await info.attach('drag-hit-target',{body:JSON.stringify({box,hit}),contentType:'application/json'});
 await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.4,{steps:8});await page.mouse.up();
 await info.attach('drag-input-events',{body:JSON.stringify(await page.evaluate(()=>({events:(window as typeof window&{__diagnosticInputs:unknown[]}).__diagnosticInputs,diagnostics:(window as unknown as Probe).__v256World.getDiagnostics()}))),contentType:'application/json'});
 // On software WebGL a held-pointer frame can take >4 seconds, longer than
 // the existing 2.5-second stolen-pointer recovery. Keep that safety contract;
 // use a batched owned stroke to inspect the rendered reset path, not device FPS.
 if(await c.getAttribute('data-camera-azimuth')===azimuth){
   const recovery=await c.evaluate(element=>{
     const gl=(element as HTMLCanvasElement).getContext('webgl2')!,extension=gl.getExtension('WEBGL_debug_renderer_info');
     const gpu=String(gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL??gl.RENDERER));
     const events=(window as typeof window&{__diagnosticInputs:{kind:string;at:number;count:string}[]}).__diagnosticInputs;
     const down=events.findIndex(e=>e.kind==='pointerdown'),firstMove=events.slice(down+1).find(e=>e.kind==='pointermove')!;
     return{gpu,gapMs:firstMove.at-events[down]!.at,released:firstMove.count==='0'};
   });
   await info.attach('software-stroke-recovery',{body:JSON.stringify(recovery),contentType:'application/json'});
   expect(recovery.gpu).toMatch(/SwiftShader|llvmpipe|software/i);expect(recovery.gapMs).toBeGreaterThan(2500);expect(recovery.released).toBe(true);
   await c.evaluate((element,{x,y,width})=>{
   element.dispatchEvent(new PointerEvent('pointerdown',{pointerId:71,clientX:x,clientY:y,bubbles:true,buttons:1}));
   for(let i=1;i<=8;i++)element.dispatchEvent(new PointerEvent('pointermove',{pointerId:71,clientX:x+width*.2*i/8,clientY:y,bubbles:true,buttons:1}));
   element.dispatchEvent(new PointerEvent('pointerup',{pointerId:71,clientX:x+width*.2,clientY:y,bubbles:true}));
   },{x:box.x+box.width*.4,y:box.y+box.height*.4,width:box.width});
 }
 await expect(c).not.toHaveAttribute('data-camera-azimuth',azimuth!);
 const beforeReset=await page.evaluate(()=>(window as unknown as Probe).__v256World.getDiagnostics());
 await page.evaluate(()=>(window as unknown as Probe).__v256World.resetCamera());
 await c.screenshot({path:info.outputPath('mosaic-after-orbit-reset.png')});
 const afterReset=await page.evaluate(()=>(window as unknown as Probe).__v256World.getDiagnostics());
 expect(afterReset.worldRebuildCount).toBe(beforeReset.worldRebuildCount);expect(afterReset.qualityTier).toBe(beforeReset.qualityTier);
 await c.dispatchEvent('wheel',{deltaY:10000});await c.screenshot({path:info.outputPath('mosaic-revised-regions-wide.png')});
 expect(errors).toEqual([]);await info.attach('regional-night-observations',{body:JSON.stringify({records,near,far,beforeReset,afterReset,errors}),contentType:'application/json'});await page.evaluate(()=>(window as unknown as Probe).__v256World.dispose());
});

test('a terrain-supported reward can be tapped on its rendered geometry and becomes the orbit pivot',async({page},info)=>{
 test.setTimeout(120_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.waitForFunction(()=>Boolean((window as unknown as Probe).__blockcolcVoxelTest));
 await page.evaluate(async()=>{
  const w=window as unknown as Probe,c=document.createElement('canvas');c.setAttribute('aria-label','每日奖励点击诊断');c.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;touch-action:none';document.body.append(c);
  const temporary=new w.__blockcolcVoxelTest.LightingPostProcessor({capabilities:{maxSamples:0}} as THREE.WebGLRenderer);
  const proto=Object.getPrototypeOf(Object.getPrototypeOf((temporary as unknown as {quadScene:THREE.Scene}).quadScene)) as THREE.Object3D,before=proto.onBeforeRender;temporary.dispose();
  proto.onBeforeRender=function(renderer,scene,camera,geometry,material,group){if(renderer.domElement===c&&this.userData.terrainTriangles){w.__v256Scene=scene;w.__v256Camera=camera;}before.call(this,renderer,scene,camera,geometry,material,group);};
  w.__v256Picked=[];w.__v256World=w.__blockcolcVoxelTest.createVoxelRenderer(c,{environmentStyle:'ocean-island',lightingQuality:'performance',terrainGenerationVersion:4,onSelectProject:id=>{w.__v256Picked!.push(id);w.__v256World.focusProject(id);},initialEnvironment:{weather:{kind:'clear'},astronomy:null,debug:{date:Date.parse('2026-10-03T07:00:00Z')}}});
  w.__v256World.setReducedMotion(true);
  const blueprint=w.__blockcolcVoxelTest.validateBlueprint({schemaVersion:1,id:'tap-reward',title:'点击诊断柱',bounds:{minX:0,maxX:2,minY:0,maxY:5,minZ:0,maxZ:2},voxels:Array.from({length:54},(_,i)=>({x:i%3,z:Math.floor(i/3)%3,y:Math.floor(i/9),materialId:'accent',buildOrder:Math.round(i/53*10000)}))});
  await w.__v256World.initializeWorlds([{projectId:'p',settlementIndex:0,blueprintId:'builtin-small-workshop',buildingCompletionBasisPoints:10000,buildingConditionBasisPoints:10000,isMonument:false,importedDecorations:[{rewardId:'tap',resourceId:'tap-reward',date:'2026-10-04',blueprint,localPosition:{x:28,z:20},rotationQuarterTurns:0}]}],null);
  await w.__v256World.prepareInitialPresentation();
 });
 const c=page.getByLabel('每日奖励点击诊断');await expect(c).toHaveAttribute('data-first-nonempty-frame-ms',/\d/);
 const aim=await page.evaluate(()=>{const w=window as unknown as Probe,group=w.__v256Scene!.getObjectByName('reward:tap')!,point=group.getWorldPosition(group.position.clone());point.y+=3;point.project(w.__v256Camera!);const rect=document.querySelector<HTMLCanvasElement>('[aria-label="每日奖励点击诊断"]')!.getBoundingClientRect();return{x:rect.left+(point.x+1)/2*rect.width,y:rect.top+(1-point.y)/2*rect.height};});
 await page.mouse.click(aim.x,aim.y);expect(await page.evaluate(()=>(window as unknown as Probe).__v256Picked)).toEqual(['reward:tap']);
 const support=JSON.parse((await c.getAttribute('data-reward-ground-support'))!) as {id:string;x:number;y:number;z:number}[];
 const reward=support.find(r=>r.id==='tap')!;expect(Number(await c.getAttribute('data-camera-target-x'))).toBeCloseTo(reward.x,2);expect(Number(await c.getAttribute('data-camera-target-z'))).toBeCloseTo(reward.z,2);
 const azimuth=await c.getAttribute('data-camera-azimuth'),box=(await c.boundingBox())!;
 await page.mouse.move(box.x+box.width*.3,box.y+box.height*.35);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.35,{steps:8});await page.mouse.up();
 await expect(c).not.toHaveAttribute('data-camera-azimuth',azimuth!);expect(Number(await c.getAttribute('data-camera-target-x'))).toBeCloseTo(reward.x,2);
 await c.screenshot({path:info.outputPath('reward-geometry-pick-and-pivot.png')});await info.attach('actual-reward-pick',{body:JSON.stringify({aim,support,errors}),contentType:'application/json'});expect(errors).toEqual([]);await page.evaluate(()=>(window as unknown as Probe).__v256World.dispose());
});
