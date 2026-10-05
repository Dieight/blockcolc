import { expect, it } from 'vitest';
import { createSteppedTerrainData, type MergedGeometryData } from '../src/terrain';
import { terrainGenerationProfile } from '../src/terrain-profile';

function boundaryRelief(terrain: MergedGeometryData, boundary: number) {
  const waterEdges: Array<{ axis: 'x' | 'z'; coordinate: number; start: number; end: number }> = [];
  for (let offset = 0; offset < terrain.indicesByMaterial.water.length; offset += 6) {
    const points = [...new Set(terrain.indicesByMaterial.water.slice(offset, offset + 6))].map(index => ({
      x: terrain.positions[index * 3]!, z: terrain.positions[index * 3 + 2]!,
    }));
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z));
    for (const x of [minX, maxX]) if (Math.abs(x) === boundary) waterEdges.push({ axis: 'x', coordinate: x, start: minZ, end: maxZ });
    for (const z of [minZ, maxZ]) if (Math.abs(z) === boundary) waterEdges.push({ axis: 'z', coordinate: z, start: minX, end: maxX });
  }
  const gaps: Array<{ height: number; width: number; wet: boolean; axis: 'x' | 'z'; coordinate: number; start: number; end: number }> = [];
  for (const indices of [terrain.sideIndices.dirt, terrain.sideIndices.stone]) {
    for (let offset = 0; offset < indices.length; offset += 6) {
      const vertices = [...new Set(indices.slice(offset, offset + 6))].map(index => ({
        x: terrain.positions[index * 3]!, y: terrain.positions[index * 3 + 1]!, z: terrain.positions[index * 3 + 2]!,
      }));
      const xs = vertices.map(v => v.x), zs = vertices.map(v => v.z), ys = vertices.map(v => v.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const xEdge = minX === maxX && Math.abs(minX) === boundary && minZ >= -boundary && maxZ <= boundary;
      const zEdge = minZ === maxZ && Math.abs(minZ) === boundary && minX >= -boundary && maxX <= boundary;
      const width = xEdge ? maxZ - minZ : zEdge ? maxX - minX : 0;
      if (width > .1) {
        const start = xEdge ? minZ : minX, end = xEdge ? maxZ : maxX;
        const wet = waterEdges.some(edge => edge.axis === (xEdge ? 'x' : 'z')
          && edge.coordinate === (xEdge ? minX : minZ) && edge.start < end && edge.end > start);
        gaps.push({ width, height: Math.max(...ys) - Math.min(...ys), wet, axis: xEdge ? 'x' : 'z', coordinate: xEdge ? minX : minZ, start, end });
      }
    }
  }
  const segments: Array<{ height: number; width: number; wet: boolean }> = [];
  for (const [axis, coordinate] of [['x', -boundary], ['x', boundary], ['z', -boundary], ['z', boundary]] as const) {
    const sides = gaps.filter(gap => gap.axis === axis && gap.coordinate === coordinate);
    const water = waterEdges.filter(edge => edge.axis === axis && edge.coordinate === coordinate);
    const cuts = [...new Set([-boundary, boundary, ...[...sides, ...water].flatMap(edge => [edge.start, edge.end])])]
      .filter(point => point >= -boundary && point <= boundary).sort((a, b) => a - b);
    for (let index = 1; index < cuts.length; index += 1) {
      const start = cuts[index - 1]!, end = cuts[index]!;
      segments.push({ width: end - start,
        height: sides.filter(side => side.start < end && side.end > start).reduce((height, side) => Math.max(height, side.height), 0),
        wet: water.some(edge => edge.start < end && edge.end > start),
      });
    }
  }
  const percentile = (samples: typeof segments) => {
    const target = samples.reduce((sum, segment) => sum + segment.width, 0) * .95;
    let covered = 0;
    for (const segment of [...samples].sort((a, b) => a.height - b.height)) {
      covered += segment.width;
      if (covered >= target) return segment.height;
    }
    return 0;
  };
  const dry = segments.filter(segment => !segment.wet);
  return {
    mean: segments.reduce((sum, segment) => sum + segment.height * segment.width, 0) / (boundary * 8),
    p95: percentile(segments), maximum: Math.max(0, ...segments.map(segment => segment.height)),
    dryP95: percentile(dry), dryMaximum: Math.max(0, ...dry.map(segment => segment.height)),
    dryWallFraction: dry.filter(segment => segment.height > 6).reduce((sum, segment) => sum + segment.width, 0)
      / dry.reduce((sum, segment) => sum + segment.width, 0),
  };
}

it.each([
  { seed: 'world-default', refined: true }, { seed: 'quiet-valley', refined: true },
  { seed: 'world-default', refined: false }, { seed: 'quiet-valley', refined: false },
])('keeps natural hills rather than a vertical LOD wall ($seed / refined=$refined)', ({ seed, refined }) => {
  const profile = terrainGenerationProfile('natural-valley', 40, 4, refined);
  if (profile.kind !== 'natural-valley') throw new Error('Wrong terrain profile');
  const terrain = createSteppedTerrainData([], [], [], { x: 40, z: 40 }, {
    environmentStyle: 'natural-valley', worldSeed: seed, terrainGenerationVersion: 4, refinedFar: refined,
  });
  const relief = boundaryRelief(terrain, refined ? profile.farFineExtent : profile.middleExtent);
  console.info(`${seed}/${refined}: boundary relief ${JSON.stringify(relief)}`);
  // Real mountains still make steps. The seam itself must not introduce the
  // old 10–20-block lift across an otherwise continuous height field.
  expect(relief.mean).toBeLessThan(2.6);
  // A real river bank may be steep. Do not flatten hydrology to satisfy a LOD
  // threshold; compare land-to-land steps separately, keep all faces in mean.
  // Measure the entire border length, including flat joins. Counting only
  // nonzero faces made two natural corner steps look like an endless wall.
  expect(relief.dryP95).toBeLessThanOrEqual(6);
  expect(relief.dryMaximum).toBeLessThanOrEqual(12);
  expect(relief.dryWallFraction).toBeLessThan(.01);
}, 30_000);
