import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];assert(output,'Scenery oracle directory required');
const sourceHashes={},sha=b=>createHash('sha256').update(b).digest('hex');
const plugin={name:'expose-existing-scenery-archetypes',setup(b){b.onLoad({filter:/[\\/]voxel[\\/]src[\\/]scenery\.ts$/},args=>({
 contents:readFileSync(args.path,'utf8')+`\nexport {wellBlocks as oracleWell,farmBlocks as oracleFarm,sceneryRockBlocks as oracleRock};
 export {terrainSurfaceTable} from './terrain-surface-table';
 export {createSteppedTerrainData} from './terrain';
 export {treeSuitability,reefDensity,reefChannel} from './scenery-ecotones';
 export {createReefField,reefCoverage} from './reef-field';`,loader:'ts',resolveDir:path.dirname(args.path)
}));}};
const compiled=await build({entryPoints:[path.join(root,'packages/voxel/src/scenery.ts')],bundle:true,write:false,platform:'node',format:'esm',metafile:true,plugins:[plugin]});
for(const input of Object.keys(compiled.metafile.inputs)){const absolute=path.resolve(input),name=path.relative(root,absolute).replaceAll('\\','/');assert(!name.startsWith('../'));sourceHashes[name]=sha(readFileSync(absolute));}
const source=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const models=[];
function add(kind,args,value){const byVoxel=new Map(value.voxels.map((voxel,index)=>[voxel,index]));const distant=value.distantVoxels.map(v=>{assert(byVoxel.has(v),'Source silhouette is no longer a subset');return byVoxel.get(v);});models.push({kind,args,voxels:value.voxels,distant});}
const variants=[0,1,2,3,4,7,31,127,65535,0x80000000,0xffffffff];
for(const species of ['oak','birch','spruce','pale_oak','poplar'])for(const variant of variants)add('tree',{species,variant,tall:false},source.sceneryTreeBlocks(species,variant));
for(const variant of variants)add('tree',{species:'spruce',variant,tall:true},source.sceneryTreeBlocks('spruce',variant,true));
for(const wood of ['oak','birch','poplar'])for(const roof of ['oak','spruce'])for(const chimney of [false,true])add('house',{wood,roof,chimney},source.sceneryHouseBlocks(wood,roof,chimney));
for(const [kind,value]of [['well',source.oracleWell()],['farm',source.oracleFarm()],['wreck',source.sceneryWreckBlocks()],['dock',source.sceneryDockBlocks()],['ruin',source.sceneryRuinBlocks()]])add(kind,{},value);
for(const cloth of ['brown_wool','white_wool','orange_wool'])add('camp',{cloth},source.sceneryCampBlocks(cloth));
for(const seed of ['world-default','中文世界 😀','a-seed'])add('rock',{seed},source.oracleRock(seed));
for(const seed of variants)add('ice',{seed},source.sceneryIceSpireBlocks(seed));
// Binary source values, not a Kotlin-generated expectation or JSON printer
// comparison. State keys use UTF-16 lexical order and coordinates remain f64;
// signed zero is normalized, as in the source JSON/cache and spatial keys.
function voxelHash(voxels){
 const hash=createHash('sha256');
 const int=n=>{const b=Buffer.alloc(4);b.writeInt32LE(n);hash.update(b);};
 const text=s=>{const b=Buffer.from(s,'utf8');int(b.length);hash.update(b);};
 for(const v of voxels){const b=Buffer.alloc(28);b.writeDoubleLE(v.x===0?0:v.x,0);b.writeDoubleLE(v.y===0?0:v.y,8);b.writeDoubleLE(v.z===0?0:v.z,16);b.writeInt32LE(v.buildOrder,24);hash.update(b);
  text(v.materialId);text(v.sourceBlockId);const entries=v.sourceBlockState?Object.entries(v.sourceBlockState).sort(([a],[b])=>a<b?-1:a>b?1:0):null;int(entries?.length??-1);
  for(const [k,value]of entries??[]){text(k);text(value);}
 }return hash.digest('hex');
}
function blockSummary(value){
 const refs=new Map(value.voxels.map((v,i)=>[v,i])),bytes=Buffer.alloc(value.distantVoxels.length*4);
 value.distantVoxels.forEach((v,i)=>{assert(refs.has(v));bytes.writeUInt32LE(refs.get(v),i*4);});
 return {count:value.voxels.length,distantCount:value.distantVoxels.length,voxels:voxelHash(value.voxels),distant:sha(bytes)};
}
const fields=[];
for(const seed of [0,1,0x80000000,0xffffffff])for(const radius of [26,132.7])for(let x=-280.5;x<=280.5;x+=56.125)for(let z=-244.25;z<=244.25;z+=61.375){
 const height=fields.length%53,cold=fields.length%3===0;
 fields.push({seed,radius,x,z,height,cold,hypot:Math.hypot(x,z),result:source.treeSuitability(x,z,seed,radius,height,cold),
  density:source.reefDensity(seed,x,z,32,-95,132,6+height/7),channel:source.reefChannel(seed,x,z),coverage:source.reefCoverage(seed,x,z,32,-95,132),
  biomes:['classic-island','natural-valley','ocean-island','mosaic-coast'].map(environment=>({environment,biome:source.sceneryBiome('中文世界 😀',x,z,environment,height)}))});
}
const reefs=[];
for(const seed of [0,1,31,0x80000000,0xffffffff])for(const mode of ['standalone','clipped','connected']){
 const originX=-40,originZ=80,halfX=17,halfZ=13;
 const allowed=(x,z)=>mode==='standalone'||(x>=-halfX&&x<halfX&&z>=-halfZ&&z<halfZ&&!(x>3&&z<-2));
 const field=mode!=='connected'?undefined:{originX,originZ,baseY:(x,z)=>Math.floor(-9+.02*(x+originX)+.03*(z+originZ)),
  density:(x,z)=>source.reefDensity(seed,x+originX,z+originZ,-20,55,56,9)};
 const value=source.createReefField(seed,halfX,halfZ,allowed,field);
 reefs.push({seed,mode,originX,originZ,halfX,halfZ,...blockSummary(value)});
}
const terrainOracle=JSON.parse(readFileSync(path.join(root,'apps/native-android/world-core/build/generated/terrain-oracle/terrain-oracle.json'),'utf8'));
for(const [name,expected]of Object.entries(terrainOracle.sourceHashes)){assert.equal(sha(readFileSync(path.join(root,name))),expected,'Stale scenery terrain: '+name);sourceHashes[name]=expected;}
const worlds=[];
for(const c of terrainOracle.cases.filter(c=>[':variant-0-count-0:',':variant-0-count-1:',':variant-0-count-25:'].some(s=>c.name.includes(s))&&c.minimumRadius===null
 ||c.name.includes(':variant-0-count-5:中文世界'))){
 const mesh=source.createSteppedTerrainData(c.placements,c.roads,c.pads,c.minimumRadius??undefined,{environmentStyle:c.environment,worldSeed:c.seed,terrainGenerationVersion:4,...(c.refined===null?{}:{refinedFar:c.refined})});
 const protectedRects=[...c.placements,...c.rewards.slice(0,2).map(r=>r.supported)].map(p=>({x:p.worldPosition.x,z:p.worldPosition.z,width:p.footprint.width+5,depth:p.footprint.depth+5}));
 const normalBounds=mesh.nearDetailBounds,mosaicCoreRadius=Math.max(Math.abs(mesh.framingBounds.minX),Math.abs(mesh.framingBounds.maxX));
 const result=source.planWorldScenery({environmentStyle:c.environment,worldSeed:c.seed,surfaces:source.terrainSurfaceTable(mesh),trees:mesh.naturalTrees,roads:c.roads,protectedRects,normalBounds,mosaicCoreRadius});
 worlds.push({name:c.name,environment:c.environment,seed:c.seed,placements:c.placements,roads:c.roads,pads:c.pads,minimumRadius:c.minimumRadius,refined:c.refined,
  protectedRects,normalBounds,mosaicCoreRadius,village:result.village,objects:result.objects.map(o=>{const {voxels,distantVoxels,...metadata}=o;return {...metadata,...blockSummary(o)};})});
}
assert.equal(worlds.length,16);
assert(worlds.some(w=>w.objects.some(o=>o.id.includes(':reef:'))),'Real warm-water coral not exercised');
assert(worlds.some(w=>w.objects.some(o=>o.role==='wreck')),'Real expanded-island wreck search not exercised');
for(const name of ['apps/native-android/tools/export-scenery-oracle.mjs','package-lock.json'])sourceHashes[name]=sha(readFileSync(path.join(root,name)));
const hypots=[[101,55],[1,115],[-101,55],[-1,-115],[55,101],[115,1],[0,0],[1e-280,2e-280],[1e280,2e280]].map(([x,z])=>({x,z,result:Math.hypot(x,z)}));
mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'scenery-oracle.json'),JSON.stringify({schema:2,sourceHashes,models,fields,hypots,reefs,worlds}));
console.log(JSON.stringify({models:models.length,voxels:models.reduce((n,m)=>n+m.voxels.length,0),fields:fields.length,reefs:reefs.length,worlds:worlds.length,
 sceneryObjects:worlds.reduce((n,w)=>n+w.objects.length,0),worldVoxels:worlds.reduce((n,w)=>n+w.objects.reduce((m,o)=>m+o.count,0),0),sources:Object.keys(sourceHashes).length}));
