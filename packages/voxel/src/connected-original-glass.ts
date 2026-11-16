import * as THREE from 'three';
import type {BlueprintVoxel} from './blueprint-model';
import {fallbackVisualStyleForVoxel} from './fallback-visual';

const FACES=[
 {n:[1,0,0],corners:[[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]]},
 {n:[-1,0,0],corners:[[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]]},
 {n:[0,1,0],corners:[[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]]},
 {n:[0,-1,0],corners:[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]]},
 {n:[0,0,1],corners:[[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]},
 {n:[0,0,-1],corners:[[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]]},
] as const;
const key=(x:number,y:number,z:number)=>`${x}:${y}:${z}`;
export function isConnectedOriginalGlass(voxel:Pick<BlueprintVoxel,'sourceBlockId'>&Partial<Pick<BlueprintVoxel,'materialId'>>):boolean{return voxel.sourceBlockId===undefined&&voxel.materialId==='glass'||/^minecraft:(glass|(?:white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_stained_glass)$/.test(voxel.sourceBlockId??'');}
/** Adjacent same-colour full glass: only outside faces, borders only at the union's boundary. */
export function connectedGlassSurface(voxels:readonly BlueprintVoxel[]){
 const cells=new Set(voxels.map(v=>key(v.x,v.y,v.z))),positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[];
 for(const voxel of voxels)for(const {n,corners}of FACES){
  if(cells.has(key(voxel.x+n[0],voxel.y+n[1],voxel.z+n[2])))continue;
  const u=corners[1].map((value,i)=>value-corners[0][i]!),v=corners[3].map((value,i)=>value-corners[0][i]!);
  const adjacent=(delta:readonly number[])=>cells.has(key(voxel.x+delta[0]!,voxel.y+delta[1]!,voxel.z+delta[2]!))&&!cells.has(key(voxel.x+delta[0]!+n[0],voxel.y+delta[1]!+n[1],voxel.z+delta[2]!+n[2]));
  const mask=(adjacent(u)?0:2)|(adjacent(u.map(value=>-value))?0:1)|(adjacent(v)?0:8)|(adjacent(v.map(value=>-value))?0:4),base=positions.length/3;
  for(const corner of corners){positions.push(voxel.x+corner[0],voxel.y+corner[1],voxel.z+corner[2]);normals.push(...n);}
  const left=(mask%4*32+8)/128,bottom=(Math.floor(mask/4)*32+8)/128,size=16/128;
  uvs.push(left,bottom,left+size,bottom,left+size,bottom+size,left,bottom+size);indices.push(base,base+1,base+2,base,base+2,base+3);
 }return{positions,normals,uvs,indices};
}
export function connectedGlassPixels():Uint8Array{
 const data=new Uint8Array(128*128*4);
 for(let mask=0;mask<16;mask++)for(let py=0;py<32;py++)for(let px=0;px<32;px++){
  const x=Math.max(0,Math.min(15,px-8)),y=Math.max(0,Math.min(15,py-8));
  const edge=((mask&1)&&x===0)||((mask&2)&&x===15)||((mask&4)&&y===0)||((mask&8)&&y===15);
  const value=edge?186:246,offset=((Math.floor(mask/4)*32+py)*128+(mask%4)*32+px)*4;data.set([value,value,value,255],offset);
 }return data;
}
export function addConnectedOriginalGlass(root:THREE.Group,voxels:readonly BlueprintVoxel[]):Set<BlueprintVoxel>{
 const groups=new Map<string,BlueprintVoxel[]>(),handled=new Set<BlueprintVoxel>();
 for(const voxel of voxels){if(!isConnectedOriginalGlass(voxel))continue;const id=voxel.sourceBlockId??'builtin:glass',group=groups.get(id)??[];group.push(voxel);groups.set(id,group);handled.add(voxel);}
 for(const [id,cells]of groups){
  const data=connectedGlassSurface(cells),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(data.uvs,2));geometry.setIndex(data.indices);
  const texture=new THREE.DataTexture(connectedGlassPixels(),128,128,THREE.RGBAFormat);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.flipY=false;texture.needsUpdate=true;
  const material=new THREE.MeshStandardMaterial({color:fallbackVisualStyleForVoxel(cells[0]!).color,map:texture,transparent:true,opacity:.36,roughness:.12,metalness:.08,depthWrite:false});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='connected-original-glass:'+id;mesh.userData.ownedMaterial=material;mesh.userData.ownedTexture=texture;mesh.receiveShadow=true;mesh.renderOrder=10;root.add(mesh);
 }return handled;
}
