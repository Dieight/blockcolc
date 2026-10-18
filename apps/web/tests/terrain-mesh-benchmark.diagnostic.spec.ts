import { expect,test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('compares frozen JSON and numeric terrain grouping in an isolated browser',async({page},info)=>{
  test.setTimeout(240_000);
  const root=fileURLToPath(new URL('../../../packages/voxel/src/',import.meta.url));
  const directory=resolve(process.env.BLOCKCOLC_CHUNK_AUDIT_OUTPUT??fileURLToPath(new URL('../../../artifacts/performance/v2.8.0-terrain-chunks-20261016/',import.meta.url)));
  const reference=resolve(directory,'mesh-reference.ts'),metadata=JSON.parse(readFileSync(resolve(directory,'reference-source.json'),'utf8'));
  expect(createHash('sha256').update(readFileSync(reference)).digest('hex')).toBe(metadata.variants[reference]);
  await page.route('**/__terrain-mesh-benchmark__',route=>route.fulfill({contentType:'text/html',
    body:'<!doctype html><meta charset="utf-8"><title>Terrain CPU comparison, no App database</title>'}));
  await page.goto('/__terrain-mesh-benchmark__');
  const report=await page.evaluate(async({root,reference})=>{
    const {layoutWorlds,alignWorldsToEnvironment}=await import(`${root}renderer.ts`);
    const {createSteppedTerrainData,settlementSupportHeightForPlacement}=await import(`${root}terrain.ts`);
    const {roadCellsForVillage}=await import(`${root}village.ts`);
    const before=(await import(reference)).compactTerrainRenderMesh;
    const after=(await import(`${root}terrain-render-mesh.ts`)).compactTerrainRenderMesh;
    const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))))
      .map(n=>n.toString(16).padStart(2,'0')).join('');
    const rows=[];
    for(const style of ['classic-island','natural-valley','ocean-island','mosaic-coast']){
      const worlds=alignWorldsToEnvironment(layoutWorlds(Array.from({length:24},(_,settlementIndex)=>({
        projectId:`terrain-audit-${settlementIndex}`,settlementIndex,blueprintId:'builtin-small-workshop',
        buildingCompletionBasisPoints:5000,buildingConditionBasisPoints:10000,isMonument:false,
      }))),style).map((w:any)=>({...w,worldPosition:{...w.worldPosition,y:settlementSupportHeightForPlacement(w,style)}}));
      const roads=roadCellsForVillage(worlds),pads=worlds.map((w:any)=>({x:w.worldPosition.x,z:w.worldPosition.z,width:w.footprint.width,depth:w.footprint.depth,groundLevel:w.worldPosition.y}));
      const source=createSteppedTerrainData(worlds,roads,pads,undefined,{environmentStyle:style,worldSeed:'world-default',terrainGenerationVersion:4,refinedFar:true});
      const sourceHash=await digest(source),samples={reference:[] as number[],candidate:[] as number[]},hashes:string[]=[];
      before(source);after(source);
      for(let repeat=0;repeat<5;repeat++)for(const variant of repeat%2?['candidate','reference'] as const:['reference','candidate'] as const){
        const fn=variant==='reference'?before:after;
        const started=performance.now(),mesh=fn(source);
        samples[variant].push(performance.now()-started);
        hashes.push(await digest(mesh));
      }
      rows.push({style,count:24,samples,hashes,sourceHash,sourceUnchanged:await digest(source)===sourceHash});
    }
    return {userAgent:navigator.userAgent,scope:'Isolated desktop Chromium with mobile viewport; no App, IndexedDB, WebGL or Android. Warm JIT, five AB/BA pairs; generation, module imports and hashes excluded. No forced GC or fixed CPU frequency.',rows};
  },{root:`/@fs/${root.replaceAll('\\','/')}`,reference:`/@fs/${reference.replaceAll('\\','/')}`});
  for(const row of report.rows){expect(row.sourceUnchanged).toBe(true);expect(new Set(row.hashes).size).toBe(1);}
  expect(report.rows).toHaveLength(4);
  await info.attach('terrain-mesh-cpu.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});
  console.log(`TERRAIN_MESH_CPU ${JSON.stringify(report)}`);
});
