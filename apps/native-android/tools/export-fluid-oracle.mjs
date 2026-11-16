import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];assert(output,'Fluid oracle output required');
const sha=b=>createHash('sha256').update(b).digest('hex'),hashes={};
const plugin={name:'expose-formal-fluid-geometry',setup(b){b.onLoad({filter:/[\\/]voxel[\\/]src[\\/]resource-fluids\.ts$/},args=>({
 contents:readFileSync(args.path,'utf8')+`\nimport * as THREE from 'three'; export {THREE,isPartialFluidBlock};
 export {encodeFluidCornerHeights,encodeFluidSurfaceMetadata,createTexturedBoxGeometry} from './resource-textures';`,loader:'ts',resolveDir:path.dirname(args.path)
}));}};
const built=await build({entryPoints:[path.join(root,'packages/voxel/src/resource-fluids.ts')],bundle:true,write:false,platform:'node',format:'esm',metafile:true,plugins:[plugin]});
for(const input of Object.keys(built.metafile.inputs)){const absolute=path.resolve(input),name=path.relative(root,absolute).replaceAll('\\','/');assert(!name.startsWith('../'));hashes[name]=sha(readFileSync(absolute));}
const source=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const cases=[],v=(x,y,z,id='water',state={level:'0'})=>({x,y,z,materialId:'stone',buildOrder:0,sourceBlockId:'minecraft:'+id,sourceBlockState:state});
function add(name,voxels,{waterlogged=false,limit=4096,neighbors=voxels}={}) {
 const plan=waterlogged?source.planResourceWaterloggedFluidBatches(voxels,undefined,limit):source.planResourceFluidBatches(voxels,undefined,neighbors);
 assert.equal(plan.batches.length,0);assert.equal(plan.texturedVoxelCount,0);
 const ids=new Map(voxels.map((value,index)=>[value,index])),heights=new Map(plan.fallbackBatches.flatMap(b=>b.entries.map(e=>[e,b.height])));
 function entry(e){const surface=e.fluidSurface;return{sourceIndex:ids.get(e.voxel),height:heights.get(e),faceMask:e.faceMask,corners:surface.cornerHeights,flowing:surface.flowing,flowAngle:surface.flowAngleRadians,
  kind:surface.isWater?'water':'lava',packedCorners:source.encodeFluidCornerHeights(surface.cornerHeights),packedMetadata:source.encodeFluidSurfaceMetadata(surface)};}
 cases.push({name,voxels,neighbors:neighbors===voxels?null:neighbors,waterlogged,limit:Number.isFinite(limit)?limit:String(limit),entries:plan.fallbackEntries.map(entry),
  batches:plan.fallbackBatches.map(b=>({kind:b.kind,height:b.height,faceMask:b.faceMask,indices:b.entries.map(e=>ids.get(e.voxel))}))});
}
add('empty',[]);add('no-fluid',[v(0,0,0,'stone')]);
for(const id of ['water','lava','bubble_column'])for(const level of ['0','1','2','3','4','5','6','7','8','15','bad'])add(id+'-'+level,[v(0,0,0,id,{level})]);
add('same-kind-stack',[v(0,0,0),v(0,1,0)]);add('mixed-kind-stack',[v(0,0,0),v(0,1,0,'lava')]);
add('closed-cube',Array.from({length:27},(_,i)=>v(i%3,Math.floor(i/3)%3,Math.floor(i/9))));
for(const neighbor of ['stone','oak_slab','glass','glass_pane','oak_stairs','redstone_torch','air','sea_pickle']){
 const inputs=[v(0,0,0),v(1,0,0,neighbor,{}),v(-1,0,0,'water',{level:'4'}),v(0,-1,1,'water',{level:'2'})];add('neighbors-'+neighbor,inputs);
}
for(let i=0;i<12;i++){
 const cells=[];for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)if((x*11+z*7+i+100)%5!==0)cells.push(v(x,i%2,z,(x+z+i+30)%7===0?'lava':'water',{level:String((x*5+z*3+i+40)%8)}));
 cells.push(v(1,-1,2),v(-1,0,0,'oak_slab',{type:'bottom',waterlogged:'true'}));add('slopes-'+i,cells);add('slopes-reverse-'+i,[...cells].reverse());
}
add('fractional-piston-neighbors',[v(-.5,0,.25),v(.5,0,.25,'water',{level:'2'}),v(1.5,-1,.25)]);
const selected=[v(0,0,0),v(2,0,0,'lava')];add('separate-neighbor-field',selected,{neighbors:[...selected,v(0,1,0),v(2,0,1,'lava')]});
for(const id of ['oak_stairs','glass_pane','oak_fence','oak_slab','water','lava'])add('waterlogged-'+id,[v(0,0,0,id,{waterlogged:'true',level:'4'}),v(1,0,0,'water',{level:'2'})],{waterlogged:true});
for(const limit of [0,1,17,4096,Infinity,-3,NaN])add('waterlogged-limit-'+String(limit),Array.from({length:35},(_,i)=>v(i%7,0,Math.floor(i/7),'oak_slab',{waterlogged:'true'})),{waterlogged:true,limit});
add('waterlogged-over-one-batch',Array.from({length:4900},(_,i)=>v(i%70,0,Math.floor(i/70),'oak_slab',{waterlogged:'true'})),{waterlogged:true});
const directory=path.join(root,'apps/native-android/world-core/build/generated/bundled-blueprints/native-blueprints');
const catalog=JSON.parse(readFileSync(path.join(directory,'catalog.json'),'utf8'));
for(const [name,expected]of Object.entries(catalog.sourceHashes)){assert.equal(sha(readFileSync(path.join(root,name))),expected);hashes[name]=expected;}
for(const e of catalog.entries){const bytes=readFileSync(path.join(directory,e.sha256+'.json'));assert.equal(sha(bytes),e.sha256);const voxels=JSON.parse(bytes).voxels;
 if(voxels.some(v=>/:(water|bubble_column|lava)$/.test(v.sourceBlockId??'')||v.sourceBlockState?.waterlogged==='true')){add('bundled-free-'+e.id,voxels);add('bundled-waterlogged-'+e.id,voxels,{waterlogged:true});}}
const samples=[-1,0,.125,8/9,1],averages=[];
for(const a of samples)for(const b of samples)for(const c of samples)for(const d of samples)averages.push({input:[a,b,c,d],expected:source.calculateAverageFluidHeight(a,b,c,d)});
const partialIds=[undefined,'',...['stone','air','iron_bars','chain','torchflower_crop','sea_pickle','oak_slab','oak_stairs','red_stained_glass_pane','iron_door','wheat','poppy','red_tulip','cobweb','tube_coral_wall_fan','kelp','redstone_torch'].flatMap(p=>['minecraft:'+p,'mod:'+p,p.toUpperCase()])]
 .map(id=>({id:id??null,partial:source.isPartialFluidBlock(id)}));
const byteHash=a=>sha(Buffer.from(a.buffer,a.byteOffset,a.byteLength)),geometries=[];
const template=source.planResourceFluidBatches([v(0,0,0)]).fallbackEntries[0];
for(const waterlogged of [false,true])for(let mask=1;mask<=63;mask++){
 const g=source.createTexturedBoxGeometry([{...template,faceMask:mask}]);const inset=waterlogged ? .985 : .995;g.scale(inset/.97,1/.97,inset/.97);
 const expanded=g.toNonIndexed();expanded.computeBoundingBox();geometries.push({waterlogged,faceMask:mask,vertices:expanded.getAttribute('position').count,
  attributes:Object.fromEntries(['position','normal','uv'].map(name=>[name,byteHash(expanded.getAttribute(name).array)])),bounds:[...expanded.boundingBox.min.toArray(),...expanded.boundingBox.max.toArray()]});g.dispose();expanded.dispose();
}
for(const name of ['apps/native-android/tools/export-fluid-oracle.mjs','package-lock.json'])hashes[name]=sha(readFileSync(path.join(root,name)));
mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'fluid-oracle.json'),JSON.stringify({schema:1,sourceHashes:hashes,cases,averages,partialIds,geometries}));
console.log(JSON.stringify({cases:cases.length,entries:cases.reduce((sum,c)=>sum+c.entries.length,0),averages:averages.length,geometries:geometries.length,sources:Object.keys(hashes).length}));
