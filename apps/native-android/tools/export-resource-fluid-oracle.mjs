import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url)),out=process.argv[2];
const built=await build({entryPoints:[path.join(root,'packages/voxel/src/resource-fluids.ts')],bundle:true,write:false,platform:'node',format:'esm',metafile:true,preserveSymlinks:true});
const source=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const input=JSON.parse(readFileSync(path.join(root,'apps/native-android/world-core/build/generated/fluid-oracle/fluid-oracle.json'))),cases=[];
for(const original of input.cases.filter(c=>c.voxels.length<300))for(const mode of ['both','still-only','flow-only','none','split-page','lava-transparent']){
 const tiles=[];for(const kind of ['water','lava'])for(const flow of [false,true]){
  if(mode==='none'||mode==='still-only'&&flow||mode==='flow-only'&&!flow)continue;
  tiles.push({resourceId:`minecraft:block/${kind}_${flow?'flow':'still'}`,page:mode==='split-page'&&flow?1:0,pageTextureIndex:kind==='water'?(flow?1:0):(flow?3:2),alphaMode:kind==='water'||mode==='lava-transparent'?'translucent':'opaque'});
 }
 const atlas={pages:[{},{}],tiles:new Map(tiles.map(t=>[t.resourceId,t]))};
 const plan=original.waterlogged?source.planResourceWaterloggedFluidBatches(original.voxels,atlas):source.planResourceFluidBatches(original.voxels,atlas,original.neighbors??original.voxels);
 const ids=new Map(original.voxels.map((v,i)=>[v,i]));
 const entry=e=>({index:ids.get(e.voxel),tiles:e.faceTiles,corners:e.fluidSurface.cornerHeights,flowing:e.fluidSurface.flowing,angle:e.fluidSurface.flowAngleRadians});
 cases.push({name:original.name+'/'+mode,voxels:original.voxels,neighbors:original.neighbors,waterlogged:original.waterlogged,tiles,
 batches:plan.batches.map(b=>({kind:b.kind,height:b.height,page:b.page,mask:b.faceMask,alpha:b.alphaMode,entries:b.entries.map(entry)})),fallback:plan.fallbackEntries.map(e=>ids.get(e.voxel)),accepted:plan.texturedVoxelCount});
}
const hashes=Object.fromEntries(Object.keys(built.metafile.inputs).map(f=>{const full=path.resolve(f);return[path.relative(root,full).replaceAll('\\','/'),createHash('sha256').update(readFileSync(full)).digest('hex')]}));
mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'resource-fluid-oracle.json'),JSON.stringify({cases,sourceHashes:hashes}));console.log(JSON.stringify({cases:cases.length,sources:Object.keys(hashes).length}));
