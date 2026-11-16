import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {captureOwnedMemory} from './device-memory.mjs';

// Deliberately keep the host VM between entries. The orbit benchmark isolates
// its samples with force-stop and cannot by itself prove same-process reentry.
const [adb,serial,apk,output]=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
if(!adb||!serial||!apk||!output)throw Error('adb serial exact-installed-apk new-output required');
const pkg='com.blockcolc.preview',sha=b=>createHash('sha256').update(b).digest('hex');
const shell=(...args)=>execFileSync(adb,['-s',serial,'shell',...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}).trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const focus=()=>shell('dumpsys','window').split('\n').find(s=>s.includes('mCurrentFocus='))??'';
await mkdir(output,{recursive:false});
const report={kind:'p1-native-same-process-reentry',serial,package:pkg,apkSha256:sha(await readFile(apk)),
  toolSha256:sha(await readFile(new URL('./verify-reentry-device.mjs',import.meta.url))),cases:[],p1GatePassed:false};
let pid,lastSubmit=0,lastRetirement=0;
async function status(prefix){const deadline=Date.now()+90000;for(;;){
  if(!focus().includes(pkg))throw Error('Preview lost foreground');
  shell('uiautomator','dump','/data/local/tmp/blockcolc-p1-reentry.xml');
  const xml=shell('cat','/data/local/tmp/blockcolc-p1-reentry.xml'),s=xml.match(/text="((?:P1 submitted|P1 owner-check submitted|ERROR:)[^"]*)"/)?.[1];
  if(s?.startsWith('ERROR:'))throw Error(s);if(s?.startsWith(prefix))return xml;
  if(Date.now()>deadline)throw Error('Reentry did not reach '+prefix);await sleep(750);
}}
try{
  if(![pkg,'com.android.launcher/'].some(s=>focus().includes(s)))throw Error('Phone is busy');
  const base=shell('pm','path',pkg).split('\n').find(s=>s.startsWith('package:')&&s.endsWith('/base.apk'))?.slice(8);
  if(!base?.startsWith('/data/app/')||shell('sha256sum',base).split(/\s/)[0]!==report.apkSha256)throw Error('Installed preview differs');
  shell('am','force-stop',pkg);
  for(const fixture of ['ocean','coast','ocean','coast']){
    const row={fixture,index:report.cases.length};report.cases.push(row);
    row.launch=shell('am','start','-W','-n',pkg+'/.MainActivity','--es','fixture',fixture);
    const xml=await status('P1 submitted'),current=shell('pidof',pkg);
    if(!/^\d+$/.test(current)||pid&&pid!==current)throw Error('Host VM changed during reentry');pid=current;row.pid=Number(pid);
    const node=[...xml.matchAll(/<node\b[^>]*>/g)].map(m=>m[0]).find(s=>s.includes('text="Verify owner update"'));
    const b=node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)?.slice(1).map(Number);if(!b)throw Error('Missing own update target');
    shell('input','tap',String(Math.round((b[0]+b[2])/2)),String(Math.round((b[1]+b[3])/2)));
    await status('P1 owner-check submitted');
    const resource=JSON.parse(shell('run-as',pkg,'cat','files/p1-owner-'+fixture+'.json'));
    if(!resource.localGpuSwapPassed||!resource.failureRolledBack||!resource.staleRejectedWithoutAllocation||resource.updatedFrameSubmittedNs<=lastSubmit)throw Error('No fresh local update');
    lastSubmit=resource.updatedFrameSubmittedNs;
    await writeFile(path.join(output,row.index+'-'+fixture+'-resources.json'),JSON.stringify(resource,null,2));
    row.memory=await captureOwnedMemory(shell,pkg,output,row.index+'-'+fixture);
    row.resourcePack=resource.after.resourcePack??null;row.packets=resource.after.packets;
    shell('input','keyevent','KEYCODE_BACK');
    const deadline=Date.now()+30000;let retired;
    for(;;){try{retired=JSON.parse(shell('run-as',pkg,'cat','files/p1-retire-'+fixture+'.json'));}catch{}
      if(retired?.startedNs>Math.max(lastSubmit,lastRetirement))break;
      if(Date.now()>deadline)throw Error('No fresh engine retirement');await sleep(500);
    }
    if(retired.failure||!retired.engineDestroyed||!retired.colorPipelineRetired||retired.after.packets!==0||Object.keys(retired.after.geometries).length||Object.keys(retired.after.textures).length)throw Error('Reentry leaked renderer resources');
    lastRetirement=retired.startedNs;
    await writeFile(path.join(output,row.index+'-'+fixture+'-retired.json'),JSON.stringify(retired,null,2));
    row.cleanRetirement=true;await sleep(1000);
    row.memoryAfterBack=await captureOwnedMemory(shell,pkg,output,row.index+'-'+fixture+'-after-back',{requireHost:false,allowRetirement:true});
    row.completed=true;
  }
  report.completed=true;report.scope='Four real entries in the same Android host PID, local update and fresh zero-resource engine retirement each time; PSS is observed, no forced GC and no whole-App startup claim.';
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{
  shell('am','force-stop',pkg);if(focus().includes(pkg))shell('input','keyevent','KEYCODE_HOME');
  report.previewStopped=true;await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({completed:report.completed??false,pid,cases:report.cases.length,failure:report.failure??null}));
}
