import {build} from 'esbuild';
import ts from 'typescript';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];assert(output,'Original compiler oracle output required');
const sha=b=>createHash('sha256').update(b).digest('hex'),hashes={};
const rendererPath=path.join(root,'packages/voxel/src/renderer.ts'),renderer=readFileSync(rendererPath,'utf8');
const syntax=ts.createSourceFile(rendererPath,renderer,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),found=[];
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='compileOriginalBuildingShapes')found.push(node);ts.forEachChild(node,visit);}visit(syntax);
assert.equal(found.length,1,'The actual renderer compiler seam must still exist once');
let declaration=found[0].getText(syntax);
function replaceOnce(before,after){assert.equal(declaration.split(before).length,2,'Review changed source compiler: '+before);declaration=declaration.replace(before,after);}
// Hoist the actual function with its real imports, without evaluating a DOM
// renderer. Parameterize only its two existing budget constants for edge cases.
replaceOnce('indices:Map<BlueprintVoxel,number>)','indices:Map<BlueprintVoxel,number>,oracleTopologyLimit=64,oracleMaterialLimit=64)');
replaceOnce('planOriginalStaticShapeBatches(voxels)','planOriginalStaticShapeBatches(voxels,oracleTopologyLimit)');
replaceOnce(').key,64,',').key,oracleMaterialLimit,');
const imports=`import * as THREE from 'three';
import {planOriginalStaticShapeBatches,groupOriginalStaticShapeEntries,createOriginalStaticShapeComponentGeometry} from './original-static-shapes';
import {fallbackVisualStyleForOriginalComponent} from './fallback-visual';
import {sourceLanternEmissionForVoxel,sourceCandleEmissionForVoxel,effectiveEmissionIdentity} from './lighting';
import {captureCpuGeometry} from './building-cpu-cache';`;
const compiled=await build({stdin:{contents:imports+'\n'+declaration+'\nexport {compileOriginalBuildingShapes,sourceLanternEmissionForVoxel,sourceCandleEmissionForVoxel,effectiveEmissionIdentity};',loader:'ts',resolveDir:path.dirname(rendererPath),sourcefile:rendererPath},bundle:true,write:false,platform:'node',format:'esm',metafile:true,preserveSymlinks:true});
for(const input of Object.keys(compiled.metafile.inputs)){const absolute=path.resolve(input),name=path.relative(root,absolute).replaceAll('\\','/');assert(!name.startsWith('../'));hashes[name]=sha(readFileSync(absolute));}
hashes['packages/voxel/src/renderer.ts']=sha(readFileSync(rendererPath));
const source=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const shapes=JSON.parse(readFileSync(path.join(root,'apps/native-android/world-core/build/generated/original-shape-oracle/original-shape-oracle.json'),'utf8'));
for(const [name,expected]of Object.entries(shapes.sourceHashes)){assert.equal(sha(readFileSync(path.join(root,name))),expected);hashes[name]=expected;}
const styles=['stone','wood','plank','roof','glass','accent'];
const voxels=shapes.plans.filter(c=>!('sourceBlockState' in c.input)||c.input.sourceBlockState&&typeof c.input.sourceBlockState==='object'&&!Array.isArray(c.input.sourceBlockState)).map((c,i)=>({
 x:(i%31-15)*1.25,y:Math.floor(i/31)%16,z:(Math.floor(i/496)-1)*-1.5,materialId:styles[i%styles.length],buildOrder:0,...c.input}));
for(const kind of [undefined,'','light','soul-lantern','redstone','灯|光'])for(const level of [undefined,0,1,7,15])for(const id of ['lantern','soul_lantern','red_candle']){
 voxels.push({x:voxels.length%11,y:2,z:-8,materialId:'accent',buildOrder:0,sourceBlockId:'minecraft:'+id,
  sourceBlockState:id.endsWith('candle')?{candles:'3',lit:'true',waterlogged:'false'}:{hanging:'true',waterlogged:'false'},
  ...(kind===undefined?{}:{emissiveKind:kind}),...(level===undefined?{}:{emissiveLevel:level})});
}
const byteHash=a=>sha(Buffer.from(a.buffer,a.byteOffset,a.byteLength));
function summary(value){return {topologies:value.topologies,topologyOverflow:value.topologyOverflow,materialGroups:value.materialGroups,materialOverflow:value.materialOverflow,
 fallbackCount:value.fallbackCount,handled:[...value.handled],batches:value.batches.map(b=>({topologyKey:b.topologyKey,materialId:b.materialId,emissiveKind:b.emissiveKind,emissiveLevel:b.emissiveLevel,
  indices:[...b.indices],matrices:byteHash(b.matrices),attributes:Object.fromEntries(Object.entries(b.geometry.attributes).map(([name,a])=>[name,{itemSize:a.itemSize,length:a.array.length,sha:byteHash(a.array)}]))}))};}
const cases=[];
function add(name,values,topologies=64,materials=64){
 const actual=source.compileOriginalBuildingShapes(values,new Map(values.map((v,i)=>[v,i])),topologies,materials);
 const zero=n=>Object.is(n,-0)?'-0':n;
 cases.push({name,topologies:Number.isFinite(topologies)?topologies:String(topologies),materials:Number.isFinite(materials)?materials:String(materials),
  voxels:values.map(v=>({...v,x:zero(v.x),y:zero(v.y),z:zero(v.z)})),result:summary(actual)});
}
add('mixed-all',voxels);add('mixed-reversed',[...voxels].reverse());
for(const limit of [0,1,2,7,64,96,-1,NaN,Infinity])add('topology-'+String(limit),voxels,limit,64);
for(const limit of [0,1,2,7,64,96,NaN,Infinity])add('material-'+String(limit),voxels,64,limit);
add('empty',[]);
const emissions=voxels.map(voxel=>({voxel:{...voxel,x:0,y:0,z:0},effective:source.effectiveEmissionIdentity(voxel),lantern:source.sourceLanternEmissionForVoxel(voxel)??null,candle:source.sourceCandleEmissionForVoxel(voxel)??null}));
for(const name of ['apps/native-android/tools/export-original-compiler-oracle.mjs','package-lock.json'])hashes[name]=sha(readFileSync(path.join(root,name)));
mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'original-compiler-oracle.json'),JSON.stringify({schema:1,sourceHashes:hashes,cases,emissions}));
console.log(JSON.stringify({cases:cases.length,inputVoxels:voxels.length,emissions:emissions.length,batches:cases.reduce((n,c)=>n+c.result.batches.length,0),sources:Object.keys(hashes).length}));
