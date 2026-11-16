import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright';
import {P1_FIXTURES} from './fixture-scope.mjs';

const [adb,serial,apk,output,scope='main']=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
if(!adb||!serial||!apk||!output)throw Error('adb serial frozen-apk new-directory required');
if(!['main','all'].includes(scope))throw Error('Owner fixture scope must be main or all');
const pkg='com.blockcolc.preview',component=pkg+'/.MainActivity';
const call=args=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}).trim();
const shell=(...args)=>call(['shell',...args]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(output,{recursive:false});
const report={kind:'p1-owner-gpu-device',package:pkg,serial,apkSha256:hash(await readFile(apk)),p1GatePassed:false,p2Started:false,cases:[]};
const decoder=await chromium.launch({headless:true}),decodePage=await decoder.newPage();
const foreground=()=>shell('dumpsys','activity','activities').split('\n').find(line=>line.includes('topResumedActivity='))??'';
async function ui(){
  shell('uiautomator','dump','/data/local/tmp/blockcolc-p1-owner-ui.xml');
  return shell('cat','/data/local/tmp/blockcolc-p1-owner-ui.xml');
}
async function waitStatus(prefix){
  const deadline=Date.now()+90000;
  for(;;){
    const xml=await ui(),status=xml.match(/text="((?:P1 submitted|P1 owner-check submitted|ERROR:)[^"]*)"/)?.[1];
    if(status?.startsWith('ERROR:'))throw Error(status);
    if(status?.startsWith(prefix))return {xml,status};
    if(Date.now()>deadline)throw Error('Timed out waiting for '+prefix);
    await sleep(1000);
  }
}
function box(xml,predicate){
  const node=[...xml.matchAll(/<node\b[^>]*>/g)].map(match=>match[0]).find(predicate);
  const values=node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)?.slice(1).map(Number);
  if(!values)throw Error('Own UI target not found');return values;
}
async function screenshot(name){
  const bytes=execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:16*1024*1024});
  await writeFile(path.join(output,name+'.png'),bytes);return {bytes,sha256:hash(bytes)};
}
async function surfaceMetrics(before,after,bounds){
  return decodePage.evaluate(async({before,after,bounds})=>{
    const pixels=async value=>{
      const image=await createImageBitmap(await(await fetch('data:image/png;base64,'+value)).blob());
      const canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);image.close();
      const [x0,y0,x1,y1]=bounds;return context.getImageData(x0,y0,x1-x0,y1-y0).data;
    };
    const a=await pixels(before),b=after?await pixels(after):null,colors=new Set();let changed=0,total=0;
    for(let at=0;at<a.length;at+=16){colors.add(((a[at]>>4)<<8)|((a[at+1]>>4)<<4)|(a[at+2]>>4));
      if(b&&Math.max(Math.abs(a[at]-b[at]),Math.abs(a[at+1]-b[at+1]),Math.abs(a[at+2]-b[at+2]))>4)changed++;total++;}
    return {coarseColors:colors.size,changedFraction:b?changed/total:null,scope:'Blank / motion guard only, not visual parity'};
  },{before:before.toString('base64'),after:after?.toString('base64'),bounds});
}
try{
  if(![pkg,'com.android.launcher/'].some(name=>foreground().includes(name)))throw Error('Device busy in another application');
  const base=shell('pm','path',pkg).split('\n').find(line=>line.startsWith('package:')&&line.endsWith('/base.apk'))?.slice(8);
  if(!base?.startsWith('/data/app/')||shell('sha256sum',base).split(/\s/)[0]!==report.apkSha256)throw Error('Installed preview differs');
  for(const {name:fixture} of P1_FIXTURES.slice(0,scope==='all'?4:2)){
    shell('am','force-stop',pkg);
    shell('am','start','-W','-n',component,'--es','fixture',fixture);
    const ready=await waitStatus('P1 submitted');
    if(!foreground().includes(pkg))throw Error('Preview lost foreground');
    const initial=await screenshot(fixture+'-before');
    const surfaceBounds=box(ready.xml,node=>node.includes('class="android.view.SurfaceView"'));
    const row={fixture,initialStatus:ready.status,initialScreenshotSha256:initial.sha256};report.cases.push(row);
    row.initialSurface=await surfaceMetrics(initial.bytes,null,surfaceBounds);
    if(row.initialSurface.coarseColors<8)throw Error('Blank world surface: '+fixture);
    const [x0,y0,x1,y1]=box(ready.xml,node=>node.includes('text="Verify owner update"'));
    shell('input','tap',String(Math.round((x0+x1)/2)),String(Math.round((y0+y1)/2)));
    const completed=await waitStatus('P1 owner-check submitted');row.finalStatus=completed.status;
    const result=JSON.parse(shell('run-as',pkg,'cat','files/p1-owner-'+fixture+'.json'));
    if(!result.localGpuSwapPassed||!result.failureRolledBack||!result.staleRejectedWithoutAllocation||result.unchangedOtherOwners!==25||!result.updatedFrameSubmittedNs)throw Error('Local GPU gate incomplete');
    if(!result.runtimeEnabled||result.runtimeSeconds<=.1||result.before.runtimeClockUploads<2||!result.firstFrameResources)throw Error('Native visible-world clock did not advance');
    for(const key of ['geometryCreated','geometryDestroyed','textureCreated','textureDestroyed'])
      if(result.firstFrameResources[key]!==result.before[key])throw Error('Runtime rebuilt world resources: '+key);
    row.runtimeSeconds=result.runtimeSeconds;row.runtimeClockUploads=result.before.runtimeClockUploads;
    await writeFile(path.join(output,fixture+'-resources.json'),JSON.stringify(result,null,2));
    row.resourceReport=fixture+'-resources.json';row.unchangedOtherOwners=result.unchangedOtherOwners;
    row.validationAndUploadSubmitMs=result.validationAndUploadSubmitMs;
    const updated=await screenshot(fixture+'-updated');row.updatedScreenshotSha256=updated.sha256;
    row.updateSurface=await surfaceMetrics(initial.bytes,updated.bytes,surfaceBounds);
    if(row.updateSurface.changedFraction<.0001)throw Error('No visible owner replacement: '+fixture);
    const bounds=box(completed.xml,node=>node.includes('class="android.view.SurfaceView"'));
    const [sx0,sy0,sx1,sy1]=bounds,sy=Math.round((sy0+sy1)/2);
    shell('input','swipe',String(Math.round(sx0+(sx1-sx0)*.4)),String(sy),String(Math.round(sx0+(sx1-sx0)*.6)),String(sy),'350');
    await sleep(500);const rotated=await screenshot(fixture+'-updated-rotated');row.rotatedScreenshotSha256=rotated.sha256;
    row.rotationSurface=await surfaceMetrics(updated.bytes,rotated.bytes,surfaceBounds);
    if(row.rotationSurface.changedFraction<.0001)throw Error('No world motion after rotation: '+fixture);
    row.scope='Owner resources plus submitted frame; not screen-presentation latency, dynamic behavior or visual parity.';
    shell('input','keyevent','KEYCODE_BACK');
    const closeDeadline=Date.now()+30000;let retired;
    do{
      try{retired=JSON.parse(shell('run-as',pkg,'cat','files/p1-retire-'+fixture+'.json'));}catch{}
      if(retired?.startedNs>result.updatedFrameSubmittedNs)break;
      if(Date.now()>closeDeadline)throw Error('Missing fresh owner retirement result');
      await sleep(500);
    }while(true);
    if(retired.failure||!retired.engineDestroyed||retired.before.packets<1||retired.after.packets!==0||Object.keys(retired.after.geometries).length||Object.keys(retired.after.textures).length)throw Error('Owner GPU retirement incomplete');
    await writeFile(path.join(output,fixture+'-retired.json'),JSON.stringify(retired,null,2));row.cleanRetirement=true;
  }
  shell('am','force-stop',pkg);
  shell('am','start','-W','-n',component,'--es','fixture','ocean');
  await waitStatus('P1 submitted');
  report.reviewedDefaultAccepted=true;report.unknownProgramRefusalScope='Exact identity / changed shader / attribute and malformed input refusal is covered by core and exporter tests, not a fake corruption of the installed asset.';
  report.ownerGpuChecksPassed=true;report.nonblankUpdateAndOrbitPassed=true;
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{
  await decoder.close();
  shell('am','force-stop',pkg);
  if(foreground().includes(pkg))shell('input','keyevent','KEYCODE_HOME');
  report.previewStopped=true;
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({cases:report.cases.length,ownerGpuChecksPassed:report.ownerGpuChecksPassed??false,failure:report.failure??null,p1GatePassed:false}));
}
