import './export-fixture';
import {restoreSourceAnimalInput} from './animal-source';
// @ts-expect-error Shared bounded synthetic fixtures.
import {P1_FIXTURES} from './fixture-scope.mjs';

const bridge=(window as any).P1Reference;
const query=new URLSearchParams(location.search);
const fixture=query.get('fixture')??'ocean';
const selectedFixture=P1_FIXTURES.find((row:{name:string})=>row.name===fixture);
if(!selectedFixture)throw Error('Unknown source fixture');
const profile=query.get('profile')??'day';if(!['day','night','rain','snow'].includes(profile))throw Error('Unknown source profile');
const runtime=query.get('runtime')==='true';
const animalProbe=query.get('animalProbe');
const benchmarkRun=query.get('benchmarkRun');
const skyProbe=query.get('skyProbe')==='true';
const moonProbe=query.get('moonProbe')==='true';
const lab=()=> (window as any).nativeP1;
let completed=false;
function fail(error:unknown){bridge?.save(JSON.stringify({fixture,profile,failed:String(error)}));}
(window as any).p1ReferenceSample=()=>{
  if(!completed)return;
  try{bridge.save(JSON.stringify({fixture,profile,sampled:true,runtimeEnabled:runtime,assets:lab().assetState(),weather:lab().hook().precipitation(),camera:lab().hook().state(),animals:lab().hook().animalSnapshot()}));}
  catch(error){fail(error);}
};
(window as any).p1ReferenceUpdate=async()=>{
  if(!completed)return;
  try{await lab().replaceBuilding(false);if(skyProbe)lab().hook().probeView(.9,.08,Math.PI/4);if(moonProbe)lab().hook().probeMoon();if(animalProbe)lab().hook().probeAnimal(animalProbe);lab().hook().draw();
    requestAnimationFrame(()=>requestAnimationFrame(()=>bridge.save(JSON.stringify({fixture,profile,updated:true,scope:'Source renderer reference, not GPU owner contract'}))));
  }catch(error){fail(error);}
};
try{
  const deadline=performance.now()+30000;
  while(!bridge.foreground()){
    if(performance.now()>deadline)throw Error('Source reference never gained foreground');
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  const frozen=await(await fetch('/web/frozen-camera-'+fixture+'.json')).json();
  if(frozen.resourcePack)await lab().loadResourcePackWire(frozen.resourcePack);
  await lab().build(selectedFixture.style,25,profile);
  const hook=lab().hook();
  // Match the native render buffer, independently of physical display density.
  hook.renderer.setPixelRatio(1);hook.renderer.setSize(720,960,false);hook.camera.aspect=.75;hook.camera.updateProjectionMatrix();hook.draw();
  hook.frozenCamera(frozen.camera);hook.draw();
  if(frozen.animalRuntime){restoreSourceAnimalInput(hook.animals(),frozen.animalRuntime);hook.prepareTick();hook.draw();}
  if(skyProbe){hook.probeView(.9,.08,Math.PI/4);hook.draw();}
  if(moonProbe){hook.probeMoon();hook.draw();}
  if(animalProbe){hook.probeAnimal(animalProbe);hook.draw();}
  if(runtime)lab().runtime(true);
  if(benchmarkRun){
    if(!/^[a-z0-9-]{1,80}$/.test(benchmarkRun))throw Error('Invalid benchmark identity');
    const camera=hook.state(),initial=Math.atan2(camera.position[2]-camera.target[2],camera.position[0]-camera.target[0]);
    const start=performance.now();let begin=0,beginNs='',frames=0,worldFrames=0,foreground=true,before:any;
    await new Promise<void>((resolve,reject)=>{
      function tick(now:number){try{
        foreground=foreground&&bridge.foreground();if(!foreground)throw Error('Reference orbit lost foreground');
        if(!begin&&now-start>=3000){begin=now;beginNs=bridge.monotonicNs();worldFrames=hook.renderStats().totalRenderedFrames;
          before={animals:hook.animalSnapshot(),weather:hook.precipitation(),quality:hook.renderStats(),assets:lab().assetState()};}
        const angle=initial+(begin?Math.min(1,(now-begin)/10000)*Math.PI*2:0);
        // lookAt already requests the production frame scheduler. A direct
        // draw here would render the same workload a second time each rAF.
        hook.lookAt(...camera.target,angle);
        if(begin)frames++;
        if(begin&&now-begin>=10000){
          bridge.save(JSON.stringify({kind:'p1-bounded-orbit',backend:'WEBGL',runId:benchmarkRun,fixture,
            beginMonotonicNs:beginNs,endMonotonicNs:bridge.monotonicNs(),requestedDurationMs:10000,
            cameraUpdates:frames,submittedFrames:hook.renderStats().totalRenderedFrames-worldFrames,
            renderScheduling:'production-scheduler-only',foregroundGuard:foreground,width:720,height:960,ratio:.55,pitch:Math.PI/6,
            camera,sourceDiagnostics:lab().hook().renderer.info.render,quality:hook.renderStats(),dynamicRuntime:runtime,profile,
            before,after:{animals:hook.animalSnapshot(),weather:hook.precipitation(),quality:hook.renderStats(),assets:lab().assetState()},
            scope:runtime?'Actual production renderer with dynamic animals/clouds/precipitation; not whole-App startup':'Frozen dynamic behavior, static negative control only',p1GatePassed:false}));resolve();
        }else requestAnimationFrame(tick);
      }catch(error){reject(error);}}
      requestAnimationFrame(tick);
    });
  }else{
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(!bridge.foreground()){fail('Source reference lost foreground');return;}
    const gl=hook.renderer.getContext(),info=gl.getExtension('WEBGL_debug_renderer_info');
    completed=true;bridge.save(JSON.stringify({fixture,profile,ready:true,width:hook.renderer.domElement.width,
      height:hook.renderer.domElement.height,camera:hook.state(),gpu:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
      runtimeEnabled:runtime,assets:lab().assetState(),weather:hook.precipitation(),animals:hook.animalSnapshot(),scope:'Current actual production renderer in isolated WebView; no formal App database'}));
  }));
  }
}catch(error){fail(error);}
