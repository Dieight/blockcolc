import { expect, test } from '@playwright/test';
import type { VoxelRenderer } from '@blockcolc/voxel';
import type * as THREE from 'three';

type Probe = { upper:number; lower:number; count:number; capacity:number; area:number; spanY:number; cameraY:number; maxY:number; groundRelative:boolean; sampleId:number };
type Scope = typeof window & { __blockcolcVoxelTest:typeof import('@blockcolc/voxel'); densityRenderer:VoxelRenderer; densitySampleId:number; densityProbe?:Probe };

// This standalone shader-uniform probe measures the CSS camera volume, not
// high-DPI raster performance. Keep its software WebGL surface at CSS resolution;
// real touch/frame-budget coverage remains in the separate motion/interaction specs.
test.use({ deviceScaleFactor: 1 });

test('ordinary and immersive precipitation cover every cardinal view and keep physical density while zooming', async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as Scope).__blockcolcVoxelTest);
  await page.evaluate(async () => {
    // The three onboarding previews are unrelated to this standalone world.
    // Hiding their host suspends them rather than competing for software GPU frames.
    const appRoot = document.getElementById('root');
    if (appRoot) appRoot.style.display = 'none';
    const scope = window as Scope, voxel = scope.__blockcolcVoxelTest;
    const temporary = new voxel.LightingPostProcessor({capabilities:{maxSamples:0}} as THREE.WebGLRenderer);
    const scene = (temporary as unknown as {quadScene:THREE.Scene}).quadScene;
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(scene)) as THREE.Object3D;
    const before = proto.onBeforeRender;
    temporary.dispose();
    scope.densitySampleId=0;
    proto.onBeforeRender = function(renderer,scene,camera,geometry,material,group) {
      if ((this.name==='world-rain' || this.name==='world-snow') && renderer.domElement.getAttribute('aria-label')==='降水密度验证') {
        const mesh = this as THREE.InstancedMesh;
        const phase = geometry.getAttribute('weatherPhase'), offset = geometry.getAttribute('weatherOffset');
        const uniforms = (renderer.properties.get(material) as {uniforms?:Record<string,{value:unknown}>}).uniforms;
        if (uniforms?.weatherField) {
          // Project particles only for a requested observation, not every easing
          // frame. The probe must not add work to the gesture it is waiting for.
          if(scope.densitySampleId===0 || scope.densityProbe?.sampleId===scope.densitySampleId){before.call(this,renderer,scene,camera,geometry,material,group);return;}
          const field = uniforms.weatherField.value as [number,number], center = uniforms.weatherCenter!.value as [number,number];
          const spanY = Number(uniforms.weatherSpan!.value), base = Number(uniforms.weatherBase!.value);
          const elapsed = Number(uniforms.weatherElapsed!.value), speed = Number(uniforms.weatherSpeed!.value);
          const snow = this.name==='world-snow', point = mesh.position.clone();
          const groundTexture=uniforms.weatherGround?.value as THREE.DataTexture|undefined;
          const groundBounds=uniforms.weatherGroundBounds?.value as [number,number,number,number]|undefined;
          let upper=0,lower=0;
          for(let index=0;index<mesh.count;index++) {
            const p = phase.getX(index), raw = p-elapsed*(snow?.00022:.00078)*speed;
            const fraction = raw-Math.floor(raw);
            const drift=p*Math.PI*2+elapsed*.00055;
            const x=center[0]+offset.getX(index)*field[0]+(snow?Math.sin(drift)*1.35:0),z=center[1]+offset.getY(index)*field[1]+(snow?Math.cos(drift*.72)*.8:0);
            let ground=0;
            if(groundTexture&&groundBounds){
              const image=groundTexture.image as {data:Float32Array;width:number;height:number};
              const gx=Math.min(image.width-1,Math.max(0,Math.floor((x-groundBounds[0])/groundBounds[2]*image.width)));
              const gz=Math.min(image.height-1,Math.max(0,Math.floor((z-groundBounds[1])/groundBounds[3]*image.height)));
              ground=image.data[gz*image.width+gx]!;
            }
            point.set(x,ground+base+fraction*spanY,z)
              .applyMatrix4(mesh.matrixWorld).project(camera);
            if (Math.abs(point.x)<=1 && Math.abs(point.y)<=1 && point.z>=-1 && point.z<=1) { if(point.y>=0)upper++;else lower++; }
          }
          scope.densityProbe={upper,lower,count:mesh.count,capacity:phase.count,area:field[0]*field[1],spanY,cameraY:camera.position.y,maxY:base+spanY,groundRelative:!!groundTexture,sampleId:scope.densitySampleId};
        }
      }
      before.call(this,renderer,scene,camera,geometry,material,group);
    };
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label','降水密度验证');
    canvas.style.cssText='position:fixed;left:0;top:0;width:375px;height:300px;touch-action:none;z-index:99999';
    document.body.append(canvas);
    const app = voxel.createVoxelRenderer(canvas,{environmentStyle:'natural-valley',worldSeed:'density-cardinal',terrainGenerationVersion:4,lightingQuality:'balanced',
      initialEnvironment:{weather:{kind:'clear',cloudIntensity:0},astronomy:null,debug:{date:Date.parse('2026-10-01T15:00:00+08:00')}}});
    scope.densityRenderer=app;app.setReducedMotion(true);app.setVisible(false);
    await app.initializeWorlds(Array.from({length:24},(_,settlementIndex)=>({projectId:`density-${settlementIndex}`,settlementIndex,blueprintId:'builtin-timber-house',
      buildingCompletionBasisPoints:10_000,buildingConditionBasisPoints:10_000,isMonument:false})),null);
    app.setVisible(true);await app.prepareInitialPresentation();
  });
  const canvas=page.getByLabel('降水密度验证');
  const observations:{mode:string;kind:string;angle:number;zoom:string;probe:Probe}[]=[];
  // Derive each gesture from the last commanded target, not the still-easing
  // sampled camera. Otherwise tiny residuals accumulate across 24 gestures.
  let commandedAzimuth = Number(await canvas.getAttribute('data-camera-azimuth'));
  for(const mode of ['ordinary','immersive']) {
    await canvas.evaluate((node,value)=>{node.style.height=value==='ordinary'?'300px':'760px';},mode);
    await page.evaluate(value=>(window as Scope).densityRenderer.setImmersiveBandFraction(value==='immersive'?.38:0,0),mode);
    for(const kind of ['rain','storm','snow']) {
      const renderedBefore=Number(await canvas.getAttribute('data-render-frame-count'));
      await page.evaluate(value=>(window as Scope).densityRenderer.setExternalWeatherOverride({kind:value==='snow'?'snow':'rain',thunderstorm:value==='storm',cloudIntensity:.8,precipitationIntensity:value==='storm'?.8:.25}),kind);
      // Wait for this weather's completed first draw before measuring gestures.
      // Software WebGL can compile the precipitation program during that draw;
      // a dataset written by setExternalWeatherOverride is not a rendered frame.
      await expect.poll(async()=>Number(await canvas.getAttribute('data-render-frame-count')),
        {timeout:15_000}).toBeGreaterThan(renderedBefore);
      const uploads=await canvas.getAttribute(kind==='snow'?'data-snow-matrix-upload-count':'data-rain-matrix-upload-count');
      const rebuilds=await canvas.getAttribute('data-world-rebuild-count');
      for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]) {
        commandedAzimuth=await canvas.evaluate((node,{from,target})=>{
          // Equivalent cardinal headings use the shortest arc. A full backward
          // turn between 270 and 0 degrees only spends software-GPU easing
          // frames; it does not add density coverage.
          const nearestTarget=target+Math.round((from-target)/(Math.PI*2))*Math.PI*2;
          // Browser pointer coordinates are pixel-quantized. Carry the actual
          // delivered command, not the ideal angle, to avoid accumulated drift.
          const dx=Math.round((nearestTarget-from)/.011);
          node.dispatchEvent(new PointerEvent('pointerdown',{pointerId:5,clientX:80,clientY:100,bubbles:true}));
          node.dispatchEvent(new PointerEvent('pointermove',{pointerId:5,clientX:80+dx,clientY:100,bubbles:true}));
          node.dispatchEvent(new PointerEvent('pointerup',{pointerId:5,clientX:80+dx,clientY:100,bubbles:true}));
          return from+dx*.011;
        },{from:commandedAzimuth,target:angle});
        // Observe readiness inside the page rather than repeatedly injecting DOM
        // getters between costly software-GPU frames. Use the same bounded
        // readiness window as the weather draw; this is not a latency benchmark.
        await page.waitForFunction(target=>{
          const node=document.querySelector<HTMLCanvasElement>('[aria-label="降水密度验证"]')!;
          const delta=Number(node.dataset.cameraAzimuth)-target;
          return Math.abs(Math.atan2(Math.sin(delta),Math.cos(delta)))<.01;
        },angle,{timeout:15_000});
        for(const zoom of ['far','near']) {
          const request=await canvas.evaluate((node,value)=>{
            const scope=window as Scope,sampleId=++scope.densitySampleId;
            const renderedBefore=Number(node.dataset.renderFrameCount);
            node.dispatchEvent(new WheelEvent('wheel',{deltaY:value==='far'?100_000:-100_000,bubbles:true,cancelable:true}));
            return {sampleId,renderedBefore};
          },zoom);
          // Read shader uniforms from this requested, submitted frame, not the
          // previous pose after a fixed sleep. A GPU fence per observation adds
          // raster latency to a numerical frustum probe without adding coverage.
          const sampleHandle=await page.waitForFunction(({sampleId,renderedBefore})=>{
            const scope=window as Scope,node=document.querySelector<HTMLCanvasElement>('[aria-label="降水密度验证"]')!;
            if(scope.densityProbe?.sampleId!==sampleId || Number(node.dataset.renderFrameCount)<=renderedBefore)return false;
            return {probe:scope.densityProbe,azimuth:Number(node.dataset.cameraAzimuth)};
          },request,{timeout:15_000});
          const sample=await sampleHandle.jsonValue();await sampleHandle.dispose();
          if(!sample)throw new Error('The requested precipitation draw did not produce a sample.');
          expect(sample.probe.sampleId).toBe(request.sampleId);
          const delta=sample.azimuth-angle;
          expect(Math.abs(Math.atan2(Math.sin(delta),Math.cos(delta)))).toBeLessThan(.01);
          const probe=sample.probe;
          observations.push({mode,kind,angle,zoom,probe});
          await info.attach(`${mode}-${kind}-${angle.toFixed(2)}-${zoom}`,{body:JSON.stringify(probe),contentType:'application/json'});
          if(mode==='ordinary'&&angle===0&&zoom==='far')await canvas.screenshot({path:info.outputPath(`${kind}-${mode}-far.png`)});
        }
      }
      await expect(canvas).toHaveAttribute(kind==='snow'?'data-snow-matrix-upload-count':'data-rain-matrix-upload-count',uploads!);
      await expect(canvas).toHaveAttribute('data-world-rebuild-count',rebuilds!);
    }
  }
  await info.attach('cardinal-density',{body:JSON.stringify(observations,null,2),contentType:'application/json'});
  for(const observation of observations) {
    const p=observation.probe;
    expect(p.upper/(p.upper+p.lower),JSON.stringify(observation)).toBeGreaterThan(.12);
    expect(p.upper/(p.upper+p.lower),JSON.stringify(observation)).toBeLessThan(.88);
    expect(p.lower,JSON.stringify(observation)).toBeGreaterThan(5);
    expect(p.groundRelative).toBe(true);
  }
  for(let index=0;index<observations.length;index+=2) {
    const far=observations[index]!.probe,near=observations[index+1]!.probe;
    const farDensity=far.count/(far.area*far.spanY),nearDensity=near.count/(near.area*near.spanY);
    expect(Math.abs(farDensity-nearDensity)/farDensity,JSON.stringify({far,near})).toBeLessThan(.03);
    expect(far.count).toBeGreaterThan(near.count);
  }
  await page.evaluate(()=>(window as Scope).densityRenderer.dispose());
});
