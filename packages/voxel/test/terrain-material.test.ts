import {expect,it} from 'vitest';
import * as THREE from 'three';
import {configureTerrainTile,terrainTileColor,TERRAIN_SIDE_SHADE} from '../src/terrain-material';
import {createVisualBiomePalette} from '../src/visual-biome';

it('filters only an independent terrain crop with bounded anisotropy',()=>{
  const texture=new THREE.DataTexture(new Uint8Array(16*16*4),16,16);
  configureTerrainTile(texture,16);
  expect(texture.generateMipmaps).toBe(true);expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  expect(texture.magFilter).toBe(THREE.LinearFilter);expect(texture.anisotropy).toBe(4);
  configureTerrainTile(texture,1);expect(texture.anisotropy).toBe(1);texture.dispose();
});
it('tints only declared grass faces, not already-coloured pack pixels',()=>{
  expect(terrainTileColor('minecraft:grass_block',0)).toBe(0x91bd59);
  expect(terrainTileColor('minecraft:grass_block',0,{...createVisualBiomePalette([]),grass:0x71aa33})).toBe(0x71aa33);
  expect(terrainTileColor('minecraft:grass_block',undefined)).toBe(0xffffff);
  expect(terrainTileColor('minecraft:stone',0)).toBe(0xffffff);expect(TERRAIN_SIDE_SHADE).toBe(.65);
});
