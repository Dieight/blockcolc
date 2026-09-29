import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseJava16xResourcePack } from "@blockcolc/resource-pack";
import { describe, expect, it } from "vitest";
import {
  buildResourcePackAtlas,
  planTexturedVoxelPages,
  resourceTexturePlanCacheDiagnostics,
} from "../src/resource-textures";
import type { BlueprintVoxel } from "../src/blueprint";

const sampleDirectory = resolve(__dirname, "../../../artifacts/resourcepacks_test");
const sampleNames = ["Ashen_16x.zip", "Bare Bones 1.21.11.zip", "Plastic Texture Pack.zip", "Stay True 1.21.5.zip"];

describe("read-only resource-pack cold-path diagnostic", () => {
  it("measures archive parsing and atlas construction without retaining imported assets", () => {
    const samples = sampleNames.map((name) => resolve(sampleDirectory, name)).filter(existsSync);
    if (samples.length === 0) {
      console.warn("Local resource-pack diagnostics skipped: no permitted samples were found.");
      return;
    }

    const measurements = samples.map((path) => {
      const archive = readFileSync(path);
      const parseStarted = performance.now();
      const manifest = parseJava16xResourcePack(archive);
      const parseMs = performance.now() - parseStarted;
      const atlasStarted = performance.now();
      const atlas = buildResourcePackAtlas(manifest);
      const atlasMs = performance.now() - atlasStarted;
      let representativeVoxel: BlueprintVoxel | undefined;
      let texturePlanDiagnostic: Record<string, number> | undefined;
      // Find an actual texture-plan-able single-choice route without printing
      // any imported resource identifiers or asset content.
      if (atlas.pages.length > 0) {
        for (const blockState of manifest.blockStates) {
          const positionWeighted = blockState.variants.some((candidate) => candidate.choices.length > 1)
            || blockState.multipart?.some((part) => part.apply.length > 1);
          if (positionWeighted) continue;
          for (const variant of blockState.variants) {
            if (variant.choices.length !== 1) continue;
            const candidate: BlueprintVoxel = {
              x: 0, y: 0, z: 0, materialId: "stone", buildOrder: 1,
              sourceBlockId: blockState.resourceId,
              sourceBlockState: variant.conditions,
            };
            if (planTexturedVoxelPages(candidate, manifest, atlas)) {
              representativeVoxel = candidate;
              break;
            }
          }
          if (representativeVoxel) break;
        }
      }
      if (representativeVoxel) {
        const voxel = representativeVoxel;
        const coldStarted = performance.now();
        const coldPlan = planTexturedVoxelPages(voxel, manifest, atlas);
        const coldMissMs = performance.now() - coldStarted;
        if (coldPlan) {
          const repeated = Array.from({ length: 1000 }, (_, index): BlueprintVoxel => ({ ...voxel, x: index }));
          const unboundAtlas = { ...atlas };
          const uncachedStarted = performance.now();
          for (const item of repeated) planTexturedVoxelPages(item, manifest, unboundAtlas);
          const uncachedMs = performance.now() - uncachedStarted;
          const cachedStarted = performance.now();
          for (const item of repeated) planTexturedVoxelPages(item, manifest, atlas);
          const cachedMs = performance.now() - cachedStarted;
          const cache = resourceTexturePlanCacheDiagnostics(atlas);
          texturePlanDiagnostic = {
            coldMissMs: Number(coldMissMs.toFixed(3)),
            uncached1000Ms: Number(uncachedMs.toFixed(3)),
            cached1000Ms: Number(cachedMs.toFixed(3)),
            cacheHits: cache.hits,
            cacheMisses: cache.misses,
            cacheEntries: cache.entries,
            cacheEvictions: cache.evictions,
          };
        }
      }
      const result = {
        archiveBytes: archive.byteLength,
        textureCount: manifest.textures.length,
        blockStateCount: manifest.blockStates.length,
        modelCount: manifest.models.length,
        atlasPages: atlas.pages.length,
        estimatedPeakBytes: atlas.source.memoryEstimate?.estimatedPeakBytes ?? null,
        parseMs,
        atlasMs,
        ...(texturePlanDiagnostic ? { texturePlanDiagnostic } : {}),
      };
      atlas.dispose();
      return result;
    });
    const aggregate = {
      sampleCount: measurements.length,
      totalArchiveBytes: measurements.reduce((sum, item) => sum + item.archiveBytes, 0),
      totalTextures: measurements.reduce((sum, item) => sum + item.textureCount, 0),
      totalBlockStates: measurements.reduce((sum, item) => sum + item.blockStateCount, 0),
      totalModels: measurements.reduce((sum, item) => sum + item.modelCount, 0),
      totalAtlasPages: measurements.reduce((sum, item) => sum + item.atlasPages, 0),
      parseMedianMs: median(measurements.map((item) => item.parseMs)),
      atlasMedianMs: median(measurements.map((item) => item.atlasMs)),
      peakSinglePackEstimateBytes: Math.max(...measurements.map((item) => item.estimatedPeakBytes ?? 0)),
      texturePlanning: measurements.flatMap((item) => item.texturePlanDiagnostic ? [item.texturePlanDiagnostic] : []),
      phase: "synchronous archive parse, atlas CPU construction, one cold texture plan, and repeated non-position-weighted route planning; excludes IndexedDB, voxel geometry batching, renderer rebuild, GPU upload and first frame",
    };
    console.log(`[resource-pack-cold-path] ${JSON.stringify(aggregate)}`);
    expect(measurements.every((item) => item.atlasPages >= 0 && item.textureCount >= 0)).toBe(true);
  }, 30_000);
});

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
  return Number(value.toFixed(3));
}
