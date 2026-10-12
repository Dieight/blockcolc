import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import path from 'node:path';
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
const serial=option('--serial'),apk=option('--apk'),output=path.resolve(option('--output'));
if(!/^[\w-]+$/.test(serial??'')||!apk)throw new Error('Explicit authorized device, installed APK and output required');
const adb=path.join(process.env.LOCALAPPDATA,'Android/Sdk/platform-tools/adb.exe'),pkg='com.blockcolc.app',activity=`${pkg}/.MainActivity`;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,ms)));
const report={status:'running',sha256:createHash('sha256').update(await readFile(apk)).digest('hex'),method:'Actual App/domain/native alarms; 24s focus + 12s break; isolated copied database and volatile local preferences; relay disabled',samples:[],limitations:['No OriginOS device','ADB notification state verifies chronometer identities/deadlines, not OEM visual layout']};
let socket,forward,sequence=0,pending=new Map(),scriptId,experiment,databases=[];
async function adbCall(...argv){return new Promise((resolve,reject)=>{const child=spawn(adb,['-s',serial,...argv],{windowsHide:true});let stdout='',stderr='';const timer=setTimeout(()=>child.kill(),30_000);child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(new Error(`ADB ${argv[0]} failed: ${stderr.slice(0,80)}`));});});}
async function send(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP ${method} timeout`));},30_000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails){const description=result.exceptionDetails.exception?.description??result.exceptionDetails.text;const safe=String(description).split('\n')[0].replace(/https?:\/\/\S+/g,'[url]').slice(0,180);throw new Error(`Diagnostic evaluation failed: ${safe}`);}return result.result.value;}
async function attach(){const pid=(await adbCall('shell','pidof',pkg)).trim();if(!/^\d+$/.test(pid))throw new Error('No unique app PID');const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));forward=`tcp:${port}`;await adbCall('forward','--no-rebind',forward,`localabstract:webview_devtools_remote_${pid}`);
  let target;for(let i=0;i<40&&!target;i++){try{const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());const own=targets.filter(t=>t.type==='page'&&/^https?:\/\/localhost(?:[:/]|$)/.test(t.url));if(own.length===1)target=own[0];}catch{}if(!target)await pause(250);}if(!target)throw new Error('App WebView unavailable');const url=new URL(target.webSocketDebuggerUrl);url.hostname='127.0.0.1';url.port=String(port);socket=new WebSocket(url);socket.addEventListener('message',event=>{const value=JSON.parse(String(event.data)),entry=pending.get(value.id);if(!entry)return;pending.delete(value.id);clearTimeout(entry.timer);value.error?entry.reject(new Error('CDP error')):entry.resolve(value.result);});await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});}
async function waitFor(expression,timeout=80_000){const end=Date.now()+timeout;while(Date.now()<end){const value=await evaluate(expression);if(value)return value;await pause(300);}throw new Error('Expected app state timed out');}
function traceNativeCalls(){
  window.__blockcolcNativeTrace=[];
  const wrapped=new WeakSet(),until=Date.now()+240_000;
  const attach=()=>{const c=window.Capacitor,original=c?.nativePromise;if(typeof original==='function'&&!wrapped.has(original)){
    const fn=function(plugin,method,args){const value=original.call(this,plugin,method,args);if(plugin==='BreakLiveUpdate'){
      const item={method,at:Date.now(),phases:args?.timeline?.phases?.map(p=>({kind:p.kind,start:p.startsAtEpochMs,end:p.endsAtEpochMs,round:p.round}))};
      window.__blockcolcNativeTrace.push(item);value.then(r=>{item.result={scheduled:r?.scheduled,exact:r?.exact,due:r?.due}},()=>{item.failed=true});}return value};wrapped.add(fn);c.nativePromise=fn;
  }if(Date.now()<until)setTimeout(attach,50)};attach();
}
async function notificationState(){const dump=await adbCall('shell','dumpsys','notification','--noredact');const records=dump.split(/(?=\s+NotificationRecord\()/).filter(record=>record.startsWith('  NotificationRecord')||record.includes('NotificationRecord('));return records.filter(record=>record.includes(`pkg=${pkg}`)).map(record=>{
  const tag=/tag=([^\s]+)/.exec(record)?.[1]??'',when=Number(/com\.blockcolc\.app\.extra\.ENDS_AT_EPOCH_MS=Long \((\d+)\)/.exec(record)?.[1]??/when=(\d+)/.exec(record)?.[1]??0);
  const kind=/com\.blockcolc\.app\.extra\.LIVE_UPDATE_KIND=String \((focus|break)\)/.exec(record)?.[1]??'unknown';
  return{tag:tag.startsWith('automatic-continuation:diagnostic-')?tag:'ordinary',kind,when,chronometer:/android.showChronometer=Boolean \(true\)/.test(record),countDown:/android.chronometerCountDown=Boolean \(true\)/.test(record),ongoing:/ONGOING_EVENT/.test(record)};
}).filter(record=>record.tag!=='ordinary'||record.chronometer);}
async function timerServiceState(){
  const dump=await adbCall('shell','dumpsys','activity','services',`${pkg}/.AutomaticTimerService`);
  const processes=await adbCall('shell','dumpsys','activity','processes',pkg);
  const processState=processes.split(/\r?\n/).filter(line=>/curRawAdj=|curProcState=|hasForegroundServices=|frozen=|isFrozen=|virtualFreeze:/.test(line)).map(line=>line.trim());
  const pid=(await adbCall('shell','pidof',pkg)).trim();
  let freezer=null,freezerV2=null,threads=[];
  if(/^\d+$/.test(pid)){
    const dump=await adbCall('shell','ps','-T','-p',pid,'-o','COMM,STAT,WCHAN').catch(()=> '');
    threads=dump.split(/\r?\n/).filter(line=>/AutomaticTimer|com\.blockcolc/.test(line)).map(line=>line.trim());
    const groups=await adbCall('shell','cat',`/proc/${pid}/cgroup`);
    const unified=/^0::(\/[^\r\n]*)/m.exec(groups)?.[1];
    if(unified&&/^\/apps\/uid_\d+\/pid_\d+$/.test(unified)){
      freezerV2=await adbCall('shell','cat',`/sys/fs/cgroup${unified}/cgroup.events`).catch(()=>null);
      freezerV2=freezerV2?.trim()??'unreadable';
    }
    const group=/^\d+:freezer:(\/[^\r\n]*)/m.exec(groups)?.[1];
    if(group&&/^\/[\w/-]+$/.test(group)){
      const state=await adbCall('shell','cat',`/dev/freezer${group}/freezer.state`).catch(()=>null);
      freezer=state?.trim()??'unreadable';
    }else if(group==='/')freezer='root';
  }
  return{running:/ServiceRecord\{[^}]*AutomaticTimerService/.test(dump),foreground:/isForeground=true/.test(dump),processState,freezer,freezerV2,threads};
}
async function restore(){if(!socket)return;
  if(experiment){await evaluate(`window.__blockcolcPerformanceProbe.cancelExperiment(${JSON.stringify(experiment.authorizationId)})`);await evaluate('Promise.all([window.Capacitor.Plugins.BreakLiveUpdate.cancel(),window.Capacitor.Plugins.LocalNotifications.cancel({notifications:[{id:42001},{id:42003}]})])');experiment=null;}
  if(scriptId){await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:scriptId});scriptId=undefined;await send('Page.reload');await waitFor('window.__blockcolcPerformanceProbe?.snapshot()?.safety?.known');}
}
try{
  const installed=(await adbCall('shell','pm','path',pkg)).split(/\r?\n/).find(line=>line.endsWith('base.apk'))?.replace('package:','').trim();
  if(!installed||!(await adbCall('shell','sha256sum',installed)).startsWith(report.sha256))throw new Error('APK mismatch');
  await adbCall('shell','am','start','-n',activity,'-a',`${pkg}.action.PERFORMANCE`,'--es','probeOperation','arm','--es','probeRunId',`auto-${Date.now()}`,'--es','probeRequestId','auto');
  await attach();await send('Page.enable');await waitFor('window.__blockcolcPerformanceProbe?.snapshot()?.safety?.idle');
  const baseline=await evaluate('(()=>{const s=window.__blockcolcPerformanceProbe.snapshot();return{safety:s.safety}})()');report.baseline=baseline;
  const locked=option('--case')==='locked';
  for(const background of (['foreground','revoke'].includes(option('--case'))?[false]:['background','locked'].includes(option('--case'))?[true]:[false,true])){
    await adbCall('shell','am','start','-n',activity,'-a',`${pkg}.action.PERFORMANCE`,'--es','probeOperation','arm','--es','probeRunId',`auto-${Date.now()}`,'--es','probeRequestId','auto');
    experiment=await evaluate('window.__blockcolcPerformanceProbe.prepareFocusExperiment()');databases.push(experiment.databaseName);
    const seed=JSON.stringify(experiment);
    const source=`(()=>{const e=${seed};window.__blockcolcDiagnosticStorage=e.databaseName;const data=new Map([['blockcolc-focus-preferences-v1',JSON.stringify(e.preferences)],['blockcolc-round-plan-v1',JSON.stringify(e.plan)],['blockcolc-onboarding-v1','1'],['blockcolc-first-project-setup-v1','1']]);Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>data.get(String(key))??null,setItem:(key,value)=>data.set(String(key),String(value)),removeItem:key=>data.delete(String(key)),clear:()=>data.clear(),key:index=>[...data.keys()][index]??null,get length(){return data.size}}});})()`;
    scriptId=(await send('Page.addScriptToEvaluateOnNewDocument',{source:source+`;\n(${traceNativeCalls.toString()})();`})).identifier;
    // The short timer starts when the copied repository is prepared. Do not
    // wait for a cache-miss world rebuild and accidentally miss its first
    // boundary while still in the foreground.
    await send('Page.reload');await waitFor('(()=>{try{const p=window.__blockcolcPerformanceProbe;return p?.snapshot()?.phases?.["bootstrap-ready"]&&p.experimentStatus()?.active}catch{return false}})()');
    // Android and the workstation need not share a wall clock. Schedule ADB
    // observations against a midpoint-calibrated device clock, not host time.
    const clockBefore=Date.now(),deviceNow=await evaluate('Date.now()'),clockAfter=Date.now();
    const clockOffsetMs=deviceNow-(clockBefore+clockAfter)/2,deviceTime=()=>Date.now()+clockOffsetMs;
    const run={background,locked,initialHistory:experiment.initialHistoryCount,clockOffsetMs,clockRoundTripMs:clockAfter-clockBefore,readyBeforeFirstEndMs:experiment.firstEndsAt-deviceTime(),phases:[]};
    report.samples.push(run);
    if(run.readyBeforeFirstEndMs<6000)throw new Error('Fixture loaded too late for first boundary; no valid background sample');
    await evaluate('window.dispatchEvent(new Event("focus"))');
    await pause(300);
    run.initialTrace=await evaluate('window.__blockcolcNativeTrace');
    if(option('--case')==='revoke'){
      // Revoke only the synthetic native authorization, not the user's domain
      // state. The copied repository is discarded through the normal cleanup.
      run.initialTimerService=await timerServiceState();
      if(!run.initialTimerService.running)throw new Error('No active service to revoke');
      await evaluate(`window.__blockcolcPerformanceProbe.cancelExperiment(${JSON.stringify(experiment.authorizationId)})`);
      await pause(800);
      run.revokedTimerService=await timerServiceState();
      run.revokedProjection=await evaluate('JSON.parse(window.BlockcolcPerformance?.timerProjection?.()??"{}")');
      if(run.revokedTimerService.running)throw new Error('Revoked timer service remained active');
      if(!Array.isArray(run.revokedProjection.timelines)||!(run.revokedProjection.now>0))throw new Error('Native revocation probe was unavailable');
      if(run.revokedProjection.timelines.length)throw new Error('Revoked native timeline remained authorized');
      run.method='Native synthetic authorization revocation; not UI plan-cancellation acceptance';
      await restore();break;
    }
    if(background)await adbCall('shell','input','keyevent','KEYCODE_HOME');
    if(locked)await adbCall('shell','input','keyevent','KEYCODE_SLEEP');
    run.initialTimerService=await timerServiceState();
    if(option('--case')==='shade'){
      await waitFor('window.__blockcolcPerformanceProbe?.snapshot()?.worldReady',20_000);
      await evaluate('window.__blockcolcPerformanceProbe.beginWindow("return")');
      await adbCall('shell','cmd','statusbar','expand-notifications');await pause(700);
      await adbCall('shell','cmd','statusbar','collapse');await pause(150);
      const rect=await evaluate('(()=>{const r=document.querySelector("canvas[data-world-canvas]").getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,s:devicePixelRatio}})()');
      await adbCall('shell','input','touchscreen','swipe',String(Math.round((rect.x+rect.w*.3)*rect.s)),String(Math.round((rect.y+rect.h*.42)*rect.s)),String(Math.round((rect.x+rect.w*.7)*rect.s)),String(Math.round((rect.y+rect.h*.42)*rect.s)),'1200');
      run.shade=await evaluate('(()=>{const p=window.__blockcolcPerformanceProbe;return{state:p.experimentStatus(),probe:p.snapshot(),frames:p.frameTrace()}})()');
      await restore();break;
    }
    for(const [offset,expected,endOffset] of [[-8000,'focus',0],[2000,'break',12000],[14000,'focus',36000],[38000,'break',48000],[50000,'focus',72000]]){
      await pause(experiment.firstEndsAt+offset-deviceTime());
      const state=background?null:await evaluate('window.__blockcolcPerformanceProbe.experimentStatus()');
      const notifications=await notificationState();
      const schedule=background?null:await evaluate('(()=>{const p=JSON.parse(localStorage.getItem("blockcolc-round-plan-v1")??"null"),f=JSON.parse(localStorage.getItem("blockcolc-focus-preferences-v1")??"null");return{authorized:!!p?.automaticContinuation,focusMs:p?.automaticContinuation?.focusDurationMs,breakMs:p?.automaticContinuation?.breakDurationMs,breakEndsAt:p?.breakEndsAt,endAt:p?.endAt,enabled:f?.autoContinueFocus}})()');
      const nativeTrace=background?null:await evaluate('window.__blockcolcNativeTrace');
      // A background WebView can suspend Runtime.evaluate. Native alarm and
      // notification observations must not depend on waking its JS thread.
      const nativeProjection=background?null:await evaluate('JSON.parse(window.BlockcolcPerformance?.timerProjection?.()??"{}")');
      run.phases.push({at:deviceTime(),expected,state,schedule,notifications,nativeTrace,nativeProjection,timerService:await timerServiceState()});
      if(!background&&state.plan?.status!==expected)throw new Error(`Foreground expected ${expected}`);
      if(offset>0&&!notifications.some(n=>n.chronometer&&n.kind===expected&&n.when===experiment.firstEndsAt+endOffset)){
        if(!background)throw new Error(`Foreground notification did not advance to ${expected}`);
        // Complete the finite schedule so delayed OEM dispatch is distinguishable
        // from a lost timeline; retain only our alarm actions and numeric times.
        run.missingPhases??=[];run.missingPhases.push(expected);
        const dump=await adbCall('shell','dumpsys','alarm');
        run.alarmActions??=[];run.alarmActions.push([...dump.matchAll(/com\.blockcolc\.app\.action\.(AUTO_[A-Z_]+|FOCUS_DEADLINE|BREAK_DEADLINE)/g)].map(m=>m[1]));
      }
    }
    await pause(experiment.firstEndsAt+74_000-deviceTime());
    if(locked){await adbCall('shell','input','keyevent','KEYCODE_WAKEUP');await pause(500);await adbCall('shell','input','swipe','600','1800','600','450','400');}
    if(background)await adbCall('shell','am','start','-n',activity);
    run.final=await waitFor('(()=>{const s=window.__blockcolcPerformanceProbe?.experimentStatus();return s?.reportVisible?s:null})()',20_000);
    run.finalNativeProjection=await evaluate('JSON.parse(window.BlockcolcPerformance?.timerProjection?.()??"{}")');
    run.finalTrace=await evaluate('window.__blockcolcNativeTrace');
    if(run.final.historyCount!==experiment.initialHistoryCount+3||run.final.active||run.final.plan?.completedRounds!==3)throw new Error('Completed schedule did not reconcile exactly three rounds');
    run.finalNotifications=await notificationState();if(run.finalNotifications.some(n=>n.chronometer&&n.when<deviceTime()))throw new Error('Expired chronometer still visible');
    run.finalTimerServiceRunning=(await timerServiceState()).running;
    if(run.finalTimerServiceRunning)throw new Error('Automatic timer service outlived the finite plan');
    await restore();
    if(run.missingPhases?.length)throw new Error('Background chronometer did not advance in '+run.missingPhases.length+' phases');
  }
  report.status='completed';
}catch(error){report.status='failed';report.failure=error.message;try{report.diagnosticState=await evaluate('(()=>{let state;try{state=window.__blockcolcPerformanceProbe?.experimentStatus()}catch{}return{isolated:typeof window.__blockcolcDiagnosticStorage==="string",probe:!!window.__blockcolcPerformanceProbe,state,nativeTrace:window.__blockcolcNativeTrace}})()')}catch{}process.exitCode=1;}
finally{
  try{await adbCall('shell','am','start','-n',activity);await restore();
    for(const name of databases){if(!/^blockcolc-diagnostic-[a-f0-9-]{36}$/.test(name))throw new Error('Unsafe database cleanup');await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(${JSON.stringify(name)});r.onsuccess=()=>resolve(true);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Diagnostic database still open'))})`);}
    report.restoredSafety=await evaluate('window.__blockcolcPerformanceProbe?.snapshot()?.safety');
    report.restoredIdle=report.restoredSafety?.idle===true;
    for(const key of ['projectCount','focusHistoryCount','importedBlueprintCount','progressReportCount']){
      if(report.baseline&&report.restoredSafety?.[key]!==report.baseline.safety[key])throw new Error('Original data count changed during cleanup');
    }
    if(!report.restoredIdle)throw new Error('Original idle state was not restored');
    await evaluate('window.__blockcolcPerformanceProbe?.stop()');
  }catch{report.cleanupIncomplete=true;process.exitCode=1;}
  socket?.close();if(forward)await adbCall('forward','--remove',forward).catch(()=>{});
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));console.log(`Native automatic continuation ${report.status}: ${output}`);
}
