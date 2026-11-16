import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import * as THREE from 'three';

const [adb,serial,apk,input,output]=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
if(!adb||!serial||!apk||!input||!output)throw Error('adb serial installed-apk source-inputs new-directory required');
const pkg='com.blockcolc.preview',hash=value=>createHash('sha256').update(value).digest('hex');
const call=args=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}).trim();
const shell=(...args)=>call(['shell',...args]),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const foreground=()=>shell('dumpsys','window').split('\n').find(line=>line.includes('mCurrentFocus='))??'';
await mkdir(output,{recursive:false});
const metadata=JSON.parse(await readFile(path.join(input,'ocean.world.json'),'utf8'));
const report={kind:'P1-native-HDR-ACES-sRGB-device-probe',package:pkg,serial,apkSha256:hash(await readFile(apk)),
  sourceExposure:metadata.environment.exposure,p1GatePassed:false,p2Started:false};
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),page=await browser.newPage();
async function ui(){shell('uiautomator','dump','/data/local/tmp/blockcolc-p1-color-ui.xml');return shell('cat','/data/local/tmp/blockcolc-p1-color-ui.xml');}
async function ready(prefix){const deadline=Date.now()+90000;
  for(;;){const xml=await ui(),status=xml.match(/text="((?:P1 submitted|P1 owner-check submitted|ERROR:)[^"]*)"/)?.[1];
    if(status?.startsWith('ERROR:'))throw Error(status);if(status?.startsWith(prefix))return xml;
    if(Date.now()>deadline)throw Error('No fresh color probe frame');await sleep(1000);}
}
function bounds(xml,match){const node=[...xml.matchAll(/<node\b[^>]*>/g)].map(row=>row[0]).find(node=>node.includes(match));
  const box=node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)?.slice(1).map(Number);if(!box)throw Error('Own target missing');return box;}
try{
  if(![pkg,'com.android.launcher/'].some(name=>foreground().includes(name)))throw Error('Device busy');
  const base=shell('pm','path',pkg).split('\n').find(line=>line.startsWith('package:')&&line.endsWith('/base.apk'))?.slice(8);
  if(!base?.startsWith('/data/app/')||shell('sha256sum',base).split(/\s/)[0]!==report.apkSha256)throw Error('Installed APK mismatch');
  shell('am','force-stop',pkg);shell('am','start','-W','-n',pkg+'/.MainActivity','--es','fixture','ocean','--ez','projectionOnly','true','--ez','colorProbe','true');
  const initial=await ready('P1 submitted'),button=bounds(initial,'text="Verify owner update"');
  shell('input','tap',String(Math.round((button[0]+button[2])/2)),String(Math.round((button[1]+button[3])/2)));
  const xml=await ready('P1 owner-check submitted'),resources=JSON.parse(shell('run-as',pkg,'cat','files/p1-owner-ocean.json'));
  if(!resources.colorProbe||resources.colorPipeline!=='linear-hdr-to-three-aces-srgb')throw Error('Native HDR probe not active');
  const png=execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:16*1024*1024});
  await writeFile(path.join(output,'color-probe.png'),png);report.screenshotSha256=hash(png);
  const surface=bounds(xml,'class="android.view.SurfaceView"');report.surfaceBounds=surface;
  report.comparison=await page.evaluate(async({png,bounds,exposure,tone,transfer})=>{
    const image=await createImageBitmap(await(await fetch('data:image/png;base64,'+png)).blob()),canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d');
    context.drawImage(image,0,0);image.close();
    const gl=document.createElement('canvas').getContext('webgl2',{antialias:false});if(!gl)throw Error('No reference WebGL2');
    const compile=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const v=compile(gl.VERTEX_SHADER,`#version 300 es
      void main(){gl_Position=vec4(float((gl_VertexID<<1)&2)*2.-1.,float(gl_VertexID&2)*2.-1.,0,1);}`);
    const f=compile(gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float;\n${tone}\n${transfer}\nuniform vec3 inputColor;out vec4 color;
      void main(){color=sRGBTransferOETF(vec4(ACESFilmicToneMapping(inputColor),1));}`);
    const program=gl.createProgram();gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);gl.viewport(0,0,1,1);gl.bindVertexArray(gl.createVertexArray());gl.uniform1f(gl.getUniformLocation(program,'toneMappingExposure'),exposure);
    const samples=[];let maxDelta=0,totalDelta=0;
    for(let screenRow=0;screenRow<8;screenRow++)for(let column=0;column<8;column++){
      const row=7-screenRow,value=2**(column-6),tints=[[1,1,1],[1,0,0],[0,1,0],[0,0,1],[1,.5,.1],[.1,.5,1],[.2,1,.3],[0,0,0]],input=tints[row].map(v=>v*value);
      gl.uniform3fv(gl.getUniformLocation(program,'inputColor'),input);gl.drawArrays(gl.TRIANGLES,0,3);
      const expected=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,expected);
      const x=Math.round(bounds[0]+(column+.5)*(bounds[2]-bounds[0])/8),y=Math.round(bounds[1]+(screenRow+.5)*(bounds[3]-bounds[1])/8);
      const actual=context.getImageData(x,y,1,1).data;
      const delta=Math.max(...[0,1,2].map(c=>Math.abs(expected[c]-actual[c])));maxDelta=Math.max(maxDelta,delta);totalDelta+=delta;
      samples.push({screenRow,column,input,expected:[...expected].slice(0,3),actual:[...actual].slice(0,3),delta});
    }
    gl.deleteProgram(program);gl.deleteShader(v);gl.deleteShader(f);
    return {samples,maxChannelDelta:maxDelta,meanMaxChannelDelta:totalDelta/64};
  },{png:png.toString('base64'),bounds:surface,exposure:report.sourceExposure,
    tone:THREE.ShaderChunk.tonemapping_pars_fragment,transfer:THREE.ShaderChunk.colorspace_pars_fragment});
  if(report.comparison.maxChannelDelta>3)throw Error('Native HDR / transfer differs from actual source shader: '+report.comparison.maxChannelDelta);
  shell('input','keyevent','KEYCODE_BACK');const deadline=Date.now()+30000;let retired;
  do{try{retired=JSON.parse(shell('run-as',pkg,'cat','files/p1-retire-ocean.json'));}catch{}
    if(retired?.startedNs>resources.updatedFrameSubmittedNs)break;
    if(Date.now()>deadline)throw Error('No fresh retirement');await sleep(500);
  }while(true);
  if(retired.failure||!retired.engineDestroyed||!retired.colorPipelineRetired)throw Error('Color pipeline not retired');
  report.colorTransferPassed=true;report.cleanRetirement=true;
  report.scope='64 HDR color patches through a real native render target and terminal shader, compared to the production Three shader; not whole-world visual parity.';
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{await browser.close();shell('am','force-stop',pkg);if(foreground().includes(pkg))shell('input','keyevent','KEYCODE_HOME');
  report.previewStopped=true;await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.colorTransferPassed??false,maxChannelDelta:report.comparison?.maxChannelDelta,failure:report.failure??null,p1GatePassed:false}));}
