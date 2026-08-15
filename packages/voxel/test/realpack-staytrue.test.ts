import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseJava16xResourcePack } from "@tomato-clock/resource-pack";
import { expect, it } from "vitest";
import { builtinMaterialBlockId } from "../src/original-materials";
import { buildResourcePackAtlas, planTexturedVoxel, resolvePackTileRect } from "../src/resource-textures";
import type { BlueprintVoxel } from "../src/blueprint";

const realPackPath = resolve(__dirname, "../../../litematic/v17-stay-true-1.21.5.zip");

it("retextures built-in materials with the real v17-stay-true pack", () => {
  if (!existsSync(realPackPath)) {
    console.warn("Real pack fixture stays local; skipping.");
    return;
  }
  const manifest = parseJava16xResourcePack(readFileSync(realPackPath));
  const atlas = buildResourcePackAtlas(manifest, 2048);
  for (const materialId of ["stone", "plank", "roof", "accent"] as const) {
    const voxel: BlueprintVoxel = { x: 0, y: 0, z: 0, materialId, buildOrder: 10000 };
    expect(planTexturedVoxel(voxel, manifest, atlas), `${materialId} via ${builtinMaterialBlockId(materialId)}`).toBeDefined();
  }
  // wood (oak_log) and glass keep the procedural fallback with this pack: its oak_log
  // variants reference textures the pack does not ship, and glass is absent entirely.
  for (const materialId of ["wood", "glass"] as const) {
    const voxel: BlueprintVoxel = { x: 0, y: 0, z: 0, materialId, buildOrder: 10000 };
    expect(planTexturedVoxel(voxel, manifest, atlas), `${materialId} keeps the fallback`).toBeUndefined();
  }
  // Terrain surfaces resolve pack tiles where the pack ships the blocks; this pack
  // has no grass_block or dirt blockstates, so those keep their procedural fallback.
  expect(resolvePackTileRect(manifest, atlas, "minecraft:grass_block", "up")).toBeUndefined();
  const stoneRect = resolvePackTileRect(manifest, atlas, "minecraft:stone", "up");
  expect(stoneRect, "stone up face tile").toBeDefined();
  expect(stoneRect!.u1 - stoneRect!.u0).toBeGreaterThan(0);
  const dirtRect = resolvePackTileRect(manifest, atlas, "minecraft:dirt", "up");
  if (dirtRect) expect(dirtRect.u1 - dirtRect.u0).toBeGreaterThan(0);
  atlas.dispose();
});
