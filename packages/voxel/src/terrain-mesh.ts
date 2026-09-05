import type { TerrainMaterial } from './terrain';

export interface TerrainMeshBuffers {
  positions: number[];
  indicesByMaterial: Record<TerrainMaterial, number[]>;
  sideIndices: { dirt: number[]; stone: number[] };
  addTop(vertices: readonly number[], material: TerrainMaterial): void;
  addSide(vertices: readonly number[], material: 'dirt' | 'stone'): void;
}

/** Shared indexed-buffer emission for every terrain environment. */
export function createTerrainMeshBuffers(): TerrainMeshBuffers {
  const positions: number[] = [];
  const indicesByMaterial: Record<TerrainMaterial, number[]> = { grass: [], dirt: [], stone: [], water: [] };
  const sideIndices: { dirt: number[]; stone: number[] } = { dirt: [], stone: [] };
  const emit = (vertices: readonly number[], indices: number[]): void => {
    const start = positions.length / 3;
    positions.push(...vertices);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  return {
    positions,
    indicesByMaterial,
    sideIndices,
    addTop: (vertices, material) => emit(vertices, indicesByMaterial[material]),
    addSide: (vertices, material) => emit(vertices, sideIndices[material]),
  };
}
