import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {connectedGlassSurface,connectedGlassPixels,isConnectedOriginalGlass,addConnectedOriginalGlass} from '../src/connected-original-glass';
import {ORIGINAL_DETAIL_IDS,originalDetailParts,originalDetailPixels,addOriginalBlockDetails} from '../src/original-block-details';
import {fallbackVisualStyleForVoxel} from '../src/fallback-visual';
import type {BlueprintVoxel} from '../src/blueprint-model';
const glass=(x:number,y=0):BlueprintVoxel=>({x,y,z:0,materialId:'glass',sourceBlockId:'minecraft:glass',buildOrder:10000});
describe('original close-up surfaces',()=>{
 it('culls shared glass faces and keeps contiguous unit-sized outer geometry',()=>{
  expect(connectedGlassSurface([glass(0)]).indices).toHaveLength(36);
  const joined=connectedGlassSurface([glass(0),glass(1)]);expect(joined.indices).toHaveLength(60);
  const xs=joined.positions.filter((_,index)=>index%3===0);expect(Math.min(...xs)).toBe(-.5);expect(Math.max(...xs)).toBe(1.5);
  const wall=connectedGlassSurface([glass(0),glass(1),glass(0,1),glass(1,1)]);expect(wall.indices).toHaveLength(96);
  expect(connectedGlassPixels()).toHaveLength(128*128*4);
 });
 it('joins only exact vanilla full glass IDs and keeps different colours separate',()=>{
  expect(isConnectedOriginalGlass({sourceBlockId:'minecraft:red_stained_glass'})).toBe(true);
  expect(isConnectedOriginalGlass({materialId:'glass'})).toBe(true);
  for(const id of ['mod:glass','minecraft:glass_pane','minecraft:ice','minecraft:not_real_stained_glass'])expect(isConnectedOriginalGlass({sourceBlockId:id})).toBe(false);
  const root=new THREE.Group();addConnectedOriginalGlass(root,[glass(0),{...glass(1),sourceBlockId:'minecraft:red_stained_glass'}]);expect(root.children).toHaveLength(2);
  for(const object of root.children){const mesh=object as THREE.Mesh;expect(mesh.userData.ownedTexture).toBeTruthy();expect(mesh.userData.ownedMaterial).toBeTruthy();}
 });
 it('uses bounded original parts and deterministic padded six-face colour textures',()=>{
  expect(new Set(ORIGINAL_DETAIL_IDS).size).toBe(ORIGINAL_DETAIL_IDS.length);
  for(const id of ORIGINAL_DETAIL_IDS){
   const voxel={x:0,y:0,z:0,buildOrder:10000,materialId:'accent' as const,sourceBlockId:id};
   expect(originalDetailParts(voxel)?.length).toBeGreaterThan(0);
   const pixels=originalDetailPixels(voxel);expect(pixels).toEqual(originalDetailPixels(voxel));expect(pixels).toHaveLength(128*64*4);
  }
  expect(originalDetailParts({sourceBlockId:'mod:chest'})).toBeNull();
  expect(originalDetailParts({sourceBlockId:'minecraft:sea_pickle',sourceBlockState:{pickles:'8'}})).toBeNull();
  const root=new THREE.Group();expect(addOriginalBlockDetails(root,[{...glass(0),materialId:'plank',sourceBlockId:'minecraft:chest'}]).size).toBe(1);
  const mesh=root.children[0] as THREE.InstancedMesh;expect(mesh.userData.ownedTexture).toBeTruthy();expect(mesh.castShadow).toBe(true);
 });
 it('distinguishes clay dye from wool without mutating other colour families',()=>{
  const wool=fallbackVisualStyleForVoxel({materialId:'accent',sourceBlockId:'minecraft:red_wool'});
  const clay=fallbackVisualStyleForVoxel({materialId:'accent',sourceBlockId:'minecraft:red_terracotta'});
  expect(wool.color).toBe(0xb02e26);expect(clay.color).not.toBe(wool.color);
  expect(fallbackVisualStyleForVoxel({materialId:'glass',sourceBlockId:'minecraft:red_stained_glass'}).color).toBe(wool.color);
  expect(fallbackVisualStyleForVoxel({materialId:'roof',sourceBlockId:'minecraft:oak_stairs'}).pattern).toBe('planks');
  expect(fallbackVisualStyleForVoxel({materialId:'roof',sourceBlockId:'minecraft:granite_stairs'}).pattern).toBe('stone');
 });
});
