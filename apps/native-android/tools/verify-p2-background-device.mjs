import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {freshActivityCommit,previewStorage,previewStorageRestored,previewNotificationIds,previewScreenOff,previewCapabilities} from './p2-background-state.mjs';

const [adb,serial,apk,output,policy='restricted',suite='short']=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
const suites=['short','extended','extended-home','lock-auto','lock-zero-rest','deep-idle'];
if(!adb||!serial||!apk||!output||!['restricted','granted','exact-only'].includes(policy)||!suites.includes(suite))throw Error('adb serial exact-installed-preview.apk new-directory [restricted|granted|exact-only] ['+suites.join('|')+'] required');
const pkg='com.blockcolc.preview',component=pkg+'/.MainActivity',runner=pkg+'.test/androidx.test.runner.AndroidJUnitRunner';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const call=args=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:45_000,maxBuffer:8*1024*1024}).trim();
const shell=(...args)=>call(['shell',...args]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
await mkdir(output,{recursive:false});
const report={kind:'p2-background-contract',package:pkg,serial,policy,suite,executedAt:new Date().toISOString(),
  apkSha256:sha(await readFile(apk)),completed:false,cases:[],restored:{database:false},
  scope:'Synthetic preview DB; real Home/lock and same-UID process death. deep-idle explicitly forces global idle only with separate user authorization, then unforces it. Locked cases verify durable completion without claiming a foreground unlock. Not OEM visual certification or full P2 approval. No permission/battery policy changes.'};
const save=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
const preferences=()=>shell('run-as',pkg,'cat','shared_prefs/p2-storage.xml');
const database=xml=>previewStorage(xml).database;
const readJson=name=>JSON.parse(shell('run-as',pkg,'cat','files/'+name));
async function instrument(method,args=[]){
  const log=call(['shell','am','instrument','-w','-e','class','com.blockcolc.preview.P2BackgroundControlTest#'+method,...args,runner]);
  const file=`instrument-${method}-${report.cases.length}.txt`;
  await writeFile(path.join(output,file),log);
  assert.match(log,/OK \(1 test\)/,file);assert.doesNotMatch(log,/FAILURES|INSTRUMENTATION_FAILED/,file);
}
async function settleUntilDeviceDeadline(deadline){
  const before=Date.now(),deviceNow=Number(shell('date','+%s%3N')),after=Date.now();
  assert.ok(Number.isSafeInteger(deviceNow)&&deviceNow>0,'device wall clock');
  const end=performance.now()+Math.max(0,deadline-deviceNow);
  while(performance.now()<end)await sleep(Math.min(800,end-performance.now()));
  return {hostBefore:before,deviceNow,hostAfter:after};
}
function locked(){return /deviceLocked=1/.test(shell('dumpsys','trust').split('User "system_clone"')[0]);}
function ensureUnlocked(){
  shell('input','keyevent','224');
  if(locked()){
    const size=shell('wm','size').match(/Physical size: (\d+)x(\d+)/);assert.ok(size);
    shell('input','swipe',String(Math.round(Number(size[1])*.5)),String(Math.round(Number(size[2])*.8)),String(Math.round(Number(size[1])*.5)),String(Math.round(Number(size[2])*.2)),'350');
  }
  if(locked()){report.needsManualUnlock=true;throw Error('Manual biometric/PIN unlock required; no credentials requested');}
}
function activeOwnNotifications(){
  // Do not store unrelated notification contents or echo them on command failure.
  let text;try{text=shell('dumpsys','notification','--noredact');}catch{throw Error('Cannot inspect active notification section');}
  return previewNotificationIds(text);
}
async function waitLive(predicate,timeout=15_000){
  const end=Date.now()+timeout;let last;
  while(Date.now()<end){try{last=readJson('p2-live.json');if(predicate(last))return last;}catch{}await sleep(300);}
  throw Error('Expected saved preview state not reached: '+JSON.stringify(last&&{phase:last.phase,round:last.round,pid:last.pid}));
}
function validateFacts(prepared,live,count){
  const previous=new Set(JSON.parse(prepared.initial).focusHistory.map(session=>session.id));
  const facts=live.domain.focusHistory.filter(session=>!previous.has(session.id));
  assert.equal(facts.length,count,'new completed facts');assert.equal(new Set(facts.map(s=>s.id)).size,count);
  const start=Date.parse(prepared.startedAt);
  for(let i=0;i<count;i++){
    const fact=facts[i];assert.equal(fact.status,'completed');assert.equal(fact.subtaskId,null);
    assert.equal(Date.parse(fact.startedAt),start+i*(prepared.focusMs+prepared.restMs));
    const duration=Math.min(prepared.focusMs,prepared.exactEndAt?Date.parse(prepared.exactEndAt)-Date.parse(fact.startedAt):Infinity);
    assert.equal(fact.actualDurationMs,duration);assert.equal(fact.plannedDurationMs,duration);assert.equal(fact.deferredSettlement,true);
  }
  assert.equal(live.round,count);assert.equal(live.rounds,prepared.rounds);
  assert.equal(live.domain.activeFocusSession,null);
  assert.equal(live.notices.some(notice=>notice.overdueCountdown),false);
  return facts.map(s=>({id:s.id,startedAt:s.startedAt,completedAt:s.completedAt,duration:s.actualDurationMs}));
}
let original,forcedIdle=false;
function idleState(){
  const raw=shell('dumpsys','deviceidle');
  return {forced:/mForceIdle=true/.test(raw),deep:raw.match(/\bmState=(\w+)/)?.[1],light:raw.match(/\bmLightState=(\w+)/)?.[1]};
}
function leaveForcedIdle(){
  if(!forcedIdle)return;
  shell('dumpsys','deviceidle','unforce');forcedIdle=false;
  report.restored.globalIdle=idleState();assert.equal(report.restored.globalIdle.forced,false,'forced global idle restored');
}
try{
  const base=shell('pm','path',pkg).split('\n').find(line=>line.startsWith('package:')&&line.endsWith('/base.apk'))?.slice(8);
  assert.ok(base);assert.equal(shell('sha256sum',base).split(/\s/)[0],report.apkSha256,'installed preview identity');
  original=preferences();assert.doesNotMatch(original,/name="beforeTest"/,'previous test DB must be restored first');
  await writeFile(path.join(output,'preferences-before.xml'),original);
  const short=[{name:'home-auto',automatic:true,rest:3000,kill:false},{name:'home-manual',automatic:false,rest:3000,kill:false},
    {name:'home-zero-rest',automatic:true,rest:0,kill:false},{name:'process-death',automatic:true,rest:3000,kill:true}];
  const extended=[
    {name:'lock-auto',automatic:true,focus:12000,rest:4000,lock:true},
    {name:'lock-zero-rest',automatic:true,focus:12000,rest:0,lock:true},
    {name:'home-longer',automatic:true,focus:60000,rest:15000},
    {name:'exact-partial-focus',automatic:true,focus:12000,rest:4000,rounds:2,exact:27000},
    {name:'exact-terminal-rest',automatic:true,focus:12000,rest:4000,rounds:1,exact:14500}];
  const cases=suite==='short'?short:suite==='extended'?extended:suite==='extended-home'?extended.filter(s=>!s.lock):
    suite==='deep-idle'?[{name:'deep-idle',automatic:true,focus:12000,rest:4000,lock:true,deep:true}]:extended.filter(s=>s.name===suite);
  for(const spec of cases){
    const entry={name:spec.name,automatic:spec.automatic,restMs:spec.rest,completed:false};report.cases.push(entry);await save();
    try{
      ensureUnlocked();
      await instrument('prepare',['-e','case',spec.name,'-e','focusMs',String(spec.focus??6000),'-e','restMs',String(spec.rest),'-e','rounds',String(spec.rounds??3),'-e','auto',String(spec.automatic),...(spec.exact?['-e','endDurationMs',String(spec.exact)]:[])]);
      const prepared=readJson('p2-prepared-'+spec.name+'.json');await writeFile(path.join(output,spec.name+'-prepared.json'),JSON.stringify(prepared,null,2));
      const seeded=readJson('p2-live.json');
      shell('am','start','-W','-n',component,'--ez','skipWorld','true','--es','p2Run',spec.name);
      // The seed instrumentation's file can still contain the old permission
      // snapshot. Require a real Activity/actor commit, not merely its phase.
      const first=await waitLive(live=>freshActivityCommit(seeded,live,prepared.database));
      await writeFile(path.join(output,spec.name+'-at-start.json'),JSON.stringify({seedRevision:seeded.revision,live:first},null,2));
      entry.capabilities={notify:first.canNotify,exact:first.canScheduleExact};
      assert.deepEqual(entry.capabilities,previewCapabilities(policy),'explicit capability condition must match the real Activity');
      shell('input','keyevent','3');
      if(spec.lock){shell('input','keyevent','223');entry.screen=previewScreenOff(shell('dumpsys','power'));assert.equal(entry.screen.screenOff,true,'actual screen-off transition');}
      if(spec.deep){
        entry.idleBefore=idleState();assert.equal(entry.idleBefore.forced,false,'never take over an existing forced-idle session');
        // This suite is opt-in: the human separately authorized global idle.
        forcedIdle=true;shell('dumpsys','deviceidle','force-idle','deep');entry.idleDuring=idleState();
        assert.equal(entry.idleDuring.forced,true);assert.equal(entry.idleDuring.deep,'IDLE','actual deep Doze, not AOD wakefulness');
      }
      if(spec.kill){
        const pid=shell('pidof',pkg).trim();assert.match(pid,/^\d+$/);assert.ok(shell('cat','/proc/'+pid+'/cmdline').replaceAll('\0','').startsWith(pkg));
        shell('run-as',pkg,'kill','-9',pid);await sleep(400);
        let after='';try{after=shell('pidof',pkg);}catch{}assert.equal(after,'','real process death');entry.killedPid=Number(pid);
      }
      const finalAt=prepared.exactEndAt?Date.parse(prepared.exactEndAt):Date.parse(prepared.startedAt)+prepared.rounds*prepared.focusMs+Math.max(0,prepared.rounds-1)*spec.rest;
      entry.timing=await settleUntilDeviceDeadline(finalAt+2000);
      const before=readJson('p2-live.json');await writeFile(path.join(output,spec.name+'-before-resume.json'),JSON.stringify(before,null,2));
      entry.preResume={phase:before.phase,round:before.round,pid:before.pid,at:before.at};
      entry.activeOwnNotificationIds=activeOwnNotifications();
      assert.equal(entry.activeOwnNotificationIds.includes(2701),false,'no expired live countdown at final deadline');
      if(policy!=='restricted'&&spec.automatic&&!spec.kill&&!spec.deep){assert.equal(before.phase,'REPORT','background phase before resume');validateFacts(prepared,before,prepared.rounds);}
      if(spec.lock&&!spec.deep){
        // A lock experiment need not defeat the keyguard to prove its result.
        // Verify the saved DB independently; foreground catch-up is a separate case.
        await instrument('inspectSavedStateWithoutResumingOrCompletingAnything',['-e','case',spec.name]);
        const inspected=readJson('p2-inspected-'+spec.name+'.json');
        assert.deepEqual(inspected.domain,before.domain,'live projection agrees with durable facts');
        entry.facts=validateFacts(prepared,before,prepared.rounds);entry.phase=before.phase;
        entry.recoveryTrigger='none: persisted completion while locked';entry.completed=true;continue;
      }
      leaveForcedIdle();
      // A denied receiver may defer. Reopening must catch up from saved absolute
      // deadlines without granting new automatic authority or losing any round.
      if(!spec.deep)ensureUnlocked();
      else {shell('input','keyevent','224');entry.recoveryTrigger='Activity restart after leaving forced idle; no keyguard bypass';}
      shell('am','start','-W','-n',component,'--ez','skipWorld','true','--es','p2Run',spec.name+'-resume');
      const expected=spec.automatic?'REPORT':'READY';
      const after=await waitLive(live=>live.database===prepared.database&&live.phase===expected);
      await writeFile(path.join(output,spec.name+'-after-resume.json'),JSON.stringify(after,null,2));
      entry.facts=validateFacts(prepared,after,spec.automatic?prepared.rounds:1);entry.phase=after.phase;entry.completed=true;
    }finally{
      leaveForcedIdle();
      if(/name="beforeTest"/.test(preferences()))await instrument('restoreOriginalPreviewDatabase');
      const restored=preferences();assert.equal(database(restored),database(original));assert.doesNotMatch(restored,/name="beforeTest"/);
      entry.databaseRestored=true;await save();
    }
  }
  report.completed=true;
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{
  try{
    leaveForcedIdle();
    if(original&&/name="beforeTest"/.test(preferences()))await instrument('restoreOriginalPreviewDatabase');
    const actual=preferences();await writeFile(path.join(output,'preferences-after.xml'),actual);
    report.restored.database=Boolean(original)&&previewStorageRestored(original,actual);
    assert.equal(report.restored.database,true);shell('am','force-stop',pkg);shell('input','keyevent','3');
  }catch(error){report.restoreError=String(error);report.completed=false;process.exitCode=1;}
  await save();
}
console.log(JSON.stringify({completed:report.completed,cases:report.cases.map(c=>({name:c.name,completed:c.completed,preResume:c.preResume})),restored:report.restored,failure:report.failure}));
