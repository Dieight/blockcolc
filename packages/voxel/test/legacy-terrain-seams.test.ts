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

it("scans legacy terrain paths for sky-visible vertical gaps", () => {
  for (const style of ["classic-island", "natural-valley"] as const) {
    const placements = layoutWorlds(snapshots);
    const roads = roadCellsForVillage(placements);
    const terrain = createSteppedTerrainData(placements, roads, [], undefined, {
      environmentStyle: style,
      worldSeed: "stable-world",
      terrainGenerationVersion: 1,
    });
    const round = (value: number) => Math.round(value * 1000) / 1000;
    const vertex = (index: number) => ({
      x: round(terrain.positions[index * 3]!),
      y: round(terrain.positions[index * 3 + 1]!),
      z: round(terrain.positions[index * 3 + 2]!),
    });
    const edgeKey = (a: { x: number; z: number }, b: { x: number; z: number }) => {
      const minX = Math.min(a.x, b.x); const maxX = Math.max(a.x, b.x);
      const minZ = Math.min(a.z, b.z); const maxZ = Math.max(a.z, b.z);
      return `${minX}|${minZ}|${maxX}|${maxZ}`;
    };
    type Quad = { vertices: Array<{ x: number; y: number; z: number }>; material: string };
    const quadsOf = (indices: readonly number[], material: string): Quad[] => {
      const quads: Quad[] = [];
      for (let offset = 0; offset < indices.length; offset += 6) {
        const unique = [...new Set([indices[offset]!, indices[offset + 1]!, indices[offset + 2]!, indices[offset + 3]!, indices[offset + 5]!])];
        quads.push({ vertices: unique.map((index) => vertex(index)), material });
      }
      return quads;
    };
    const surfaces = [
      ...quadsOf(terrain.indicesByMaterial.grass, "grass"),
      ...quadsOf(terrain.indicesByMaterial.water, "water"),
    ];
    const sides = [
      ...quadsOf(terrain.sideIndices.dirt, "dirt"),
      ...quadsOf(terrain.sideIndices.stone, "stone"),
    ];
    const edgeSurfaces = new Map<string, Quad[]>();
    for (const surface of surfaces) {
      for (let corner = 0; corner < 4; corner += 1) {
        const a = surface.vertices[corner]!;
        const b = surface.vertices[(corner + 1) % 4]!;
        const key = edgeKey(a, b);
        const list = edgeSurfaces.get(key) ?? [];
        if (!list.includes(surface)) list.push(surface);
        edgeSurfaces.set(key, list);
      }
    }
    const sideSpans = new Map<string, Array<{ bottom: number; top: number }>>();
    for (const side of sides) {
      const key = edgeKey(side.vertices[0]!, side.vertices[2]!);
      const spans = sideSpans.get(key) ?? [];
      spans.push({ bottom: Math.min(...side.vertices.map((v) => v.y)), top: Math.max(...side.vertices.map((v) => v.y)) });
      sideSpans.set(key, spans);
    }
    const gaps: string[] = [];
    for (const [key, sharing] of edgeSurfaces) {
      if (sharing.length < 2) continue;
      const heights = [...new Set(sharing.map((surface) => surface.vertices[0]!.y))];
      if (heights.length < 2) continue;
      const low = Math.min(...heights);
      const high = Math.max(...heights);
      const spans = sideSpans.get(key) ?? [];
      let cursor = low;
      let closed = false;
      for (let pass = 0; pass < spans.length + 1; pass += 1) {
        const next = Math.max(cursor, ...spans.filter((span) => span.bottom <= cursor + 0.011).map((span) => span.top));
        if (next >= high - 0.011) { closed = true; break; }
        if (next <= cursor) break;
        cursor = next;
      }
      if (!closed) gaps.push(`${style} ${key} step ${low}..${high} spans=${JSON.stringify(spans)}`);
    }
    console.log(`${style}: ${gaps.length} open steps`);
    for (const gap of gaps.slice(0, 6)) console.log("  GAP", gap);
    expect(gaps.length).toBe(0);
  }
});
