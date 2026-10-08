import * as THREE from 'three';

/** Transparent water receives land shadows but must not occlude its own bed. */
export function detachTerrainWaterSurface(
  source: THREE.BufferGeometry,
  waterMaterialIndex: number,
  material: THREE.Material,
): THREE.Mesh | null {
  const group = source.groups.find(item => item.materialIndex === waterMaterialIndex && item.count > 0);
  if (!group || !source.index) return null;
  const geometry = new THREE.BufferGeometry();
  // Both surfaces have the same lifetime. Share their buffers rather than
  // copying the whole terrain just to render one existing index range.
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(source.index);
  geometry.addGroup(group.start, group.count, 0);
  // A single-material Mesh ignores groups; the draw range is authoritative.
  geometry.setDrawRange(group.start, group.count);
  group.count = 0;
  const surface = new THREE.Mesh(geometry, material);
  surface.name = 'warm-sea-surface';
  surface.castShadow = false;
  surface.receiveShadow = true;
  return surface;
}
