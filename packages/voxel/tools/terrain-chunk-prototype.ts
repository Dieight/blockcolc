/** Experiment only: completed global geometry is partitioned, never generated
 * independently by tile. Not exported from voxel or used by the renderer. */
import { createHash } from 'node:crypto';
import { createTerrainMeshBuffers } from '../src/terrain-mesh';
import { TERRAIN_MATERIALS, type MergedGeometryData, type TerrainMaterial } from '../src/terrain';
import { compactTerrainRenderMesh } from '../src/terrain-render-mesh';

export type Mesh = Pick<MergedGeometryData, 'positions' | 'indicesByMaterial' | 'sideIndices' | 'triangleCount'>;
export type Compactor = (mesh: Mesh) => Mesh;
export interface Chunk { key: string; x: number; z: number; source: Mesh; mesh: Mesh }
export interface Partition { key: string; x: number; z: number; source: Mesh }
const channels = (mesh: Mesh) => [...TERRAIN_MATERIALS.map(m => mesh.indicesByMaterial[m]), mesh.sideIndices.dirt, mesh.sideIndices.stone];
export const meshBytes = (mesh: Mesh) => (mesh.positions.length + channels(mesh).reduce((n, a) => n + a.length, 0)) * 8;
export const materialGroups = (mesh: Mesh) => channels(mesh).filter(list => list.length > 0).length;

/** A face has one owner even when it straddles a tile boundary. No clipping,
 * new vertical skirts or invented neighbours. Mesh bounds must be real bounds,
 * not an assumed tile box. Source vertex coordinates are shared, not copied. */
export function partitionTerrain(mesh: Mesh, size: number): Partition[] {
  if (!Number.isSafeInteger(size) || size < 1) throw Error('Invalid chunk size');
  const buckets = new Map<string, Partition>();
  const visit = (indices: readonly number[], material: TerrainMaterial, side: boolean) => {
    for (let offset = 0; offset < indices.length; offset += 6) {
      if (offset + 5 >= indices.length) throw Error('Expected complete terrain quads');
      const a = indices[offset]! * 3, b = indices[offset + 1]! * 3, c = indices[offset + 2]! * 3, d = indices[offset + 5]! * 3;
      const x = Math.floor(Math.min(mesh.positions[a]!, mesh.positions[b]!, mesh.positions[c]!, mesh.positions[d]!) / size);
      const z = Math.floor(Math.min(mesh.positions[a + 2]!, mesh.positions[b + 2]!, mesh.positions[c + 2]!, mesh.positions[d + 2]!) / size);
      const key = `${x}:${z}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        const buffers = createTerrainMeshBuffers();
        bucket = { key, x, z, source: { positions: mesh.positions, indicesByMaterial: buffers.indicesByMaterial,
          sideIndices: buffers.sideIndices, triangleCount: 0 } };
        buckets.set(key, bucket);
      }
      const target = side ? bucket.source.sideIndices[material as 'dirt' | 'stone'] : bucket.source.indicesByMaterial[material];
      for (let n = 0; n < 6; n++) target.push(indices[offset + n]!);
      bucket.source.triangleCount += 2;
    }
  };
  for (const material of TERRAIN_MATERIALS) visit(mesh.indicesByMaterial[material], material, false);
  for (const material of ['dirt', 'stone'] as const) visit(mesh.sideIndices[material], material, true);
  return Array.from(buckets.values());
}

/** Exact current geometry proof, not a seed/coordinate hash. All global
 * sampling, hydrology and closure must already have run for the new input. */
export function sameChunkGeometry(a: Mesh, b: Mesh): boolean {
  if (a.triangleCount !== b.triangleCount) return false;
  const left = channels(a), right = channels(b);
  for (let channel = 0; channel < left.length; channel++) {
    const ai = left[channel]!, bi = right[channel]!;
    if (ai.length !== bi.length) return false;
    for (let i = 0; i < ai.length; i++) {
      const av = ai[i]! * 3, bv = bi[i]! * 3;
      if (a.positions[av] !== b.positions[bv] || a.positions[av + 1] !== b.positions[bv + 1] || a.positions[av + 2] !== b.positions[bv + 2]) return false;
    }
  }
  return true;
}

export function buildChunkMeshes(source: Mesh, size: number, compact: Compactor = compactTerrainRenderMesh,
  previous?: { namespace: string; chunks: readonly Chunk[] }, namespace = '') {
  const old = previous?.namespace === namespace ? new Map(previous.chunks.map(c => [c.key, c])) : new Map<string, Chunk>();
  let hits = 0, misses = 0;
  const chunks = partitionTerrain(source, size).map(part => {
    const before = old.get(part.key);
    const mesh = before && sameChunkGeometry(before.source, part.source) ? (hits++, before.mesh) : (misses++, compact(part.source));
    return { ...part, mesh };
  });
  const bytes = meshBytes(source) + chunks.reduce((n, c) => n + meshBytes(c.mesh)
    + channels(c.source).reduce((sum, a) => sum + a.length * 8, 0) + 512, 0);
  return { namespace, chunks, hits, misses, bytes, triangleCount: chunks.reduce((n, c) => n + c.mesh.triangleCount, 0),
    materialGroups: chunks.reduce((n, c) => n + materialGroups(c.mesh), 0) };
}

export function joinChunkMeshes(chunks: readonly Pick<Chunk, 'mesh'>[]): Mesh {
  const out = createTerrainMeshBuffers();
  for (const { mesh } of chunks) {
    const base = out.positions.length / 3;
    for (const p of mesh.positions) out.positions.push(p);
    for (const material of TERRAIN_MATERIALS) for (const index of mesh.indicesByMaterial[material]) out.indicesByMaterial[material].push(index + base);
    for (const material of ['dirt', 'stone'] as const) for (const index of mesh.sideIndices[material]) out.sideIndices[material].push(index + base);
  }
  return { positions: out.positions, indicesByMaterial: out.indicesByMaterial, sideIndices: out.sideIndices,
    triangleCount: chunks.reduce((n, c) => n + c.mesh.triangleCount, 0) };
}

/** Independent coverage oracle. Canonicalise oriented/material planes using a
 * sweep of rectangle edges, retaining overlap counts, not just total area.
 * Adjacent strips with the same exact interval profile are coalesced so that
 * merged quads and unmerged cell faces have the same signature. */
export function meshCoverageHash(mesh: Mesh): string {
  type Event = { u: number; v0: number; v1: number; delta: number };
  const planes = new Map<string, Event[]>(), fallback: string[] = [];
  const visit = (indices: readonly number[], material: string) => {
    for (let i = 0; i < indices.length; i += 6) {
      if (i + 5 >= indices.length) throw Error('Incomplete coverage quad');
      const vertices = [0,1,2,5].map(n => indices[i + n]! * 3);
      const [a,b,c] = vertices as [number,number,number,number];
      let axis = -1;
      for (let n = 0; n < 3; n++) if (vertices.every(v => mesh.positions[v+n] === mesh.positions[a+n])) { axis = n; break; }
      if (axis < 0) { fallback.push(JSON.stringify([material,...vertices.flatMap(v => mesh.positions.slice(v,v+3))])); continue; }
      const u = axis === 0 ? 1 : 0, v = axis === 2 ? 1 : 2;
      const u0 = Math.min(...vertices.map(p => mesh.positions[p+u]!)), u1 = Math.max(...vertices.map(p => mesh.positions[p+u]!));
      const v0 = Math.min(...vertices.map(p => mesh.positions[p+v]!)), v1 = Math.max(...vertices.map(p => mesh.positions[p+v]!));
      const cross = (mesh.positions[b+u]!-mesh.positions[a+u]!)*(mesh.positions[c+v]!-mesh.positions[a+v]!)
        -(mesh.positions[b+v]!-mesh.positions[a+v]!)*(mesh.positions[c+u]!-mesh.positions[a+u]!);
      const corners = new Set(vertices.map(p => `${mesh.positions[p+u]}:${mesh.positions[p+v]}`));
      if (!(u0<u1 && v0<v1 && corners.size===4 && vertices.every(p => (mesh.positions[p+u]===u0||mesh.positions[p+u]===u1)
        && (mesh.positions[p+v]===v0||mesh.positions[p+v]===v1)))) {
        fallback.push(JSON.stringify([material,...vertices.flatMap(p => mesh.positions.slice(p,p+3))])); continue;
      }
      const key = JSON.stringify([material,axis,mesh.positions[a+axis],Math.sign(cross)]), list = planes.get(key) ?? [];
      list.push({u:u0,v0,v1,delta:1},{u:u1,v0,v1,delta:-1}); planes.set(key,list);
    }
  };
  for (const material of TERRAIN_MATERIALS) visit(mesh.indicesByMaterial[material], material);
  for (const material of ['dirt','stone'] as const) visit(mesh.sideIndices[material], `side-${material}`);
  const hash = createHash('sha256');
  for (const key of Array.from(planes.keys()).sort()) {
    hash.update(key);
    const events = planes.get(key)!.sort((a,b) => a.u-b.u), differences = new Map<number,number>();
    let previousU = events[0]!.u, previousProfile = '', stripStart = previousU, index = 0;
    while (index < events.length) {
      const u = events[index]!.u;
      if (u > previousU) {
        const profile: number[][] = [];
        let coverage = 0, start = 0;
        for (const v of Array.from(differences.keys()).sort((a,b) => a-b)) {
          const next = coverage + differences.get(v)!;
          if (next !== coverage) {
            if (coverage) profile.push([start,v,coverage]);
            start = v; coverage = next;
          }
        }
        if (coverage !== 0) throw Error('Unclosed interval coverage');
        const signature = JSON.stringify(profile);
        if (signature !== previousProfile) {
          if (previousProfile && previousProfile !== '[]') hash.update(JSON.stringify([stripStart,previousU,previousProfile]));
          stripStart = previousU; previousProfile = signature;
        }
      }
      while (index < events.length && events[index]!.u === u) {
        const e = events[index++]!;
        for (const [v,delta] of [[e.v0,e.delta],[e.v1,-e.delta]] as const) {
          const value = (differences.get(v) ?? 0) + delta;
          if (value) differences.set(v,value); else differences.delete(v);
        }
      }
      previousU = u;
    }
    if (previousProfile && previousProfile !== '[]') hash.update(JSON.stringify([stripStart,previousU,previousProfile]));
    if (differences.size) throw Error('Unclosed plane coverage');
  }
  hash.update(JSON.stringify(fallback.sort()));
  return hash.digest('hex');
}
