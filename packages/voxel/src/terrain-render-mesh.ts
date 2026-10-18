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
      const a = indices[offset]! * 3, b = indices[offset + 1]! * 3;
      const c = indices[offset + 2]! * 3, d = indices[offset + 5]! * 3;
      const rect = rectangle(data.positions, a, b, c, d);
      if (rect) rects.push(rect);
      else emit([a, b, c, d].flatMap(i => data.positions.slice(i, i + 3)));
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

function rectangle(positions: readonly number[], a: number, b: number, c: number, d: number): Rect | null {
  // Read the indexed quad directly. Previously each face allocated coordinate
  // slices, nested arrays and string corner keys just to recover this rectangle.
  let axis = -1;
  for (let i = 0; i < 3; i++) {
    if (positions[a + i] === positions[b + i] && positions[a + i] === positions[c + i]
      && positions[a + i] === positions[d + i]) { axis = i; break; }
  }
  if (axis < 0) return null;
  const u = axis === 0 ? 1 : 0, v = axis === 2 ? 1 : 2;
  const u0 = Math.min(positions[a + u]!, positions[b + u]!, positions[c + u]!, positions[d + u]!);
  const u1 = Math.max(positions[a + u]!, positions[b + u]!, positions[c + u]!, positions[d + u]!);
  const v0 = Math.min(positions[a + v]!, positions[b + v]!, positions[c + v]!, positions[d + v]!);
  const v1 = Math.max(positions[a + v]!, positions[b + v]!, positions[c + v]!, positions[d + v]!);
  if (u0 === u1 || v0 === v1) return null;
  let corners = 0;
  for (let i = 0; i < 4; i++) {
    const offset = i === 0 ? a : i === 1 ? b : i === 2 ? c : d;
    const x = positions[offset + u]!, y = positions[offset + v]!;
    if ((x !== u0 && x !== u1) || (y !== v0 && y !== v1)) return null;
    corners |= 1 << ((x === u1 ? 1 : 0) | (y === v1 ? 2 : 0));
  }
  if (corners !== 15) return null;
  const cross = (positions[b + u]! - positions[a + u]!) * (positions[c + v]! - positions[a + v]!)
    - (positions[b + v]! - positions[a + v]!) * (positions[c + u]! - positions[a + u]!);
  return { axis, plane: positions[a + axis]!, sign: Math.sign(cross), u0, u1, v0, v1 };
}

function mergeAxis(rects: readonly Rect[], axis: 'u' | 'v'): Rect[] {
  // Numeric keys avoid serialising one temporary tuple per face and sweep.
  // Keep a separate discovery-order list: walking nested Maps would reorder
  // interleaved planes and change the exact emitted buffers/cache contents.
  const groups: Rect[][] = [];
  type SingleGroup = { high: number; rects: Rect[] };
  type RangeBucket = SingleGroup | Map<number,Rect[]>;
  // Most lower bounds have a single upper bound. Allocate the last Map only
  // when a different range actually shares that lower bound.
  const lookup = new Map<number,Map<number,Map<number,RangeBucket>>>();
  const start = axis === 'u' ? 'u0' : 'v0', end = axis === 'u' ? 'u1' : 'v1';
  for (const rect of rects) {
    const direction = rect.axis * 3 + rect.sign;
    let planes = lookup.get(direction);
    if (!planes) { planes = new Map(); lookup.set(direction,planes); }
    let minima = planes.get(rect.plane);
    if (!minima) { minima = new Map(); planes.set(rect.plane,minima); }
    const low = axis === 'u' ? rect.v0 : rect.u0, high = axis === 'u' ? rect.v1 : rect.u1;
    const bucket = minima.get(low);
    let group: Rect[];
    if (!bucket) {
      group = []; minima.set(low,{high,rects:group}); groups.push(group);
    } else if (bucket instanceof Map) {
      const existing = bucket.get(high);
      if (existing) group = existing;
      else { group = []; bucket.set(high,group); groups.push(group); }
    } else if (bucket.high === high) group = bucket.rects;
    else {
      group = [];
      const multiple = new Map<number,Rect[]>();
      multiple.set(bucket.high,bucket.rects); multiple.set(high,group);
      minima.set(low,multiple); groups.push(group);
    }
    group.push(rect);
  }
  lookup.clear();
  const result: Rect[] = [];
  for (const group of groups) {
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
