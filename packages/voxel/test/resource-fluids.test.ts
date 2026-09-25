import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BlueprintVoxel } from "../src/blueprint";
import { planResourceFluidBatches, planResourceWaterloggedFluidBatches } from "../src/resource-fluids";
import {
  createTexturedBoxGeometry,
  encodeFluidCornerHeights,
  encodeFluidSurfaceMetadata,
  unpackFaceTintKinds,
  type AtlasTile,
  type ResourcePackAtlas,
  type ResourcePackAtlasPage,
} from "../src/resource-textures";

function voxel(id: string, x = 0, y = 0, z = 0, level?: string): BlueprintVoxel {
  return {
    x, y, z, materialId: "stone", buildOrder: 10_000,
    sourceBlockId: id,
    ...(level === undefined ? {} : { sourceBlockState: { level } }),
  };
}

function waterloggedVoxel(id: string, x = 0, y = 0, z = 0): BlueprintVoxel {
  return {
    x, y, z, materialId: "stone", buildOrder: 10_000,
    sourceBlockId: id,
    sourceBlockState: { waterlogged: "true" },
  };
}

function atlas(tilePages: Record<string, number>): ResourcePackAtlas {
  const pages = Array.from({ length: Math.max(1, ...Object.values(tilePages).map((page) => page + 1)) }, () => ({
    texture: new THREE.DataTexture(new Uint8Array(64 * 64 * 4), 64, 64),
    width: 64, height: 64, columns: 2, cellSize: 20, padding: 2,
  } satisfies ResourcePackAtlasPage));
  const pageCounts = new Map<number, number>();
  const tiles = new Map<string, AtlasTile>();
  for (const [resourceId, page] of Object.entries(tilePages)) {
    const index = pageCounts.get(page) ?? 0;
    pageCounts.set(page, index + 1);
    tiles.set(resourceId, {
      resourceId, index, page, pageTextureIndex: index, alphaMode: "opaque",
    });
  }
  return { pages, tiles, source: {} as ResourcePackAtlas["source"], dispose() { for (const page of pages) page.texture.dispose(); } };
}

describe("resource-pack fluid surfaces", () => {
  it("uses imported animated-atlas still and flow tiles with water tint instead of a procedural box", () => {
    const resourceAtlas = atlas({
      "minecraft:block/water_still": 0,
      "minecraft:block/water_flow": 0,
    });
    const water = voxel("minecraft:water", 2, 3, 4, "2");
    const plan = planResourceFluidBatches([water], resourceAtlas);

    expect(plan.texturedVoxelCount).toBe(1);
    expect(plan.fallbackVoxels).toEqual([]);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.height).toBeCloseTo(6 / 9);
    expect(plan.batches[0]?.faceMask).toBe(0b11_1111);
    expect(plan.batches[0]?.alphaMode).toBe("translucent");
    expect(plan.batches[0]?.entries[0]?.faceTiles).toEqual([0, 0, 1, 1, 1, 1]);
    expect(unpackFaceTintKinds(plan.batches[0]!.entries[0]!.faceTintWord)).toEqual([3, 3, 3, 3, 3, 3]);
    const geometry = createTexturedBoxGeometry(plan.batches[0]!.entries);
    expect(geometry.getIndex()?.count).toBe(36);
    geometry.dispose();
    resourceAtlas.dispose();
  });

  it("splits still and flow surfaces safely when atlas tiles lie on different pages", () => {
    const resourceAtlas = atlas({
      "minecraft:block/lava_still": 0,
      "minecraft:block/lava_flow": 1,
    });
    const plan = planResourceFluidBatches([voxel("minecraft:lava")], resourceAtlas);

    expect(plan.texturedVoxelCount).toBe(1);
    expect(plan.batches.map((batch) => [batch.page, batch.faceMask])).toEqual([[0, 0b00_0011], [1, 0b11_1100]]);
    expect(plan.batches.every((batch) => batch.kind === "lava" && batch.alphaMode === "opaque")).toBe(true);
    resourceAtlas.dispose();
  });

  it("hides internal fluid faces even where a neighboring fluid surface is lower", () => {
    const resourceAtlas = atlas({ "minecraft:block/water_still": 0, "minecraft:block/water_flow": 0 });
    const upper = voxel("minecraft:water", 0, 1, 0);
    const lower = voxel("minecraft:water", 0, 0, 0);
    const lowNeighbor = voxel("minecraft:water", 1, 1, 0, "7");
    const plan = planResourceFluidBatches([upper, lower, lowNeighbor], resourceAtlas);
    const upperEntry = plan.batches.find((batch) => batch.entries.some((entry) => entry.voxel === upper));
    const lowerEntry = plan.batches.find((batch) => batch.entries.some((entry) => entry.voxel === lower));
    expect(upperEntry?.faceMask && (upperEntry.faceMask & (1 << 0))).toBe(0);
    expect(lowerEntry?.faceMask && (lowerEntry.faceMask & (1 << 1))).toBe(0);
    expect(upperEntry?.faceMask && (upperEntry.faceMask & (1 << 5))).toBe(0);
    resourceAtlas.dispose();
  });

  it("culls an ordinary water face against a modeled waterlogged neighbor", () => {
    const resourceAtlas = atlas({ "minecraft:block/water_still": 0, "minecraft:block/water_flow": 0 });
    const source = voxel("minecraft:water", 0, 0, 0);
    const host = waterloggedVoxel("minecraft:oak_stairs", 1, 0, 0);
    const plan = planResourceFluidBatches([source], resourceAtlas, [source, host]);
    const entry = plan.batches.flatMap((batch) => batch.entries).find((item) => item.voxel === source);
    expect(plan.texturedVoxelCount).toBe(1);
    expect(entry?.faceMask && (entry.faceMask & (1 << 5))).toBe(0);
    resourceAtlas.dispose();
  });

  it("keeps the procedural fallback when a pack has no usable fluid tile", () => {
    const resourceAtlas = atlas({ "minecraft:block/stone": 0 });
    const water = voxel("minecraft:water");
    const plan = planResourceFluidBatches([water, voxel("minecraft:stone")], resourceAtlas);
    expect(plan.texturedVoxelCount).toBe(0);
    expect(plan.batches).toEqual([]);
    expect(plan.fallbackVoxels).toEqual([water]);
    resourceAtlas.dispose();
  });

  it("adds model-occluded water layers for representative stairs, slabs, fences, and leaves", () => {
    const resourceAtlas = atlas({
      "minecraft:block/water_still": 0,
      "minecraft:block/water_flow": 0,
    });
    const hosts = [
      waterloggedVoxel("minecraft:oak_stairs", 0),
      waterloggedVoxel("minecraft:stone_slab", 2),
      waterloggedVoxel("minecraft:oak_fence", 4),
      waterloggedVoxel("minecraft:oak_leaves", 6),
    ];
    const plan = planResourceWaterloggedFluidBatches(hosts, resourceAtlas);

    expect(plan.texturedVoxelCount).toBe(4);
    expect(plan.fallbackVoxels).toEqual([]);
    expect(plan.batches.every((batch) => batch.waterlogged && batch.kind === "water")).toBe(true);
    expect(plan.batches.every((batch) => batch.alphaMode === "translucent")).toBe(true);
    expect(plan.batches.every((batch) => Math.abs(batch.height - 8 / 9) < 0.001)).toBe(true);
    expect(plan.batches.flatMap((batch) => batch.entries.map((entry) => entry.voxel))).toEqual(hosts);
    expect(plan.batches.flatMap((batch) => batch.entries).every((entry) => entry.faceMask === 0b11_1111)).toBe(true);
    expect(plan.omittedVoxelCount).toBe(0);
    resourceAtlas.dispose();
  });

  it("uses Java source-water height and removes every shared face against same-fluid neighbors", () => {
    const resourceAtlas = atlas({
      "minecraft:block/water_still": 0,
      "minecraft:block/water_flow": 0,
    });
    const host = waterloggedVoxel("minecraft:oak_stairs");
    const adjacentSourceWater = voxel("minecraft:water", 1, 0, 0, "0");
    const lowerWater = voxel("minecraft:water", 0, -1, 0, "7");
    const plan = planResourceWaterloggedFluidBatches([host, adjacentSourceWater, lowerWater], resourceAtlas);
    const entry = plan.batches.flatMap((batch) => batch.entries).find((item) => item.voxel === host);

    expect(plan.batches.find((batch) => batch.entries.some((item) => item.voxel === host))?.height).toBeCloseTo(8 / 9);
    expect(entry?.faceMask && (entry.faceMask & (1 << 5))).toBe(0);
    expect(entry?.faceMask && (entry.faceMask & (1 << 0))).toBe(0);
    expect(plan.texturedVoxelCount).toBe(1);
    resourceAtlas.dispose();
  });

  it("raises waterlogged level only below an adjacent same-fluid cell above", () => {
    const resourceAtlas = atlas({
      "minecraft:block/water_still": 0,
      "minecraft:block/water_flow": 0,
    });
    const lower = waterloggedVoxel("minecraft:oak_fence", 0, 0, 0);
    const upper = waterloggedVoxel("minecraft:oak_fence", 0, 1, 0);
    const plan = planResourceWaterloggedFluidBatches([lower, upper], resourceAtlas);
    const lowerBatch = plan.batches.find((batch) => batch.entries.some((entry) => entry.voxel === lower));
    const upperBatch = plan.batches.find((batch) => batch.entries.some((entry) => entry.voxel === upper));
    const lowerEntry = lowerBatch?.entries.find((entry) => entry.voxel === lower);

    expect(lowerBatch?.height).toBe(1);
    expect(upperBatch?.height).toBeCloseTo(8 / 9);
    expect(lowerEntry?.faceMask && (lowerEntry.faceMask & (1 << 1))).toBe(0);
    expect(plan.texturedVoxelCount).toBe(2);
    resourceAtlas.dispose();
  });

  it("emits face-masked fallback geometry without imported fluid tiles and chunks without omissions", () => {
    const hosts = [
      waterloggedVoxel("minecraft:oak_stairs"),
      waterloggedVoxel("minecraft:stone_slab", 2),
      waterloggedVoxel("minecraft:oak_fence", 4),
    ];
    const fallbackPlan = planResourceWaterloggedFluidBatches(hosts);
    expect(fallbackPlan.texturedVoxelCount).toBe(0);
    expect(fallbackPlan.fallbackEntries).toHaveLength(3);
    expect(fallbackPlan.fallbackBatches.map((batch) => batch.entries.length)).toEqual([3]);
    expect(fallbackPlan.fallbackBatches[0]?.height).toBeCloseTo(8 / 9);

    const resourceAtlas = atlas({
      "minecraft:block/water_still": 0,
      "minecraft:block/water_flow": 0,
    });
    const chunkedPlan = planResourceWaterloggedFluidBatches(hosts, resourceAtlas, 2);
    expect(chunkedPlan.batches.map((batch) => batch.entries.length)).toEqual([2, 1]);
    expect(chunkedPlan.omittedVoxelCount).toBe(0);
    expect(chunkedPlan.texturedVoxelCount).toBe(3);
    resourceAtlas.dispose();
  });

  it("splits no-atlas waterlogged fallback batches by height and exposed-face mask", () => {
    const adjacentWaterlogged = waterloggedVoxel("minecraft:oak_stairs", 0, 0, 0);
    const ordinaryWater = voxel("minecraft:water", 1, 0, 0, "0");
    const isolatedWaterlogged = waterloggedVoxel("minecraft:oak_fence", 3, 0, 0);
    const plan = planResourceWaterloggedFluidBatches([
      adjacentWaterlogged,
      ordinaryWater,
      isolatedWaterlogged,
    ]);

    expect(plan.fallbackBatches.map((batch) => [batch.height, batch.faceMask, batch.entries.length])).toEqual([
      [8 / 9, 0b01_1111, 1],
      [8 / 9, 0b11_1111, 1],
    ]);
    expect(plan.fallbackEntries.find((entry) => entry.voxel === adjacentWaterlogged)?.faceMask).toBe(0b01_1111);
    expect(plan.fallbackEntries.find((entry) => entry.voxel === isolatedWaterlogged)?.faceMask).toBe(0b11_1111);

    const geometries = plan.fallbackBatches.map((batch) => createTexturedBoxGeometry(batch.entries));
    expect(geometries.map((geometry) => geometry.userData.blockcolcFaceMask)).toEqual([0b01_1111, 0b11_1111]);
    geometries.forEach((geometry) => geometry.dispose());
  });

  it("keeps Java corner heights flat for equal-level neighbors and slopes toward lower cells", () => {
    const flatVoxels = Array.from({ length: 9 }, (_, index) => voxel(
      "minecraft:water", index % 3, 0, Math.floor(index / 3), "0",
    ));
    const center = flatVoxels.find((item) => item.x === 1 && item.z === 1)!;
    const flat = planResourceFluidBatches([center], undefined, flatVoxels).fallbackEntries[0]!.fluidSurface!;
    flat.cornerHeights.forEach((height) => expect(height).toBeCloseTo(8 / 9));
    expect(flat.flowing).toBe(false);

    const slopedVoxels = flatVoxels.map((item) => item.x === 2
      ? { ...item, sourceBlockState: { level: "6" } }
      : item);
    const sloped = planResourceFluidBatches(
      [center], undefined, slopedVoxels,
    ).fallbackEntries[0]!.fluidSurface!;
    expect(sloped.cornerHeights[0]).toBeCloseTo(8 / 9);
    expect(sloped.cornerHeights[1]).toBeLessThan(sloped.cornerHeights[0]);
    expect(sloped.flowing).toBe(true);
    expect(sloped.flowAngleRadians).toBeCloseTo(-Math.PI / 2);
  });

  it("promotes a corner to full height when a same-fluid cardinal cell is full above", () => {
    const target = voxel("minecraft:water", 1, 0, 1, "0");
    const north = voxel("minecraft:water", 1, 0, 0, "0");
    const northAbove = voxel("minecraft:water", 1, 1, 0, "0");
    const plan = planResourceFluidBatches([target], undefined, [target, north, northAbove]);
    const corners = plan.fallbackEntries[0]!.fluidSurface!.cornerHeights;
    expect(corners[0]).toBe(1);
    expect(corners[1]).toBe(1);
  });

  it("shares slope and flowing-top selection across waterlogged and ordinary water", () => {
    const resourceAtlas = atlas({
      "minecraft:block/water_still": 0,
      "minecraft:block/water_flow": 0,
    });
    const host = waterloggedVoxel("minecraft:oak_stairs", 0, 0, 0);
    const lowerOrdinaryWater = voxel("minecraft:water", 1, 0, 0, "6");
    const plan = planResourceWaterloggedFluidBatches([host, lowerOrdinaryWater], resourceAtlas);
    const entry = plan.batches.flatMap((batch) => batch.entries).find((item) => item.voxel === host)!;
    const flowingTile = resourceAtlas.tiles.get("minecraft:block/water_flow")!;

    expect(entry.fluidSurface?.flowing).toBe(true);
    expect(entry.fluidSurface?.flowAngleRadians).toBeCloseTo(-Math.PI / 2);
    expect(entry.faceTiles[1]).toBe(flowingTile.pageTextureIndex);
    expect(entry.faceMask & (1 << 5)).toBe(0);
    resourceAtlas.dispose();
  });

  it("uses a bounded shader payload and valid geometry for flowing fluid surfaces", () => {
    const target = voxel("minecraft:water", 1, 0, 1, "0");
    const neighbors = Array.from({ length: 9 }, (_, index) => voxel(
      "minecraft:water", index % 3, 0, Math.floor(index / 3), index % 3 === 2 ? "6" : "0",
    ));
    const plan = planResourceFluidBatches([target], undefined, neighbors);
    const entry = plan.fallbackEntries[0]!;
    const geometry = createTexturedBoxGeometry([entry]);
    const packedCorners = geometry.getAttribute("instanceMaterialResponse").getX(0);
    const packedSurface = geometry.getAttribute("instanceFaceOcclusion").getX(0);

    expect(Number.isInteger(packedCorners)).toBe(true);
    expect(packedCorners).toBe(encodeFluidCornerHeights(entry.fluidSurface!.cornerHeights));
    expect(packedSurface).toBe(encodeFluidSurfaceMetadata(entry.fluidSurface!));
    expect(geometry.getIndex()?.count).toBeGreaterThan(0);
    expect(Array.from(geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
    geometry.dispose();
  });

  it("chunks more than 4096 waterlogged fluids without dropping any entries", () => {
    const hosts = Array.from({ length: 4100 }, (_, index) => waterloggedVoxel(
      "minecraft:oak_fence", index * 2, 0, 0,
    ));
    const plan = planResourceWaterloggedFluidBatches(hosts);
    expect(plan.omittedVoxelCount).toBe(0);
    expect(plan.fallbackEntries).toHaveLength(hosts.length);
    expect(plan.fallbackBatches.map((batch) => batch.entries.length)).toEqual([4096, 4]);
  });
});
