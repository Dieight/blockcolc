import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {P1_FIXTURES} from './fixture-scope.mjs';
const [adb,serial,apk,output,profile='night',cameraPreset='default',scope='main']=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
if(!adb||!serial||!apk||!output||!['night','day','rain','snow'].includes(profile)||!['default','sky','moon'].includes(cameraPreset)||!['main','all'].includes(scope))throw Error('adb serial APK new-directory profile [default|sky|moon] [main|all] required');
const pkg='com.blockcolc.preview',sha=b=>createHash('sha256').update(b).digest('hex');
const call=args=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}).trim();
const shell=(...args)=>call(['shell',...args]),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const foreground=()=>shell('dumpsys','window').split('\n').find(line=>line.includes('mCurrentFocus='))??'';
await mkdir(output,{recursive:false});
const report={kind:'same-device-actual-source-renderer',package:pkg,serial,profile,cameraPreset:cameraPreset??'default',apkSha256:sha(await readFile(apk)),scenes:[],p1GatePassed:false,p2Started:false};
async function ui(){shell('uiautomator','dump','/data/local/tmp/blockcolc-p1-reference.xml');return shell('cat','/data/local/tmp/blockcolc-p1-reference.xml');}
async function ready(prefix){const deadline=Date.now()+120000;
  for(;;){const xml=await ui(),status=xml.match(/text="((?:Reference submitted|Reference owner-check submitted|ERROR:)[^"]*)"/)?.[1];
    if(status?.startsWith('ERROR:'))throw Error(status);if(status?.startsWith(prefix))return xml;
    if(Date.now()>deadline)throw Error('No reference ready callback');await sleep(1000);}
}
try{
  if(![pkg,'com.android.launcher/'].some(n=>foreground().includes(n)))throw Error('Device busy');
  const base=shell('pm','path',pkg).split('\n').find(s=>s.startsWith('package:')&&s.endsWith('/base.apk'))?.slice(8);
  if(!base?.startsWith('/data/app/')||shell('sha256sum',base).split(/\s/)[0]!==report.apkSha256)throw Error('APK mismatch');
  for(const {name:fixture} of P1_FIXTURES.slice(0,scope==='all'?4:2)){
    shell('am','force-stop',pkg);shell('am','start','-W','-n',pkg+'/.MainActivity','--es','fixture',fixture,'--es','profile',profile,'--ez','webReference','true','--ez','skyProbe',String(cameraPreset==='sky'),'--ez','moonProbe',String(cameraPreset==='moon'));
    const xml=await ready('Reference submitted');
    const initial=JSON.parse(shell('run-as',pkg,'cat','files/p1-web-'+fixture+'.json'));
    if(!initial.ready||initial.fixture!==fixture||initial.profile!==profile||initial.width!==720||initial.height!==960)throw Error('Source reference frame/input differs');
    if(cameraPreset==='sky'&&Math.abs(initial.camera.ratio-.9)>1e-6)throw Error('Source probe camera differs');
    const node=[...xml.matchAll(/<node\b[^>]*>/g)].map(x=>x[0]).find(x=>x.includes('text="Verify owner update"'));
    const box=node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)?.slice(1).map(Number);if(!box)throw Error('Missing update button');
    shell('input','tap',String(Math.round((box[0]+box[2])/2)),String(Math.round((box[1]+box[3])/2)));
    await ready('Reference owner-check submitted');
    const result=JSON.parse(shell('run-as',pkg,'cat','files/p1-web-'+fixture+'.json'));
    if(!result.updated||result.fixture!==fixture||result.profile!==profile)throw Error('No actual source update');
    if(!foreground().includes(pkg))throw Error('Reference lost foreground');
    const png=execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{maxBuffer:16*1024*1024,timeout:30000});
    await writeFile(path.join(output,fixture+'.png'),png);report.scenes.push({fixture,...initial,updated:true,screenshotSha256:sha(png)});
    shell('input','keyevent','KEYCODE_BACK');
  }
  report.sourceFramesCaptured=true;
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{shell('am','force-stop',pkg);if(foreground().includes(pkg))shell('input','keyevent','KEYCODE_HOME');
  report.previewStopped=true;await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({captured:report.sourceFramesCaptured??false,scenes:report.scenes.length,failure:report.failure??null}));}
