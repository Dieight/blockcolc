import { describe, expect, it } from 'vitest';
import { createTerrainMeshBuffers } from '../src/terrain-mesh';
import { TerrainSurfaceTable, peekTerrainSurfaceTable, terrainSurfaceTable, terrainSurfaceTableBytes } from '../src/terrain-surface-table';
import { scenerySurfaceAt, surfaceSampler, surfaceIndexBytes } from '../src/surface-index';
import { terrainGeometryBytes } from '../src/terrain-cache';
import { terrainSurfaceRectangles } from '../src/renderer';
import { createSteppedTerrainData, type MergedGeometryData, type TerrainMaterial } from '../src/terrain';
import { precipitationGroundForSurfaces } from '../src/precipitation-ground';

function fixture() {
  const mesh = createTerrainMeshBuffers();
  const rect = (material: TerrainMaterial, x0: number, x1: number, z0: number, z1: number, y: number) =>
    mesh.addTop([x0,y,z0,x0,y,z1,x1,y,z1,x1,y,z0], material);
  rect('water', -32, 32, -32, 32, -.34);
  rect('grass', -16, 0, -16, 16, 3.5);
  rect('grass', -16, 0, -16, 16, 3.5);
  rect('stone', -8, 8, -8, 8, 7.5);
  rect('dirt', -16, 0, -16, 16, 3.5);
  rect('sand', 0, 16, -16, 16, -.35);
  rect('snow', 8.25, 16.25, -8.25, -.25, 14.25);
  rect('ice', 16, 16, -8, 8, 100); // Degenerate tops do not support props.
  mesh.addSide([-16,3.5,-16,-16,-10,-16,-16,-10,16,-16,3.5,16], 'dirt');
  return mesh;
}

describe('shared read-only terrain surface table', () => {
  it('keeps material order, exact fractional coordinates and the water support datum', () => {
    const mesh = fixture(), table = new TerrainSurfaceTable(mesh), rows = Array.from(table);
    expect(rows.map(s => s.material)).toEqual(['grass','grass','dirt','stone','water','sand','snow','ice']);
    expect(rows[4]!.supportY).toBe(-.34 + .5);
    expect(rows[6]).toEqual({ minX:8.25, maxX:16.25, minZ:-8.25, maxZ:-.25, supportY:14.75, water:false, material:'snow' });
    expect(table.at(-1)).toBeUndefined(); expect(table.at(1.5)).toBeUndefined(); expect(table.at(table.length)).toBeUndefined();
    expect(table.byteLength).toBe(table.length * 41);
  });

  it('does not expose mutable columns and keeps public snapshots fresh', () => {
    const mesh = fixture(), table = terrainSurfaceTable(mesh);
    expect(terrainSurfaceTable(mesh)).toBe(table);
    expect(terrainSurfaceTable({ ...mesh })).not.toBe(table);
    const row = table.at(0)!; row.supportY = 999;
    expect(table.at(0)!.supportY).toBe(4);
    const full = mesh as unknown as MergedGeometryData;
    const first = terrainSurfaceRectangles(full); first[0]!.supportY = -999; first.pop();
    expect(terrainSurfaceRectangles(full)).toEqual(Array.from(table));
    mesh.positions[1] = 25;
    // The public helper still reflects edits made by external diagnostic users.
    expect(terrainSurfaceRectangles(full)[4]!.supportY).toBe(25.5);
    expect(table.at(4)!.supportY).toBe(-.34 + .5);
  });

  it('matches brute force at negative/fractional coordinates, edges and equal-height ties', () => {
    const table = new TerrainSurfaceTable(fixture()), rows = Array.from(table), at = surfaceSampler(table);
    for (let x = -40; x <= 40; x += .5) for (let z = -40; z <= 40; z += .5) {
      expect(at(x,z)).toEqual(scenerySurfaceAt(rows,x,z));
    }
    for (const row of rows) for (const x of [row.minX, row.maxX]) for (const z of [row.minZ, row.maxZ]) {
      expect(at(x,z)).toEqual(scenerySurfaceAt(rows,x,z));
    }
    expect(at(-12,0)!.material).toBe('grass');
    expect(at(10,10)!.water).toBe(true);
    expect(at(0,0)!.material).toBe('stone');
    expect(at(NaN,0)).toBeUndefined(); expect(at(Infinity,0)).toBeUndefined();
  });

  it('counts numeric table/index memory without allocating on inspection', () => {
    const mesh = fixture(), base = terrainGeometryBytes(mesh);
    expect(peekTerrainSurfaceTable(mesh)).toBeUndefined(); expect(terrainSurfaceTableBytes(mesh)).toBe(0);
    const table = terrainSurfaceTable(mesh);
    expect(surfaceIndexBytes(table)).toBe(0);
    expect(terrainGeometryBytes(mesh)).toBe(base + table.byteLength + 256);
    surfaceSampler(table)(0,0);
    const indexBytes = surfaceIndexBytes(table);
    expect(indexBytes).toBeGreaterThan(256);
    expect(terrainGeometryBytes(mesh)).toBe(base + table.byteLength + 256 + indexBytes);
    for (let i=0;i<20;i++) surfaceSampler(table)(i,0);
    expect(surfaceIndexBytes(table)).toBe(indexBytes);
  });

  it('does not alter serialized geometry and rebuilds sidecars after structured clone', () => {
    const data = createSteppedTerrainData([],[],[],undefined,{environmentStyle:'classic-island'});
    const before = JSON.stringify(data), table = terrainSurfaceTable(data);
    surfaceSampler(table)(0,0);
    expect(JSON.stringify(data)).toBe(before);
    const restored = structuredClone(data);
    expect(peekTerrainSurfaceTable(restored)).toBeUndefined();
    expect(Array.from(terrainSurfaceTable(restored))).toEqual(Array.from(table));
    expect(precipitationGroundForSurfaces(table)).toEqual(precipitationGroundForSurfaces(Array.from(table)));
  });

  it('keeps editable-array callers fresh between samplers and bounds extreme indexes', () => {
    const rows = [{ minX:-2, maxX:2, minZ:-2, maxZ:2, supportY:1, water:false }];
    expect(surfaceSampler(rows)(0,0)).toBe(rows[0]);
    rows[0]!.minX=20; rows[0]!.maxX=24;
    expect(surfaceSampler(rows)(0,0)).toBeUndefined();
    expect(surfaceSampler(rows)(22,0)).toBe(rows[0]);
    const sparse = [...rows,{ minX:-1e12, maxX:-1e12+10, minZ:-1e12, maxZ:-1e12+10, supportY:7, water:false }];
    for (const [x,z] of [[22,0],[-1e12+2,-1e12+2],[0,0]]) expect(surfaceSampler(sparse)(x!,z!)).toBe(scenerySurfaceAt(sparse,x!,z!));
    const unbounded = [...rows,{ minX:-Infinity, maxX:Infinity, minZ:-2, maxZ:2, supportY:3, water:true }];
    expect(surfaceSampler(unbounded)(0,0)).toEqual(scenerySurfaceAt(unbounded,0,0));
    expect(surfaceSampler([])(0,0)).toBeUndefined();
    expect(surfaceSampler(new TerrainSurfaceTable(createTerrainMeshBuffers()))(0,0)).toBeUndefined();
  });

  it('preserves dry/water threshold ties and first-in-input precedence', () => {
    for (const height of [2, 2.009, 2.01, 2.01001, 2.02]) {
      const rows = [{minX:-16,maxX:16,minZ:-16,maxZ:16,supportY:2,water:true,material:'water'},
        {minX:-16,maxX:16,minZ:-16,maxZ:16,supportY:height,water:false,material:'sand'},
        {minX:-8,maxX:8,minZ:-8,maxZ:8,supportY:height,water:false,material:'grass'}];
      const at=surfaceSampler(rows);
      for (const [x,z] of [[0,0],[-8,8],[-16,16],[16,0],[16.01,0]]) expect(at(x!,z!)).toBe(scenerySurfaceAt(rows,x!,z!));
      const mesh=createTerrainMeshBuffers();
      for(const row of rows)mesh.addTop([row.minX,row.supportY-.5,row.minZ,row.minX,row.supportY-.5,row.maxZ,
        row.maxX,row.supportY-.5,row.maxZ,row.maxX,row.supportY-.5,row.minZ],row.material as TerrainMaterial);
      const table=new TerrainSurfaceTable(mesh),ordered=Array.from(table),sample=surfaceSampler(table);
      for(const [x,z] of [[0,0],[-8,8],[-16,16],[16,0],[16.01,0]])expect(sample(x!,z!)).toEqual(scenerySurfaceAt(ordered,x!,z!));
    }
  });
});
