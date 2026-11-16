import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

import {captureOwnedMemory,ownedProcesses} from './device-memory.mjs';

const [adb,serial,apk,output,profile='day',mode='static',repeat='1']=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
const {presentationSummary}=await import('../../../spikes/native-world-complex/presentation.mjs');
if(!adb||!serial||!apk||!output)throw Error('adb serial exact-installed-apk new-output-directory required');
if(!['day','night','rain','snow'].includes(profile)||!['static','dynamic'].includes(mode)||!['1','2','3'].includes(repeat))throw Error('profile day/night/rain/snow, mode static/dynamic, repeat 1..3');
const dynamicRuntime=mode==='dynamic';
const pkg='com.blockcolc.preview',sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const call=args=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
const shell=(...args)=>call(['shell',...args]);
const focus=()=>shell('dumpsys','window').split('\n').find(line=>line.includes('mCurrentFocus='))??'';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(output,{recursive:false});
const report={kind:dynamicRuntime?'p1-matched-dynamic-world':'p1-matched-static-load-preflight',serial,package:pkg,executedAt:new Date().toISOString(),profile,repeat:Number(repeat),
  apkSha256:sha(await readFile(apk)),toolSha256:{runner:sha(await readFile(new URL('./measure-orbit-device.mjs',import.meta.url))),memory:sha(await readFile(new URL('./device-memory.mjs',import.meta.url)))},dynamicRuntime,p1GatePassed:false,p2Started:false,cases:[]};
try{
  if(![pkg,'com.android.launcher/'].some(s=>focus().includes(s)))throw Error('Phone is busy');
  const base=shell('pm','path',pkg).split('\n').find(s=>s.startsWith('package:')&&s.endsWith('/base.apk'))?.slice(8);
  if(!base?.startsWith('/data/app/')||shell('sha256sum',base).split(/\s/)[0]!==report.apkSha256)throw Error('Installed preview APK differs');
  for(let repetition=0;repetition<Number(repeat);repetition++)for(const fixture of ['ocean','coast'])for(const backend of (fixture==='ocean')===(repetition%2===0)?['OPENGL','WEBGL']:['WEBGL','OPENGL']){
    if(![pkg,'com.android.launcher/'].some(s=>focus().includes(s)))throw Error('Phone became busy');
    const runId=fixture+'-'+backend.toLowerCase()+'-'+Date.now();
    const row={fixture,backend,runId,repetition};report.cases.push(row);
    row.batteryBefore=shell('dumpsys','battery').split('\n').filter(s=>/level:|temperature:/.test(s)).map(s=>s.trim());
    shell('am','force-stop',pkg);
    row.launch=shell('am','start','-W','-n',pkg+'/.MainActivity','--es','fixture',fixture,'--es','profile',profile,
      '--ez','runtime',String(dynamicRuntime),'--ez','webReference',String(backend==='WEBGL'),'--es','benchmarkRun',runId);
    const capture={surface:null,polls:0,rows:[]},unique=new Map();let result;
    const deadline=Date.now()+120000;
    for(;;){
      await sleep(700);
      if(!focus().includes(pkg))throw Error('Preview lost foreground: '+focus());
      if(!capture.surface){
        const layers=shell('dumpsys','SurfaceFlinger','--list').split('\n');
        const expression=backend==='OPENGL'
          ? /(?:RequestedLayerState\{)?([0-9a-f]+ SurfaceView\[com\.blockcolc\.preview\/com\.blockcolc\.preview\.MainActivity\]\(BLAST\)#\d+)/
          : /^(?:RequestedLayerState\{)?(com\.blockcolc\.preview\/com\.blockcolc\.preview\.MainActivity#\d+)/;
        capture.surface=layers.map(line=>line.match(expression)?.[1]).filter(Boolean).at(-1)??null;
      }
      if(capture.surface){
        const lines=shell('dumpsys','SurfaceFlinger','--latency',"'"+capture.surface+"'").split('\n');capture.polls++;
        for(const line of lines){const m=line.match(/^(\d+)\s+(\d+)\s+(\d+)\s*$/);if(m)unique.set(m.slice(1).join(','),{desiredNs:m[1],actualNs:m[2],readyNs:m[3]});}
      }
      try{result=JSON.parse(shell('run-as',pkg,'cat','files/p1-orbit-'+runId+'.json'));}catch{}
      if(result?.runId===runId&&result.endMonotonicNs)break;
      if(Date.now()>deadline)throw Error('Orbit did not complete: '+runId);
    }
    if(result.kind!=='p1-bounded-orbit'||!result.foregroundGuard||result.width!==720||result.height!==960||result.requestedDurationMs!==10000||result.dynamicRuntime!==dynamicRuntime||result.profile!==profile)throw Error('Invalid orbit scope');
    if(backend==='WEBGL'&&(result.renderScheduling!=='production-scheduler-only'||result.submittedFrames>result.cameraUpdates+2||result.submittedFrames<result.cameraUpdates*.8))
      throw Error('Reference did not use one production world frame per camera update');
    if(backend==='OPENGL')for(const key of ['geometryCreated','geometryDestroyed','textureCreated','textureDestroyed'])
      if(result.before[key]!==result.after[key])throw Error('Orbit allocated or retired world resources: '+key);
    const resourcePack=backend==='OPENGL'?result.after.resourcePack:result.after.assets?.resourcePack;
    row.resourcePack=resourcePack??null;
    const previous=report.cases.find(r=>r!==row&&r.completed);
    if(previous&&['kind','sha256','bytes','wireSha256'].some(key=>previous.resourcePack?.[key]!==row.resourcePack?.[key]))throw Error('Compared different resource packs');
    if(resourcePack&&dynamicRuntime){
      if(backend==='OPENGL'){
        if(result.before.atlasSequences<1||result.after.atlasSequences!==result.before.atlasSequences||result.after.atlasUploadFrames<=result.before.atlasUploadFrames||result.after.atlasTimelineChanges<=result.before.atlasTimelineChanges)throw Error('Native atlas animation did not advance');
      }else{
        const a=result.before.assets.diagnostics,b=result.after.assets.diagnostics;
        if(a.animatedTextureCount<1||a.animatedTextureCount!==b.animatedTextureCount||b.animationFrameUpdateCount<=a.animationFrameUpdateCount||b.activeResourcePackId!=='p1-mc263-'+resourcePack.sha256)throw Error('Source atlas animation did not advance');
      }
    }
    if(dynamicRuntime){
      const before=backend==='OPENGL'?result.before.nativeAnimals:result.before.animals,after=backend==='OPENGL'?result.after.nativeAnimals:result.after.animals;
      if(!before||after.count!==before.count||after.time<=before.time+3)throw Error('Animal runtime did not advance');
      if(backend==='OPENGL'){
        if(result.after.animalUploadFrames<=result.before.animalUploadFrames+5||result.after.precipitationActiveCount<1&&['rain','snow'].includes(profile))throw Error('Native dynamic load missing');
      }else{
        if(result.before.quality.qualityTier!==result.after.quality.qualityTier||result.after.quality.pixelRatio!==1)throw Error('Source changed visible quality');
        if(['rain','snow'].includes(profile)&&!result.after.weather.animations.some(a=>a.kind===profile&&a.activeCount>0&&a.elapsedMs>result.before.weather.animations.find(b=>b.kind===profile)?.elapsedMs+3000))throw Error('Source precipitation time did not advance');
      }
    }
    capture.rows=[...unique.values()];row.presentation=presentationSummary(capture,result);
    if(row.presentation.lowSampleCount||row.presentation.firstEdgeGapMs>1000||row.presentation.lastEdgeGapMs>1000)throw Error('Incomplete actual presentation coverage');
    await writeFile(path.join(output,runId+'.json'),JSON.stringify(result,null,2));
    await writeFile(path.join(output,runId+'-fences.json'),JSON.stringify(capture,null,2));
    const png=execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:16*1024*1024});
    await writeFile(path.join(output,runId+'.png'),png);row.screenshotSha256=sha(png);
    row.memory=await captureOwnedMemory(shell,pkg,output,runId,{requireWebView:backend==='WEBGL'});
    row.batteryAfter=shell('dumpsys','battery').split('\n').filter(s=>/level:|temperature:/.test(s)).map(s=>s.trim());
    shell('input','keyevent','KEYCODE_BACK');
    if(backend==='OPENGL'){
      const deadline=Date.now()+30000;let retired;
      for(;;){try{retired=JSON.parse(shell('run-as',pkg,'cat','files/p1-retire-'+fixture+'.json'));}catch{}
        if(retired?.startedNs>Number(result.endMonotonicNs))break;
        if(Date.now()>deadline)throw Error('No fresh native retirement after orbit');await sleep(500);}
      if(retired.failure||!retired.engineDestroyed||retired.after.packets!==0||Object.keys(retired.after.geometries).length||Object.keys(retired.after.textures).length)throw Error('Dynamic orbit leaked GPU resources');
      row.retirement=retired;
    }
    await sleep(1000);row.memoryAfterBack=await captureOwnedMemory(shell,pkg,output,runId+'-after-back',{requireHost:false,allowRetirement:true});
    row.completed=true;
    shell('am','force-stop',pkg);await sleep(2500);
    row.processesAfterStop=ownedProcesses(shell('dumpsys','activity','processes',pkg),pkg);
    if(row.processesAfterStop.length)throw Error('Preview-owned process survived stop; attribution needs review');
  }
  report.completed=true;
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{
  shell('am','force-stop',pkg);if(focus().includes(pkg))shell('input','keyevent','KEYCODE_HOME');
  report.previewStopped=true;await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({completed:report.completed??false,failure:report.failure??null,cases:report.cases.map(r=>({fixture:r.fixture,backend:r.backend,actual:r.presentation?.presentedUpdatesPerSecond,p95:r.presentation?.presentIntervalP95Ms})),p1GatePassed:false}));
}
