import { describe, expect, it } from 'vitest';
import { createTerrainMeshBuffers } from '../src/terrain-mesh';
import { compactTerrainRenderMesh } from '../src/terrain-render-mesh';
import { createSteppedTerrainData } from '../src/terrain';
import { createPlanarQuadUvs } from '../src/original-materials';

function surfaces(data: ReturnType<typeof compactTerrainRenderMesh>) {
  const areas = new Map<string, number>();
  for (const [material, indices] of [...Object.entries(data.indicesByMaterial),
    ...Object.entries(data.sideIndices).map(([id, indices]) => [`side-${id}`, indices] as const)]) {
    for (let i = 0; i < indices.length; i += 3) {
      const points = [0, 1, 2].map(n => data.positions.slice(indices[i + n]! * 3, indices[i + n]! * 3 + 3));
      const [a, b, c] = points as [number[], number[], number[]];
      const ab = b.map((value, axis) => value - a[axis]!), ac = c.map((value, axis) => value - a[axis]!);
      const normal = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
      const axis = normal.findIndex(value => value !== 0);
      const key = `${material}:${axis}:${a[axis]}:${Math.sign(normal[axis]!)}`;
      areas.set(key, (areas.get(key) ?? 0) + Math.hypot(...normal) / 2);
    }
  }
  return areas;
}

describe('render-only terrain compaction', () => {
  it('joins a plateau but preserves a hole, material boundary, height and both sliver windings', () => {
    const source = createTerrainMeshBuffers();
    for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) {
      if (x === 1 && z === 1) continue;
      const y = x === 3 ? 1 : 0;
      source.addTop([x,y,z, x,y,z+1, x+1,y,z+1, x+1,y,z], x === 2 ? 'water' : 'grass');
    }
    source.addSide([0,0,0, 0,1,0, .05,1,0, .05,0,0], 'dirt');
    source.addSide([.05,0,0, .05,1,0, 0,1,0, 0,0,0], 'dirt');
    const data = { ...source, triangleCount: 34 };
    const original = structuredClone({ positions: data.positions, indicesByMaterial: data.indicesByMaterial, sideIndices: data.sideIndices });
    const result = compactTerrainRenderMesh(data);
    expect(result.triangleCount).toBeLessThan(data.triangleCount);
    expect(surfaces(result)).toEqual(surfaces(data));
    expect({ positions: data.positions, indicesByMaterial: data.indicesByMaterial, sideIndices: data.sideIndices }).toEqual(original);
    // No rectangle crosses the intentionally absent water/grass surface.
    for (const indices of Object.values(result.indicesByMaterial)) for (let i=0; i<indices.length; i+=6) {
      const points = [0,1,2,5].map(n => result.positions.slice(indices[i+n]! * 3, indices[i+n]! * 3 + 3));
      expect(Math.min(...points.map(p=>p[0]!)) < 1.5 && Math.max(...points.map(p=>p[0]!)) > 1.5
        && Math.min(...points.map(p=>p[2]!)) < 1.5 && Math.max(...points.map(p=>p[2]!)) > 1.5).toBe(false);
    }
    const uvs = createPlanarQuadUvs(result.positions);
    expect([...uvs].every(Number.isFinite)).toBe(true);
  });

  for (const environmentStyle of ['natural-valley', 'ocean-island', 'classic-island'] as const) {
    it(`preserves every plane's area and winding for real ${environmentStyle} terrain`, () => {
      const source = createSteppedTerrainData([], [], [], { x: 60, z: 60 }, { environmentStyle, worldSeed: 'render-budget', terrainGenerationVersion: 4 });
      const result = compactTerrainRenderMesh(source);
      expect(result.triangleCount).toBeLessThan(source.triangleCount * .8);
      const expected = surfaces(source), actual = surfaces(result);
      expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
      for (const [key, area] of expected) expect(actual.get(key)).toBeCloseTo(area, 6);
      expect(result.positions.length % 12).toBe(0);
      expect([...createPlanarQuadUvs(result.positions)].every(Number.isFinite)).toBe(true);
    });
  }
});
