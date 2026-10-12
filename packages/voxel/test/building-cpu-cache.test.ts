import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {buildingCpuKey,prepareBuildingCpuRecipe,captureCpuGeometry,restoreCpuGeometry,restoreBuildingCpuCache,createBuildingCpuCache,buildingCpuCacheBytes,type BuildingCpuCache} from '../src/building-cpu-cache';
import {validateBlueprint} from '../src/blueprint-model';
function blueprint(){return validateBlueprint({schemaVersion:1,id:'building-cache',title:'Cache',bounds:{minX:0,maxX:1,minY:0,maxY:0,minZ:0,maxZ:0},voxels:[{x:0,y:0,z:0,materialId:'stone',stage:'foundation',buildOrder:5000},{x:1,y:0,z:0,materialId:'wood',stage:'details',buildOrder:10000}]});}
function recipe(){const b=blueprint();return prepareBuildingCpuRecipe(buildingCpuKey(b,'p',10000,10000),b,'p',10000,10000);}
const entry=():BuildingCpuCache=>({revision:1,recipes:[recipe()]});
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
    expect(restoreBuildingCpuCache(invalid)).toBeNull();expect(restoreBuildingCpuCache({revision:1,recipes:[]})).not.toBeNull();
  });
});
