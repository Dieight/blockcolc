/** Sampled Node JS heap, separate from CPU timing. Never an Android peak. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { alignWorldsToEnvironment,layoutWorlds } from '../src/renderer';
import { createSteppedTerrainData,settlementSupportHeightForPlacement } from '../src/terrain';
import { roadCellsForVillage } from '../src/village';
import { terrainSurfaceTable } from '../src/terrain-surface-table';
import { surfaceSampler } from '../src/surface-index';
import type { Compactor,Mesh } from './terrain-chunk-prototype';

const gc = (globalThis as { gc?:()=>void }).gc;
assert.ok(gc,'Run node --expose-gc node_modules/vite-node/vite-node.mjs packages/voxel/tools/terrain-mesh-heap.ts');
const root=resolve(process.env.BLOCKCOLC_CHUNK_AUDIT_OUTPUT??'artifacts/performance/v2.8.0-terrain-chunks-20261016');
const tag=process.env.BLOCKCOLC_CHUNK_AUDIT_TAG??'';
const report=resolve(root,`${tag}heap.json`);
assert.ok(!existsSync(report),'Keep existing memory evidence; use a new tag.');
const references=JSON.parse(readFileSync(resolve(root,'reference-source.json'),'utf8'));
const directory=resolve(root,`${tag}heap-instrumented`);mkdirSync(directory,{recursive:true});
const modules:Record<string,Compactor>={};
const selected=process.env.BLOCKCOLC_CHUNK_AUDIT_VARIANT==='adaptive'?'adaptive':'numeric';
for(const [name,file] of [['reference','mesh-reference.ts'],[selected,`mesh-${selected}.ts`]] as const){
  const original=resolve(root,file),path=resolve(directory,file);
  const expected=name==='adaptive'?JSON.parse(readFileSync(resolve(root,'adaptive-source.json'),'utf8')).variant:references.variants[original];
  assert.equal(createHash('sha256').update(readFileSync(original)).digest('hex'),expected);
  assert.ok(!existsSync(path),'Use a new memory output directory/tag rather than overwrite instruments.');
  const source=readFileSync(original,'utf8'),marker='  const result: Rect[] = [];';
  assert.equal(source.split(marker).length,2);
  writeFileSync(path,source.replace(marker,`  (globalThis as any).__blockcolcTerrainHeapSample?.('grouped');\n${marker}`));
  modules[name]=(await import(path.replaceAll('\\','/'))).compactTerrainRenderMesh as Compactor;
}
const hooks=globalThis as typeof globalThis & {__blockcolcTerrainHeapSample?:(phase:string)=>void};
const rows:unknown[]=[];
let retained:Mesh|null=null;
try{
  for(const style of ['classic-island','natural-valley','ocean-island','mosaic-coast'] as const){
    const worlds=alignWorldsToEnvironment(layoutWorlds(Array.from({length:24},(_,settlementIndex)=>({
      projectId:`terrain-audit-${settlementIndex}`,settlementIndex,blueprintId:'builtin-small-workshop',
      buildingCompletionBasisPoints:5000,buildingConditionBasisPoints:10000,isMonument:false,
    }))),style).map(w=>({...w,worldPosition:{...w.worldPosition,y:settlementSupportHeightForPlacement(w,style)}}));
    const roads=roadCellsForVillage(worlds),pads=worlds.map(w=>({x:w.worldPosition.x,z:w.worldPosition.z,width:w.footprint.width,depth:w.footprint.depth,groundLevel:w.worldPosition.y}));
    const source=createSteppedTerrainData(worlds,roads,pads,undefined,{environmentStyle:style,worldSeed:'world-default',terrainGenerationVersion:4,refinedFar:true});
    surfaceSampler(terrainSurfaceTable(source))(0,0);
    modules.reference!(source);modules[selected]!(source);
    const samples:unknown[]=[];let expected='';
    for(let repeat=0;repeat<5;repeat++)for(const variant of repeat%2?[selected,'reference']:['reference',selected]){
      retained=null;gc();
      const base=process.memoryUsage(),marks:Array<{phase:string;heapUsed:number;arrayBuffers:number}>=[];
      hooks.__blockcolcTerrainHeapSample=phase=>{const m=process.memoryUsage();marks.push({phase,heapUsed:m.heapUsed,arrayBuffers:m.arrayBuffers});};
      retained=modules[variant]!(source);
      hooks.__blockcolcTerrainHeapSample('complete');delete hooks.__blockcolcTerrainHeapSample;
      gc();const after=process.memoryUsage();
      const hash=createHash('sha256').update(JSON.stringify(retained)).digest('hex');
      if(!expected)expected=hash;else assert.equal(hash,expected,'Instrumentation must not change output');
      samples.push({variant,baseHeap:base.heapUsed,sampledHeap:Math.max(base.heapUsed,...marks.map(m=>m.heapUsed)),
        sampledExtra:Math.max(0,...marks.map(m=>m.heapUsed-base.heapUsed)),retainedDelta:after.heapUsed-base.heapUsed,marks});
    }
    rows.push({style,meshHash:expected,samples});
  }
}finally{delete hooks.__blockcolcTerrainHeapSample;retained=null;gc();}
writeFileSync(report,JSON.stringify({capturedAt:new Date().toISOString(),node:process.version,
  scope:'Node JS heap sampled after each grouping pass and after output. Explicit GC before each variant and after output; five AB/BA pairs. This is neither an exact allocation count nor actual heap/OS peak, Android memory or a CPU timing run.',
  rows},null,2));
console.log(JSON.stringify({report,cases:rows.length}));
