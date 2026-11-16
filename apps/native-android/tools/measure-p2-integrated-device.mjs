import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {captureOwnedMemory} from './device-memory.mjs';
import {previewStorageRestored} from './p2-background-state.mjs';
import {summarizeP2Operation} from './p2-cost-summary.mjs';

const [adb,serial,apk,output,repeats='5',fixtureScope='both']=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
if(!adb||!serial||!apk||!output||!['1','5'].includes(repeats)||!['ocean','coast','both'].includes(fixtureScope))throw Error('adb serial installed-preview.apk new-output [1|5] [ocean|coast|both]');
const pkg='com.blockcolc.preview',sleep=ms=>new Promise(r=>setTimeout(r,ms));
const call=(args,timeout=45000,encoding='utf8')=>execFileSync(adb,['-s',serial,...args],{encoding,timeout,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
const shell=(...args)=>call(['shell',...args]).trim(),sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
await mkdir(output,{recursive:false});
const result={kind:'p2-integrated-closed-path-cost',completed:false,serial,package:pkg,apkSha256:sha(await readFile(apk)),repeats:Number(repeats),fixtures:fixtureScope==='both'?['ocean','coast']:[fixtureScope],cases:[],restored:{database:false},
  scope:'Matched Compose controls, 25-building active world, MC pack, fixed 720x960, day/cloudy/animals; actual actor+SQLite+Filament versus formal ApplicationService+IndexedDB+production Three setWorlds. Same virtual business instants/IDs, real performance clocks. Excludes seeding, React shell, whole-final-App cold startup and general native world generation. Prepared first-workshop cache cost reported separately.'};
const preferences=()=>shell('run-as',pkg,'cat','shared_prefs/p2-storage.xml');
async function instrument(method,options=[]){
 const log=call(['shell','am','instrument','-w','-e','class',method,...options,pkg+'.test/androidx.test.runner.AndroidJUnitRunner'],90000);
 assert.match(log,/OK \(1 test\)/);assert.doesNotMatch(log,/FAILURES|INSTRUMENTATION_FAILED/);return log;
}
async function live(run,predicate,timeout=180000){
 const end=performance.now()+timeout;let last;
 while(performance.now()<end){try{last=JSON.parse(shell('run-as',pkg,'cat','files/p2-cost-'+run+'.json'));
   if(last.failed)throw Error(last.failed);if(predicate(last))return last;}catch(error){if(last?.failed)throw error;}await sleep(350);}
 throw Error('P2 cost deadline: '+JSON.stringify(last&&{phase:last.phase,sequence:last.sequence,ready:last.ready}));
}
function focused(){return shell('dumpsys','window').split('\n').find(l=>l.includes('mCurrentFocus='))??'';}
function click(action){
 assert.ok(focused().includes(pkg),'measurement stays in the isolated preview');
 shell('uiautomator','dump','/sdcard/p2-cost-controls.xml');const xml=shell('cat','/sdcard/p2-cost-controls.xml');
 const node=[...xml.matchAll(/<node\b[^>]*>/g)].map(x=>x[0]).find(x=>x.includes('content-desc="cost-'+action+'"'));
 assert.ok(node,'real button '+action);assert.ok(node.includes('enabled="true"'),'enabled button '+action);
 const b=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert.ok(b);
 shell('input','tap',String(Math.round((+b[1]+ +b[3])/2)),String(Math.round((+b[2]+ +b[4])/2)));
}
function surface(backend){
 const rows=shell('dumpsys','SurfaceFlinger','--list').split('\n');
 const re=backend==='native'?/(?:RequestedLayerState\{)?([0-9a-f]+ SurfaceView\[com\.blockcolc\.preview\/com\.blockcolc\.preview\.P2CostActivity\]\(BLAST\)#\d+)/:
   /^(?:RequestedLayerState\{)?(com\.blockcolc\.preview\/com\.blockcolc\.preview\.P2CostActivity#\d+)/;
 const name=rows.map(l=>l.match(re)?.[1]).filter(Boolean).at(-1);assert.ok(name,'actual world surface');return name;
}
async function presentAfter(layer,submitted){
 const limit=9223372036854775807n,after=BigInt(submitted);
 const end=performance.now()+3000;let polls=0,rows;
 do{polls++;
 rows=shell('dumpsys','SurfaceFlinger','--latency',"'"+layer+"'").split('\n').map(l=>l.match(/^(\d+)\s+(\d+)\s+(\d+)\s*$/)).filter(Boolean)
   .map(m=>({desiredNs:m[1],actualNs:m[2],readyNs:m[3]})).filter(r=>BigInt(r.actualNs)>=after&&BigInt(r.actualNs)<limit&&BigInt(r.readyNs)>0n&&BigInt(r.readyNs)<limit)
   .sort((a,b)=>BigInt(a.actualNs)<BigInt(b.actualNs)?-1:1);
 if(rows.length)return {...rows[0],polls};await sleep(150);
 }while(performance.now()<end);
 throw Error('No actual presentation fence after submitted update within 3s; no rAF substitution');
}
let original;
try{
 const base=shell('pm','path',pkg).split('\n').find(l=>l.startsWith('package:')&&l.endsWith('/base.apk'))?.slice(8);
 assert.ok(base);assert.equal(shell('sha256sum',base).split(/\s/)[0],result.apkSha256);
 original=preferences();assert.doesNotMatch(original,/name="beforeTest"/);await writeFile(path.join(output,'preferences-before.xml'),original);
 const notificationState=shell('dumpsys','package',pkg).split('\n').find(l=>l.includes('android.permission.POST_NOTIFICATIONS: granted='));
 assert.ok(notificationState);result.platformAtStart={notificationsGranted:/granted=true/.test(notificationState),exactAlarm:shell('appops','get',pkg,'SCHEDULE_EXACT_ALARM')};
 assert.equal(/deviceLocked=1/.test(shell('dumpsys','trust').split('User "system_clone"')[0]),false,'manual unlock before measurement');
 for(let pair=0;pair<Number(repeats);pair++)for(const fixture of result.fixtures){
   const baseTime=Number(shell('date','+%s%3N'))+3600000,pairFinal=[];
   for(const backend of (pair%2===0?['native','web']:['web','native'])){
    const run=fixture+'-'+backend+'-'+pair+'-'+Date.now(),entry={run,fixture,backend,pair,completed:false};result.cases.push(entry);
    await writeFile(path.join(output,'report.json'),JSON.stringify(result,null,2));
    assert.equal(/deviceLocked=1/.test(shell('dumpsys','trust').split('User "system_clone"')[0]),false,'phone unlocked');
    entry.batteryBefore=shell('dumpsys','battery').split('\n').filter(l=>/level:|temperature:/.test(l));
    shell('am','force-stop',pkg);
    if(backend==='native')await writeFile(path.join(output,run+'-prepare.txt'),await instrument('com.blockcolc.preview.P2CostControlTest#prepare'));
    shell('am','force-stop',pkg);
    entry.launch=shell('am','start','-W','-n',pkg+'/.MainActivity','--es','fixture',fixture,'--es','costBackend',backend,'--es','costRun',run,'--el','businessBase',String(baseTime));
    const first=await live(run,r=>r.ready&&r.initial&&r.worldSubmittedNs&&r.activityCreatedNs);entry.initial=first;entry.surface=surface(backend);
    entry.firstPresent=await presentAfter(entry.surface,first.worldSubmittedNs);
    await writeFile(path.join(output,run+'-initial.png'),call(['exec-out','screencap','-p'],45000,null));
    if(backend==='native')entry.runtime=JSON.parse(shell('run-as',pkg,'cat','files/p1-runtime-'+fixture+'.json'));
    await sleep(2500);
    entry.memory=await captureOwnedMemory(shell,pkg,output,run,{requireWebView:backend==='web'});
    for(const action of ['start','early','start','early','start','early','report']){
      const previous=action==='start'&&entry.actions===undefined?0:(entry.actions?.length??0);click(action);
      const value=await live(run,r=>r.sequence===previous+1);
      entry.actions??=[];const op=value.operations.at(-1);assert.equal(op.action,action);summarizeP2Operation(op,backend);entry.actions.push(op);
      if(action==='report'){
        let submitted=op.worldSubmittedNs;
        if(backend==='native'){
          const end=performance.now()+45000;let update;
          do{try{update=JSON.parse(shell('run-as',pkg,'cat','files/p2-construction-'+fixture+'.json'));}catch{}
            if(update?.progress===2500&&BigInt(update.updatedFrameSubmittedNs)>BigInt(op.inputNs))break;
            await sleep(100);
          }while(performance.now()<end);
          assert.ok(update?.progress===2500&&BigInt(update.updatedFrameSubmittedNs)>BigInt(op.inputNs),'new owner update, not a stale file');
          entry.worldUpdate=update;submitted=String(update.updatedFrameSubmittedNs);
        }
        entry.ownerPresent=await presentAfter(entry.surface,submitted);
        entry.reportInputToPresentMs=Number(BigInt(entry.ownerPresent.actualNs)-BigInt(op.inputNs))/1e6;
      }
    }
    click('stats');const last=await live(run,r=>r.completed===true&&r.sequence===8&&r.commonUiFrames?.some(f=>f.kind==='saved-state'&&f.sequence===8));entry.final=last;
    const file=path.resolve(output,run+'.json');await writeFile(file,JSON.stringify(last,null,2));
    const replay=execFileSync(process.execPath,[fileURLToPath(new URL('./replay-p2-device.mjs',import.meta.url)),file,path.resolve(output,run+'-formal-replay.json')],{encoding:'utf8',timeout:90000});
    entry.replay=JSON.parse(replay.trim());assert.equal(entry.replay.completed,true);pairFinal.push(last.final);
    entry.resourcePack=backend==='native'?entry.worldUpdate.after.resourcePack:last.world.resourcePack;
    const comparison=result.cases.find(e=>e!==entry&&e.resourcePack);
    if(comparison)for(const key of ['kind','sha256','bytes','wireSha256'])assert.equal(entry.resourcePack[key],comparison.resourcePack[key],'same controlled material input');
    if(backend==='web'){
      assert.equal(last.canvas.contextLost,false);assert.equal(last.canvas.hidden,false);assert.equal(last.canvas.width,720);assert.equal(last.canvas.height,960);
      assert.ok(last.canvas.render.triangles>0,'actual source geometry still rendered');
      assert.equal(last.world.diagnostics.requestedLightingQuality,'cinematic');assert.equal(last.world.diagnostics.activeLightingQuality,'cinematic');
      assert.equal(first.world.diagnostics.animals.ready,true);assert.equal(last.world.diagnostics.animals.ready,true,'source animals finished rebuilding');
      assert.equal(last.world.diagnostics.animals.count,first.world.diagnostics.animals.count);assert.ok(last.world.diagnostics.animals.count>0);
      assert.ok(last.world.diagnostics.animationFrameUpdateCount>first.world.diagnostics.animationFrameUpdateCount);
    }else{
      assert.equal(entry.runtime.runtimeEnabled,true);
      assert.equal(entry.worldUpdate.after.nativeAnimals.count,entry.runtime.resources.nativeAnimals.count);assert.ok(entry.worldUpdate.after.nativeAnimals.count>0);
      assert.ok(entry.worldUpdate.after.nativeAnimals.updates>entry.runtime.resources.nativeAnimals.updates);
      assert.ok(entry.worldUpdate.after.atlasUploadFrames>entry.runtime.resources.atlasUploadFrames);
      assert.ok(entry.worldUpdate.after.runtimeClockUploads>entry.runtime.resources.runtimeClockUploads);
    }
    await writeFile(path.join(output,run+'.png'),call(['exec-out','screencap','-p'],45000,null));
    entry.batteryAfter=shell('dumpsys','battery').split('\n').filter(l=>/level:|temperature:/.test(l));entry.completed=true;
    shell('am','force-stop',pkg);
    if(backend==='native')await writeFile(path.join(output,run+'-restore.txt'),await instrument('com.blockcolc.preview.P2BackgroundControlTest#restoreOriginalPreviewDatabase'));
    shell('am','force-stop',pkg);shell('input','keyevent','3');await sleep(1500);
   }
   assert.equal(pairFinal.length,2);assert.equal(canonical(JSON.parse(pairFinal[0])),canonical(JSON.parse(pairFinal[1])),'both real complete domain outputs match exactly');
 }
 result.completed=true;
}catch(error){result.failure=String(error);process.exitCode=1;}
finally{
 try{
  if(original&&/name="beforeTest"/.test(preferences()))await instrument('com.blockcolc.preview.P2BackgroundControlTest#restoreOriginalPreviewDatabase');
  const after=preferences();await writeFile(path.join(output,'preferences-after.xml'),after);result.restored.database=Boolean(original)&&previewStorageRestored(original,after);assert.equal(result.restored.database,true);
  shell('am','force-stop',pkg);shell('input','keyevent','3');
 }catch(error){result.restoreError=String(error);result.completed=false;process.exitCode=1;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(result,null,2));
}
console.log(JSON.stringify({completed:result.completed,failure:result.failure,cases:result.cases.map(e=>({fixture:e.fixture,backend:e.backend,completed:e.completed,reportMs:e.reportInputToPresentMs})),restored:result.restored}));
