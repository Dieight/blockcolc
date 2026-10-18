/** CPU/geometry experiment. No App database, device, GPU or user blueprint. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { alignWorldsToEnvironment, layoutWorlds } from '../src/renderer';
import { createSteppedTerrainData, settlementSupportHeightForPlacement, terrainGenerationInputKey, type TerrainEnvironmentStyle } from '../src/terrain';
import { roadCellsForVillage } from '../src/village';
import { terrainSurfaceTable } from '../src/terrain-surface-table';
import { surfaceSampler } from '../src/surface-index';
import { terrainGeometryBytes, TERRAIN_CACHE_BYTES } from '../src/terrain-cache';
import { buildChunkMeshes, joinChunkMeshes, materialGroups, meshBytes, meshCoverageHash, type Compactor, type Mesh } from './terrain-chunk-prototype';
import type { BlueprintV1 } from '../src/blueprint';

const output = resolve(process.env.BLOCKCOLC_CHUNK_AUDIT_OUTPUT ?? 'artifacts/performance/v2.8.0-terrain-chunks-20261016');
mkdirSync(output,{recursive:true});
const sourcePath = resolve('packages/voxel/src/terrain-render-mesh.ts');
const frozenPath = resolve(output,'mesh-reference.ts'), templatePath = resolve(output,'mesh-template.ts'), numericPath = resolve(output,'mesh-numeric.ts');
const adaptivePath = resolve(output,'mesh-adaptive.ts');
const hashFile = (path:string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const digest = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dependencyFiles = ['terrain.ts','terrain-mesh.ts','terrain-profile.ts','mosaic-terrain.ts','village.ts','terrain-surface-table.ts','surface-index.ts','terrain-cache.ts'];
const keyCode = `    const key = JSON.stringify([rect.axis, rect.plane, rect.sign,
      axis === 'u' ? rect.v0 : rect.u0, axis === 'u' ? rect.v1 : rect.u1]);`;
const lookupCode = `  const groups = new Map<string, Rect[]>();
  const start = axis === 'u' ? 'u0' : 'v0', end = axis === 'u' ? 'u1' : 'v1';
  for (const rect of rects) {
${keyCode}
    const group = groups.get(key) ?? [];
    group.push(rect); groups.set(key, group);
  }`;
if (process.argv.includes('--freeze')) {
  for (const path of [frozenPath,templatePath,numericPath,resolve(output,'reference-source.json')]) assert.ok(!existsSync(path),'Use a new experiment directory; do not overwrite evidence.');
  const source = readFileSync(sourcePath,'utf8');
  assert.ok(source.includes(lookupCode),'Capture the JSON-key implementation before comparing alternatives.');
  const resolveImports = (code:string) => code.replace(/from (["'])(\.\/[^"']+)\1/g,(_all,quote,specifier)=>
    `from ${quote}${resolve(dirname(sourcePath),`${specifier}.ts`).replaceAll('\\','/')}${quote}`);
  writeFileSync(frozenPath,resolveImports(source));
  const templateCode = `    const key = \`\${rect.axis}:\${rect.plane}:\${rect.sign}:\${axis === 'u' ? rect.v0 : rect.u0}:\${axis === 'u' ? rect.v1 : rect.u1}\`;`;
  writeFileSync(templatePath,resolveImports(source.replace(keyCode,templateCode)));
  const numericLookup = `  const groups: Rect[][] = [];
  const lookup = new Map<number,Map<number,Map<number,Map<number,Rect[]>>>>();
  const start = axis === 'u' ? 'u0' : 'v0', end = axis === 'u' ? 'u1' : 'v1';
  for (const rect of rects) {
    const direction = rect.axis * 3 + rect.sign;
    let planes = lookup.get(direction);
    if (!planes) { planes = new Map(); lookup.set(direction,planes); }
    let minima = planes.get(rect.plane);
    if (!minima) { minima = new Map(); planes.set(rect.plane,minima); }
    const low = axis === 'u' ? rect.v0 : rect.u0, high = axis === 'u' ? rect.v1 : rect.u1;
    let maxima = minima.get(low);
    if (!maxima) { maxima = new Map(); minima.set(low,maxima); }
    let group = maxima.get(high);
    if (!group) { group = []; maxima.set(high,group); groups.push(group); }
    group.push(rect);
  }`;
  writeFileSync(numericPath,resolveImports(source.replace(lookupCode,numericLookup).replace('for (const group of groups.values())','for (const group of groups)')));
  writeFileSync(resolve(output,'reference-source.json'),JSON.stringify({capturedAt:new Date().toISOString(),source:hashFile(sourcePath),
    dependencies:Object.fromEntries(dependencyFiles.map(file=>[file,hashFile(resolve('packages/voxel/src',file))])),
    variants:Object.fromEntries([frozenPath,templatePath,numericPath].map(path=>[path,hashFile(path)])),
  },null,2));
  console.log(`Frozen mesh reference and two mechanical grouping variants: ${output}`);
  process.exit(0);
}

const frozen = JSON.parse(readFileSync(resolve(output,'reference-source.json'),'utf8'));
for (const [file,hash] of Object.entries(frozen.dependencies)) assert.equal(hashFile(resolve('packages/voxel/src',file)),hash,`Dependency changed: ${file}`);
for (const [path,hash] of Object.entries(frozen.variants)) assert.equal(hashFile(path),hash,`Frozen variant changed: ${path}`);
if (process.argv.includes('--prepare-adaptive')) {
  const metadataPath=resolve(output,'adaptive-source.json');
  assert.ok(!existsSync(adaptivePath)&&!existsSync(metadataPath),'Preserve the first adaptive candidate.');
  const source=readFileSync(numericPath,'utf8'),start=source.indexOf('  const groups: Rect[][] = [];'),end=source.indexOf('  const result: Rect[] = [];',start);
  assert.ok(start>=0&&end>start);
  const lookup=`  const groups: Rect[][] = [];
  type SingleGroup = { high: number; rects: Rect[] };
  type RangeBucket = SingleGroup | Map<number,Rect[]>;
  const lookup = new Map<number,Map<number,Map<number,RangeBucket>>>();
  const start = axis === 'u' ? 'u0' : 'v0', end = axis === 'u' ? 'u1' : 'v1';
  for (const rect of rects) {
    const direction = rect.axis * 3 + rect.sign;
    let planes = lookup.get(direction);
    if (!planes) { planes = new Map(); lookup.set(direction,planes); }
    let minima = planes.get(rect.plane);
    if (!minima) { minima = new Map(); planes.set(rect.plane,minima); }
    const low = axis === 'u' ? rect.v0 : rect.u0, high = axis === 'u' ? rect.v1 : rect.u1;
    const bucket = minima.get(low);
    let group: Rect[];
    if (!bucket) {
      group = []; minima.set(low,{high,rects:group}); groups.push(group);
    } else if (bucket instanceof Map) {
      const existing = bucket.get(high);
      if (existing) group = existing;
      else { group = []; bucket.set(high,group); groups.push(group); }
    } else if (bucket.high === high) group = bucket.rects;
    else {
      group = [];
      const multiple = new Map<number,Rect[]>();
      multiple.set(bucket.high,bucket.rects); multiple.set(high,group);
      minima.set(low,multiple); groups.push(group);
    }
    group.push(rect);
  }
  lookup.clear();
`;
  writeFileSync(adaptivePath,source.slice(0,start)+lookup+source.slice(end));
  writeFileSync(metadataPath,JSON.stringify({capturedAt:new Date().toISOString(),parent:hashFile(numericPath),variant:hashFile(adaptivePath)},null,2));
  console.log(`Prepared adaptive numeric leaf candidate: ${adaptivePath}`);process.exit(0);
}
const reference = (await import(frozenPath.replaceAll('\\','/'))).compactTerrainRenderMesh as Compactor;
const template = (await import(templatePath.replaceAll('\\','/'))).compactTerrainRenderMesh as Compactor;
const numeric = (await import(numericPath.replaceAll('\\','/'))).compactTerrainRenderMesh as Compactor;
let adaptive:Compactor|undefined;
if (existsSync(adaptivePath)) {
  const metadata=JSON.parse(readFileSync(resolve(output,'adaptive-source.json'),'utf8'));
  assert.equal(hashFile(adaptivePath),metadata.variant);assert.equal(hashFile(numericPath),metadata.parent);
  adaptive=(await import(adaptivePath.replaceAll('\\','/'))).compactTerrainRenderMesh as Compactor;
}
const current = (await import('../src/terrain-render-mesh')).compactTerrainRenderMesh;
const quick = process.argv.includes('--quick'), transitionsOnly = process.argv.includes('--transitions');
const selected = process.env.BLOCKCOLC_CHUNK_AUDIT_VARIANT ?? 'template';
assert.ok(['template','numeric','adaptive','current'].includes(selected));
const candidate = selected === 'template' ? template : selected === 'numeric' ? numeric : selected==='adaptive'?adaptive!:current;
assert.ok(candidate,'Prepare the selected candidate first');
const tag = process.env.BLOCKCOLC_CHUNK_AUDIT_TAG ?? '';
const reportPath = resolve(output,`${tag}${transitionsOnly?'transitions':quick?'quick':'comparison'}.json`);
assert.ok(!existsSync(reportPath),'Keep earlier runs; select a fresh report tag.');
const styles:TerrainEnvironmentStyle[] = ['classic-island','natural-valley','ocean-island','mosaic-coast'];
const cases:{style:TerrainEnvironmentStyle;count:number;detail?:'auto'|'coarse';wide?:boolean}[] =
  styles.flatMap(style=>[1,24,60].map(count=>({style,count})));
cases.push({style:'natural-valley',count:24,detail:'auto'},{style:'natural-valley',count:24,detail:'coarse'},
  {style:'mosaic-coast',count:24,detail:'coarse'},{style:'mosaic-coast',count:1,wide:true});
const makeWorld = (style:TerrainEnvironmentStyle,count:number,worldSeed:string,detail?:'auto'|'coarse',wide=false) => {
  const blueprint:BlueprintV1 = {schemaVersion:1,id:'audit-wide-60',title:'Synthetic 60x60 foundation',
    bounds:{minX:-30,maxX:29,minY:0,maxY:0,minZ:-30,maxZ:29},voxels:[{x:0,y:0,z:0,materialId:'stone',buildOrder:10000}]};
  const worlds=alignWorldsToEnvironment(layoutWorlds(Array.from({length:count},(_,settlementIndex)=>({
    projectId:`terrain-audit-${settlementIndex}`,settlementIndex,blueprintId:'builtin-small-workshop',
    buildingCompletionBasisPoints:5000,buildingConditionBasisPoints:10000,isMonument:false,
  })),wide?()=>blueprint:undefined),style).map(w=>({...w,worldPosition:{...w.worldPosition,y:settlementSupportHeightForPlacement(w,style)}}));
  const roads=roadCellsForVillage(worlds),pads=worlds.map(w=>({x:w.worldPosition.x,z:w.worldPosition.z,width:w.footprint.width,depth:w.footprint.depth,groundLevel:w.worldPosition.y}));
  const options={environmentStyle:style,worldSeed,terrainGenerationVersion:4 as const,refinedFar:detail==='auto'?undefined:detail!=='coarse'};
  const started=performance.now(),data=createSteppedTerrainData(worlds,roads,pads,undefined,options),generationMs=performance.now()-started;
  // Model the auxiliary surface/index memory already present before meshing.
  surfaceSampler(terrainSurfaceTable(data))(0,0);
  const namespace=JSON.stringify([style,worldSeed,4,data.bounds,data.nearDetailBounds,data.framingBounds,data.lodCellCounts]);
  return {data,generationMs,namespace,key:terrainGenerationInputKey(worlds,roads,pads,undefined,options),
    auxiliaryBytes:terrainGeometryBytes(data)-meshBytes(data)};
};

const rows:unknown[]=[];
if (transitionsOnly) {
  for (const style of styles) {
    const targets = process.argv.includes('--global-invalidations') ? [[60,'world-default'],[24,'terrain-audit-280']] as const : [[25,'world-default']] as const;
    for (const [targetCount,targetSeed] of targets) {
    const before=makeWorld(style,24,'world-default'),after=makeWorld(style,targetCount,targetSeed);
    const previousTerrainHash=digest(before.data),nextTerrainHash=digest(after.data),coverage=meshCoverageHash(reference(after.data));
    assert.notEqual(before.key,after.key,'New construction must change the whole-terrain input key');
    for (const size of [64,128,256]) {
      const prepared=buildChunkMeshes(before.data,size,reference,undefined,before.namespace);
      const retained=prepared.bytes+before.auxiliaryBytes<=TERRAIN_CACHE_BYTES;
      const previous=retained?prepared:undefined;
      const samples={reference:[] as number[],candidate:[] as number[]},joinSamples:number[]=[];
      reference(after.data);buildChunkMeshes(after.data,size,reference,previous,after.namespace);
      let result!:ReturnType<typeof buildChunkMeshes>,joined!:Mesh;
      for(let repeat=0;repeat<5;repeat++)for(const variant of repeat%2?['candidate','reference'] as const:['reference','candidate'] as const){
        const start=performance.now();
        if(variant==='reference')reference(after.data);
        else result=buildChunkMeshes(after.data,size,reference,previous,after.namespace);
        samples[variant].push(performance.now()-start);
        if(variant==='candidate'){
          const joinStart=performance.now();joined=joinChunkMeshes(result.chunks);joinSamples.push(performance.now()-joinStart);
        }
      }
      assert.equal(meshCoverageHash(joined),coverage,'Transition coverage, including cross-chunk sides');
      rows.push({style,from:24,to:targetCount,targetSeed,size,previousRetained:retained,namespaceStable:before.namespace===after.namespace,
        generationBeforeMs:before.generationMs,generationAfterMs:after.generationMs,previousBytes:prepared.bytes+before.auxiliaryBytes,
        resultBytes:result.bytes+after.auxiliaryBytes,joinedBytes:meshBytes(joined),hits:result.hits,misses:result.misses,
        chunks:result.chunks.length,triangles:result.triangleCount,materialGroups:result.materialGroups,samples,joinSamples,
        previousTerrainHash,nextTerrainHash,coverage});
    }
    }
  }
} else {
  for(const {style,count,detail,wide} of quick?cases.filter(c=>c.count===24&&!c.detail):cases){
    for(const worldSeed of quick?['world-default']:['world-default','terrain-audit-280']){
      const fixture=makeWorld(style,count,worldSeed,detail,wide),source=fixture.data,terrainHash=digest(source);
      const baseline=reference(source),baselineHash=digest(baseline),coverage=meshCoverageHash(baseline);
      assert.equal(meshCoverageHash(source),coverage,'Baseline coverage oracle');
      const methods=quick?(process.argv.includes('--adaptive-only')?['adaptive']:['template','numeric','chunk-64','chunk-128','chunk-256']):['selected'];
      const measurements:unknown[]=[];
      for(const mode of methods){
        const size=mode.startsWith('chunk-')?Number(mode.slice(6)):0;
        const compact=mode==='template'?template:mode==='numeric'?numeric:mode==='adaptive'?adaptive!:candidate;
        const evaluate=()=>{
          if(!size)return {mesh:compact(source),chunks:0,groups:materialGroups(baseline),bytes:0};
          const chunks=buildChunkMeshes(source,size,reference,undefined,fixture.namespace);
          return {mesh:joinChunkMeshes(chunks.chunks),chunks:chunks.chunks.length,groups:chunks.materialGroups,bytes:chunks.bytes+fixture.auxiliaryBytes};
        };
        const repeats=quick?3:count===24&&!detail&&worldSeed==='world-default'?5:1;
        const samples={reference:[] as number[],candidate:[] as number[]};
        reference(source);evaluate();
        let result!:ReturnType<typeof evaluate>,expected='';
        for(let repeat=0;repeat<repeats;repeat++)for(const variant of repeat%2?['candidate','reference'] as const:['reference','candidate'] as const){
          const start=performance.now();
          if(variant==='reference')reference(source);else result=evaluate();
          samples[variant].push(performance.now()-start);
          if(variant==='candidate'){
            const hash=digest(result.mesh);
            if(!expected)expected=hash;else assert.equal(hash,expected,'Variant determinism');
            if(!size)assert.equal(hash,baselineHash,`Full numeric result and emission order: ${style}/${count}/${mode}`);
          }
        }
        assert.equal(meshCoverageHash(result.mesh),coverage,`Coverage including holes, duplicate counts and winding: ${style}/${count}/${mode}`);
        measurements.push({mode:selected==='current'&&mode==='selected'?'current':mode,samples,meshHash:expected,triangles:result.mesh.triangleCount,
          chunkCount:result.chunks,separateMaterialGroups:result.groups,prototypeBytes:result.bytes,
          joinedBytes:meshBytes(result.mesh),singleMeshGroups:materialGroups(result.mesh)});
      }
      assert.equal(digest(source),terrainHash,'Source geometry is read-only');
      rows.push({style,count,worldSeed,detail:detail??'refined',wide:!!wide,generationMs:fixture.generationMs,
        terrainHash,meshHash:baselineHash,coverage,sourceBytes:terrainGeometryBytes(source),baselineBytes:meshBytes(baseline),
        baselineTriangles:baseline.triangleCount,baselineGroups:materialGroups(baseline),measurements});
    }
  }
}
writeFileSync(reportPath,JSON.stringify({capturedAt:new Date().toISOString(),node:process.version,selected,
  scope:transitionsOnly?'CPU only. Global generation runs for both inputs and is outside mesh timing. 24-to-25 buildings by default; --global-invalidations tests 24-to-60 and changed seed. One retained prior layout only, 32 MiB budget including source, partitions, meshes and auxiliary table/index. Five paired AB/BA samples. Join time recorded separately. No GPU, device or startup measurement.'
    :`CPU only. Global generation and coverage/hash checks excluded. ${quick?'Three paired AB/BA samples per method and environment. Chunk samples include partition, compaction and joining.':'Five paired AB/BA samples only for 24/default/refined, other inputs one equivalence pair.'} No database, GPU or device.`,
  sourceHashes:{...Object.fromEntries(dependencyFiles.map(file=>[file,hashFile(resolve('packages/voxel/src',file))])),
    'terrain-render-mesh.ts':hashFile(sourcePath),'prototype':hashFile(resolve('packages/voxel/tools/terrain-chunk-prototype.ts'))},
  referenceSource:frozen,rows},null,2));
console.log(JSON.stringify({report:reportPath,cases:rows.length}));
