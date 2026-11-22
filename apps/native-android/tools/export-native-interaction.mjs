import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import * as THREE from '../../../node_modules/three/build/three.module.js';
const repo=fileURLToPath(new URL('../../../',import.meta.url)),out=path.resolve(process.argv[2]??'');
assert.ok(out.startsWith(path.join(repo,'apps/native-android/world-core/build/generated')+path.sep));
const source='packages/voxel/src/renderer.ts',text=fs.readFileSync(path.join(repo,source),'utf8').replace(/\r\n/g,'\n');
function section(start,end){const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a);return text.slice(a,b);}
const entry=`import * as THREE from 'three';
import {cameraZoomBounds,clampCameraDistance,settlementOpeningDistance} from ${JSON.stringify(path.join(repo,'packages/voxel/src/camera-zoom.ts'))};
export function subject(input){
 let focusedProjectId=null,cameraDistance=1,fittedDistance=1,minimumCameraDistance=1,maximumCameraDistance=1;
 let cameraPitch=38*Math.PI/180,cameraAzimuth=Math.PI/4,targetCameraPitch=cameraPitch,targetCameraAzimuth=cameraAzimuth,lastCameraUpdateMs=0;
 let openingReveal=null,interactionFrameDurations=[];
 const defaultCameraPitch=cameraPitch,defaultCameraAzimuth=cameraAzimuth,previewMode=false,options={environmentStyle:'ocean-island'};
 const camera={fov:40,aspect:input.aspect},cameraTarget=new THREE.Vector3();
 const contentBounds=new THREE.Box3(new THREE.Vector3(...input.low),new THREE.Vector3(...input.high));
 const positionedWorlds=input.targets.filter(t=>!t.id.startsWith('reward:')).map(make),positionedDecorations=input.targets.filter(t=>t.id.startsWith('reward:')).map(make);
 function make(t){return {projectId:t.id,rewardId:t.id.slice(7),worldPosition:new THREE.Vector3(...t.position),footprint:{width:t.width,depth:t.depth},blueprint:{bounds:{minY:0,maxY:t.height-1}}};}
 function updateCamera(){}function requestRender(){}
 ${section('  function focusBoundsFor(', '  const immersiveLookTargetValue')}
 ${section('  function resetView(): void {','  function applyQuality(')}
 function snapshot(){return {selected:focusedProjectId,target:cameraTarget.toArray(),distance:cameraDistance,fitted:fittedDistance,minimum:minimumCameraDistance,maximum:maximumCameraDistance,pitch:cameraPitch,azimuth:cameraAzimuth};}
 frameScene(true);cameraDistance=settlementOpeningDistance(fittedDistance,minimumCameraDistance,maximumCameraDistance);
 const results=[snapshot()];
 for(const command of input.commands){
  if(command.kind==='focus'){focusedProjectId=command.id;frameScene(true);}
  else if(command.kind==='reset')resetView();
  else if(command.kind==='map'){focusedProjectId=null;resetView();}
  else if(command.kind==='resize'){camera.aspect=command.aspect;frameScene(false);}
  results.push(snapshot());
 }
 return results;
}`;
const compiled=await build({stdin:{contents:entry,loader:'ts',resolveDir:repo},bundle:true,write:false,platform:'node',format:'esm',metafile:true,preserveSymlinks:true,logLevel:'silent'});
const {subject}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const cameras=[];
for(const aspect of [.32,.75,1,1.8,3.2])for(const scale of [1,9]){
 const input={aspect,low:[-32*scale,-2.5,-40*scale],high:[48*scale,35,50*scale],targets:[
  {id:'a',position:[12,4,-18],width:12,depth:17,height:22},
  {id:'reward:cake',position:[-32,2,45],width:3,depth:4,height:4}],
  commands:[{kind:'focus',id:'a'},{kind:'reset'},{kind:'resize',aspect:1.33},{kind:'focus',id:'reward:cake'},{kind:'reset'},{kind:'map'}]};
 cameras.push({input,frames:subject(input)});
}
const group=new THREE.Group(),sources=[];
const ring=new THREE.Shape();ring.moveTo(-2,-2);ring.lineTo(2,-2);ring.lineTo(2,2);ring.lineTo(-2,2);ring.closePath();
const hole=new THREE.Path();hole.moveTo(-.7,-.7);hole.lineTo(-.7,.7);hole.lineTo(.7,.7);hole.lineTo(.7,-.7);hole.closePath();ring.holes.push(hole);
function add(owner,geometry,poses,side=0,opacity=1){
 const material=new THREE.MeshBasicMaterial({side,transparent:opacity<1,opacity});const mesh=new THREE.InstancedMesh(geometry,material,poses.length);
 for(let i=0;i<poses.length;i++){const p=poses[i],m=new THREE.Matrix4().compose(new THREE.Vector3(...p.position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rotation)),new THREE.Vector3(...p.scale));mesh.setMatrixAt(i,m);}
 mesh.userData.owner=owner;group.add(mesh);
 sources.push({owner,positions:Array.from(geometry.attributes.position.array),normals:Array.from(geometry.attributes.normal.array),indices:Array.from(geometry.index.array),matrices:Array.from(mesh.instanceMatrix.array),side,opacity});
}
const pose=(x,y,z,scale=[1,1,1],rotation=[0,0,0])=>({position:[x,y,z],scale,rotation});
add('building:near',new THREE.BoxGeometry(),[pose(0,0,1),pose(0,2,0)]);
add('building:far',new THREE.BoxGeometry(),[pose(0,0,-4,[3,3,3])]);
add('reward:daily',new THREE.BoxGeometry(),[pose(3,0,0,[.5,3,1.5],[.3,1.3,-.2])],2);
add('building:ring',new THREE.ShapeGeometry(ring),[pose(7,0,0)],2);
add('building:front',new THREE.PlaneGeometry(2,2),[pose(-3,0,0)],0);
add('building:back',new THREE.PlaneGeometry(2,2),[pose(-6,0,0)],1);
add('building:mirror',new THREE.BoxGeometry(),[pose(3,3,0,[-2,.5,3],[0,.7,.3])],0,0);
add('world',new THREE.BoxGeometry(100,100,1),[pose(0,0,10)],2);
group.updateMatrixWorld(true);
const selectable=group.children.filter(m=>m.userData.owner!=='world');
const rays=[];
function ray(origin,direction){const raycaster=new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction).normalize());const hit=raycaster.intersectObjects(selectable,false)[0];
 rays.push({origin,direction:raycaster.ray.direction.toArray(),hit:hit?{id:hit.object.userData.owner.replace(/^building:/,''),distance:hit.distance}:null});}
for(let x=-16;x<=22;x++)for(let y=-6;y<=10;y++)ray([x*.5,y*.5,20],[0,0,-1]);
ray([7,0,3],[0,0,-1]);ray([0,0,1],[0,0,1]);ray([-6,0,-3],[0,0,1]);
let seed=0x6245af;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
for(let i=0;i<500;i++){const origin=[random()*24-12,random()*12-6,random()*20-10];ray(origin,[random()*2-1,random()*2-1,random()*2-1]);}
const self=path.relative(repo,fileURLToPath(import.meta.url)).replaceAll('\\','/'),inputs=new Set([source,self,'package-lock.json']);
for(const input of Object.keys(compiled.metafile.inputs))if(input!=='<stdin>')inputs.add(path.relative(repo,path.resolve(input)).replaceAll('\\','/'));
inputs.add('node_modules/three/build/three.module.js');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex');
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-interaction-oracle.json'),JSON.stringify({schema:1,sourceHashes:Object.fromEntries([...inputs].sort().map(p=>[p,sha(p)])),cameras,sources,rays}));
console.log(`Native interaction: ${cameras.length} camera sequences, ${rays.length} actual Three raycasts.`);
