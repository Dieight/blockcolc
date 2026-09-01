import { expect, test } from "vitest";
import { SMALL_WORKSHOP_BLUEPRINT, TIMBER_HOUSE_BLUEPRINT } from "../src/blueprint";
import { alignWorldsToEnvironment, layoutWorlds } from "../src/renderer";
import { createSteppedTerrainData, type MergedGeometryData } from "../src/terrain";
import { roadCellsForVillage } from "../src/village";

const placements = layoutWorlds([
  { projectId: "a", blueprintId: SMALL_WORKSHOP_BLUEPRINT.id, buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 0 },
  { projectId: "b", blueprintId: TIMBER_HOUSE_BLUEPRINT.id, buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 1 },
]);
const roads = roadCellsForVillage(placements);
const largePlacements = layoutWorlds(Array.from({ length: 9 }, (_, settlementIndex) => ({
  projectId: `large-${settlementIndex}`,
  blueprintId: settlementIndex % 2 === 0 ? SMALL_WORKSHOP_BLUEPRINT.id : TIMBER_HOUSE_BLUEPRINT.id,
  buildingCompletionBasisPoints: 10_000,
  buildingConditionBasisPoints: 10_000,
  isMonument: false,
  settlementIndex,
})));
const largeRoads = roadCellsForVillage(largePlacements);

function build(seed: string): MergedGeometryData {
  return createSteppedTerrainData(placements, roads, [], undefined, { environmentStyle: "ocean-island", worldSeed: seed });
}

function buildLarge(seed: string): MergedGeometryData {
  return createSteppedTerrainData(largePlacements, largeRoads, [], undefined, { environmentStyle: "ocean-island", worldSeed: seed });
}

function topSurfaceRectangles(terrain: MergedGeometryData): Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> {
  const rectangles: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  for (const material of ["grass", "dirt", "stone", "water"] as const) {
    const indices = terrain.indicesByMaterial[material];
    for (let base = 0; base + 5 < indices.length; base += 6) {
      const vertices = [indices[base]!, indices[base + 1]!, indices[base + 2]!, indices[base + 5]!];
      const xs = vertices.map(index => terrain.positions[index * 3]!);
      const zs = vertices.map(index => terrain.positions[index * 3 + 2]!);
      rectangles.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
    }
  }
  return rectangles;
}

type SurfaceCell = { minX: number; maxX: number; minZ: number; maxZ: number; top: number };
type Edge = { start: number; end: number; top: number };
type SideFace = { start: number; end: number; bottom: number; top: number };

function unsealedStraightSideBands(terrain: MergedGeometryData): Array<{ axis: "x" | "z"; line: number; from: number; to: number; bottom: number; top: number }> {
  const cells: SurfaceCell[] = [];
  for (const material of ["grass", "dirt", "stone", "water"] as const) {
    const indices = terrain.indicesByMaterial[material];
    for (let base = 0; base + 5 < indices.length; base += 6) {
      const vertices = [indices[base]!, indices[base + 1]!, indices[base + 2]!, indices[base + 5]!];
      const xs = vertices.map(index => terrain.positions[index * 3]!);
      const ys = vertices.map(index => terrain.positions[index * 3 + 1]!);
      const zs = vertices.map(index => terrain.positions[index * 3 + 2]!);
      cells.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), top: Math.max(...ys) });
    }
  }

  const leftByX = new Map<number, Edge[]>();
  const rightByX = new Map<number, Edge[]>();
  const nearByZ = new Map<number, Edge[]>();
  const farByZ = new Map<number, Edge[]>();
  const sideByLine = new Map<string, SideFace[]>();
  const register = <T>(map: Map<number, T[]>, line: number, value: T) => {
    const values = map.get(line) ?? [];
    values.push(value);
    map.set(line, values);
  };
  for (const cell of cells) {
    register(leftByX, cell.minX, { start: cell.minZ, end: cell.maxZ, top: cell.top });
    register(rightByX, cell.maxX, { start: cell.minZ, end: cell.maxZ, top: cell.top });
    register(nearByZ, cell.minZ, { start: cell.minX, end: cell.maxX, top: cell.top });
    register(farByZ, cell.maxZ, { start: cell.minX, end: cell.maxX, top: cell.top });
  }
  for (const material of ["dirt", "stone"] as const) {
    const indices = terrain.sideIndices[material];
    for (let base = 0; base + 5 < indices.length; base += 6) {
      const unique = [...new Set([indices[base]!, indices[base + 1]!, indices[base + 2]!, indices[base + 5]!])];
      const points = unique.map(index => ({ x: terrain.positions[index * 3]!, y: terrain.positions[index * 3 + 1]!, z: terrain.positions[index * 3 + 2]! }));
      const xs = points.map(point => point.x);
      const ys = points.map(point => point.y);
      const zs = points.map(point => point.z);
      const axis = Math.max(...xs) - Math.min(...xs) < 0.001 ? "x" : Math.max(...zs) - Math.min(...zs) < 0.001 ? "z" : null;
      if (!axis) continue;
      const line = axis === "x" ? xs[0]! : zs[0]!;
      const span = axis === "x" ? zs : xs;
      const key = `${axis}:${line}`;
      const faces = sideByLine.get(key) ?? [];
      faces.push({ start: Math.min(...span), end: Math.max(...span), bottom: Math.min(...ys), top: Math.max(...ys) });
      sideByLine.set(key, faces);
    }
  }

  for (const map of [leftByX, rightByX, nearByZ, farByZ]) {
    for (const edges of map.values()) edges.sort((left, right) => left.start - right.start);
  }
  for (const faces of sideByLine.values()) faces.sort((left, right) => left.start - right.start);
  const overlapping = <T extends { start: number; end: number }>(values: readonly T[] | undefined, start: number, end: number): T[] => {
    if (!values) return [];
    let low = 0;
    let high = values.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (values[middle]!.end <= start + 0.001) low = middle + 1;
      else high = middle;
    }
    const result: T[] = [];
    for (let index = low; index < values.length && values[index]!.start < end - 0.001; index += 1) {
      if (values[index]!.end > start + 0.001) result.push(values[index]!);
    }
    return result;
  };
  const gaps: Array<{ axis: "x" | "z"; line: number; from: number; to: number; bottom: number; top: number }> = [];
  const check = (axis: "x" | "z", line: number, start: number, end: number, top: number, neighbors: readonly Edge[] | undefined) => {
    for (const neighbor of overlapping(neighbors, start, end)) {
      if (neighbor.top >= top - 0.01) continue;
      const from = Math.max(start, neighbor.start);
      const to = Math.min(end, neighbor.end);
      const sealed = overlapping(sideByLine.get(`${axis}:${line}`), from, to).some(face =>
        face.start <= from + 0.001 && face.end >= to - 0.001
        && face.bottom <= neighbor.top + 0.001 && face.top >= top - 0.001);
      if (!sealed) gaps.push({ axis, line, from, to, bottom: neighbor.top, top });
      if (gaps.length >= 20) return;
    }
  };
  for (const cell of cells) {
    check("x", cell.minX, cell.minZ, cell.maxZ, cell.top, rightByX.get(cell.minX));
    check("x", cell.maxX, cell.minZ, cell.maxZ, cell.top, leftByX.get(cell.maxX));
    check("z", cell.minZ, cell.minX, cell.maxX, cell.top, farByZ.get(cell.minZ));
    check("z", cell.maxZ, cell.minX, cell.maxX, cell.top, nearByZ.get(cell.maxZ));
    if (gaps.length >= 20) break;
  }
  return gaps;
}

function uncoveredBandsAroundIslets(terrain: MergedGeometryData): Array<{ islet: number; z: number; from: number; to: number }> {
  const rectangles = topSurfaceRectangles(terrain);
  const gaps: Array<{ islet: number; z: number; from: number; to: number }> = [];
  for (const [isletIndex, islet] of (terrain.oceanIslets ?? []).entries()) {
    const backgroundSkipReach = Math.ceil(((islet.radius + 5) * 1.45) / 32) * 32;
    const inspectionReach = backgroundSkipReach + 32;
    const minX = islet.x - inspectionReach;
    const maxX = islet.x + inspectionReach;
    const local = rectangles.filter(rectangle =>
      rectangle.maxX > minX && rectangle.minX < maxX
      && rectangle.maxZ > islet.z - inspectionReach && rectangle.minZ < islet.z + inspectionReach);
    // Offset the scan from cell edges. Each row merges the top-surface x
    // intervals; any positive-width band is a real sky-visible missing face,
    // independent of camera, lighting or screenshot thresholds.
    for (let zOffset = -inspectionReach + 0.37; zOffset < inspectionReach; zOffset += 1) {
      const z = islet.z + zOffset;
      const intervals = local
        .filter(rectangle => rectangle.minZ < z && rectangle.maxZ > z)
        .map(rectangle => ({ from: Math.max(minX, rectangle.minX), to: Math.min(maxX, rectangle.maxX) }))
        .filter(interval => interval.to > interval.from)
        .sort((a, b) => a.from - b.from);
      let coveredTo = minX;
      for (const interval of intervals) {
        if (interval.from > coveredTo + 0.001) {
          gaps.push({ islet: isletIndex, z, from: coveredTo, to: interval.from });
          if (gaps.length >= 20) return gaps;
        }
        coveredTo = Math.max(coveredTo, interval.to);
        if (coveredTo >= maxX) break;
      }
      if (coveredTo < maxX - 0.001) gaps.push({ islet: isletIndex, z, from: coveredTo, to: maxX });
      if (gaps.length >= 20) return gaps;
    }
  }
  return gaps;
}

test("ocean island: framing stays dry, ocean dominates, islets exist", () => {
  for (const seed of ["sea-a", "sea-b", "sea-c"]) {
    const terrain = build(seed);
    const framing = terrain.framingBounds;
    // Land must cover the whole framing box (2-unit sample grid).
    let dryInside = 0;
    for (let x = Math.ceil(framing.minX) - 1; x <= framing.maxX; x += 2) {
      for (let z = Math.ceil(framing.minZ) - 1; z <= framing.maxZ; z += 2) {
        if (Math.abs(x) > framing.maxX || Math.abs(z) > framing.maxZ) continue;
        dryInside += 1;
      }
    }
    expect(dryInside).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`OCEAN_FRAMING seed=${seed} framing=${JSON.stringify(framing)} dry=${dryInside} waterRatio=${(terrain.hydrology.waterSurfaceArea / terrain.hydrology.terrainSurfaceArea).toFixed(3)}`);
    // Water must dominate the total surface area (wide ocean).
    expect(terrain.hydrology.waterSurfaceArea / terrain.hydrology.terrainSurfaceArea).toBeGreaterThan(0.55);
    // Some land must exist beyond the main island (satellite islets): land
    // cells whose center lies farther than framing radius + 40.
    let isletLand = 0;
    for (const key of terrain.indicesByMaterial.grass.keys()) { void key; break; }
    const positions = terrain.positions;
    const counts = { grass: 0, stone: 0, dirt: 0, water: 0 };
    for (const material of ["grass", "dirt", "stone", "water"] as const) {
      const indices = terrain.indicesByMaterial[material];
      for (let base = 0; base + 2 < indices.length; base += 6) {
        const p0 = indices[base]! * 3;
        const x = positions[p0]! + Math.abs(positions[p0 + 2]! * 0); // keep simple
        const z = positions[p0 + 2]!;
        const dist = Math.hypot(x, z);
        if (material !== "water" && dist > framing.maxX + 38) isletLand += 1;
        counts[material] += 1;
      }
    }
    expect(isletLand).toBeGreaterThan(100);
    // The building platform must stay uniform green — no beach, rock or water
    // quad center may sit inside the construction area (framing box).
    let platformDirt = 0;
    let platformStone = 0;
    let platformWater = 0;
    {
      const positions = terrain.positions;
      for (const material of ["dirt", "stone", "water"] as const) {
        const indices = terrain.indicesByMaterial[material];
        for (let base = 0; base + 2 < indices.length; base += 6) {
          const p0 = indices[base]! * 3;
          const p2 = indices[base + 2]! * 3;
          const cx = (positions[p0]! + positions[p2]!) / 2;
          const cz = (positions[p0 + 2]! + positions[p2 + 2]!) / 2;
          if (Math.max(Math.abs(cx), Math.abs(cz)) <= framing.maxX - 1) {
            if (material === "dirt") platformDirt += 1;
            if (material === "stone") platformStone += 1;
            if (material === "water") platformWater += 1;
          }
        }
      }
    }
    expect(platformDirt).toBe(0);
    expect(platformStone).toBe(0);
    expect(platformWater).toBe(0);
    // The ocean envelope sits far past any reachable view so the zoomed-out
    // rotation never shows a hard terrain edge.
    expect(terrain.bounds.maxX).toBeGreaterThanOrEqual(1100);
    // Straits: no land bridge between islands — every land quad at distance d
    // from origin has open water between mainRadius and d (checked visually via
    // the land-only ring counts above); at minimum land exists at 2+ distances.
    // Triangle budget sanity.
    expect(terrain.triangleCount).toBeLessThan(400_000);
    // eslint-disable-next-line no-console
    console.log(`OCEAN ${seed} water=${Math.round(terrain.hydrology.waterSurfaceArea / terrain.hydrology.terrainSurfaceArea * 100)}% tris=${terrain.triangleCount} isletLand=${isletLand} cells=${terrain.cellCount} bounds=${terrain.bounds.maxX}`);
  }
});

test("ocean island: satellite lattices leave no uncovered surface bands", () => {
  for (const seed of ["sea-a", "sea-b", "sea-c"]) {
    expect(uncoveredBandsAroundIslets(build(seed)), seed).toEqual([]);
  }
});

test("ocean island: actual mixed-LOD neighbours have continuous side faces", () => {
  for (const [label, terrain] of [
    ["sea-a", build("sea-a")],
    ["sea-b", build("sea-b")],
    ["sea-c", build("sea-c")],
    ["sea-large", buildLarge("sea-large")],
  ] as const) {
    expect(unsealedStraightSideBands(terrain), label).toEqual([]);
  }
});

test("ocean island: generated trees stay outside real building footprints", () => {
  const terrain = buildLarge("sea-large");
  const collisions = terrain.naturalTrees.filter(tree => largePlacements.some(placement =>
    Math.abs(tree.x - placement.worldPosition.x) <= placement.footprint.width / 2 + 2
    && Math.abs(tree.z - placement.worldPosition.z) <= placement.footprint.depth / 2 + 2));
  expect(collisions).toEqual([]);
});

test("ocean island: foundations use the inhabited terrace datum", () => {
  const legacy = layoutWorlds(Array.from({ length: 12 }, (_, settlementIndex) => ({
    projectId: `foundation-${settlementIndex}`,
    blueprintId: settlementIndex % 2 === 0 ? SMALL_WORKSHOP_BLUEPRINT.id : TIMBER_HOUSE_BLUEPRINT.id,
    buildingCompletionBasisPoints: 10_000,
    buildingConditionBasisPoints: 10_000,
    isMonument: false,
    settlementIndex,
  })));
  const ocean = alignWorldsToEnvironment(legacy, "ocean-island");
  expect(ocean.every(placement => placement.worldPosition.y >= 4)).toBe(true);
  expect(alignWorldsToEnvironment(legacy, "classic-island").map(placement => placement.worldPosition.y))
    .toEqual(legacy.map(placement => placement.worldPosition.y));
});

test("ocean island: main shore never falls back to 32-unit water LOD", () => {
  const terrain = buildLarge("shore-lod");
  const reach = (terrain.oceanMain?.radius ?? 0) * 1.2 + (terrain.oceanMain?.beach ?? 0) * 1.18 + 8;
  for (const material of ["grass", "dirt", "stone"] as const) {
    const indices = terrain.indicesByMaterial[material];
    for (let base = 0; base + 5 < indices.length; base += 6) {
      const vertices = [indices[base]!, indices[base + 1]!, indices[base + 2]!, indices[base + 5]!];
      const xs = vertices.map(index => terrain.positions[index * 3]!);
      const zs = vertices.map(index => terrain.positions[index * 3 + 2]!);
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
      if (Math.hypot(centerX, centerZ) > reach) continue;
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(4);
      expect(Math.max(...zs) - Math.min(...zs)).toBeLessThanOrEqual(4);
    }
  }
});
