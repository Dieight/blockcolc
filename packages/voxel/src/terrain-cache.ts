import type { MergedGeometryData } from './terrain';

// One most-recent layout, never an unbounded per-project terrain history.
export const TERRAIN_CACHE_BYTES = 32 * 1024 * 1024;
export function terrainGeometryBytes(data: Pick<MergedGeometryData, 'positions' | 'indicesByMaterial' | 'sideIndices'>): number {
  return (data.positions.length
    + Object.values(data.indicesByMaterial).reduce((sum, indices) => sum + indices.length, 0)
    + data.sideIndices.dirt.length + data.sideIndices.stone.length) * 8;
}
