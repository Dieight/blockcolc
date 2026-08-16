import { expect, it } from "vitest";
import { SMALL_WORKSHOP_BLUEPRINT, TIMBER_HOUSE_BLUEPRINT, VILLAGE_CHAPEL_BLUEPRINT } from "../src/blueprint";
import { layoutWorlds, type WorldSnapshot } from "../src/renderer";
import { createSteppedTerrainData } from "../src/terrain";
import { roadCellsForVillage } from "../src/village";

const snapshots: WorldSnapshot[] = [SMALL_WORKSHOP_BLUEPRINT, TIMBER_HOUSE_BLUEPRINT, VILLAGE_CHAPEL_BLUEPRINT]
  .map((blueprint, settlementIndex) => ({
    projectId: `project-${settlementIndex}`,
    blueprintId: blueprint.id,
    buildingCompletionBasisPoints: 10_000,
    buildingConditionBasisPoints: 10_000,
    isMonument: false,
    settlementIndex,
  }));

function collectCornerSlits(seed: string, terrainGenerationVersion: 1 | 4): string[] {
  const placements = layoutWorlds(snapshots);
  const roads = roadCellsForVillage(placements);
  const terrain = createSteppedTerrainData(placements, roads, [], undefined, {
    environmentStyle: "natural-valley",
    worldSeed: seed,
    terrainGenerationVersion,
  });
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const vertex = (index: number) => ({
    x: round(terrain.positions[index * 3]!),
    y: round(terrain.positions[index * 3 + 1]!),
    z: round(terrain.positions[index * 3 + 2]!),
  });
  type V = { x: number; y: number; z: number };
  type Quad = { vertices: V[]; material: string };
  const quadsOf = (indices: readonly number[], material: string): Quad[] => {
    const quads: Quad[] = [];
    for (let offset = 0; offset < indices.length; offset += 6) {
      const unique = [...new Set([indices[offset]!, indices[offset + 1]!, indices[offset + 2]!, indices[offset + 3]!, indices[offset + 5]!])];
      quads.push({ vertices: unique.map((index) => vertex(index)), material });
    }
    return quads;
  };
  const tops = [
    ...quadsOf(terrain.indicesByMaterial.grass, "grass"),
    ...quadsOf(terrain.indicesByMaterial.dirt, "dirt"),
    ...quadsOf(terrain.indicesByMaterial.stone, "stone"),
    ...quadsOf(terrain.indicesByMaterial.water, "water"),
  ];
  const sides = [
    ...quadsOf(terrain.sideIndices.dirt, "dirt"),
    ...quadsOf(terrain.sideIndices.stone, "stone"),
  ];
  const key = (x: number, z: number) => `${x}|${z}`;
  // Top surfaces meeting at each corner position.
  const cornerHeights = new Map<string, number[]>();
  for (const quad of tops) {
    for (const corner of quad.vertices) {
      const k = key(corner.x, corner.z);
      const list = cornerHeights.get(k) ?? [];
      if (!list.includes(corner.y)) list.push(corner.y);
      cornerHeights.set(k, list);
    }
  }
  // Vertical coverage spans: a side quad covers every corner position along
  // its plan line (half-integer legacy grids included), looked up by index.
  const cornerSpans = new Map<string, Array<{ bottom: number; top: number }>>();
  const cornersByX = new Map<number, number[]>();
  const cornersByZ = new Map<number, number[]>();
  for (const k of cornerHeights.keys()) {
    const [cx, cz] = k.split("|").map(Number) as [number, number];
    const byX = cornersByX.get(cx) ?? [];
    byX.push(cz);
    cornersByX.set(cx, byX);
    const byZ = cornersByZ.get(cz) ?? [];
    byZ.push(cx);
    cornersByZ.set(cz, byZ);
  }
  for (const quad of sides) {
    const points: V[] = [];
    for (let corner = 0; corner < 4; corner += 1) {
      const a = quad.vertices[corner]!;
      const b = quad.vertices[(corner + 1) % 4]!;
      if (a.x === b.x && a.z === b.z) points.push(a);
    }
    if (points.length !== 2) continue;
    const ys = quad.vertices.map((v) => v.y);
    const bottom = Math.min(...ys);
    const top = Math.max(...ys);
    const [p0, p1] = points as [V, V];
    const minX = Math.min(p0.x, p1.x);
    const maxX = Math.max(p0.x, p1.x);
    const minZ = Math.min(p0.z, p1.z);
    const maxZ = Math.max(p0.z, p1.z);
    if (minX === maxX) {
      for (const z of cornersByX.get(minX) ?? []) {
        if (z >= minZ - 0.011 && z <= maxZ + 0.011) {
          const spans = cornerSpans.get(key(minX, z)) ?? [];
          spans.push({ bottom, top });
          cornerSpans.set(key(minX, z), spans);
        }
      }
    } else if (minZ === maxZ) {
      for (const x of cornersByZ.get(minZ) ?? []) {
        if (x >= minX - 0.011 && x <= maxX + 0.011) {
          const spans = cornerSpans.get(key(x, minZ)) ?? [];
          spans.push({ bottom, top });
          cornerSpans.set(key(x, minZ), spans);
        }
      }
    }
  }
  const slits: string[] = [];
  for (const [k, heights] of cornerHeights) {
    if (heights.length < 2) continue;
    const low = Math.min(...heights);
    const high = Math.max(...heights);
    const spans = cornerSpans.get(k) ?? [];
    let cursor = low;
    let closed = false;
    for (let pass = 0; pass < spans.length + 1; pass += 1) {
      const next = Math.max(cursor, ...spans.filter((span) => span.bottom <= cursor + 0.011).map((span) => span.top));
      if (next >= high - 0.011) { closed = true; break; }
      if (next <= cursor) break;
      cursor = next;
    }
    if (!closed) slits.push(`${k} heights=${JSON.stringify(heights)} spans=${JSON.stringify(spans)}`);
  }
  return slits;
}

it("leaves no sky-visible slit at cell corners of a multi-level natural settlement", () => {
  for (const version of [1, 4] as const) {
    for (const seed of ["world-default", "probe-seed-16", "stable-world", "mountain-basin"]) {
      const slits = collectCornerSlits(seed, version);
      console.log(`v${version} ${seed}: ${slits.length} open corner slits`);
      for (const slit of slits.slice(0, 8)) console.log("  SLIT", slit);
      expect(slits.length).toBe(0);
    }
  }
}, 60_000);
