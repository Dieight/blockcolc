import {expect,test,type Page} from '@playwright/test';
import type * as THREE from 'three';

async function open(page:Page,style:string,count=24,preview=false){
  // Silence the unrelated React onboarding preview behind our isolated canvas.
  // The fixture explicitly owns its renderer motion below.
  await page.setViewportSize({width:900,height:720});await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');await page.waitForFunction(()=>!!(window as any).__blockcolcVoxelTest);
  await page.evaluate(()=>{
    const scope=window as any,voxel=scope.__blockcolcVoxelTest;
    const temp=new voxel.LightingPostProcessor({capabilities:{maxSamples:0}}),proto=Object.getPrototypeOf(Object.getPrototypeOf(temp.quadScene));
    const before=proto.onBeforeRender;temp.dispose();scope.animalFixture={app:null,scene:null,camera:null};
    proto.onBeforeRender=function(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera,...rest:any[]){
      if(renderer.domElement.getAttribute('aria-label')==='Wildlife fixture'&&scene.getObjectByName('worldLightRig')){
        scope.animalFixture.scene=scene;scope.animalFixture.camera=camera;
      }before.call(this,renderer,scene,camera,...rest);
    };
    const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','Wildlife fixture');
    canvas.style.cssText='position:fixed;inset:0;width:900px;height:640px;z-index:999999;touch-action:none';document.body.append(canvas);
  });
  return page.evaluate(async({style,count,preview})=>{
    const scope=window as any,voxel=scope.__blockcolcVoxelTest,canvas=document.querySelector('[aria-label="Wildlife fixture"]');
    const app=voxel.createVoxelRenderer(canvas,{environmentStyle:style,worldSeed:'world-default',terrainGenerationVersion:4,lightingQuality:'balanced',
      performanceHoldQuality:()=>true,previewMode:preview,constructionOutlineVisibility:'off',
      initialEnvironment:{weather:{kind:'clear',cloudIntensity:0,precipitationIntensity:0},astronomy:null,debug:{date:Date.parse('2026-10-17T15:00:00+08:00')}}});
    const worlds=Array.from({length:count},(_,settlementIndex)=>({projectId:`wildlife-${settlementIndex}`,settlementIndex,blueprintId:'builtin-small-workshop',
      buildingCompletionBasisPoints:10000,buildingConditionBasisPoints:10000,isMonument:false}));
    scope.animalFixture.app=app;scope.animalFixture.worlds=worlds;app.setVisible(false);
    const start=performance.now();await app.initializeWorlds(worlds,null);app.setVisible(true);await app.prepareInitialPresentation();
    return {initialMs:performance.now()-start,diagnostics:app.getDiagnostics()};
  },{style,count,preview});
}
const diag=(page:Page)=>page.evaluate(()=>(window as any).animalFixture.app.getDiagnostics());
async function ready(page:Page){await page.waitForFunction(()=>(window as any).animalFixture.app.getDiagnostics().animals?.ready,null,{timeout:90_000});}
async function staticState(page:Page){
  return page.evaluate(()=>{
    const fixture=(window as any).animalFixture,root=fixture.scene.getObjectByName('rotatableWorldRoot'),rows:any[]=[];
    for(const name of ['terrain','roads','buildingsAndDecorations'])root.getObjectByName(name).traverse((o:THREE.Object3D)=>{
      if((o as THREE.Mesh).isMesh){const mesh=o as THREE.Mesh,p=mesh.geometry.getAttribute('position');rows.push({id:o.uuid,geometry:mesh.geometry.uuid,
        version:'version'in p?p.version:p.data.version,count:p.count});}});
    return {rows,rebuilds:fixture.app.getDiagnostics().worldRebuildCount};
  });
}
async function matrices(page:Page){return page.evaluate(()=>{
  const root=(window as any).animalFixture.scene.getObjectByName('world-animals');
  return Array.from((root.getObjectByName('animal-cuboids') as THREE.InstancedMesh).instanceMatrix.array);
});}
async function picture(page:Page,name:string,testInfo:any){await page.getByLabel('Wildlife fixture').screenshot({path:testInfo.outputPath(name+'.png')});}

for(const style of ['natural-valley','ocean-island','mosaic-coast'] as const){
  test(`${style}: live wildlife shares the static world, pauses honestly, survives construction and disposal`,async({page},info)=>{
    test.setTimeout(240_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const initial=await open(page,style);await ready(page);const first=await diag(page);
    expect(first.animals.fish).toBe(style==='natural-valley'?8:15);expect(first.animals.birds).toBe(8);
    expect(first.animals.land).toBe(style==='natural-valley'?10:style==='mosaic-coast'?8:0);
    expect(first.terrainWaterOpaque).toBe(false);
    expect(first.animals.collisionCacheShapes).toBeLessThanOrEqual(8192);
    const staticBefore=await staticState(page),before=await matrices(page);
    await page.waitForFunction(start=>(window as any).animalFixture.app.getDiagnostics().animals.updates>start+8,first.animals.updates,{timeout:12_000});
    expect(await matrices(page)).not.toEqual(before);expect(await staticState(page)).toEqual(staticBefore);
    await picture(page,style+'-normal',info);
    await page.evaluate(()=>{(window as any).animalFixture.app.setReducedMotion(true);});
    await page.waitForTimeout(100);const stopped=await matrices(page);await page.waitForTimeout(240);expect(await matrices(page)).toEqual(stopped);
    const paused=await diag(page);await picture(page,style+'-reduced',info);
    await page.evaluate(()=>{const f=(window as any).animalFixture;f.app.setVisible(false);f.app.setReducedMotion(false);});
    const hidden=(await diag(page)).animals.updates;await page.waitForTimeout(250);expect((await diag(page)).animals.updates).toBe(hidden);
    await page.evaluate(()=>{const f=(window as any).animalFixture;f.app.setVisible(true);f.app.setWorlds(f.worlds.map((w:any,i:number)=>i===0?{...w,buildingCompletionBasisPoints:5000}:w));});
    await ready(page);const construction=await diag(page);expect(construction.worldRebuildCount).toBe(staticBefore.rebuilds+1);
    expect(construction.animals.count).toBe(first.animals.count);expect(construction.animals.navigationColumns).toBeLessThanOrEqual(10*1024);
    const canvas=page.getByLabel('Wildlife fixture');await canvas.dispatchEvent('wheel',{deltaY:240});
    await canvas.dispatchEvent('pointerdown',{pointerId:6,clientX:400,clientY:320});await canvas.dispatchEvent('pointermove',{pointerId:6,clientX:540,clientY:320});
    await canvas.dispatchEvent('pointerup',{pointerId:6,clientX:540,clientY:320});await picture(page,style+'-turned',info);
    expect((await diag(page)).animals.reactions).toBe(0);expect(errors).toEqual([]);
    await page.evaluate(async()=>{const f=(window as any).animalFixture;f.app.setImmersiveBandFraction(.45);await f.app.preparePresentationFrame();});
    expect((await diag(page)).worldRebuildCount).toBe(construction.worldRebuildCount);
    await picture(page,style+'-immersive',info);
    await info.attach('wildlife',{body:JSON.stringify({initial,first,paused,construction},null,2),contentType:'application/json'});
    await page.evaluate(()=>{const f=(window as any).animalFixture;f.app.dispose();});
    expect(await page.evaluate(()=>(window as any).animalFixture.scene.getObjectByName('world-animals'))).toBeUndefined();
  });
}

test('tap animates a visible animal, not the building behind it, under reduced motion',async({page},info)=>{
  test.setTimeout(180_000);await open(page,'natural-valley');await ready(page);
  await page.evaluate(async()=>{
    const f=(window as any).animalFixture;f.app.setReducedMotion(true);
    // Isolated close shot of the actual rendered first animal. Do not assume
    // an arbitrary focused building has an unobstructed animal beside it.
    const mesh=f.scene.getObjectByName('animal-cuboids') as THREE.InstancedMesh,m=mesh.matrixWorld.clone();mesh.getMatrixAt(0,m);
    const point=f.camera.position.clone().setFromMatrixPosition(m).applyMatrix4(mesh.matrixWorld);
    f.camera.position.set(point.x+5,point.y+7,point.z+5);f.camera.near=.1;f.camera.updateProjectionMatrix();f.camera.lookAt(point);
    await f.app.preparePresentationFrame();
  });
  // Pick an actually visible cuboid by its real projected instance center, not
  // a synthetic tap callback or a counter-only state mutation.
  const target=await page.evaluate(async()=>{
    const three=(window as any).__blockcolcThreeTest;
    const f=(window as any).animalFixture,mesh=f.scene.getObjectByName('animal-cuboids') as THREE.InstancedMesh,canvas=document.querySelector('canvas[aria-label="Wildlife fixture"]')!,b=canvas.getBoundingClientRect();
    const m=mesh.matrixWorld.clone(),v=f.camera.position.clone();mesh.updateWorldMatrix(true,false);
    const ray=new three.Raycaster();
    for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,m);v.setFromMatrixPosition(m).applyMatrix4(mesh.matrixWorld).project(f.camera);
      const x=b.left+(v.x+1)*b.width/2,y=b.top+(1-v.y)*b.height/2;
      if(!(x>10&&x<b.width-10&&y>10&&y<b.height-10))continue;
      ray.setFromCamera(new three.Vector2(v.x,v.y),f.camera);
      const hits=ray.intersectObjects([f.scene.getObjectByName('rotatableWorldRoot')],true).filter((hit:any)=>{
        if(!hit.object.isMesh)return false;for(let o=hit.object;o;o=o.parent)if(!o.visible)return false;
        const mats=Array.isArray(hit.object.material)?hit.object.material:[hit.object.material],mat=mats[hit.face?.materialIndex??0];
        return mat&&mat.visible&&mat.colorWrite&&(!mat.transparent||mat.opacity>.85);
      });
      if(hits[0]?.object===mesh)return {x,y,part:i,top:document.elementFromPoint(x,y)?.getAttribute('aria-label')};
    }
    return null;
  });
  await info.attach('visible-hit-target',{body:JSON.stringify({target,diagnostics:await diag(page)}),contentType:'application/json'});
  expect(target).not.toBeNull();expect(target!.top).toBe('Wildlife fixture');
  const start=(await diag(page)).animals.reactions,pixelsBefore=await page.getByLabel('Wildlife fixture').screenshot();
  await page.mouse.click(target!.x,target!.y);
  await page.waitForFunction(start=>(window as any).animalFixture.app.getDiagnostics().animals.reactions===start+1,start,{timeout:5000});
  const afterTap=await matrices(page);await page.waitForTimeout(150);expect(await matrices(page)).not.toEqual(afterTap);
  const after=(await diag(page)).animals.reactions;expect(after).toBe(start+1);await picture(page,'tap-response',info);
  expect((await page.getByLabel('Wildlife fixture').screenshot()).equals(pixelsBefore)).toBe(false);
  await page.mouse.move(450,280);await page.mouse.down();await page.mouse.move(520,290,{steps:8});await page.mouse.up();
  expect((await diag(page)).animals.reactions).toBe(after);await page.evaluate(()=>(window as any).animalFixture.app.dispose());
});

test('sky islands keep birds, while small blueprint previews have no animal lifecycle',async({page},info)=>{
  test.setTimeout(180_000);await open(page,'classic-island',3);await ready(page);const islands=await diag(page);
  expect(islands.animals.birds).toBe(8);expect(islands.animals.fish).toBe(0);expect(islands.animals.land).toBe(0);
  await picture(page,'sky-birds',info);await page.evaluate(()=>(window as any).animalFixture.app.dispose());
  await open(page,'natural-valley',1,true);await page.waitForTimeout(200);expect((await diag(page)).animals).toBeNull();
  await page.evaluate(()=>(window as any).animalFixture.app.dispose());
});

test('real underwater fish remain depth-tested and the water retains its shared night reflection',async({page},info)=>{
  test.setTimeout(180_000);await open(page,'ocean-island');await ready(page);
  const framed=await page.evaluate(async()=>{
    const f=(window as any).animalFixture;f.app.setReducedMotion(true);
    const three=(window as any).__blockcolcThreeTest;
    const mesh=f.scene.getObjectByName('animal-cuboids') as THREE.InstancedMesh,m=mesh.matrixWorld.clone(),color=(mesh.material as THREE.MeshStandardMaterial).color.clone();
    const ray=new three.Raycaster();
    for(let i=0;i<mesh.count;i++){
      mesh.getColorAt(i,color);if(color.getHex()!==0x9bbcb5&&color.getHex()!==0xe1a245)continue;
      mesh.getMatrixAt(i,m);const p=f.camera.position.clone().setFromMatrixPosition(m).applyMatrix4(mesh.matrixWorld);
      for(const [dx,dz] of [[5,5],[-5,5],[5,-5],[-5,-5]]){
        f.camera.position.set(p.x+dx!,p.y+7,p.z+dz!);f.camera.near=.1;f.camera.updateProjectionMatrix();f.camera.lookAt(p);f.camera.updateMatrixWorld(true);
        const projected=p.clone().project(f.camera);ray.setFromCamera(new three.Vector2(projected.x,projected.y),f.camera);
        const hits=ray.intersectObjects([f.scene.getObjectByName('rotatableWorldRoot')],true).filter((hit:any)=>{
          if(!hit.object.isMesh)return false;for(let o=hit.object;o;o=o.parent)if(!o.visible)return false;
          const mat=Array.isArray(hit.object.material)?hit.object.material[hit.face?.materialIndex??0]:hit.object.material;
          return mat.visible&&mat.colorWrite&&(!mat.transparent||mat.opacity>.85);
        });
        if(hits[0]?.object===mesh){await f.app.preparePresentationFrame();return {part:i,point:{x:p.x,y:p.y,z:p.z}};}
      }
    }return null;
  });
  expect(framed).not.toBeNull();await picture(page,'underwater-fish-visible',info);
  await page.evaluate(async()=>{const f=(window as any).animalFixture;f.app.setEnvironmentDebugOverride({date:Date.parse('2026-10-18T00:00:00+08:00')});await f.app.preparePresentationFrame();});
  const night=await diag(page);expect(night.dayPhase).toBe('night');
  expect(await page.getByLabel('Wildlife fixture').getAttribute('data-night-sky-reflections')).toBe('directional-shared');
  expect(Number(await page.getByLabel('Wildlife fixture').getAttribute('data-water-reflection-strength'))).toBeGreaterThan(.5);
  await picture(page,'underwater-night',info);await page.evaluate(()=>(window as any).animalFixture.app.dispose());
});
