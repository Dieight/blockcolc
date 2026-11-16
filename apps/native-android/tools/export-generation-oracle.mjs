import {buildSync} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];
if(!output)throw Error('Generated oracle directory required');
const sourceHashes={},sha=b=>createHash('sha256').update(b).digest('hex');
const built=buildSync({entryPoints:[path.join(root,'packages/voxel/src/village.ts')],bundle:true,write:false,platform:'node',format:'esm',metafile:true});
for(const input of Object.keys(built.metafile.inputs)){
 const absolute=path.resolve(input),relative=path.relative(root,absolute).replaceAll('\\','/');
 assert.ok(!relative.startsWith('../'));sourceHashes[relative]=sha(readFileSync(absolute));
}
const {layoutVillage,roadCellsForVillage,villagePlazaFor,placeImportedDecorations,terrainHeightAt}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const supportBuild=buildSync({entryPoints:[path.join(root,'packages/voxel/src/terrain.ts')],bundle:true,write:false,platform:'node',format:'esm',metafile:true});
for(const input of Object.keys(supportBuild.metafile.inputs)){
 const absolute=path.resolve(input),relative=path.relative(root,absolute).replaceAll('\\','/');
 assert.ok(!relative.startsWith('../'));sourceHashes[relative]=sha(readFileSync(absolute));
}
const {settlementGroundHeightAt,settlementSupportHeightForPlacement,createRoadGeometryData}=await import('data:text/javascript;base64,'+Buffer.from(supportBuild.outputFiles[0].text).toString('base64'));
let rng=0xc01c2026;
const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
const blueprint=(i,variant)=>{const width=variant===0?13:1+Math.floor(random()*60),depth=variant===0?13:1+Math.floor(random()*60);
 const x=variant===0?0:Math.floor(random()*21)-10,z=variant===0?0:Math.floor(random()*21)-10;
 return {id:'generic-'+i,bounds:{minX:x,maxX:x+width-1,minY:0,maxY:4,minZ:z,maxZ:z+depth-1}};};
const layouts=[];
for(const variant of [0,1,2])for(const count of [0,1,2,5,12,25,37]){
 const inputs=Array.from({length:count},(_,i)=>({settlementIndex:i,blueprint:blueprint(i,variant)}));
 if(variant===2)inputs.reverse();const placements=layoutVillage(inputs),roads=roadCellsForVillage(placements);
 const hosts=placements.map((p,i)=>({...p,projectId:'p-'+inputs[i].settlementIndex}));
 const decorations=hosts.slice(0,Math.min(4,hosts.length)).flatMap((host,i)=>[0,1,2,3].map(turn=>({
  rewardId:`reward-${i}-${turn}`,resourceId:'reward-house',date:'2026-10-25',projectId:host.projectId,blueprint:blueprint(i,1),localPosition:{x:2+turn*.5,z:-3-turn},rotationQuarterTurns:turn
 })));
 decorations.push({rewardId:'missing',resourceId:'none',date:'2026-10-25',projectId:'missing',blueprint:blueprint(0,1),localPosition:{x:0,z:0},rotationQuarterTurns:0});
 layouts.push({name:`variant-${variant}-count-${count}`,inputs,placements,roads,plaza:villagePlazaFor(placements),decorations,hosts,decorationPlacements:placeImportedDecorations(decorations,hosts,roads)});
}
for(const indices of [[1],[2,0],[0,3,8],[15,3,1,8],[40,10,0]]){
 const inputs=indices.map(i=>({settlementIndex:i,blueprint:blueprint(i,1)}));const placements=layoutVillage(inputs),roads=roadCellsForVillage(placements);
 layouts.push({name:'sparse-'+indices.join('-'),inputs,placements,roads,plaza:villagePlazaFor(placements),decorations:[],hosts:[],decorationPlacements:[]});
}
for(const origin of [9007199254740000,-9007199254740000]){
 const inputs=[{settlementIndex:0,blueprint:{id:'large-origin',bounds:{minX:origin,maxX:origin+12,minY:0,maxY:0,minZ:origin,maxZ:origin+9}}}];
 const placements=layoutVillage(inputs),roads=roadCellsForVillage(placements);
 layouts.push({name:'large-origin-'+origin,inputs,placements,roads,plaza:villagePlazaFor(placements),decorations:[],hosts:[],decorationPlacements:[]});
}
const heights=[];
for(let x=-80;x<=80;x+=2.5)for(let z=-64;z<=64;z+=3.5)heights.push({x,z,height:terrainHeightAt(x,z)});
for(const x of [-24.5,-10.5,-3.5,0,3.5,10.5,24.5])for(const z of [-24.5,-3.5,0,3.5,24.5])heights.push({x,z,height:terrainHeightAt(x,z)});
const supports=[];
for(const layout of layouts)for(const environment of ['natural-valley','classic-island','ocean-island','mosaic-coast']){
 const placements=layout.placements.map(p=>{
  const initial=environment==='ocean-island'?{...p,worldPosition:{...p.worldPosition,y:Math.max(4,p.worldPosition.y)}}:p;
  const y=settlementSupportHeightForPlacement(initial,environment);return y>initial.worldPosition.y?{...initial,worldPosition:{...initial.worldPosition,y}}:initial;
 });
 const pads=placements.map(p=>({x:p.worldPosition.x,z:p.worldPosition.z,width:p.footprint.width,depth:p.footprint.depth,groundLevel:p.worldPosition.y}));
 const roads=roadCellsForVillage(placements),ground=(x,z)=>settlementGroundHeightAt(x,z,environment,placements,pads);
 // Exercise external support pads too, without allowing them into layout.
 const extraPads=[...pads,{x:-31.5,z:8.25,width:7,depth:4,groundLevel:6.5}];
 const samples=[];for(let x=-45;x<=45;x+=7.5)for(let z=-30;z<=30;z+=6.25)samples.push({x,z,height:settlementGroundHeightAt(x,z,environment,placements,extraPads)});
 const geometry=createRoadGeometryData(roads,placements,pads,ground);
 const sampleIndices=[...new Set([0,3,Math.floor(geometry.positions.length/6)*3,Math.max(0,geometry.positions.length-3)])].filter(i=>i<geometry.positions.length);
 supports.push({layout:layout.name,environment,placements,pads,extraPads,samples,roads,geometry:{cellCount:geometry.cellCount,triangleCount:geometry.triangleCount,vertexCount:geometry.positions.length/3,
  positionsSha:sha(Buffer.from(new Float32Array(geometry.positions).buffer)),indicesSha:sha(Buffer.from(new Uint32Array(geometry.indices).buffer)),
  samples:sampleIndices.map(index=>({index,values:geometry.positions.slice(index,index+3)}))}});
}
for(const file of ['apps/native-android/tools/export-generation-oracle.mjs','package-lock.json'])sourceHashes[file]=sha(readFileSync(path.join(root,file)));
mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'generation-oracle.json'),JSON.stringify({schema:1,locale:Intl.Collator().resolvedOptions().locale,sourceHashes,layouts,heights,supports}));
console.log(JSON.stringify({layouts:layouts.length,heights:heights.length,supports:supports.length,sources:Object.keys(sourceHashes).length}));
