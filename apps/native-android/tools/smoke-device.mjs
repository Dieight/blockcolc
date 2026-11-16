import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const [adb,serial,apk,output]=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
if(!adb||!serial||!apk||!output)throw Error('adb serial frozen-apk new-evidence-directory required');
const pkg='com.blockcolc.preview',component=pkg+'/.MainActivity';
await mkdir(output,{recursive:false});
const call=args=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:30000}).trim();
const shell=(...args)=>call(['shell',...args]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const expected=hash(await readFile(apk));
const report={package:pkg,apkSha256:expected,formalAppChanged:false,p1GatePassed:false,cases:[]};
function foreground(){return shell('dumpsys','activity','activities').split('\n').find(line=>line.includes('topResumedActivity='))??'';}
async function ownUi() {
  shell('uiautomator','dump','/data/local/tmp/blockcolc-p1-smoke-ui.xml');
  const xml=shell('cat','/data/local/tmp/blockcolc-p1-smoke-ui.xml');
  const status=xml.match(/text="((?:P1 submitted|ERROR:)[^"]*)"/)?.[1];
  const surface=xml.match(/<node\b[^>]*class="android\.view\.SurfaceView"[^>]*>/)?.[0];
  const box=surface?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  return {status,box:box?.slice(1).map(Number)};
}
async function screenshot(name) {
  const bytes=execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:16*1024*1024});
  await writeFile(path.join(output,name+'.png'),bytes);return hash(bytes);
}
try {
  const current=foreground();
  if(!current.includes(pkg)&&!current.includes('com.android.launcher/'))throw Error('Device is busy in another application');
  const base=shell('pm','path',pkg).split('\n').find(line=>line.startsWith('package:')&&line.endsWith('/base.apk'))?.slice(8);
  if(!base||!base.startsWith('/data/app/'))throw Error('Cannot resolve exact preview base APK');
  const installed=shell('sha256sum',base).split(/\s/)[0];
  if(installed!==expected)throw Error('Installed preview differs from frozen APK');
  report.installedSha256=installed;
  for(const [name,fixture,projection]of [['ocean','ocean',true],['coast','coast',true],['unsupported-gate','ocean',false]]) {
    shell('am','force-stop',pkg);
    const launch=shell('am','start','-W','-n',component,'--es','fixture',fixture,'--ez','projectionOnly',String(projection),'--ez','culling','true');
    const deadline=Date.now()+90000;let ui;
    do {await sleep(1000);ui=await ownUi();if(ui.status)break;}while(Date.now()<deadline);
    if(!ui?.status)throw Error('No completed own-UI state: '+name);
    if(!foreground().includes(pkg))throw Error('Preview lost foreground: '+name);
    if(projection&&!ui.status.startsWith('P1 submitted'))throw Error('Scene rejected: '+ui.status);
    if(!projection&&!ui.status.includes('Unported production programs'))throw Error('Unported shader gate failed');
    const row={name,fixture,projectionOnly:projection,status:ui.status,launch,initialScreenshotSha256:await screenshot(name)};
    if(projection) {
      if(!ui.box)throw Error('No own SurfaceView bounds for gesture');
      const [x0,y0,x1,y1]=ui.box,y=Math.round((y0+y1)/2);
      shell('input','swipe',String(Math.round(x0+(x1-x0)*.4)),String(y),String(Math.round(x0+(x1-x0)*.6)),String(y),'350');
      await sleep(500);row.rotatedScreenshotSha256=await screenshot(name+'-rotated');
      row.note='Screenshots require visual review; whole-PNG hash changes alone are not gesture or performance proof.';
    }
    report.cases.push(row);
  }
  report.foundationSmokePassed=true;
} catch(error) {report.failure=String(error);throw error;}
finally {
  shell('am','force-stop',pkg);
  if(foreground().includes(pkg))shell('input','keyevent','KEYCODE_HOME');
  report.previewStopped=true;
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({cases:report.cases.length,foundationSmokePassed:report.foundationSmokePassed??false,p1GatePassed:false,failure:report.failure??null}));
}
