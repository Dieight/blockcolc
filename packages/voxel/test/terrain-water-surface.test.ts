import * as THREE from 'three';
import { expect, it } from 'vitest';
import { detachTerrainWaterSurface } from '../src/terrain-water-surface';

it('separates only transparent water from terrain shadow casting, sharing the original buffers', () => {
  const source = new THREE.BufferGeometry();
  source.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
  source.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  source.setIndex([0, 1, 2, 2, 1, 0]);
  source.addGroup(0, 3, 0);
  source.addGroup(3, 3, 3);
  const material = new THREE.MeshStandardMaterial({ transparent: true, opacity: .58 });
  const surface = detachTerrainWaterSurface(source, 3, material)!;
  expect(source.groups).toEqual([{ start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 0, materialIndex: 3 }]);
  expect(surface.geometry.groups).toEqual([{ start: 3, count: 3, materialIndex: 0 }]);
  expect(surface.geometry.drawRange).toEqual({ start: 3, count: 3 });
  expect(surface.geometry.getAttribute('position')).toBe(source.getAttribute('position'));
  expect(surface.geometry.getAttribute('normal')).toBe(source.getAttribute('normal'));
  expect(surface.geometry.index).toBe(source.index);
  expect(surface.material).toBe(material);
  expect(surface.castShadow).toBe(false);
  expect(surface.receiveShadow).toBe(true);
  expect(detachTerrainWaterSurface(source, 3, material)).toBeNull();
  surface.geometry.dispose(); source.dispose(); material.dispose();
});

it('leaves dry terrain unchanged', () => {
  const geometry = new THREE.BufferGeometry(); geometry.setIndex([0, 1, 2]); geometry.addGroup(0, 3, 0);
  const material = new THREE.MeshBasicMaterial();
  expect(detachTerrainWaterSurface(geometry, 3, material)).toBeNull();
  expect(geometry.groups).toEqual([{ start: 0, count: 3, materialIndex: 0 }]);
  geometry.dispose(); material.dispose();
});
