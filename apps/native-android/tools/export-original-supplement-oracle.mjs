import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];assert(output,'Supplement oracle output required');
const sha=b=>createHash('sha256').update(b).digest('hex'),hashes={};
const plugin={name:'expose-original-cpu-authored-assets',setup(b){b.onLoad({filter:/[\\/]voxel[\\/]src[\\/]original-(?:block-details|flower-shapes)\.ts$/},args=>({
 contents:readFileSync(args.path,'utf8')+(args.path.endsWith('original-block-details.ts')?`\nexport {detailGeometry,THREE};
 export {addOriginalFlowerShapes,FLOWER_COLORS,wheatAge} from './original-flower-shapes';
 export {connectedGlassSurface,connectedGlassPixels,isConnectedOriginalGlass} from './connected-original-glass';`:'\nexport {FLOWER_COLORS,wheatAge};'),loader:'ts',resolveDir:path.dirname(args.path)
}));}};
const bundle=await build({entryPoints:[path.join(root,'packages/voxel/src/original-block-details.ts')],bundle:true,write:false,platform:'node',format:'esm',metafile:true,preserveSymlinks:true,plugins:[plugin]});
for(const input of Object.keys(bundle.metafile.inputs)){const absolute=path.resolve(input),name=path.relative(root,absolute).replaceAll('\\','/');assert(!name.startsWith('../'));hashes[name]=sha(readFileSync(absolute));}
for(const name of ['apps/native-android/tools/export-original-supplement-oracle.mjs','package-lock.json'])hashes[name]=sha(readFileSync(path.join(root,name)));
const source=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const byteHash=a=>sha(Buffer.from(a.buffer,a.byteOffset,a.byteLength));
function geometry(g){g.computeBoundingBox();return{vertices:g.getAttribute('position').count,attributes:Object.fromEntries(Object.entries(g.attributes).map(([name,a])=>[name,{length:a.array.length,itemSize:a.itemSize,sha:byteHash(a.array)}])),
 indices:g.index?{length:g.index.array.length,sha:byteHash(Int32Array.from(g.index.array))}:null,
 bounds:g.getAttribute('position').count?[...g.boundingBox.min.toArray(),...g.boundingBox.max.toArray()]:null};}
const cubes=[[1,1,1],[.045,.18,.035],[.875,.65,.875],[0,1,1],[.1,.3,7.7],[2.0000001,3.333333333,1/7]].map(size=>{
 const g=new source.THREE.BoxGeometry(...size).toNonIndexed(),result={size,geometry:geometry(g)};g.dispose();return result;
});
const details=[];
function detail(id,state,materialId='accent'){
 const voxel={x:3.25,y:-2,z:7.5,materialId,buildOrder:0,...(id===undefined?{}:{sourceBlockId:id}),...(state===undefined?{}:{sourceBlockState:state})};
 const parts=source.originalDetailParts(voxel);if(!parts){details.push({voxel,parts:null});return;}
 const group=new source.THREE.Group();source.addOriginalBlockDetails(group,[voxel]);assert.equal(group.children.length,1);const mesh=group.children[0];
 const result={voxel,parts,geometry:geometry(mesh.geometry),pixels:byteHash(mesh.material.map.image.data),matrix:byteHash(mesh.instanceMatrix.array),roughness:mesh.material.roughness,metalness:mesh.material.metalness};
 details.push(result);mesh.geometry.dispose();mesh.material.map.dispose();mesh.material.dispose();
}
for(const id of source.ORIGINAL_DETAIL_IDS){detail(id);detail(id,{facing:'east',lit:'true'});detail(id,{facing:'north',lit:'false'});detail(id,{facing:'invalid'});}
for(let mask=0;mask<64;mask++)detail('minecraft:chiseled_bookshelf',Object.fromEntries(Array.from({length:6},(_,i)=>['slot_'+i+'_occupied',String((mask&(1<<i))!==0)])));
for(const axis of ['x','y','z','','invalid'])detail('minecraft:iron_chain',{axis,facing:'west'});
for(const pickles of ['0','1','2','3','4','5','1.0','0x4','1e0','1.5','bad','','\ufeff 3\u00a0'])detail('minecraft:sea_pickle',{pickles});
for(const id of [undefined,'','mod:chest','MINECRAFT:CHEST','minecraft:stone'])detail(id);
const flowers=[];
function flower(id,state){
 const voxel={x:-4.5,y:2,z:8,materialId:'flower',buildOrder:0,sourceBlockId:id,...(state===undefined?{}:{sourceBlockState:state})};
 const group=new source.THREE.Group();source.addOriginalFlowerShapes(group,[voxel]);
 if(!group.children.length){flowers.push({voxel,key:null});return;}
 const mesh=group.children[0];flowers.push({voxel,key:mesh.name.substring('blockcolc-original-flower-'.length),geometry:geometry(mesh.geometry),matrix:byteHash(mesh.instanceMatrix.array),age:source.wheatAge(voxel)});
 mesh.geometry.dispose();mesh.material.dispose();
}
for(const id of Object.keys(source.FLOWER_COLORS))flower('minecraft:'+id);
for(const age of [undefined,'0','1','2','3','4','5','6','7','8','-1','1.5','1.0','0x7','0b11','\ufeff 2\u00a0','invalid',''])flower('minecraft:wheat',age===undefined?undefined:{age});
for(const id of ['POPPY','MINECRAFT:POPPY','mod:poppy','minecraft:unknown',''])flower(id);
const accepts=[{},...['glass','white_stained_glass','red_stained_glass','black_stained_glass','glass_pane','red_stained_glass_pane','Glass','not_glass'].map(p=>({sourceBlockId:'minecraft:'+p})),{sourceBlockId:''},{sourceBlockId:'mod:glass'}]
 .map(v=>({voxel:{materialId:'glass',...v},accepts:source.isConnectedOriginalGlass({materialId:'glass',...v})}));
const fields=[[],[[0,0,0]],[[0,0,0],[1,0,0]],[[0,0,0],[1,0,0],[0,1,0],[1,1,0]],[[0,0,0],[1,1,0],[2,2,0]],
 Array.from({length:27},(_,i)=>[i%3,Math.floor(i/3)%3,Math.floor(i/9)]),[[.5,-2.25,.75],[1.5,-2.25,.75],[.5,-1.25,.75]],[[0,0,0],[0,0,0]],
 Array.from({length:60},(_,i)=>[i%10,Math.floor(i/10),0])];
const glass=fields.map(points=>{const voxels=points.map(([x,y,z])=>({x,y,z,materialId:'glass',buildOrder:0,sourceBlockId:'minecraft:glass'}));
 const surface=source.connectedGlassSurface(voxels),g=new source.THREE.BufferGeometry();
 g.setAttribute('position',new source.THREE.Float32BufferAttribute(surface.positions,3));g.setAttribute('normal',new source.THREE.Float32BufferAttribute(surface.normals,3));g.setAttribute('uv',new source.THREE.Float32BufferAttribute(surface.uvs,2));g.setIndex(surface.indices);
 const result={voxels,geometry:geometry(g)};g.dispose();return result;});
mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'original-supplement-oracle.json'),JSON.stringify({schema:1,sourceHashes:hashes,ids:source.ORIGINAL_DETAIL_IDS,cubes,details,flowers,accepts,glass,glassPixels:byteHash(source.connectedGlassPixels())}));
console.log(JSON.stringify({cubes:cubes.length,details:details.length,flowers:flowers.length,glass:glass.length,sources:Object.keys(hashes).length}));
