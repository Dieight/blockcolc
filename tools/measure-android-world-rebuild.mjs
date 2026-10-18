import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {decodeProbeSamples} from './android-performance-protocol.mjs';

const args=process.argv.slice(2),option=(name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1];};
const serial=option('--serial',''),apk=option('--apk',''),output=option('--output',''),iterations=Number(option('--iterations','3'));
const environment=option('--environment',''),keepEnvironment=args.includes('--keep-environment');
const observeOnly=args.includes('--observe-only');
if(environment&&!['classic-island','natural-valley','ocean-island','mosaic-coast'].includes(environment))throw new Error('Unsupported environment.');
if(!/^[\w-]+$/.test(serial)||!apk||!output||!Number.isInteger(iterations)||iterations<1||iterations>5)
  throw new Error('Required: --serial, --apk, --output; iterations 1-5.');
const exec=promisify(execFile),adb=path.join(process.env.LOCALAPPDATA,'Android/Sdk/platform-tools/adb.exe');
const pkg='com.blockcolc.app',activity=`${pkg}/.MainActivity`,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const run=`world-rebuild-${Date.now()}`,absoluteOutput=path.resolve(output);
const report={schemaVersion:1,status:'running',measuredAt:new Date().toISOString(),apkSha256:createHash('sha256').update(await readFile(apk)).digest('hex'),
  scope:'Same resident world and unchanged snapshots; no domain commands, task writes, pack/settings changes or CPU profiler.',samples:[],limitations:['Render-only replay is not an actual focus submission or full save-path measurement.'],device:{}};
let request=0,forward='',cdp=null,originalEnvironment=null,switched=false;
let originalMinimal=false;
const call=async(...argv)=>(await exec(adb,['-s',serial,...argv],{windowsHide:true,timeout:30_000,maxBuffer:8*1024*1024})).stdout;
async function ready(){
  const policy=await call('shell','dumpsys','window','policy');
  const activities=await call('shell','dumpsys','activity','activities');
  if(!/interactiveState=INTERACTIVE_STATE_AWAKE/.test(policy)||!/mIsShowing=false/.test(policy)
    ||!new RegExp(`topResumedActivity=.*${pkg.replaceAll('.','\\.')}/`).test(activities))throw new Error('Unlock and foreground Blockcolc first.');
  const temperature=Number(/temperature:\s*(\d+)/.exec(await call('shell','dumpsys','battery'))?.[1]);
  if(!Number.isFinite(temperature)||temperature>=440)throw new Error('Unknown or excessive battery temperature.');
  return temperature/10;
}
async function operation(name,extras=[]){const id=`wr${++request}`;await call('shell','am','start','-n',activity,'-a',`${pkg}.action.PERFORMANCE`,
  '--es','probeOperation',name,'--es','probeRequestId',id,...extras);return id;}
async function snapshot(){
  const id=await operation('snapshot'),deadline=Date.now()+90_000;
  while(Date.now()<deadline){const log=await call('logcat','-d','-v','brief','-s','BlockcolcPerf:I','*:S');const samples=decodeProbeSamples(log,run,id);
    if(samples.length)return samples.at(-1);await pause(400);}
  throw new Error('No complete opted-in probe snapshot.');
}
const idle=sample=>{if(!sample.safety?.known||!sample.safety.idle)throw new Error('Unknown or active focus/plan/report: refuse the experiment.');};
async function connect(url){
  const socket=new WebSocket(url),pending=new Map();let sequence=0;
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data)),entry=pending.get(message.id);if(!entry)return;
    pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(new Error(`CDP ${entry.method} failed.`)):entry.resolve(message.result);});
  socket.addEventListener('close',()=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('CDP closed.'));}pending.clear();});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  return {close:()=>socket.close(),send(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP ${method} timed out.`));},90_000);pending.set(id,{resolve,reject,timer,method});socket.send(JSON.stringify({id,method,params}));});}};
}
async function evaluate(expression){
  const result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails){
    const known=['No settings navigation','No environment choice','No visible world','No resident renderer/snapshot owner','Renderer no longer available'];
    const description=String(result.exceptionDetails.exception?.description??'');
    throw new Error(known.find(value=>description.includes(value))??'World diagnostic evaluation failed; no task contents collected.');
  }
  return result.result.value;
}
async function save(){await mkdir(path.dirname(absoluteOutput),{recursive:true});await writeFile(absoluteOutput,JSON.stringify(report,null,2));}
async function setMinimal(value){
  const current=await evaluate(`document.querySelector('.world-screen')?.getAttribute('data-minimal-mode')==='true'`);
  if(current===value)return;
  const selector=value?'.minimal-entry':'.minimal-exit';
  await evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});if(!button)throw new Error('No mode control');button.click();})()`);
  const deadline=Date.now()+60_000;
  while(Date.now()<deadline){
    if(await evaluate(`document.querySelector('.world-screen')?.getAttribute('data-minimal-mode')==='${value}'&&document.querySelector('.app-shell')?.getAttribute('data-mode-transition-active')!=='true'`))return;
    await pause(300);
  }
  throw new Error('Mode did not settle.');
}
async function switchEnvironment(value){
  idle(await snapshot());await ready();
  const wasMinimal=await evaluate(`document.querySelector('.world-screen')?.getAttribute('data-minimal-mode')==='true'`);
  if(wasMinimal)await setMinimal(false);
  report.step='open-settings';
  await evaluate(`(()=>{const button=document.querySelectorAll('.bottom-nav button')[3];if(!button)throw new Error('No settings navigation');button.click();})()`);
  const deadline=Date.now()+90_000;
  while(Date.now()<deadline){if(await evaluate(`!!document.querySelector('.settings-page button[data-value="${value}"]')`))break;await pause(250);}
  report.step='choose-environment';
  await evaluate(`(()=>{const button=document.querySelector('.settings-page button[data-value="${value}"]');if(!button||button.disabled)throw new Error('No environment choice');button.click();})()`);
  let adopted=false;
  while(Date.now()<deadline){adopted=await evaluate(`(()=>{const button=document.querySelector('.settings-page button[data-value="${value}"]');return button?.getAttribute('aria-pressed')==='true'&&!button.disabled;})()`);
    if(adopted)break;await pause(350);}
  if(!adopted)throw new Error('Environment preference did not commit.');
  report.step='return-to-world';
  await evaluate(`document.querySelectorAll('.bottom-nav button')[0].click()`);
  while(Date.now()<deadline){
    if(await evaluate(`(()=>{const canvas=document.querySelector('canvas[data-world-canvas]');return canvas?.dataset.environmentStyle===${JSON.stringify(value)}&&canvas.dataset.initialPresentationReady==='true'&&canvas.getBoundingClientRect().height>100;})()`)){
      if(wasMinimal)await setMinimal(true);return;
    }
    await pause(500);
  }
  throw new Error('Environment scene did not prepare.');
}
try{
  const manufacturer=(await call('shell','getprop','ro.product.manufacturer')).trim();if(manufacturer.toLowerCase()!=='oneplus')throw new Error('OnePlus-only experiment.');
  report.device={serial,manufacturer,model:(await call('shell','getprop','ro.product.model')).trim(),temperatureC:await ready()};
  const installed=(await call('shell','pm','path',pkg)).split(/\r?\n/).find(line=>line.endsWith('/base.apk'))?.replace(/^package:/,'').trim();
  if(!installed||!(await call('shell','sha256sum',installed)).startsWith(report.apkSha256))throw new Error('Explicit diagnostic APK does not match installed APK.');
  await operation('arm',['--es','probeRunId',run]);await pause(300);const before=await snapshot();idle(before);report.beforeSafety=before.safety;
  const pid=(await call('shell','pidof',pkg)).trim().split(/\s+/)[0];if(!/^\d+$/.test(pid))throw new Error('No current app process.');
  const port=(await call('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`)).trim();if(!/^\d+$/.test(port))throw new Error('No WebView diagnostic port.');forward=`tcp:${port}`;
  const targets=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(3000)}).then(result=>result.json());
  const target=targets.find(item=>item.type==='page'&&/^https?:\/\/localhost(?:\/|$)/.test(item.url));if(!target)throw new Error('No app WebView target.');
  const address=new URL(target.webSocketDebuggerUrl);address.hostname='127.0.0.1';address.port=port;cdp=await connect(address.href);
  report.step='wait-for-prepared-world';let preparedWorld=false;
  for(const deadline=Date.now()+90_000;Date.now()<deadline;){
    preparedWorld=await evaluate(`(()=>{const canvas=document.querySelector('canvas[data-world-canvas]');return canvas?.dataset.initialPresentationReady==='true'&&canvas.dataset.openingRevealState!=='active'&&canvas.getBoundingClientRect().height>100;})()`);
    if(preparedWorld)break;await pause(500);
  }
  if(!preparedWorld)throw new Error('No prepared, visible world for replay.');
  originalEnvironment=await evaluate(`document.querySelector('canvas[data-world-canvas]')?.dataset.environmentStyle`);
  originalMinimal=await evaluate(`document.querySelector('.world-screen')?.getAttribute('data-minimal-mode')==='true'`);
  report.minimal=originalMinimal;
  if(environment&&environment!==originalEnvironment){
    report.scope='Temporary environment choice through app controls, followed by unchanged render-only replays; no focus/task writes.';
    report.environmentChange={from:originalEnvironment,to:environment,keepRequested:keepEnvironment};
    switched=true;await switchEnvironment(environment);await pause(1800);
  }
  report.initialCaches=await evaluate(`(()=>{const d=document.querySelector('canvas[data-world-canvas]').dataset;return {
    staticCpuHits:Number(d.staticCpuCacheHits??0),staticCpuMisses:Number(d.staticCpuCacheMisses??0),
    cpuBytes:Number(d.buildingCpuCacheBytes??0),cpuRecipes:Number(d.buildingCpuCacheRecipes??0),
    sceneRead:d.worldSceneCacheRead,buildingRead:d.buildingCpuCacheRead,sceneryPlanHit:d.sceneryPlanCacheHit};})()`);
  report.world=await evaluate(`(()=>{
    const canvas=document.querySelector('canvas[data-world-canvas]');if(!canvas||canvas.getBoundingClientRect().height<100)throw new Error('No visible world');
    let fiber=canvas[Object.keys(canvas).find(key=>key.startsWith('__reactFiber$'))],rendererRef=null,snapshotRef=null;
    for(;fiber;fiber=fiber.return){for(let hook=fiber.memoizedState;hook&&typeof hook==='object';hook=hook.next){
      const value=hook.memoizedState;if(!value||typeof value!=='object'||!('current' in value))continue;
      const current=value.current;if(current&&typeof current.setWorlds==='function'&&typeof current.getDiagnostics==='function')rendererRef=value;
      if(current&&Array.isArray(current.worlds)&&typeof current.key==='string')snapshotRef=value;
    }if(rendererRef&&snapshotRef)break;}
    if(!rendererRef||!snapshotRef)throw new Error('No resident renderer/snapshot owner');
    window.__blockcolcWorldRebuildExperiment={rendererRef,snapshotRef};
    const diagnostics=rendererRef.current.getDiagnostics();return {environment:canvas.dataset.environmentStyle,
      worlds:snapshotRef.current.worlds.length,resourcePackActive:diagnostics.activeResourcePackId!==null,quality:diagnostics.qualityTier,pixelRatio:diagnostics.pixelRatio};
  })()`);
  report.observeOnly=observeOnly;
  for(let iteration=1;iteration<=(observeOnly?0:iterations);iteration++){
    idle(await snapshot());const temperatureC=await ready();
    const sample=await evaluate(`(async()=>{
      const {rendererRef,snapshotRef}=window.__blockcolcWorldRebuildExperiment,renderer=rendererRef.current,worlds=snapshotRef.current.worlds;
      if(!renderer||!worlds.length||document.hidden)throw new Error('Renderer no longer available');
      const canvas=document.querySelector('canvas[data-world-canvas]'),frames=[],tasks=[];let previous=null,raf=0;
      const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(entry=>entry.duration)));observer.observe({type:'longtask'});
      const tick=now=>{if(previous!==null)frames.push(now-previous);previous=now;raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const started=performance.now();renderer.setWorlds(worlds);const rebuildMs=performance.now()-started;
      const prepared=await renderer.preparePresentationFrame();const presentedMs=performance.now()-started;
      await new Promise(resolve=>setTimeout(resolve,120));cancelAnimationFrame(raf);tasks.push(...observer.takeRecords().map(entry=>entry.duration));observer.disconnect();
      const d=renderer.getDiagnostics();return {rebuildMs,presentedMs,prepared,frameMaxMs:Math.max(0,...frames),longTaskMaxMs:Math.max(0,...tasks),
        stages:JSON.parse(canvas.dataset.worldRebuildStagesMs??'{}'),scenery:JSON.parse(canvas.dataset.sceneryBuildStagesMs??'{}'),
        buildingMeshCacheHits:Number(canvas.dataset.buildingMeshCacheHits??0),sceneryMeshCacheHit:canvas.dataset.sceneryMeshCacheHit==='true',
        rewardMeshCacheHits:Number(canvas.dataset.rewardMeshCacheHits??0),staticCpuHits:Number(canvas.dataset.staticCpuCacheHits??0),staticCpuMisses:Number(canvas.dataset.staticCpuCacheMisses??0),
        terrainMeshCacheHit:canvas.dataset.terrainMeshCacheHit==='true',geometries:d.memory.geometries,textures:d.memory.textures,
        calls:d.render.calls,triangles:d.render.triangles,worldRebuildCount:d.worldRebuildCount,shadowRefreshCount:d.shadowRefreshCount};
    })()`);
    report.samples.push({iteration,temperatureC,...sample});await save();await pause(1200);
  }
  const after=await snapshot();idle(after);report.afterSafety=after.safety;
  report.derivedCache=await evaluate(`(async()=>{
    const result={};
    for(const suffix of ['', '-buildings']){
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('blockcolc-derived-world-scene'+suffix,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject();});
      try{const value=await new Promise((resolve,reject)=>{const r=db.transaction('scenes').objectStore('scenes').get(document.querySelector('canvas[data-world-canvas]').dataset.environmentStyle);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject();});
        result[suffix?'building':'scene']=value?{bytes:value.bytes,sceneryPresent:value.entry?.scenery!=null,objectCount:value.entry?.scenery?.plan?.objects?.length,recipeCount:value.entry?.recipes?.length}:null;
        if(suffix&&value?.entry?.recipes)result.building.staticRecipes={
          old:value.entry.recipes.filter(item=>item.key.startsWith('static-render-1:')).length,
          compact:value.entry.recipes.filter(item=>item.staticVoxelCount!==undefined).length};
        if(!suffix&&value?.entry?.scenery){
          const saved=JSON.parse(value.entry.scenery.key.slice(value.entry.terrain.key.length+1));
          const current=JSON.parse(document.querySelector('canvas[data-world-canvas]').dataset.rewardGroundSupport??'[]');
          result.scene.rewards={savedCount:saved.length,currentCount:current.length,xzSame:saved.length===current.length&&saved.every((row,i)=>row[0]===current[i].x&&row[1]===current[i].z)};
        }
      }finally{db.close();}
    }
    const shell=document.querySelector('.app-shell'),canvas=document.querySelector('canvas[data-world-canvas]');
    result.idleGuards={worldPreparing:shell?.dataset.worldPreparing,transition:shell?.dataset.presentationTransition,portal:shell?.dataset.modePortalActive,opening:canvas?.dataset.openingRevealState,
      presentationMs:canvas?.dataset.initialPresentationPreparationMs,hidden:document.hidden,inputPending:navigator.scheduling?.isInputPending?.(),
      bootVisible:[...document.querySelectorAll('.boot-page')].some(element=>element.getClientRects().length>0),
      busyVisible:[...document.querySelectorAll('[aria-busy="true"]')].some(element=>element.getClientRects().length>0)};
    return result;
  })()`);
  for(const field of ['projectCount','focusHistoryCount','importedBlueprintCount','progressReportCount'])
    if(report.beforeSafety[field]!==report.afterSafety[field])throw new Error('Business counts changed during render-only replay.');
  if(after.errors!==before.errors)throw new Error('Application reported new errors during replay.');
  report.status='completed';
}catch(error){report.status='failed';report.failure=error.message;process.exitCode=1;}
finally{
  if(switched&&!keepEnvironment&&cdp){try{await switchEnvironment(originalEnvironment);report.environmentRestored=true;}catch{report.environmentRestored=false;report.status='failed';process.exitCode=1;}}
  else if(switched)report.environmentRestored=false;
  try{if(cdp)await evaluate('delete window.__blockcolcWorldRebuildExperiment');}catch{}
  cdp?.close();try{if(forward)await call('forward','--remove',forward);}catch{}
  try{await operation('stop');}catch{report.limitations.push('Probe lease self-expires after four minutes.');}
  report.finishedAt=new Date().toISOString();await save();console.log(`Android world replay ${report.status}: ${absoluteOutput}`);
}
