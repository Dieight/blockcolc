import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {buildingCpuKey,prepareBuildingCpuRecipe,captureCpuGeometry,restoreCpuGeometry,restoreBuildingCpuCache,prepareBuildingCpuCache,createBuildingCpuCache,buildingCpuCacheBytes,type BuildingCpuCache} from '../src/building-cpu-cache';
import {validateBlueprint} from '../src/blueprint-model';
function blueprint(){return validateBlueprint({schemaVersion:1,id:'building-cache',title:'Cache',bounds:{minX:0,maxX:1,minY:0,maxY:0,minZ:0,maxZ:0},voxels:[{x:0,y:0,z:0,materialId:'stone',stage:'foundation',buildOrder:5000},{x:1,y:0,z:0,materialId:'wood',stage:'details',buildOrder:10000}]});}
function recipe(){const b=blueprint();return prepareBuildingCpuRecipe(buildingCpuKey(b,'p',10000,10000),b,'p',10000,10000);}
const entry=():BuildingCpuCache=>({revision:2,recipes:[recipe()]});
describe('derived CPU building cache',()=>{
  it('restores structured-cloned local geometry and AO',()=>{
    const before=entry(),cache=createBuildingCpuCache();expect(cache.restore(structuredClone(before))).toBe(true);
    expect(cache.get(before.recipes[0]!.key)).toEqual(before.recipes[0]);expect(buildingCpuCacheBytes(cache.snapshot())).toBeGreaterThan(0);
  });
  it('invalidates changed content even under an unchanged blueprint ID',()=>{
    const before=blueprint();let changed=structuredClone(before);changed.voxels[0]!.sourceBlockState={axis:'x'};
    expect(buildingCpuKey(before,'p',10000,10000)).not.toBe(buildingCpuKey(changed,'p',10000,10000));
    expect(buildingCpuKey(before,'p',5000,10000)).not.toBe(buildingCpuKey(before,'p',10000,10000));
    expect(buildingCpuKey(before,'p',10000,5000)).not.toBe(buildingCpuKey(before,'p',10000,10000));
    changed=structuredClone(before);changed.title='Renamed';expect(buildingCpuKey(changed,'p',10000,10000)).toBe(buildingCpuKey(before,'p',10000,10000));
  });
  it('saves vertices and indices without saving a Three.js or GPU object',()=>{
    const original=new THREE.BoxGeometry(.97,.97,.97),cpu=captureCpuGeometry(original),restored=restoreCpuGeometry(structuredClone(cpu));
    expect([...restored.getAttribute('position').array]).toEqual([...original.getAttribute('position').array]);expect([...restored.index!.array]).toEqual([...original.index!.array]);expect(cpu).not.toBeInstanceOf(THREE.BufferGeometry);original.dispose();restored.dispose();
  });
  it('rejects old revisions, non-finite AO and unsafe geometry indices',()=>{
    expect(restoreBuildingCpuCache({...entry(),revision:999})).toBeNull();const corrupt=entry();corrupt.recipes[0]!.occlusion[0]=NaN;expect(restoreBuildingCpuCache(corrupt)).toBeNull();
    const original=new THREE.BoxGeometry(1,1,1),geometry=captureCpuGeometry(original);original.dispose();geometry.index![0]=1_000_000;
    const invalid=entry();invalid.recipes[0]!.originals.set('0',{batches:[{topologyKey:'cube',materialId:'stone',emissiveKind:'',emissiveLevel:0,indices:Uint32Array.of(0),matrices:new Float32Array(16),geometry}],handled:Uint32Array.of(0),topologies:1,topologyOverflow:0,materialGroups:1,materialOverflow:0,fallbackCount:0});
    expect(restoreBuildingCpuCache(invalid)).toBeNull();expect(restoreBuildingCpuCache({revision:2,recipes:[]})).not.toBeNull();
  });
  it('round trips scenery surface buffers and rejects unsafe vertex ownership',()=>{
    const value=entry(),geometry=new THREE.BoxGeometry(1,1,1),cpu=captureCpuGeometry(geometry);geometry.dispose();
    const count=cpu.attributes.position!.array.length/3;
    value.recipes[0]!.staticSurfaces=new Map([['reef',{geometry:cpu,voxelIndices:new Uint32Array(count),occlusions:Float64Array.of(.125,.5)}],['empty',null]]);
    expect(restoreBuildingCpuCache(structuredClone(value))).toEqual(value);
    value.recipes[0]!.staticSurfaces.get('reef')!.voxelIndices[0]=2;expect(restoreBuildingCpuCache(value)).toBeNull();
  });
  it('does not flush useful recipes when one oversized recipe is skipped',()=>{
    const cache=createBuildingCpuCache(),good=recipe();cache.put(good);
    const huge={...recipe(),key:'oversized',cubeMatrices:new Map([['large',new Float32Array(9_000_000)]])};expect(cache.put(huge)).toBe(false);
    expect(cache.get(good.key)).toBe(good);expect(cache.get(huge.key)).toBeUndefined();
    good.cubeMatrices=huge.cubeMatrices;expect(cache.put(good)).toBe(true);expect(cache.get(good.key)).toBeUndefined();
  });
  it('adopts a validated worker receipt without walking geometry a second time',()=>{
    const prepared=prepareBuildingCpuCache(structuredClone(entry()))!;
    const cached=prepared.entry.recipes[0]!,cache=createBuildingCpuCache();
    Object.defineProperty(cached,'visual',{get(){throw new Error('UI must not rescan');}});
    expect(cache.restorePrepared(prepared)).toBe(true);expect(cache.get(cached.key)).toBe(cached);
    expect(cache.restorePrepared({...prepared,recipeBytes:[33*1024*1024]})).toBe(false);
    expect(cache.restorePrepared({...prepared,recipeBytes:[]})).toBe(false);
  });
  it('keeps static buffers compact and binds their indices to the validated input count',()=>{
    const value=entry(),r=value.recipes[0]!;
    r.staticVoxelCount=r.visual.intactVoxels.length;r.visual={intactVoxels:[],missingVoxels:[],vines:[],weathering:0};
    expect(restoreBuildingCpuCache(structuredClone(value))).toEqual(value);
    r.staticVoxelCount=1;expect(restoreBuildingCpuCache(value)).toBeNull();
    r.staticVoxelCount=2;r.visual.intactVoxels=[blueprint().voxels[0]!];expect(restoreBuildingCpuCache(value)).toBeNull();
  });
  it('drops superseded static recipe namespaces without invalidating legacy buildings',()=>{
    const value=entry(),old={...recipe(),key:'static-render-1:obsolete'};
    old.occlusion[0]=NaN;value.recipes.push(old);
    expect(restoreBuildingCpuCache(value)?.recipes).toEqual([value.recipes[0]]);
    expect(prepareBuildingCpuCache(value)?.recipeBytes).toHaveLength(1);
  });
});
