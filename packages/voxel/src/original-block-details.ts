import * as THREE from 'three';
import type {BlueprintVoxel} from './blueprint-model';
import {fallbackVisualStyleForVoxel} from './fallback-visual';

export const ORIGINAL_DETAIL_IDS=Object.freeze([
 'bookshelf','chiseled_bookshelf','crafting_table','furnace','blast_furnace','smoker','note_block','jukebox','barrel','loom','cartography_table','fletching_table','smithing_table',
 'chest','trapped_chest','ender_chest','hopper','anvil','chipped_anvil','damaged_anvil','flower_pot','chain','iron_chain','copper_chain','exposed_copper_chain','weathered_copper_chain','oxidized_copper_chain','waxed_copper_chain','waxed_exposed_copper_chain','waxed_weathered_copper_chain','waxed_oxidized_copper_chain','sea_pickle',
 ...'white orange magenta light_blue yellow lime pink gray light_gray cyan purple blue brown green red black'.split(' ').map(color=>color+'_glazed_terracotta'),
 ...'coal iron copper gold redstone emerald lapis diamond'.split(' ').flatMap(ore=>[ore+'_ore','deepslate_'+ore+'_ore']),
 'nether_gold_ore','nether_quartz_ore','ancient_debris',
].map(path=>'minecraft:'+path));
const IDS=new Set(ORIGINAL_DETAIL_IDS);
type Part=readonly[number,number,number,number,number,number];
const cube:Part=[0,0,0,1,1,1];
export function originalDetailParts(voxel:Pick<BlueprintVoxel,'sourceBlockId'|'sourceBlockState'>):readonly Part[]|null{
 const id=voxel.sourceBlockId;if(!id||!IDS.has(id))return null;
 const state=voxel.sourceBlockState??{},path=id.slice(10);
 if(state.facing&&!['north','east','south','west','up','down'].includes(state.facing))return null;
 if(path==='chest'||path==='trapped_chest'||path==='ender_chest')return[[0,-.08,0,.875,.65,.875],[0,.3,0,.9,.18,.9],[0,.13,.46,.14,.23,.04]];
 if(path==='hopper')return[[0,.35,-.4,1,.3,.2],[0,.35,.4,1,.3,.2],[-.4,.35,0,.2,.3,.6],[.4,.35,0,.2,.3,.6],[0,.08,0,.65,.25,.65],[0,-.12,0,.4,.2,.4],[0,-.37,0,.22,.3,.22]];
 if(path.includes('anvil'))return[[0,-.4,0,.8,.2,.8],[0,-.12,0,.38,.42,.48],[0,.32,0,1,.3,.65]];
 if(path==='flower_pot')return[[0,-.45,0,.4,.1,.4],[-.2,-.28,0,.1,.3,.5],[.2,-.28,0,.1,.3,.5],[0,-.28,-.2,.3,.3,.1],[0,-.28,.2,.3,.3,.1]];
 if(path==='chain'||path.endsWith('_chain')){
  if(state.axis&&!['x','y','z'].includes(state.axis))return null;
  return [[-.09,-.25,0,.07,.5,.1],[.09,-.25,0,.07,.5,.1],[0,-.48,0,.18,.05,.1],[0,-.02,0,.18,.05,.1],[0,.25,-.09,.1,.5,.07],[0,.25,.09,.1,.5,.07],[0,.02,0,.1,.05,.18],[0,.48,0,.1,.05,.18]];
 }
 if(path==='sea_pickle'){
  const count=Number(state.pickles??1);if(!Number.isInteger(count)||count<1||count>4)return null;
  return Array.from({length:count},(_,i)=>[(i%2)*.34-.17,-.29+((i%3)*.03),Math.floor(i/2)*.32-.16,.18,.42+i%3*.06,.18] as Part);
 }
 return[cube];
}
function yaw(state:BlueprintVoxel['sourceBlockState']):number{return({south:0,west:Math.PI/2,north:Math.PI,east:-Math.PI/2} as Record<string,number>)[state?.facing??'south']??0;}
function detailGeometry(parts:readonly Part[]):THREE.BufferGeometry{
 const positions:number[]=[],normals:number[]=[],uvs:number[]=[];
 for(const [x,y,z,w,h,d]of parts){
  const box=new THREE.BoxGeometry(w,h,d).toNonIndexed(),p=box.getAttribute('position'),n=box.getAttribute('normal'),uv=box.getAttribute('uv');
  for(let i=0;i<p.count;i++){
   positions.push(p.getX(i)+x,p.getY(i)+y,p.getZ(i)+z);normals.push(n.getX(i),n.getY(i),n.getZ(i));
   const face=Math.floor(i/6);uvs.push(((face%4)*32+8+uv.getX(i)*16)/128,(Math.floor(face/4)*32+8+uv.getY(i)*16)/64);
  }box.dispose();
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}
/** Self-authored six-face pixels. The padding protects adjacent atlas tiles in mips. */
export function originalDetailPixels(voxel:Pick<BlueprintVoxel,'materialId'|'sourceBlockId'|'sourceBlockState'>):Uint8Array{
 const path=voxel.sourceBlockId!.slice(10),style=fallbackVisualStyleForVoxel(voxel),data=new Uint8Array(128*64*4);
 const rgb=(hex:number)=>[(hex>>16)&255,(hex>>8)&255,hex&255];
 for(let face=0;face<6;face++)for(let py=0;py<32;py++)for(let px=0;px<32;px++){
  const x=Math.max(0,Math.min(15,px-8)),y=Math.max(0,Math.min(15,py-8)),top=face===2,bottom=face===3,front=face===4;
  const grain=((x*13+y*7+face*3)%11)-5;
  let color=path.includes('terracotta')||path.includes('copper_chain')?style.color:/furnace|smoker|anvil|hopper|chain/.test(path)?0x68757a:path==='ender_chest'?0x245457:path==='sea_pickle'?0x859d48:0xb18a55;
  if(path.endsWith('_ore')||path==='ancient_debris'){
   const vein=((Math.floor(x/2)*11+Math.floor(y/2)*7+face*5)%17<4)&&x>1&&y>1&&x<15&&y<15;
   color=vein?style.color:path.includes('deepslate')?0x50575b:path.startsWith('nether_')?0x794d42:path==='ancient_debris'?0x665045:0x83908a;
  }else if(path.endsWith('glazed_terracotta')){
   const motif=((x+y)%8<2)||(Math.abs(x-7)+Math.abs(y-7)<4);
   color=motif?style.color:(x<8)!==(y<8)?0xeee3cb:0x506873;
  }else if(path==='bookshelf'||path==='chiseled_bookshelf'){
   if(!top&&!bottom){const slot=(x+Math.floor(y/8))%5;const occupied=path==='bookshelf'||voxel.sourceBlockState?.[`slot_${Math.floor(x/5)+Math.floor(y/8)*3}_occupied`]==='true';color=y%8<2?0x87613e:occupied?[0x9d5146,0x638a71,0xc6b674,0x617895,0xb18567][slot]!:0x403b30;}
  }else if(path==='crafting_table'){
   color=top?(x%5===0||y%5===0?0x654b33:0xb38657):(x<2||x>13?0x735038:(x===5||x===10)&&y>4?0x5e5b4a:0xa87e4d);
  }else if(path==='furnace'||path==='blast_furnace'||path==='smoker'){
   color=top?(x%5===0||y%5===0?0x4f5a5a:0x879191):(x===0||x===15||y===0||y===15?0x4b5555:0x83908c);
   if(front&&x>2&&x<13&&(y>3&&y<7||y>9&&y<14))color=voxel.sourceBlockState?.lit==='true'&&y>9?(x+y)%3?0xeb9d45:0xe8c47c:0x2a3332;
   if(path==='smoker'&&!top&&(x<2||x>13))color=0x5e4a36;
  }else if(/chest|barrel/.test(path)){
   color=(x%5===0||y===3||y===12)?0x6e5135:0xad8147;
   if(path==='barrel'&&(x===2||x===13))color=0x62686a;
   if(front&&path.includes('chest')&&x>6&&x<10&&y>5&&y<11)color=path==='ender_chest'?0xd7c889:0xc5bd8d;
   if(path==='trapped_chest'&&front&&y===4)color=0xa44d3e;
   if(path==='ender_chest'&&!front)color=(x+y)%7===0?0x7ca69a:0x24494d;
  }else if(path==='note_block'||path==='jukebox'){
   color=(x%4<2)===(y%4<2)?0x785039:0x95694b;
   if(top&&path==='jukebox'&&y>6&&y<10&&x>2&&x<13)color=0x343c35;
  }else if(path==='loom')color=front?(x%3===0?0x694e35:0xd9c6a0):0x9f784e;
  else if(path==='cartography_table')color=top?(x<3||y<3?0x8b6844:(x+y)%7<2?0x73855b:0xe3d8ae):0x8f7353;
  else if(path==='fletching_table')color=top?((x===y||x+y===15)?0x736348:0xc8b787):0xb39c72;
  else if(path==='smithing_table')color=top?(x%6===0||y%6===0?0x363f40:0x535f60):x%6===0?0x374341:0x704f40;
  else if(path==='flower_pot')color=y<3?0x9c5b40:0xb17450;
  const channels=rgb(color),offset=((Math.floor(face/4)*32+py)*128+(face%4)*32+px)*4;
  data[offset]=Math.max(0,Math.min(255,channels[0]!+grain));data[offset+1]=Math.max(0,Math.min(255,channels[1]!+grain));data[offset+2]=Math.max(0,Math.min(255,channels[2]!+grain));data[offset+3]=255;
 }
 return data;
}
export function addOriginalBlockDetails(root:THREE.Group,voxels:readonly BlueprintVoxel[],onInstance?:(mesh:THREE.InstancedMesh,index:number,voxel:BlueprintVoxel)=>void):Set<BlueprintVoxel>{
 const groups=new Map<string,{parts:readonly Part[];voxels:BlueprintVoxel[]}>(),handled=new Set<BlueprintVoxel>();
 for(const voxel of voxels){const parts=originalDetailParts(voxel);if(!parts)continue;
  const key=voxel.sourceBlockId+'|'+JSON.stringify(voxel.sourceBlockState??{});const group=groups.get(key)??{parts,voxels:[]};group.voxels.push(voxel);groups.set(key,group);
 }
 for(const [key,group]of groups){
  const first=group.voxels[0]!,texture=new THREE.DataTexture(originalDetailPixels(first),128,64,THREE.RGBAFormat);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.flipY=false;texture.needsUpdate=true;texture.name='blockcolc-original-detail-'+first.sourceBlockId;
  const material=new THREE.MeshStandardMaterial({map:texture,roughness:.82,metalness:/anvil|hopper|chain/.test(key)?.3:0});
  const mesh=new THREE.InstancedMesh(detailGeometry(group.parts),material,group.voxels.length);mesh.name='original-detail:'+key;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.ownedMaterial=material;mesh.userData.ownedTexture=texture;
  const matrix=new THREE.Matrix4(),axis=new THREE.Matrix4();
  group.voxels.forEach((voxel,index)=>{
   matrix.makeRotationY(yaw(voxel.sourceBlockState));
   if(voxel.sourceBlockId?.endsWith('chain')){if(voxel.sourceBlockState?.axis==='x')matrix.multiply(axis.makeRotationZ(Math.PI/2));if(voxel.sourceBlockState?.axis==='z')matrix.multiply(axis.makeRotationX(Math.PI/2));}
   matrix.setPosition(voxel.x,voxel.y,voxel.z);mesh.setMatrixAt(index,matrix);onInstance?.(mesh,index,voxel);handled.add(voxel);
  });mesh.instanceMatrix.needsUpdate=true;root.add(mesh);
 }
 return handled;
}
