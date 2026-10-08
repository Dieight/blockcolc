import { describe,expect,it } from 'vitest';
import { sampleMosaicTerrain, mosaicRegionAt, mosaicGridPosition, mosaicSeed } from '../src/mosaic-terrain';
import { createSteppedTerrainData } from '../src/terrain';
import { terrainSurfaceRectangles } from '../src/renderer';
import { planWorldScenery, scenerySurfaceAt, sceneryGeometryLayers, surfaceSampler } from '../src/scenery';
import { sceneryPlanningFixture } from './scenery-planning-fixture';

describe('continuous composite environment',()=>{
 it('keeps the nine camera-space regions in the specified order with real relief',()=>{
   const spacing=mosaicGridPosition(0,0,26).spacing;
   const sample=(u:number,v:number)=>sampleMosaicTerrain((u+v)*spacing/Math.SQRT2,(v-u)*spacing/Math.SQRT2,1234,26);
   for(const [u,v,biome] of [[-1,-1,'snow-mountain'],[-1,0,'glacier'],[-1,1,'badlands'],[0,1.15,'badlands'],[1,-1,'ocean'],[1,1,'forest']] as const){
     expect(sample(u,v).biome).toBe(biome);expect(mosaicRegionAt((u+v)*spacing/Math.SQRT2,(v-u)*spacing/Math.SQRT2,26)).toBe(`${Math.round(v)+2}${u+2}`);
   }
   expect(sample(-1,-1).height).toBeGreaterThan(35);
   expect(sample(0,0).height).toBeLessThan(12);
   expect(sample(.25,-1).biome).toBe('ocean');
   expect(sample(1,-.35).biome).toBe('ocean');
   expect(sample(.65,.3).biome).not.toBe('badlands');
 });
 it('has connected sea, beach, plain, forest, valleys, snow, ice and badlands, deterministically',()=>{
   for(const seed of [1234,45211,89412]){
     const counts=new Map<string,number>();let jumps=0;
     for(let x=-700;x<=700;x+=8)for(let z=-700;z<=700;z+=8){const s=sampleMosaicTerrain(x,z,seed,26);counts.set(s.biome,(counts.get(s.biome)??0)+1);expect(Number.isFinite(s.height)).toBe(true);if(Math.abs(s.height-sampleMosaicTerrain(x+8,z,seed,26).height)>14)jumps++;}
     expect([...counts.keys()].sort()).toEqual(['badlands','beach','forest','glacier','ocean','plains','snow-mountain','valley']);
     expect(jumps).toBeLessThan(220);expect(sampleMosaicTerrain(172,-135,seed,26)).toEqual(sampleMosaicTerrain(172,-135,seed,26));
   }
 });
 it('uses common mesh, preserves protected construction surfaces and exports all new materials to samplers',()=>{
   const input=sceneryPlanningFixture('mosaic-coast',7,4);
   const terrain=createSteppedTerrainData([],[],[{x:0,z:0,width:20,depth:20,groundLevel:6}],undefined,{environmentStyle:'mosaic-coast',worldSeed:'mosaic-coast-regression',terrainGenerationVersion:4});
   const surfaces=terrainSurfaceRectangles(terrain);
   expect(scenerySurfaceAt(surfaces,0,0)!.supportY).toBeGreaterThanOrEqual(6);
   for(const id of ['grass','sand','snow','ice','terracotta','water'] as const)expect(terrain.indicesByMaterial[id].length).toBeGreaterThan(0);
   expect(input.protectedRects).toHaveLength(7);expect(terrain.positions.every(Number.isFinite)).toBe(true);
   expect(terrain.lodCellCounts.far).toBeGreaterThan(0);
 },30_000);
 it('forms a low sand shelf at sea edges rather than clipping the old relief into a beach wall',()=>{
   for(const seed of [1234,45211,89412]){
     let shores=0;
     for(let x=-340;x<=340;x+=4)for(let z=-340;z<=340;z+=4){
       const sample=sampleMosaicTerrain(x,z,seed,26);
       if(sample.material!=='sand')continue;
       expect(sample.height).toBeGreaterThanOrEqual(1);expect(sample.height).toBeLessThanOrEqual(3);
       if([[4,0],[-4,0],[0,4],[0,-4]].some(([dx,dz])=>sampleMosaicTerrain(x+dx!,z+dz!,seed,26).biome==='ocean'))shores++;
     }
     expect(shores).toBeGreaterThan(80);
   }
 });
 it.each([26,66])('joins warm and open sea without a dry diagonal seam at core radius %s',core=>{
   const spacing=mosaicGridPosition(0,0,core).spacing;
   for(const seed of [1234,45211,89412,mosaicSeed('world-default')])for(let u=.32;u<=1.4;u+=.025){
     const v=-1.1,s=sampleMosaicTerrain((u+v)*spacing/Math.SQRT2,(v-u)*spacing/Math.SQRT2,seed,core);
     expect(s.material,`dry seam at ${u.toFixed(3)} for ${seed}`).toBe('water');
   }
 });
});

describe('supported distant scenery',()=>{
 it.each([1,14,24])('does not mix legacy broadleaf trees into the snow/ice crown margin in a %s-building world',count=>{
   const input=sceneryPlanningFixture('mosaic-coast',count,4),at=surfaceSampler(input.surfaces),plan=planWorldScenery(input);
   const isolatedSand=input.surfaces.filter(s=>s.material==='sand'&&[[-12,0],[12,0],[0,-12],[0,12]].every(([dx,dz])=>at((s.minX+s.maxX)/2+dx!,(s.minZ+s.maxZ)/2+dz!)?.water));
   expect(isolatedSand).toEqual([]);
   const cold=plan.objects.filter(o=>o.role==='tree'&&[[0,0],[-8,0],[8,0],[0,-8],[0,8],[-6,-6],[-6,6],[6,-6],[6,6]].some(([dx,dz])=>['snow','ice'].includes(at(o.x+dx!,o.z+dz!)?.material??'')));
   expect(cold.length).toBeGreaterThan(5);
   for(const tree of cold){
     expect(tree.voxels.some(v=>v.sourceBlockId==='minecraft:spruce_log')).toBe(true);
     expect(tree.voxels.some(v=>/minecraft:(oak|birch)_log/.test(v.sourceBlockId??''))).toBe(false);
     expect(Math.max(...tree.voxels.map(v=>v.y))).toBeGreaterThanOrEqual(9);
   }
 },30_000);
 it.each(['world-default','world-portal-0','cold-edge-regression'])('uses only tall block spruce on the actual snow top, including blended edges: %s',worldSeed=>{
   const input=sceneryPlanningFixture('mosaic-coast',24,4,worldSeed),plan=planWorldScenery(input);
   const snowy=plan.objects.filter(o=>o.role==='tree'&&input.surfaces.some(s=>['snow','ice'].includes(s.material??'')&&o.x>=s.minX&&o.x<s.maxX&&o.z>=s.minZ&&o.z<s.maxZ));
   expect(snowy.length).toBeGreaterThan(5);
   for(const tree of snowy){
     expect(tree.voxels.some(v=>v.sourceBlockId==='minecraft:spruce_log')).toBe(true);
     expect(Math.max(...tree.voxels.map(v=>v.y))).toBeGreaterThanOrEqual(9);
   }
 },30_000);
 it('does not inherit the old valley bowl around a twenty-four-building construction area',()=>{
   const input=sceneryPlanningFixture('mosaic-coast',24,4);
   const outerX=Math.max(...input.protectedRects.map(rect=>Math.abs(rect.x)+rect.width/2));
   const outerZ=Math.max(...input.protectedRects.map(rect=>Math.abs(rect.z)+rect.depth/2));
   const radius=Math.hypot(outerX+9,outerZ+9);
   const center=input.surfaces.filter(surface=>{
     const p=mosaicGridPosition((surface.minX+surface.maxX)/2,(surface.minZ+surface.maxZ)/2,radius);
     return Math.abs(p.u)<.36&&Math.abs(p.v)<.36;
   });
   expect(center.length).toBeGreaterThan(100);
   expect(Math.max(...center.map(surface=>surface.supportY))).toBeLessThan(15);
 },30_000);
 it('places snow, mesa, forest and coastal structures in the matching real terrain regions',()=>{
   const input=sceneryPlanningFixture('mosaic-coast',24,4),plan=planWorldScenery(input);
   const names=plan.objects.map(object=>object.id);
   for(const suffix of [':camp:snow',':ruin:mesa',':house:forest',':camp:forest',':dock:coast'])expect(names.some(id=>id.endsWith(suffix)),`${suffix} absent; regional landmarks: ${names.filter(id=>/snow|mesa|forest|coast|ice-spike|reef/.test(id)).join(',')}`).toBe(true);
   expect(names.filter(id=>id.includes(':ice-spike:')).length).toBeGreaterThanOrEqual(3);
   expect(names.filter(id=>id.includes(':reef:')).length).toBeGreaterThanOrEqual(3);
   const poplars=plan.objects.filter(object=>object.role==='tree'&&object.voxels.some(voxel=>voxel.sourceBlockId==='minecraft:poplar_log'));
   expect(poplars.length).toBeGreaterThanOrEqual(40);
   for(const color of ['red','orange','yellow'])expect(poplars.some(object=>object.voxels.some(voxel=>voxel.sourceBlockId===`minecraft:${color}_poplar_leaves`))).toBe(true);
   const reefs=plan.objects.filter(object=>object.id.includes(':reef:'));
   const coral=reefs.flatMap(o=>o.voxels.filter(v=>v.sourceBlockId?.endsWith('_coral_block')).map(v=>({x:v.x+o.x,z:v.z+o.z})));
   expect(coral.length).toBeGreaterThan(4000);
   expect(Math.max(...coral.map(v=>v.x))-Math.min(...coral.map(v=>v.x))).toBeGreaterThan(90);
   expect(reefs.some(o=>o.voxels.some(v=>v.sourceBlockId?.endsWith('_coral_fan')))).toBe(true);
   expect(reefs.some(o=>o.voxels.some(v=>v.sourceBlockId==='minecraft:sea_pickle'))).toBe(true);
   // Adjacent culling tiles meet at real one-block columns, not prefab gaps.
   const floor=new Set(reefs.flatMap(o=>o.voxels.filter(v=>v.sourceBlockId==='minecraft:sand').map(v=>`${v.x+o.x}:${v.z+o.z}`)));
   const crossTile=coral.filter(v=>v.x%40===19&&floor.has(`${v.x+1}:${v.z}`));
   expect(crossTile.length).toBeGreaterThan(30);
   const spruces=plan.objects.filter(o=>o.role==='tree'&&o.voxels.some(v=>v.sourceBlockId==='minecraft:spruce_log'));
   expect(spruces.length).toBeGreaterThan(5);
   for(const tree of spruces)expect(tree.voxels.every(v=>Number.isInteger(v.x)&&Number.isInteger(v.y)&&Number.isInteger(v.z))).toBe(true);
   const coldTrees=plan.objects.filter(o=>{
     const material=input.surfaces.find(s=>o.x>=s.minX&&o.x<s.maxX&&o.z>=s.minZ&&o.z<s.maxZ)?.material;
     return o.role==='tree'&&(material==='snow'||material==='ice'||mosaicRegionAt(o.x,o.z,input.mosaicCoreRadius!)==='21'||sampleMosaicTerrain(o.x,o.z,mosaicSeed(input.worldSeed),input.mosaicCoreRadius!).biome==='glacier');
   });
   expect(coldTrees.length).toBeGreaterThan(5);
   for(const tree of coldTrees){
     expect(tree.voxels.some(v=>v.sourceBlockId==='minecraft:spruce_log')).toBe(true);
     expect(tree.voxels.some(v=>/minecraft:(oak|birch)_log/.test(v.sourceBlockId??''))).toBe(false);
     expect(Math.max(...tree.voxels.map(v=>v.y))).toBeGreaterThanOrEqual(9);
   }
   for(const reef of reefs){
     expect(reef.width).toBe(40);expect(reef.depth).toBe(40);
     expect(reef.voxels.length).toBeGreaterThanOrEqual(12);
     expect(Math.max(...reef.voxels.map(voxel=>reef.y+voxel.y+.5))).toBeLessThanOrEqual(0);
     for(const voxel of reef.voxels.filter(voxel=>/_coral$|_coral_fan$|sea_pickle$/.test(voxel.sourceBlockId??'')))expect(voxel.sourceBlockState?.waterlogged).toBe('true');
   }
 },60_000);
 it('reserves high earth cones and their flanks on the main ocean island',()=>{
   const surfaces=[];for(let x=-120;x<120;x+=4)for(let z=-120;z<120;z+=4){
     const cone=Math.hypot(x+60,z+60)<28;
     surfaces.push({minX:x,maxX:x+4,minZ:z,maxZ:z+4,supportY:cone?22:4,water:false,material:cone?'stone':'grass'});
   }
   const plan=planWorldScenery({environmentStyle:'ocean-island',worldSeed:'cone',surfaces,protectedRects:[{x:0,z:0,width:20,depth:20}],roads:[],trees:[{x:-60,z:-60,y:22,scale:1}],normalBounds:{minX:-120,maxX:120,minZ:-120,maxZ:120}});
   for(const object of plan.objects.filter(o=>['tree','garden','house','farm','well','camp'].includes(o.role)))expect(scenerySurfaceAt(surfaces,object.x,object.z)?.supportY).toBeLessThanOrEqual(9);
 });
 function flat(extent:number){const surfaces=[];for(let x=-extent;x<extent;x+=16)for(let z=-extent;z<extent;z+=16)surfaces.push({minX:x,maxX:x+16,minZ:z,maxZ:z+16,supportY:4,water:false,material:'grass'});return{environmentStyle:'natural-valley' as const,worldSeed:'far-scenery',surfaces,protectedRects:[{x:0,z:0,width:32,depth:32}],roads:[],trees:[],normalBounds:{minX:-64,maxX:64,minZ:-64,maxZ:64}};}
 it('retains block silhouettes in distant cells and grows regional totals with dry world area',()=>{
   const small=flat(256),big=flat(768),a=planWorldScenery(small),b=planWorldScenery(big);
   for(const role of ['tree','garden','house'])expect(b.objects.filter(o=>o.role===role).length).toBeGreaterThan(a.objects.filter(o=>o.role===role).length);
   expect(b.objects.filter(o=>o.role==='tree'&&Math.max(Math.abs(o.x),Math.abs(o.z))>64).length).toBeGreaterThan(40);
   for(const o of b.objects){expect(sceneryGeometryLayers(o)).not.toBeNull();if(o.role!=='path'&&o.role!=='garden')expect(o.y).toBe(4);}
   expect(planWorldScenery({...big,surfaces:[...big.surfaces].reverse()})).toEqual(b);
 });
 it('does not plant on sea, ice, construction or roads',()=>{
   const input=flat(256);input.surfaces=input.surfaces.map(s=>s.minX>96?{...s,water:true,material:'water'}:s.minZ>96?{...s,material:'ice'}:s);
   const plan=planWorldScenery(input);
   for(const o of plan.objects.filter(o=>o.role==='tree'||o.role==='garden')){
     const s=scenerySurfaceAt(input.surfaces,o.x,o.z)!;expect(s.water).toBe(false);expect(s.material).toBe('grass');expect(Math.abs(o.x)>20||Math.abs(o.z)>20).toBe(true);
   }
 });
 it('keeps existing primary landmarks while adding far coverage to real ocean and legacy valley terrain',()=>{
   for(const [style,count,version] of [['ocean-island',24,4],['natural-valley',1,3]] as const){
     const input=sceneryPlanningFixture(style,count,version);const old=planWorldScenery(input),next=planWorldScenery({...input,normalBounds:{minX:-128,maxX:128,minZ:-128,maxZ:128}});
     for(const item of old.objects.filter(o=>['wreck','dock','house','well','farm','camp','ruin'].includes(o.role)))expect(next.objects.find(o=>o.id===item.id)).toEqual(item);
   }
 },60_000);
});
