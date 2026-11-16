import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright';

const [adb,serial,apk,output]=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
if(!adb||!serial||!apk||!output)throw Error('adb serial exact-installed-apk new-directory required');
const pkg='com.blockcolc.preview',sha=b=>createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const call=args=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
const shell=(...args)=>call(['shell',...args]),focus=()=>shell('dumpsys','window').split('\n').find(s=>s.includes('mCurrentFocus='))??'';
const idle=()=>{if(![pkg,'com.android.launcher/'].some(n=>focus().includes(n)))throw Error('Device busy; no foreground interruption');};
const json=name=>JSON.parse(shell('run-as',pkg,'cat','files/'+name+'.json'));
await mkdir(output,{recursive:false});
const report={kind:'p1-native-animal-runtime',serial,package:pkg,apkSha256:sha(await readFile(apk)),cases:[],p1GatePassed:false,p2Started:false};
const browser=await chromium.launch({headless:true}),page=await browser.newPage();
async function ui(){if(!focus().includes(pkg))throw Error('Preview lost foreground');shell('uiautomator','dump','/data/local/tmp/blockcolc-p1-animals.xml');return shell('cat','/data/local/tmp/blockcolc-p1-animals.xml');}
async function ready(prefix){const end=Date.now()+120000;for(;;){const x=await ui();if(x.includes('text="ERROR:'))throw Error(x.match(/text="(ERROR:[^"]+)/)?.[1]??'Preview error');
  if(x.includes('text="'+prefix))return x;if(Date.now()>end)throw Error('No '+prefix);await sleep(800);}}
function bounds(x,text){const n=[...x.matchAll(/<node\b[^>]*>/g)].map(m=>m[0]).find(n=>n.includes(text)),b=n?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)?.slice(1).map(Number);
  if(!b)throw Error('Missing own UI '+text);return b;}
function tap(b){shell('input','tap',String(Math.round((b[0]+b[2])/2)),String(Math.round((b[1]+b[3])/2)));}
function launch(fixture,kind,web,runtime){idle();shell('am','force-stop',pkg);shell('am','start','-W','-n',pkg+'/.MainActivity','--es','fixture',fixture,'--es','profile','day',
  '--es','animalProbe',kind,'--ez','runtime',String(runtime),'--ez','animalOnly','true','--ez','webReference',String(web));}
async function sample(fixture,first=false){const name='p1-runtime-'+fixture,old=first?-1:json(name).sampleId;tap(bounds(await ui(),'text="Sample runtime"'));const end=Date.now()+15000;
  if(first)await ready('P1 runtime sampled');
  for(;;){try{const r=json(name);if(r.sampleId>old&&r.animalProbe)return r;}catch{}if(Date.now()>end)throw Error('No fresh animal sample');await sleep(200);}}
async function png(name){if(!focus().includes(pkg))throw Error('Preview lost foreground');const bytes=execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:16*1024*1024});await writeFile(path.join(output,name+'.png'),bytes);return bytes;}
function unchanged(a,b){for(const key of ['geometryCreated','geometryDestroyed','textureCreated','textureDestroyed','owners'])if(JSON.stringify(a.resources[key])!==JSON.stringify(b.resources[key]))throw Error('Animal motion rebuilt '+key);}
async function difference(a,b,box){return page.evaluate(async({a,b,box})=>{
  const decode=async b=>{const image=await createImageBitmap(await(await fetch('data:image/png;base64,'+b)).blob()),c=new OffscreenCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();return ctx.getImageData(box[0],box[1],box[2]-box[0],box[3]-box[1]).data;};
  const x=await decode(a),y=await decode(b);let changed=0,n=0;for(let i=0;i<x.length;i+=16){if(Math.max(...[0,1,2].map(k=>Math.abs(x[i+k]-y[i+k])))>4)changed++;n++;}return changed/n;
},{a:a.toString('base64'),b:b.toString('base64'),box});}
try{
  idle();const base=shell('pm','path',pkg).split('\n').find(x=>x.startsWith('package:')&&x.endsWith('/base.apk'))?.slice(8);
  if(!base?.startsWith('/data/app/')||shell('sha256sum',base).split(/\s/)[0]!==report.apkSha256)throw Error('Installed APK mismatch');
  for(const [fixture,kind]of [['ocean','bird'],['coast','land'],['coast','fish'],['coast','bird']]){
    const row={fixture,kind},prefix=fixture+'-'+kind;report.cases.push(row);
    launch(fixture,kind,true,false);await ready('Reference submitted');row.reference=json('p1-web-'+fixture);await png(prefix+'-source-frozen');
    if(row.reference.runtimeEnabled||!row.reference.animals?.agents.some(a=>a.kind===kind))throw Error('Frozen source animal is missing');
    launch(fixture,kind,false,false);const xml=await ready('P1 submitted');row.frozen=await sample(fixture,true);await png(prefix+'-native-frozen');
    const native=row.frozen.resources.nativeAnimals,source=row.reference.animals;
    if(row.frozen.runtimeEnabled||native.time!==0||native.count!==source.count||native.agents.length!==source.agents.length)throw Error('Frozen native population/time differs');
    for(const a of source.agents){const b=native.agents.find(x=>x.id===a.id);if(!b||b.kind!==a.kind||b.species!==a.species||a.position.some((v,i)=>Math.abs(v-b.position[i])>1e-6))throw Error('Initial state differs');}
    const box=bounds(xml,'class="android.view.SurfaceView"');
    launch(fixture,kind,false,true);await ready('P1 submitted');const before=await sample(fixture,true),a=await png(prefix+'-motion-before');
    await sleep(kind==='land'?11000:4000);const after=await sample(fixture),b=await png(prefix+'-motion-after');
    unchanged(before,after);const initial=before.resources.nativeAnimals,current=after.resources.nativeAnimals;
    if(!after.animalOnly||after.gpuSkySeconds!==0||after.gpuCloudSeconds!==0||after.gpuWeatherSeconds!==0)throw Error('Animal-only did not freeze other GPU clocks');
    if(current.time<initial.time+2||after.resources.animalUploadFrames<=before.resources.animalUploadFrames+2)throw Error('CPU pose / GPU upload did not advance');
    row.movedIds=current.agents.filter(actor=>actor.kind===kind&&initial.agents.find(x=>x.id===actor.id)?.position.some((v,i)=>Math.abs(v-actor.position[i])>.05)).map(x=>x.id);
    if(!row.movedIds.length)throw Error('Requested animal kind did not move: '+kind);
    row.motionDifference=await difference(a,b,box);if(row.motionDifference<.0001)throw Error('No visible animal scene change');
    row.motion={before,after};row.cameraFollowsDiagnosticActor=true;
    shell('input','keyevent','KEYCODE_BACK');const end=Date.now()+30000;let retired;
    for(;;){try{retired=json('p1-retire-'+fixture);}catch{}if(retired?.startedNs>Number(after.monotonicNs))break;if(Date.now()>end)throw Error('No fresh retirement');await sleep(500);}
    if(retired.failure||!retired.engineDestroyed||retired.after.packets!==0||Object.keys(retired.after.textures).length||Object.keys(retired.after.geometries).length)throw Error('Animal retirement failed');
    row.retirement=retired;row.passed=true;
  }
  report.animalChecksPassed=true;report.scope='Actual initial source states and closeup pictures; native land/fish/bird behavior, live rig uploads, stable GPU identity and Back cleanup. Diagnostic actor-follow camera is not a performance workload. Does not pass P1 by itself.';
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{await browser.close();shell('am','force-stop',pkg);if(focus().includes(pkg))shell('input','keyevent','KEYCODE_HOME');report.previewStopped=true;
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cases:report.cases.length,passed:report.animalChecksPassed??false,failure:report.failure??null}));}
