import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../../',import.meta.url)),output=path.resolve(process.argv[2]??'');
assert.ok(output.startsWith(path.join(repo,'apps/native-android/world-core/build/generated')+path.sep));
const source='packages/voxel/src/renderer.ts',text=fs.readFileSync(path.join(repo,source),'utf8').replace(/\r\n/g,'\n');
function section(start,end){const from=text.indexOf(start),to=text.indexOf(end,from);assert.ok(from>=0&&to>from,`Formal lightning source moved: ${start}`);return text.slice(from,to);}
const functions=section('  function clearLightning(): void {','  // V20 CT-01:');
const random=section('function seededRandom(seed: number): () => number {','\n}')+'\n}';
const reset=section('    clearLightning();\n    currentWeather = nextWeather;','    const sunlightScale =');
const entry=`import * as THREE from 'three';
import {rainCrossSectionScaleForView} from ${JSON.stringify(path.join(repo,'packages/voxel/src/precipitation-field.ts'))};
${random}
export function flashSample(point,normal,position,intensity){
 const chunk=THREE.ShaderChunk.lights_pars_begin;
 const start=chunk.indexOf('float getDistanceAttenuation('),end=chunk.indexOf('float getSpotAttenuation(',start);
 if(start<0||end<start)throw Error('Three point attenuation moved');
 const functionText=chunk.slice(start,end),body=functionText.slice(functionText.indexOf('{')+1,functionText.lastIndexOf('}'));
 const attenuation=new Function('lightDistance','cutoffDistance','decayExponent',
  'const pow=Math.pow,max=Math.max,pow2=x=>x*x,pow4=x=>x*x*x*x,saturate=x=>Math.min(1,Math.max(0,x));'+body.replaceAll('float ','let '));
 if(!THREE.ShaderChunk.lights_lambert_pars_fragment.includes('irradiance * BRDF_Lambert( material.diffuseColor )'))throw Error('Three Lambert moved');
 const delta=new THREE.Vector3(...position).sub(new THREE.Vector3(...point)),distance=delta.length();delta.normalize();
 const facing=Math.max(0,new THREE.Vector3(...normal).normalize().dot(delta));
 return new THREE.Color(0xd9e7ff).toArray().map(color=>color*intensity*attenuation(distance,28,2)*facing/Math.PI);
}
export function subject(c){
 const contentBounds=new THREE.Box3(new THREE.Vector3(c.x-c.width/2,c.y-1,c.z-c.depth/2),new THREE.Vector3(c.x+c.width/2,c.y+1,c.z+c.depth/2));
 const cloudsBuiltBaseY=c.cloudBaseY,cameraDistance=60,camera={fov:34},canvas={clientHeight:600,dataset:{}};
 const atmosphereGroup=new THREE.Group(),stormFlash=new THREE.PointLight(0xd9e7ff,0,28,2);
 let lightningBolt=null,lightningStartedAtMs=Number.NEGATIVE_INFINITY,nextLightningAtMs=Number.POSITIVE_INFINITY,lightningStrikeCount=0;
 let stormRandom=seededRandom(0x26c3),currentWeather={thunderstorm:false,seed:0},at=0;
 const performance={now:()=>at},previewMode=!!c.preview,document={hidden:false};let reducedMotion=false,paneVisible=true;
 function requestRender(){};
 function clearGroup(group){group.traverse(child=>{if(child.isMesh){child.geometry.dispose();child.material.dispose();}});group.clear();}
 ${functions}
 return {
  configure(weather,now){at=now;const nextWeather=weather;${reset}},
  update(now,motion){at=now;paneVisible=motion;updateStormLightning(now);
   const points=[];if(lightningBolt)for(const [i,segment]of lightningBolt.children.entries()){
    const half=new THREE.Vector3(0,segment.geometry.parameters.height/2,0).applyQuaternion(segment.quaternion);
    if(i===0)points.push(segment.position.clone().sub(half).toArray());points.push(segment.position.clone().add(half).toArray());
   }
   return {now,motion,strikeCount:lightningStrikeCount,nextAt:Number.isFinite(nextLightningAtMs)?nextLightningAtMs:null,
    opacity:lightningBolt?lightningBolt.children[0].material.opacity:0,flashIntensity:stormFlash.intensity,
    flashPosition:lightningBolt?stormFlash.position.toArray():null,vertices:points,
    matrices:lightningBolt?lightningBolt.children.flatMap(segment=>new THREE.Matrix4().compose(segment.position,segment.quaternion,new THREE.Vector3(1,segment.geometry.parameters.height,1)).elements):[]};
  },next(){return nextLightningAtMs;}
 };
}`;
const compiled=await build({stdin:{contents:entry,resolveDir:repo,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {subject,flashSample}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const traces=[];
for(const context of [{x:0,y:0,z:0,width:4,depth:50,cloudBaseY:18},{x:500,y:50,z:-750,width:80,depth:10,cloudBaseY:80},
 {x:-30,y:4,z:12,width:30,depth:12,cloudBaseY:30,preview:true}])for(const seed of [0,1,0xffffffff,0xdeadbeef]){
 const source=subject(context),actions=[];
 const configure=(weather,now)=>{source.configure(weather,now);actions.push({configure:weather,now});};
 const update=(now,motion=true)=>actions.push({frame:source.update(now,motion)});
 configure({thunderstorm:true,seed},0);update(0);update(1599);update(3200);update(3379);update(3380);update(4650);update(4650.001);
 update(100000);update(100050,false);update(100051);update(200000);
 configure({thunderstorm:false,seed},200050);update(200050);
 configure({thunderstorm:true,seed:(seed^0x10)>>>0},200100);update(201000);
 if(!context.preview){const next=source.next();update(next);update(next+180);update(next+1450);update(next+1451);}
 traces.push({context,seed,actions});
}
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex');
const self=path.relative(repo,fileURLToPath(import.meta.url)).replaceAll('\\','/');
const sourceHashes=Object.fromEntries([source,'packages/voxel/src/precipitation-field.ts',self,'package-lock.json',
 'node_modules/three/src/renderers/shaders/ShaderChunk/lights_pars_begin.glsl.js',
 'node_modules/three/src/renderers/shaders/ShaderChunk/lights_lambert_pars_fragment.glsl.js'].map(file=>[file,sha(file)]));
const flashes=[];
for(const position of [[0,6,0],[300,80,-500]])for(const offset of [[0,0,0],[0,-.05,0],[0,-1,0],[0,-27.9,0],[0,-28,0],[0,-50,0],[2,3,-5]])
 for(const normal of [[0,1,0],[0,-1,0],[1,2,-3]])for(const intensity of [0,.28,2.58]){
  const point=position.map((v,i)=>v+offset[i]);flashes.push({position,point,normal,intensity,diffuse:flashSample(point,normal,position,intensity)});
 }
fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'native-storm-oracle.json'),JSON.stringify({schema:1,sourceHashes,traces,flashes}));
console.log(`Native lightning reference: ${traces.length} actual Three renderer traces, ${flashes.length} shader point-light samples.`);
