import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];assert(output,'Terrain oracle directory required');
const hashes={},sha=b=>createHash('sha256').update(b).digest('hex');
const plugin={name:'expose-existing-pure-terrain-fields',setup(b){b.onLoad({filter:/[\\/]voxel[\\/]src[\\/]terrain\.ts$/},args=>{
 const source=readFileSync(args.path,'utf8');for(const name of ['sampleMacroTerrain','hash2d','fractalNoise','valueNoise'])assert(source.includes('function '+name+'('));
 return {contents:source+'\nexport {sampleMacroTerrain as oracleMacro,hash2d as oracleHash,fractalNoise as oracleFractal,valueNoise as oracleValue};',loader:'ts',resolveDir:path.dirname(args.path)};
});b.onLoad({filter:/[\\/]voxel[\\/]src[\\/]surface-index\.ts$/},args=>({
 contents:readFileSync(args.path,'utf8')+'\nexport {terrainSurfaceTable} from "./terrain-surface-table";',loader:'ts',resolveDir:path.dirname(args.path)
}));}};
async function load(relative){
 const compiled=await build({absWorkingDir:root,entryPoints:[relative],bundle:true,write:false,platform:'node',format:'esm',metafile:true,preserveSymlinks:true,plugins:[plugin]});
 for(const input of Object.keys(compiled.metafile.inputs)){const absolute=path.resolve(root,input),name=path.relative(root,absolute).replaceAll('\\','/');assert(!name.startsWith('../'));hashes[name]=sha(readFileSync(absolute));}
 return import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
}
const terrain=await load('packages/voxel/src/terrain.ts'),profile=await load('packages/voxel/src/terrain-profile.ts');
const fields=await load('packages/voxel/src/mosaic-fields.ts'),mosaic=await load('packages/voxel/src/mosaic-terrain.ts');
const land=await load('packages/voxel/src/landscape-fields.ts'),village=await load('packages/voxel/src/village.ts');
// Keep the table and its instanceof-dependent index in one bundled module.
const {terrainSurfaceTable,surfaceSampler,surfaceQuery,surfaceIndexBytes}=await load('packages/voxel/src/surface-index.ts');
const {supportImportedDecorations,decorationFoundationVoxels}=await load('packages/voxel/src/decoration-support.ts');
const bundledDirectory=path.join(root,'apps/native-android/world-core/build/generated/bundled-blueprints/native-blueprints');
const bundled=JSON.parse(readFileSync(path.join(bundledDirectory,'catalog.json'),'utf8'));
for(const [name,expected]of Object.entries(bundled.sourceHashes)){assert.equal(sha(readFileSync(path.join(root,name))),expected,'Stale reward source: '+name);hashes[name]=expected;}
const rewardSources=bundled.entries.filter(e=>e.category==='daily').sort((a,b)=>(b.bounds.maxX-b.bounds.minX+1)*(b.bounds.maxZ-b.bounds.minZ+1)-(a.bounds.maxX-a.bounds.minX+1)*(a.bounds.maxZ-a.bounds.minZ+1)).slice(0,2)
 .map(e=>{const bytes=readFileSync(path.join(bundledDirectory,e.sha256+'.json'));assert.equal(sha(bytes),e.sha256);return JSON.parse(bytes);});
const generation=JSON.parse(readFileSync(path.join(root,'apps/native-android/world-core/build/generated/generation-oracle/generation-oracle.json'),'utf8'));
for(const [name,expected]of Object.entries(generation.sourceHashes)){assert.equal(sha(readFileSync(path.join(root,name))),expected,'Stale terrain layout: '+name);hashes[name]=expected;}
const profiles=[];
function profileFor(environment,radius,refined){
 const p=profile.terrainGenerationProfile(environment==='mosaic-coast'?'natural-valley':environment,radius,4,refined);
 if(environment!=='mosaic-coast')return p;
 const align=n=>Math.ceil(n/16)*16,middle=align(Math.max(p.nearExtent+32,p.middleExtent*.8));
 return {...p,middleExtent:middle,farExtent:align(Math.max(middle+80,p.farExtent*.8)),farFineExtent:align(Math.max(middle,p.farFineExtent*.8))};
}
for(const environment of ['classic-island','natural-valley','ocean-island','mosaic-coast'])for(const radius of [0,26,69.99,70,70.01,96,134.7,227,520])for(const refined of [null,false,true])
 profiles.push({environment,radius,refined,result:profileFor(environment,radius,refined??undefined)});
const samples=[];
for(const seed of [0,0xffffffff,0x80000000,0x7168b28a])for(let x=-180.5;x<=180.5;x+=17.25)for(let z=-140.25;z<=140.25;z+=26.75){
 samples.push({seed,x,z,channel:0x171,hash:terrain.oracleHash(seed,0x171,Math.floor(x),Math.floor(z)),value:terrain.oracleValue(x*.021,z*.021,seed,0x171),
  fractal:terrain.oracleFractal(x*.021,z*.021,seed,0x171),landNoise:land.noise(seed,x,z,31),mosaicNoise:fields.mosaicNoise(seed,x,z,31),macro:terrain.oracleMacro(x,z,seed),coarse:terrain.oracleMacro(x,z,seed,true)});
}
const mosaicSamples=[];
for(const seed of [0,0xffffffff,0x7168b28a])for(const radius of [26,132.7])for(let x=-320.5;x<=320.5;x+=46.25)for(let z=-290.25;z<=290.25;z+=63.75){
 const probe=mosaicSamples.length%19===0;
 mosaicSamples.push({seed,radius,x,z,fields:fields.mosaicFields(x,z,seed,radius),sample:mosaic.sampleMosaicTerrain(x,z,seed,radius),grid:mosaic.mosaicGridPosition(x,z,radius),
  region:mosaic.mosaicRegionAt(x,z,radius),warm:mosaic.mosaicWarmSeaWeight(x,z,radius),...(probe?{shore:fields.mosaicShoreDistance(x,z,seed,radius),seabed:mosaic.mosaicSeabedHeight(x,z,seed,radius)}:{})});
}
const cases=[];
function add(layoutName,environment,seed='world-default',minimumRadius=null,refined=null){
 const layout=generation.layouts.find(c=>c.name===layoutName);assert(layout,layoutName);
 const placements=layout.placements.map(p=>{const height=terrain.settlementSupportHeightForPlacement({...p,worldPosition:{...p.worldPosition,y:environment==='ocean-island'?Math.max(4,p.worldPosition.y):p.worldPosition.y}},environment);
  return {...p,worldPosition:{...p.worldPosition,y:height}};});
 const roads=village.roadCellsForVillage(placements),pads=placements.map(p=>({x:p.worldPosition.x,z:p.worldPosition.z,width:p.footprint.width,depth:p.footprint.depth,groundLevel:p.worldPosition.y}));
 const data=terrain.createSteppedTerrainData(placements,roads,pads,minimumRadius??undefined,{environmentStyle:environment,worldSeed:seed,terrainGenerationVersion:4,...(refined===null?{}:{refinedFar:refined})});
 const geometry={positions:sha(Buffer.from(new Float32Array(data.positions).buffer)),tops:{},sides:{},vertexCount:data.positions.length/3};
 for(const [kind,indices]of Object.entries(data.indicesByMaterial))geometry.tops[kind]={length:indices.length,sha:sha(Buffer.from(new Uint32Array(indices).buffer))};
 for(const [kind,indices]of Object.entries(data.sideIndices))geometry.sides[kind]={length:indices.length,sha:sha(Buffer.from(new Uint32Array(indices).buffer))};
 const table=terrainSurfaceTable(data),sample=surfaceSampler(table),query=surfaceQuery(table);
 const points=[];for(const x of [-data.bounds.maxX-1,-data.nearDetailBounds.maxX,-32,-8,0,8,32,data.nearDetailBounds.maxX,data.bounds.maxX+1])for(const z of [-17.5,0,24.25])points.push({x,z,surface:sample(x,z)??null});
 const rectangles=[{minX:-6,maxX:6,minZ:-8,maxZ:8},{minX:data.nearDetailBounds.maxX-5,maxX:data.nearDetailBounds.maxX+7,minZ:-7,maxZ:9},
  {minX:data.bounds.maxX+1,maxX:data.bounds.maxX+9,minZ:-4,maxZ:4}];
 const surface={length:table.length,columnBytes:table.byteLength,indexBytes:surfaceIndexBytes(table),points,queries:rectangles.map(bounds=>({bounds,rows:query(bounds)})),
  rows:[-1,0,1,Math.floor(table.length/2),table.length-1,table.length].map(index=>({index,surface:table.at(index)??null}))};
 const rewards=[];
 if(layoutName==='variant-0-count-25'){
  const hosts=placements.map((p,index)=>({...p,projectId:'p'+index}));
  const imports=rewardSources.map((blueprint,index)=>({rewardId:'surface-'+index,resourceId:blueprint.id,date:'2026-10-25',projectId:'p0',blueprint,localPosition:{x:28+index*13,z:-34+index*9},rotationQuarterTurns:index}));
  const horizontal=village.placeImportedDecorations(imports,hosts,roads);
  const supported=supportImportedDecorations(horizontal,sample);
  supported.forEach((placement,index)=>rewards.push({input:horizontal[index],supported:placement,foundation:decorationFoundationVoxels(placement,sample)}));
  // Include an actual uneven generated site. Flat inhabited pads alone never
  // exercise the footing loop, even though placement height tests pass.
  for(let row=0;row<table.length;row+=Math.max(1,Math.floor(table.length/512))){
   const s=table.at(row);if(s.water)continue;
   const wanted={...imports[0],rewardId:'slope-support',localPosition:{x:(s.minX+s.maxX)/2-hosts[0].worldPosition.x,z:(s.minZ+s.maxZ)/2-hosts[0].worldPosition.z}};
   const h=village.placeImportedDecorations([wanted],hosts,roads)[0],lifted=supportImportedDecorations([h],sample)[0],foundation=decorationFoundationVoxels(lifted,sample);
   if(foundation.length){rewards.push({input:h,supported:lifted,foundation});break;}
  }
 }
 const {positions,indicesByMaterial,sideIndices,...metadata}=data;
 cases.push({name:`${environment}:${layoutName}:${seed}:${minimumRadius?.x??'auto'}:${refined}`,environment,seed,minimumRadius,refined,placements,roads,pads,geometry,metadata,surface,rewards});
}
for(const environment of ['classic-island','natural-valley','ocean-island','mosaic-coast']){
 for(const layout of ['variant-0-count-0','variant-0-count-1','variant-1-count-5','variant-0-count-25','variant-2-count-12','sparse-40-10-0','large-origin-9007199254740000'])add(layout,environment);
 add('variant-0-count-1',environment,'world-default',{x:64,z:40});
 add('variant-0-count-5',environment,'中文世界 😀');
}
for(const environment of ['natural-valley','mosaic-coast'])for(const refined of [false,true])add('variant-1-count-2',environment,'near-border',null,refined);
assert(cases.some(c=>c.rewards.some(r=>r.foundation.length>0)),'Uneven reward support branch was not exercised');
for(const name of ['apps/native-android/tools/export-terrain-oracle.mjs','package-lock.json'])hashes[name]=sha(readFileSync(path.join(root,name)));
mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'terrain-oracle.json'),JSON.stringify({schema:1,sourceHashes:hashes,profiles,samples,mosaicSamples,cases}));
console.log(JSON.stringify({profiles:profiles.length,fields:samples.length,mosaic:mosaicSamples.length,worlds:cases.length,
 rewardCases:cases.reduce((n,c)=>n+c.rewards.length,0),footings:cases.reduce((n,c)=>n+c.rewards.reduce((m,r)=>m+r.foundation.length,0),0),sources:Object.keys(hashes).length}));
