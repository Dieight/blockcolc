import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {createTerrainMeshBuffers} from '../src/terrain-mesh';
import {terrainSurfaceTable} from '../src/terrain-surface-table';
import {surfaceQuery,surfaceIndexBytes} from '../src/surface-index';
import {AnimalHabitat,obstacleSolids} from '../src/animal-habitat';
import {AnimalCommunity,speedForAnimal} from '../src/animal-behavior';
import {AnimalModels} from '../src/animal-models';
import {createAnimalWaterBed,patchAnimalWaterVisibility} from '../src/animal-water-bed';
import {WorldAnimals} from '../src/world-animals';
import type {MergedGeometryData} from '../src/terrain';
import {Navigator,Walker,PIG} from '../src/animal-navigation';
import type {BlueprintVoxel} from '../src/blueprint-model';

function terrain(){
  const mesh=createTerrainMeshBuffers();
  for(let x=-20;x<20;x++)for(let z=-20;z<20;z++){
    const water=x>=7,y=water?-.34:0;
    mesh.addTop([x,y,z,x,y,z+1,x+1,y,z+1,x+1,y,z],water?'water':'grass');
  }
  return terrainSurfaceTable(mesh);
}
function habitat(){const h=new AnimalHabitat(terrain(),{minX:-20,maxX:20,minZ:-20,maxZ:20},[],{x:0,y:0,z:0});while(!h.ready)h.advance(100);return h;}
function community(){const c=new AnimalCommunity(habitat(),'natural-valley',841);for(const _ of c.populate()){}return c;}

describe('production animal habitat and activity',()=>{
  it('queries exact terrain rectangles without duplicating large cells or retaining moving points',()=>{
    const table=terrain(),query=surfaceQuery(table),bytes=surfaceIndexBytes(table),b={minX:-2.1,maxX:2.1,minZ:-3.2,maxZ:3.2};
    const expected=[...table].filter(s=>s.minX<b.maxX&&s.maxX>b.minX&&s.minZ<b.maxZ&&s.maxZ>b.minZ);
    expect(query(b)).toEqual(expect.arrayContaining(expected));expect(query(b).length).toBe(expected.length);
    for(let i=0;i<1500;i++)query({minX:i*.01,maxX:i*.01+.5,minZ:0,maxZ:.5});
    expect(surfaceIndexBytes(table)).toBe(bytes);expect(query({...b,minX:NaN})).toEqual([]);
  });
  it('uses physical terrain tops and excludes water from land support',()=>{
    const h=habitat();expect(h.world.floors(0,0,PIG)[0]!.y).toBe(0);expect(h.waterAt(10,0)).toBeCloseTo(-.34);
    expect(h.waterAt(0,0)).toBeUndefined();expect(h.world.floors(10,0,PIG)).toEqual([]);
    expect(h.swimClear({x:10,y:-.9,z:0})).toBe(true);expect(h.swimClear({x:6.9,y:-.9,z:0})).toBe(false);
  });
  it('indexes only actual voxels, preserves offset/rotation and ignores foliage decals',()=>{
    const v={x:1,y:0,z:0,materialId:'stone',buildOrder:1,sourceBlockId:'minecraft:stone'} satisfies BlueprintVoxel;
    const source={id:'test',voxels:[v],origin:{x:10,y:3,z:12},rotation:Math.PI/2,offset:{x:1,z:0}};
    const solid=obstacleSolids(source,v,0)[0]!;expect(solid.minX).toBeCloseTo(9.5);expect(solid.maxX).toBeCloseTo(10.5);
    expect(solid.minZ).toBeCloseTo(9.5);expect(solid.maxY).toBeCloseTo(3.5);
    expect(obstacleSolids(source,{...v,sourceBlockId:'minecraft:poppy'},1)).toEqual([]);
    const h=new AnimalHabitat(terrain(),{minX:-20,maxX:20,minZ:-20,maxZ:20},[source],{x:0,y:0,z:0});
    expect(h.ready).toBe(false);while(!h.ready)h.advance(1);expect(h.indexedVoxels).toBe(1);
    expect(h.world.query({minX:9.9,maxX:10.1,minZ:9.9,maxZ:10.1}).some(s=>s.id==='test:0:0')).toBe(true);
  });
  it('can cancel collision preparation without further work',()=>{
    const h=new AnimalHabitat(terrain(),{minX:-20,maxX:20,minZ:-20,maxZ:20},[],{x:0,y:0,z:0});h.cancel();
    expect(h.advance()).toBe(false);expect(h.ready).toBe(false);
  });
  it('does not mistake solid grass blocks, flowering leaves or jack-o-lanterns for soft plants',()=>{
    for(const sourceBlockId of ['minecraft:grass_block','minecraft:flowering_azalea_leaves','minecraft:jack_o_lantern']){
      const voxel:BlueprintVoxel={x:0,y:0,z:0,materialId:'stone',buildOrder:1,sourceBlockId};
      expect(obstacleSolids({id:'solid',voxels:[voxel],origin:{x:0,y:0,z:0},rotation:0},voxel,0).length).toBeGreaterThan(0);
    }
  });
  it('uses an LRU shape budget rather than copying every indexed block into colliders',()=>{
    const voxels:BlueprintVoxel[]=Array.from({length:10000},(_,i)=>({x:i%100-50,y:1,z:Math.floor(i/100)-50,materialId:'stone',buildOrder:1,sourceBlockId:'minecraft:stone'}));
    const source={id:'large',voxels,origin:{x:0,y:0,z:0},rotation:0};
    const h=new AnimalHabitat(terrain(),{minX:-60,maxX:60,minZ:-60,maxZ:60},[source],{x:0,y:0,z:0});while(!h.ready)h.advance(100);
    expect(h.indexedVoxels).toBe(10000);expect(h.stats().cachedShapes).toBe(0);expect(h.world.solids.size).toBe(0);
    h.world.query({minX:-50,maxX:50,minZ:-50,maxZ:50});expect(h.stats().cachedShapes).toBeLessThanOrEqual(8192);
    expect(h.world.query({minX:-.01,maxX:.01,minZ:-.01,maxZ:.01}).some(s=>s.owner==='large')).toBe(true);
  });
  it('birth exclusions do not turn into invisible movement fences',()=>{
    const source={id:'birth-only',voxels:[],origin:{x:0,y:0,z:0},rotation:0,birthExclusion:{minX:-5,maxX:5,minZ:-5,maxZ:5}};
    const h=new AnimalHabitat(terrain(),{minX:-20,maxX:20,minZ:-20,maxZ:20},[source],{x:0,y:0,z:0});while(!h.ready)h.advance(100);
    expect(h.landSeeds.every(p=>Math.abs(p.x)>5||Math.abs(p.z)>5)).toBe(true);
    expect(new Navigator(h.world,PIG).plan({x:-6,y:0,z:0},{x:6,y:0,z:0}).reason).toBe('arrived');
  });
  it('populates four land species, river fish and varied birds without outside data',()=>{
    const c=community(),kinds=c.agents.map(a=>a.species);
    for(const id of ['sheep','cow','pig','horse','salmon','swallow','finch'])expect(kinds).toContain(id);
    expect(c.agents.length).toBeLessThanOrEqual(32);expect(c.agents.filter(a=>a.kind==='land').every(a=>c.habitat.world.clear(a.position,a.walker!.navigator.body))).toBe(true);
    c.dispose();
  });
  it.each([
    ['natural-valley',10,8,8],['ocean-island',0,15,8],['mosaic-coast',8,15,8],['classic-island',0,0,8],
  ] as const)('keeps the modest population budget for %s', (style,land,fish,birds)=>{
    const c=new AnimalCommunity(habitat(),style,841);for(const _ of c.populate()){}
    expect(c.agents.filter(a=>a.kind==='land')).toHaveLength(land);
    expect(c.agents.filter(a=>a.kind==='fish')).toHaveLength(fish);
    expect(c.agents.filter(a=>a.kind==='bird')).toHaveLength(birds);
    const models=new AnimalModels();models.update(c.agents,0);
    expect(models.parts.count).toBeLessThan(1536);expect(models.root.children).toHaveLength(4);
    models.dispose();c.dispose();
  });
  it('starts from the same safe births after recreation, without saving runtime positions',()=>{
    const first=community(),second=community(),births=second.agents.map(a=>({...a.position}));
    expect(first.agents.map(a=>a.position)).toEqual(births);
    first.agents[0]!.position.x+=1;expect(second.agents.map(a=>a.position)).toEqual(births);
    first.dispose();second.dispose();
  });
  it('varies speed by individual and over time while keeping finite positive limits',()=>{
    const c=community(),a=c.agents[0]!,speeds=Array.from({length:120},(_,i)=>speedForAnimal(a,i*.5));
    expect(Math.max(...speeds)-Math.min(...speeds)).toBeGreaterThan(.3);expect(Math.min(...speeds)).toBeGreaterThan(.3);
    expect(Math.max(...speeds)).toBeLessThan(4);expect(speedForAnimal(a,1)).not.toBe(speedForAnimal(c.agents[1]!,1));c.dispose();
  });
  it('starts fish in loose schools and birds away from land-animal bodies',()=>{
    const c=community(),fish=c.agents.filter(a=>a.kind==='fish');
    for(const a of fish)expect(fish.some(b=>b!==a&&b.school===a.school&&Math.hypot(b.position.x-a.position.x,b.position.z-a.position.z)<7)).toBe(true);
    for(const bird of c.agents.filter(a=>a.kind==='bird'))expect(c.agents.filter(a=>a.kind==='land').every(a=>Math.hypot(a.position.x-bird.position.x,a.position.z-bird.position.z)>3)).toBe(true);
    c.dispose();
  });
  it('alternates walking and rest, and a tap briefly stops rather than fleeing',async()=>{
    const c=community(),a=c.agents.find(a=>a.species==='sheep')!;await c.chooseWalk(a);expect(a.activity).toBe('walk');
    const before={...a.position};c.tap(a.id);for(let i=0;i<20;i++)c.update(.05,true);
    expect(a.position).toEqual(before);expect(a.reactions).toBe(1);
    for(let i=0;i<60;i++)c.update(.05,true);expect(a.traveled).toBeGreaterThan(.1);
    a.remaining=0;for(let i=0;i<20&&a.activity==='walk';i++)c.update(.05,true);expect(['graze','rest']).toContain(a.activity);
    expect(c.agents.some(a=>['graze','rest','perch'].includes(a.activity))).toBe(true);c.dispose();
  });
  it('allows curved/diagonal movement only when support and clearance remain valid',()=>{
    const h=habitat(),nav=new Navigator(h.world,PIG),a=new Walker(nav,{x:0,y:0,z:0});a.setTarget({x:4,y:0,z:0});a.curve=.2;
    let deviation=0;for(let i=0;i<240;i++){a.update(1/60);deviation=Math.max(deviation,Math.abs(a.position.z));expect(h.world.clear(a.position,PIG)).toBe(true);}
    expect(deviation).toBeGreaterThan(.1);expect(a.position.x).toBe(4);
    expect(nav.plan({x:0,y:0,z:0},{x:4,y:0,z:4}).points.length).toBeLessThan(9);
  });
  it('does not move under reduced motion but still finishes a tap response',()=>{
    const c=community(),positions=c.agents.map(a=>({...a.position}));c.tap(1);for(let i=0;i<40;i++)c.update(.05,false);
    expect(c.agents.map(a=>a.position)).toEqual(positions);expect(c.agents[0]!.response).toBe(0);expect(c.agents[0]!.reactions).toBe(1);c.dispose();
  });
  it('keeps swimming in real water and completes an occasional jump back into it',()=>{
    const c=community(),fish=c.agents.find(a=>a.kind==='fish')!;
    fish.position={x:12,y:-.94,z:0};fish.heading=0;fish.remaining=100;fish.activity='swim';fish.jumpCooldown=0;c.random=()=>0;
    c.update(.1,true,new Set([fish.id]));expect(fish.activity).toBe('jump');let maximum=-Infinity;
    for(let i=0;i<12;i++){c.update(.1,true,new Set([fish.id]));maximum=Math.max(maximum,fish.position.y);}
    expect(maximum).toBeGreaterThan(0);expect(fish.activity).toBe('swim');expect(c.habitat.swimClear(fish.position)).toBe(true);
    expect(fish.ripple).toBeGreaterThan(0);c.dispose();
  });
  it('does not jump through a solid roof or repeat immediately after landing',()=>{
    const c=community(),fish=c.agents.find(a=>a.kind==='fish')!;fish.position={x:12,y:-.94,z:0};fish.heading=0;fish.activity='swim';fish.remaining=50;fish.jumpCooldown=0;c.random=()=>0;
    c.habitat.world.replaceOwner('roof',[{id:'roof',owner:'roof',minX:11,maxX:13,minZ:.2,maxZ:2,minY:0,maxY:1}]);
    c.update(.1,true,new Set([fish.id]));expect(fish.activity).toBe('swim');c.dispose();
  });
  it('takes off, follows a curved flight, and lands before resting',()=>{
    const c=community(),bird=c.agents.find(a=>a.kind==='bird')!;bird.position={x:0,y:.08,z:0};bird.remaining=0;c.random=()=>0;
    c.update(.1,true,new Set([bird.id]));expect(bird.activity).toBe('takeoff');const states=new Set<string>();
    for(let i=0;i<170;i++){c.update(.1,true,new Set([bird.id]));states.add(bird.activity);if(bird.activity==='perch')break;}
    expect(states.has('fly')).toBe(true);expect(states.has('land')).toBe(true);expect(bird.activity).toBe('perch');expect(bird.position.y).toBeCloseTo(.08);c.dispose();
  });
  it('shares four bounded draw batches, uploads visible responses and disposes all resources',()=>{
    const c=community(),models=new AnimalModels();models.update(c.agents,0);
    expect(models.root.children.length).toBe(4);expect(models.parts.count).toBeLessThan(1536);
    const before=models.parts.instanceMatrix.array.slice();c.tap(1);c.update(.2,false);models.update(c.agents,.2);
    expect(models.parts.instanceMatrix.array).not.toEqual(before);expect(models.animalForHit(models.parts,0)).toBe(1);
    models.update(c.agents,.2,new Set());expect(models.parts.count).toBe(0);
    let disposed=0;models.parts.geometry.addEventListener('dispose',()=>disposed++);models.dispose();expect(disposed).toBe(1);c.dispose();
  });
  it('places the underwater bed below existing water only, without moving the shore',()=>{
    const table=terrain(),before=Array.from(table),bed=createAnimalWaterBed(table);
    expect(bed.indices.length).toBe(before.filter(s=>s.water).length*6);
    expect(bed.positions.filter((_,i)=>i%3===1).every(y=>y< -2)).toBe(true);expect(Array.from(table)).toEqual(before);
  });
  it('keeps close water clear and makes distant LOD sheets opaque without removing previous shader patches',()=>{
    const material=new THREE.MeshStandardMaterial({transparent:true,opacity:.7});let previous=0;
    material.onBeforeCompile=()=>{previous++;};patchAnimalWaterVisibility(material);
    const shader={fragmentShader:'#include <alphatest_fragment>'};material.onBeforeCompile(shader as never,{} as never);
    expect(previous).toBe(1);expect(shader.fragmentShader).toContain('smoothstep(24.0, 60.0, length(vViewPosition))');
    expect(material.customProgramCacheKey()).toContain('animal-water-visibility');expect(material.opacity).toBe(.7);material.dispose();
  });
  it('invalidates old flying trajectories after construction rather than clipping through new geometry',()=>{
    const mesh=createTerrainMeshBuffers();mesh.addTop([-20,0,-20,-20,0,20,20,0,20,20,0,-20],'grass');
    const data=Object.assign(mesh,{bounds:{minX:-20,maxX:20,minY:0,maxY:0,minZ:-20,maxZ:20}}) as unknown as MergedGeometryData;
    const parent=new THREE.Group(),layer=new WorldAnimals(parent,'classic-island',17),camera=new THREE.PerspectiveCamera(75,1,.1,200);
    camera.position.set(0,40,40);camera.lookAt(0,0,0);layer.sync(data,'terrain',[],{x:0,y:0,z:0});
    const matrix=new THREE.Matrix4();let now=0,airborne=false;
    for(let i=0;i<200;i++){now+=100;layer.tick(now,camera,true,true);if(!layer.diagnostics().ready)continue;
      layer.models.parts.getMatrixAt(0,matrix);if(matrix.elements[13]!>3){airborne=true;break;}}
    expect(airborne).toBe(true);
    const source={id:'new-wall',origin:{x:18,y:0,z:18},rotation:0,voxels:[{x:0,y:1,z:0,buildOrder:1,materialId:'stone' as const}]};
    layer.sync(data,'terrain',[source],{x:0,y:0,z:0});
    for(let i=0;i<80&&!layer.diagnostics().ready;i++){now+=100;layer.tick(now,camera,true,true);}
    expect(layer.diagnostics().ready).toBe(true);layer.models.parts.getMatrixAt(0,matrix);expect(matrix.elements[13]).toBeLessThan(1);layer.dispose();
  });
});
