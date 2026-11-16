import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const [adb,serial,apk,output,opticsProfile,cameraPreset]=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
if(!adb||!serial||!apk||!output)throw Error('adb serial frozen-apk new-directory required');
if(opticsProfile&&!['day','night','fog'].includes(opticsProfile))throw Error('Optics profile must be day, night or fog');
if(cameraPreset&&!['sky','moon'].includes(cameraPreset))throw Error('Unknown camera preset');
const pkg='com.blockcolc.preview';
const call=args=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}).trim();
const shell=(...args)=>call(['shell',...args]);
const hash=value=>createHash('sha256').update(value).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const foreground=()=>shell('dumpsys','window').split('\n').find(line=>line.includes('mCurrentFocus='))??'';
await mkdir(output,{recursive:false});
const report={kind:opticsProfile?'P1-'+opticsProfile+'-surface-optics-device':'P1-face-and-shadow-single-variable-device',package:pkg,serial,
  apkSha256:hash(await readFile(apk)),cameraPreset:cameraPreset??'default',p1GatePassed:false,p2Started:false,scenes:[]};
const browser=await chromium.launch({headless:true}),page=await browser.newPage();
async function ui(){shell('uiautomator','dump','/data/local/tmp/blockcolc-p1-surface-ui.xml');return shell('cat','/data/local/tmp/blockcolc-p1-surface-ui.xml');}
async function waitStatus(prefix){
  const deadline=Date.now()+90000;
  for(;;){const xml=await ui(),status=xml.match(/text="((?:P1 submitted|P1 owner-check submitted|ERROR:)[^"]*)"/)?.[1];
    if(status?.startsWith('ERROR:'))throw Error(status);
    if(status?.startsWith(prefix))return {xml,status};
    if(Date.now()>deadline)throw Error('Preview did not reach '+prefix);await sleep(1000);
  }
}
function bounds(xml,text){
  const node=[...xml.matchAll(/<node\b[^>]*>/g)].map(match=>match[0]).find(node=>node.includes(text));
  const result=node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)?.slice(1).map(Number);
  if(!result)throw Error('Missing own preview target: '+text);return result;
}
async function decode(bytes,box){return page.evaluate(async({png,box})=>{
  const image=await createImageBitmap(await(await fetch('data:image/png;base64,'+png)).blob());
  const canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);image.close();
  const data=context.getImageData(box[0],box[1],box[2]-box[0],box[3]-box[1]).data;
  const rgb=[];for(let at=0;at<data.length;at+=16)rgb.push(data[at],data[at+1],data[at+2]);return rgb;
},{png:bytes.toString('base64'),box});}
function difference(a,b){
  if(a.length!==b.length)throw Error('Surface viewport changed');let changed=0,sum=0,max=0;
  for(let at=0;at<a.length;at+=3){const distance=Math.max(...[0,1,2].map(c=>Math.abs(a[at+c]-b[at+c])));
    if(distance>4)changed++;sum+=distance;max=Math.max(max,distance);}
  return {changedFraction:changed/(a.length/3),meanMaxChannelDelta:sum/(a.length/3),maxChannelDelta:max};
}
try{
  if(![pkg,'com.android.launcher/'].some(name=>foreground().includes(name)))throw Error('Device busy');
  const base=shell('pm','path',pkg).split('\n').find(line=>line.startsWith('package:')&&line.endsWith('/base.apk'))?.slice(8);
  if(!base?.startsWith('/data/app/')||shell('sha256sum',base).split(/\s/)[0]!==report.apkSha256)throw Error('Installed APK mismatch');
  for(const fixture of ['ocean','coast']){
    const scene={fixture,variants:[]};report.scenes.push(scene);const pixels=new Map();let geometrySignature;
    const variants=opticsProfile
      ? [{name:'on',effects:true,shadows:true,optics:true,night:true,fog:true},
          {name:cameraPreset==='moon'?'no-optics':opticsProfile==='night'?'no-night':opticsProfile==='fog'?'no-fog':'no-optics',effects:true,shadows:true,
            optics:cameraPreset!=='moon'&&opticsProfile!=='day',night:opticsProfile==='fog',fog:opticsProfile!=='fog'}]
      : [{name:'on',effects:true,shadows:true,optics:true,night:true},{name:'no-face',effects:false,shadows:true,optics:true,night:true},
          {name:'no-shadow',effects:true,shadows:false,optics:true,night:true}];
    for(const variant of variants){
      shell('am','force-stop',pkg);
      shell('am','start','-W','-n',pkg+'/.MainActivity','--es','fixture',fixture,'--ez','projectionOnly','true',
        '--ez','surfaceEffects',String(variant.effects),'--ez','shadows',String(variant.shadows),
        '--ez','surfaceOptics',String(variant.optics),'--ez','nightReflections',String(variant.night),
        '--ez','fog',String(variant.fog??true),'--ez','runtime','false','--ez','skyProbe',String(cameraPreset==='sky'),'--ez','moonProbe',String(cameraPreset==='moon'));
      const initial=await waitStatus('P1 submitted');
      const button=bounds(initial.xml,'text="Verify owner update"');
      shell('input','tap',String(Math.round((button[0]+button[2])/2)),String(Math.round((button[1]+button[3])/2)));
      const ready=await waitStatus('P1 owner-check submitted');
      const resources=JSON.parse(shell('run-as',pkg,'cat','files/p1-owner-'+fixture+'.json'));
      if(!resources.localGpuSwapPassed||resources.after.surfaceEffectsEnabled!==variant.effects||resources.shadowsEnabled!==variant.shadows)throw Error('Native diagnostic variant differs');
      if(resources.after.surfaceOpticsEnabled!==variant.optics||resources.after.nightReflectionsEnabled!==variant.night)throw Error('Optics diagnostic differs');
      if(resources.after.fogEnabled!==(variant.fog??true))throw Error('Fog diagnostic differs');
      const applied=resources.after.surfaceCoverage.filter(row=>row.applied.includes('face-and-edge-v1')).length;
      if(applied<1)throw Error('No reviewed source face operation');
      const signature=JSON.stringify(Object.entries(resources.after.owners).map(([owner,draws])=>[owner,draws.map(draw=>[draw.geometry,draw.texture,draw.instances])]));
      if(geometrySignature&&geometrySignature!==signature)throw Error('A/B changed geometry, textures or instances');geometrySignature=signature;
      if(!foreground().includes(pkg))throw Error('Preview lost foreground');
      const bytes=execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:16*1024*1024});
      const name=fixture+'-'+variant.name;await writeFile(path.join(output,name+'.png'),bytes);
      await writeFile(path.join(output,name+'.json'),JSON.stringify(resources,null,2));
      const box=bounds(ready.xml,'class="android.view.SurfaceView"');pixels.set(variant.name,await decode(bytes,box));
      scene.variants.push({...variant,appliedMaterialCount:applied,screenshotSha256:hash(bytes),surfaceBounds:box,resourceReport:name+'.json'});
      shell('input','keyevent','KEYCODE_BACK');
      const deadline=Date.now()+30000;let retired;
      do{try{retired=JSON.parse(shell('run-as',pkg,'cat','files/p1-retire-'+fixture+'.json'));}catch{}
        if(retired?.startedNs>resources.updatedFrameSubmittedNs)break;
        if(Date.now()>deadline)throw Error('No fresh retirement');await sleep(500);
      }while(true);
      if(retired.failure||!retired.engineDestroyed||!retired.colorPipelineRetired||retired.after.packets!==0||Object.keys(retired.after.geometries).length||Object.keys(retired.after.textures).length)throw Error('Retirement failed');
      await writeFile(path.join(output,name+'-retired.json'),JSON.stringify(retired,null,2));
    }
    if(opticsProfile){
      scene.opticsDifference=difference(pixels.get('on'),pixels.get(cameraPreset==='moon'?'no-optics':opticsProfile==='night'?'no-night':opticsProfile==='fog'?'no-fog':'no-optics'));
      if(scene.opticsDifference.changedFraction<.0001)throw Error('Source optics has no visible effect');
    }else{
      scene.faceDifference=difference(pixels.get('on'),pixels.get('no-face'));
      scene.shadowDifference=difference(pixels.get('on'),pixels.get('no-shadow'));
      if(scene.faceDifference.changedFraction<.0001||scene.shadowDifference.changedFraction<.0001)throw Error('Face or shadow has no visible effect');
    }
  }
  report.singleVariableChecksPassed=true;
  report.scope='Same raw geometry/texture/instance input; explicit face/shadow/optics switches. Optics includes shader vertex displacement. Not whole-scene parity or a performance benchmark.';
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{
  await browser.close();shell('am','force-stop',pkg);if(foreground().includes(pkg))shell('input','keyevent','KEYCODE_HOME');
  report.previewStopped=true;await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({scenes:report.scenes.length,passed:report.singleVariableChecksPassed??false,failure:report.failure??null,p1GatePassed:false}));
}
