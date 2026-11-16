import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright';
const [adb,serial,apk,output,profile]=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
if(!adb||!serial||!apk||!output||!['rain','snow'].includes(profile))throw Error('adb serial exact-installed-apk new-directory rain/snow required');
const pkg='com.blockcolc.preview',sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>createHash('sha256').update(b).digest('hex');
const call=args=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}).trim();
const shell=(...args)=>call(['shell',...args]),focus=()=>shell('dumpsys','window').split('\n').find(s=>s.includes('mCurrentFocus='))??'';
await mkdir(output,{recursive:false});
const report={kind:'p1-precipitation-native-runtime-device',package:pkg,serial,profile,apkSha256:sha(await readFile(apk)),scenes:[],p1GatePassed:false,p2Started:false};
const browser=await chromium.launch({headless:true}),page=await browser.newPage();
async function ui(){shell('uiautomator','dump','/data/local/tmp/blockcolc-p1-weather.xml');return shell('cat','/data/local/tmp/blockcolc-p1-weather.xml');}
async function ready(prefix){const deadline=Date.now()+90000;for(;;){
  const xml=await ui();if(xml.includes('text="ERROR:'))throw Error(xml.match(/text="(ERROR:[^"]+)/)?.[1]??'Preview failure');
  if(xml.includes('text="'+prefix))return xml;if(Date.now()>deadline)throw Error('Preview did not reach '+prefix);await sleep(1000);
}}
function bounds(xml,text){const node=[...xml.matchAll(/<node\b[^>]*>/g)].map(m=>m[0]).find(n=>n.includes(text));
  const b=node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)?.slice(1).map(Number);if(!b)throw Error('Own target missing '+text);return b;}
function tap(b){shell('input','tap',String(Math.round((b[0]+b[2])/2)),String(Math.round((b[1]+b[3])/2)));}
async function png(name){if(!focus().includes(pkg))throw Error('Preview lost foreground');
  const bytes=execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:16*1024*1024});await writeFile(path.join(output,name+'.png'),bytes);return bytes;}
function json(name){return JSON.parse(shell('run-as',pkg,'cat','files/'+name+'.json'));}
async function sample(fixture){const prior=json('p1-runtime-'+fixture).sampleId;const xml=await ui();tap(bounds(xml,'text="Sample runtime"'));
  const deadline=Date.now()+15000;
  for(;;){const result=json('p1-runtime-'+fixture);if(result.sampleId>prior){await ready('P1 runtime sampled');return result;}
    if(Date.now()>deadline)throw Error('No fresh native sample');await sleep(200);}}
async function firstSample(fixture){tap(bounds(await ui(),'text="Sample runtime"'));await ready('P1 runtime sampled');return json('p1-runtime-'+fixture);}
function resourcesUnchanged(a,b){for(const key of ['geometryCreated','geometryDestroyed','textureCreated','textureDestroyed','owners'])
  if(JSON.stringify(a.resources[key])!==JSON.stringify(b.resources[key]))throw Error('Motion rebuilt '+key);}
function launch(fixture,web,runtime,only=false){
  if(![pkg,'com.android.launcher/'].some(n=>focus().includes(n)))throw Error('Device became busy');shell('am','force-stop',pkg);
  shell('am','start','-W','-n',pkg+'/.MainActivity','--es','fixture',fixture,'--es','profile',profile,'--ez','webReference',String(web),
    '--ez','runtime',String(runtime),'--ez','weatherOnly',String(only));}
try{
  if(![pkg,'com.android.launcher/'].some(n=>focus().includes(n)))throw Error('Device busy');
  const base=shell('pm','path',pkg).split('\n').find(s=>s.startsWith('package:')&&s.endsWith('/base.apk'))?.slice(8);
  if(!base?.startsWith('/data/app/')||shell('sha256sum',base).split(/\s/)[0]!==report.apkSha256)throw Error('APK mismatch');
  for(const fixture of ['ocean','coast']){
    const row={fixture};report.scenes.push(row);
    launch(fixture,true,false);await ready('Reference submitted');const reference=json('p1-web-'+fixture);
    const weather=reference.weather?.animations?.[0];if(!weather||weather.kind!==profile||reference.runtimeEnabled||weather.elapsedMs!==0)throw Error('Source profile is not frozen');
    row.reference=reference;await png(fixture+'-source-frozen');
    launch(fixture,false,false);const xml=await ready('P1 submitted');const frozen=await firstSample(fixture);
    if(frozen.runtimeEnabled||frozen.weatherSeconds!==0||frozen.resources.precipitationPackets<1)throw Error('Native frozen weather missing');
    for(const key of ['centerX','centerZ','spanX','spanZ'])if(Math.abs(frozen.resources.precipitationField[key]-weather.field[key])>.001)throw Error('Native source weather field differs: '+key);
    if(frozen.resources.precipitationActiveCount!==weather.activeCount||Math.abs(frozen.resources.precipitationSize-weather.size)>.01)throw Error('Density/cross-section differs');
    row.frozen=frozen;await png(fixture+'-native-frozen');row.surfaceBounds=bounds(xml,'class="android.view.SurfaceView"');
    launch(fixture,false,true,true);await ready('P1 submitted');const before=await firstSample(fixture),a=await png(fixture+'-motion-before');
    await sleep(1700);const after=await sample(fixture),b=await png(fixture+'-motion-after');
    if(!after.weatherOnly||after.weatherSeconds<=before.weatherSeconds+1.5)throw Error('Precipitation time did not advance');resourcesUnchanged(before,after);
    row.motionDifference=await page.evaluate(async({a,b,box})=>{
      const decode=async bytes=>{const bitmap=await createImageBitmap(await(await fetch('data:image/png;base64,'+bytes)).blob());const c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();return ctx.getImageData(box[0],box[1],box[2]-box[0],box[3]-box[1]).data;};
      const x=await decode(a),y=await decode(b);let changed=0,n=0;for(let at=0;at<x.length;at+=16){if(Math.max(...[0,1,2].map(c=>Math.abs(x[at+c]-y[at+c])))>4)changed++;n++;}return changed/n;
    },{a:a.toString('base64'),b:b.toString('base64'),box:row.surfaceBounds});
    if(row.motionDifference<.0001)throw Error('Weather-only motion is not visible');
    const box=row.surfaceBounds,cx=Math.round((box[0]+box[2])/2),cy=Math.round((box[1]+box[3])/2);
    shell('input','swipe',String(cx-160),String(cy),String(cx+160),String(cy),'700');
    shell('input','swipe',String(cx),String(cy+160),String(cx),String(cy-160),'700');
    const moved=await sample(fixture);resourcesUnchanged(after,moved);await png(fixture+'-orbit-and-zoom');
    if(moved.resources.precipitationFieldSyncs<=after.resources.precipitationFieldSyncs||moved.resources.precipitationActiveCount===after.resources.precipitationActiveCount)throw Error('Camera did not update physical field/density');
    row.motion={before,after,moved};shell('input','keyevent','KEYCODE_BACK');
    const deadline=Date.now()+30000;let retired;
    for(;;){try{retired=json('p1-retire-'+fixture);}catch{}
      if(retired?.startedNs>Number(moved.monotonicNs))break;if(Date.now()>deadline)throw Error('No fresh retirement');await sleep(500);}
    if(retired.failure||!retired.engineDestroyed||retired.after.packets!==0||Object.keys(retired.after.textures).length||Object.keys(retired.after.geometries).length)throw Error('Weather retirement failed');
    row.retirement=retired;
  }
  report.weatherChecksPassed=true;
  report.scope='Frozen actual-source fields, weather-only visible motion, camera volume/count updates, resource identity and Back retirement. Not the final animal/weather performance gate.';
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{await browser.close();shell('am','force-stop',pkg);if(focus().includes(pkg))shell('input','keyevent','KEYCODE_HOME');report.previewStopped=true;
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({scenes:report.scenes.length,passed:report.weatherChecksPassed??false,failure:report.failure??null}));}
