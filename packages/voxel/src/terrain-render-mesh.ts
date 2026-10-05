import { createTerrainMeshBuffers } from './terrain-mesh';
import type { MergedGeometryData, TerrainMaterial } from './terrain';

type RenderMesh = Pick<MergedGeometryData, 'positions' | 'indicesByMaterial' | 'sideIndices' | 'triangleCount'>;
type Rect = { axis: number; plane: number; sign: number; u0: number; u1: number; v0: number; v1: number };

/** Merge only complete shared edges on the same material/plane/winding.
 * The generated terrain remains the source for hydrology, picking heights,
 * scenery and framing. World-coordinate UVs keep their original tile scale.
 */
export function compactTerrainRenderMesh(data: RenderMesh): RenderMesh {
  const out = createTerrainMeshBuffers();
  const compact = (indices: readonly number[], material: TerrainMaterial, side: boolean) => {
    const rects: Rect[] = [];
    const emit = (vertices: number[]) => side
      ? out.addSide(vertices, material as 'dirt' | 'stone') : out.addTop(vertices, material);
    for (let offset = 0; offset < indices.length; offset += 6) {
      const vertices = [0, 1, 2, 5].flatMap(i => data.positions.slice(indices[offset + i]! * 3, indices[offset + i]! * 3 + 3));
      const rect = rectangle(vertices);
      if (rect) rects.push(rect); else emit(vertices);
    }
    let merged = rects;
    // Two bounded sweeps join plateaus and long step faces without rasterizing
    // enormous far terrain into a unit-cell bitmap.
    for (let sweep = 0; sweep < 2; sweep++) {
      const next = mergeAxis(mergeAxis(merged, 'u'), 'v');
      if (next.length === merged.length) { merged = next; break; }
      merged = next;
    }
    for (const rect of merged) emit(verticesFor(rect));
  };
  for (const material of Object.keys(data.indicesByMaterial) as TerrainMaterial[]) compact(data.indicesByMaterial[material], material, false);
  for (const material of ['dirt', 'stone'] as const) compact(data.sideIndices[material], material, true);
  return { positions: out.positions, indicesByMaterial: out.indicesByMaterial, sideIndices: out.sideIndices,
    triangleCount: (Object.values(out.indicesByMaterial).reduce((sum, indices) => sum + indices.length, 0)
      + out.sideIndices.dirt.length + out.sideIndices.stone.length) / 3 };
}

function rectangle(vertices: readonly number[]): Rect | null {
  const coordinates = [0, 1, 2].map(axis => [0, 3, 6, 9].map(offset => vertices[offset + axis]!));
  const axis = coordinates.findIndex(values => values.every(value => value === values[0]));
  if (axis < 0) return null;
  const [u, v] = [0, 1, 2].filter(value => value !== axis) as [number, number];
  const us = coordinates[u]!, vs = coordinates[v]!;
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  if (u0 === u1 || v0 === v1 || new Set(us.map((value, i) => `${value}:${vs[i]}`)).size !== 4
    || us.some(value => value !== u0 && value !== u1) || vs.some(value => value !== v0 && value !== v1)) return null;
  const cross = (us[1]! - us[0]!) * (vs[2]! - vs[0]!) - (vs[1]! - vs[0]!) * (us[2]! - us[0]!);
  return { axis, plane: coordinates[axis]![0]!, sign: Math.sign(cross), u0, u1, v0, v1 };
}

function mergeAxis(rects: readonly Rect[], axis: 'u' | 'v'): Rect[] {
  const groups = new Map<string, Rect[]>();
  const start = axis === 'u' ? 'u0' : 'v0', end = axis === 'u' ? 'u1' : 'v1';
  for (const rect of rects) {
    const key = JSON.stringify([rect.axis, rect.plane, rect.sign,
      axis === 'u' ? rect.v0 : rect.u0, axis === 'u' ? rect.v1 : rect.u1]);
    const group = groups.get(key) ?? [];
    group.push(rect); groups.set(key, group);
  }
  const result: Rect[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a[start] - b[start] || a[end] - b[end]);
    let current = { ...group[0]! };
    for (const next of group.slice(1)) {
      if (current[end] === next[start]) current[end] = next[end];
      else { result.push(current); current = { ...next }; }
    }
    result.push(current);
  }
  return result;
}

function verticesFor(rect: Rect): number[] {
  const [u, v] = [0, 1, 2].filter(axis => axis !== rect.axis) as [number, number];
  const corners = [[rect.u0, rect.v0], [rect.u1, rect.v0], [rect.u1, rect.v1], [rect.u0, rect.v1]];
  if (rect.sign < 0) corners.reverse();
  return corners.flatMap(([a, b]) => {
    const point = [0, 0, 0]; point[rect.axis] = rect.plane; point[u] = a!; point[v] = b!; return point;
  });
}
