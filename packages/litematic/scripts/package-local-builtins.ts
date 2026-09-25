import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateBlueprint } from "@tomato-clock/voxel";
import { parseLitematic } from "../src/index.js";

type LocalBuiltinCategory = "building" | "daily-reward";

interface LocalBuiltinSource {
  category: LocalBuiltinCategory;
  id: string;
}

const INPUT_DIRECTORY = process.argv[2] ?? "D:/Litematic";
const OUTPUT_DIRECTORY = resolve(import.meta.dirname, "../../voxel/src/local-blueprints");
const SOURCES: Readonly<Record<string, LocalBuiltinSource>> = Object.freeze({
  "Dieight的高级火柴盒.litematic": { category: "building", id: "builtin-local-advanced-matchbox" },
  "Dieight的高级火柴盒plus.litematic": { category: "building", id: "builtin-local-advanced-matchbox-plus" },
  "Dieight的高级火柴盒pro.litematic": { category: "building", id: "builtin-local-advanced-matchbox-pro" },
  "GYPpro的简易小仓库.litematic": { category: "building", id: "builtin-local-gyp-simple-warehouse" },
  "Dieight的神秘附魔台.litematic": { category: "daily-reward", id: "builtin-local-mysterious-enchanting-table" },
  "Dieight的小别墅.litematic": { category: "building", id: "builtin-local-small-villa" },
  "Dieight的小水箱.litematic": { category: "daily-reward", id: "builtin-local-small-water-tank" },
  "karry_steven的豪宅.litematic": { category: "building", id: "builtin-local-gkr-mansion" },
  "GYPpro的豪宅（一层）.litematic": { category: "building", id: "builtin-local-gyp-mansion-first-floor" },
  "m0m0kA_QWQ的小黄鸭.litematic": { category: "daily-reward", id: "builtin-local-wqh-yellow-duck" },
});

if (!existsSync(INPUT_DIRECTORY)) {
  console.log(JSON.stringify({
    status: "skipped-no-local-input",
    inputDirectory: INPUT_DIRECTORY,
    note: "No local blueprints generated; checked-in built-ins remain available.",
  }));
} else {
  const inputFiles = readdirSync(INPUT_DIRECTORY)
    .filter((name) => name.toLowerCase().endsWith(".litematic"))
    .sort(compareText);
  const failures: Array<{ file: string; error: string }> = [];
  for (const file of inputFiles) if (!Object.hasOwn(SOURCES, file)) failures.push({ file, error: "No stable local built-in ID is registered for this source name" });
  for (const file of Object.keys(SOURCES)) if (!inputFiles.includes(file)) failures.push({ file, error: "Expected local source file is missing" });

  const parsed: Array<{
    file: string;
    outputDirectory: string;
    blueprint: ReturnType<typeof validateBlueprint>;
    report: Record<string, unknown>;
  }> = [];

  for (const file of inputFiles) {
    const source = SOURCES[file];
    if (!source) continue;
    const sourcePath = resolve(INPUT_DIRECTORY, file);
    const sourceBytes = readFileSync(sourcePath);
    try {
      const result = await parseLitematic(sourceBytes, { blueprintId: source.id });
      const stem = file.slice(0, -".litematic".length);
      const blueprint = validateBlueprint({ ...result.blueprint, id: source.id, title: stem });
      const width = blueprint.bounds.maxX - blueprint.bounds.minX + 1;
      const height = blueprint.bounds.maxY - blueprint.bounds.minY + 1;
      const depth = blueprint.bounds.maxZ - blueprint.bounds.minZ + 1;
      const fitsOrdinaryBuilding = width <= 96 && height <= 256 && depth <= 96 && blueprint.voxels.length <= 300_000;
      const fitsDailyReward = width <= 12 && height <= 16 && depth <= 12 && blueprint.voxels.length <= 2_000;
      const fitsCategory = source.category === "building" ? fitsOrdinaryBuilding : fitsDailyReward;
      if (!fitsCategory) {
        failures.push({
          file,
          error: source.category === "building"
            ? `Does not fit building import limits: ${width}x${height}x${depth}, ${blueprint.voxels.length} voxels (max 96x256x96 / 300000)`
            : `Does not fit daily reward limits: ${width}x${height}x${depth}, ${blueprint.voxels.length} voxels (max 12x16x12 / 2000)`,
        });
      }
      const blockCounts = new Map<string, number>();
      for (const voxel of blueprint.voxels) {
        const blockId = voxel.sourceBlockId ?? "(missing sourceBlockId)";
        blockCounts.set(blockId, (blockCounts.get(blockId) ?? 0) + 1);
      }
      const jsonBytes = Buffer.byteLength(JSON.stringify(blueprint));
      parsed.push({
        file,
        outputDirectory: source.category === "building" ? "buildings" : "daily-rewards",
        blueprint,
        report: {
          file,
          category: source.category,
          stableId: blueprint.id,
          preservedTitle: blueprint.title,
          dimensions: result.preview.dimensions,
          sourceMetadata: {
            name: result.preview.name,
            author: result.preview.author,
            litematicVersion: `${result.preview.litematicVersion}.${result.preview.litematicSubVersion ?? 0}`,
            minecraftDataVersion: result.preview.minecraftDataVersion,
            compressedBytes: sourceBytes.byteLength,
          },
          regions: result.preview.regions.map((region) => ({
            name: region.name,
            position: region.position,
            signedSize: region.signedSize,
            paletteEntries: region.paletteEntries,
            volume: region.volume,
          })),
          paletteEntries: result.preview.paletteEntries,
          metadataTotalBlocks: result.preview.metadataTotalBlocks,
          nonAirBlockCount: result.preview.nonAirBlockCount,
          uniqueBlockTypeCount: blockCounts.size,
          blueprintJsonBytes: jsonBytes,
          fitsOrdinaryBuildingLimits: fitsOrdinaryBuilding,
          fitsDailyRewardLimits: fitsDailyReward,
          compatibility: {
            mappedPaletteEntries: result.preview.compatibility.mappedPaletteEntries,
            placeholderPaletteEntries: result.preview.compatibility.placeholderPaletteEntries,
            placeholderBlockNames: result.preview.compatibility.placeholderBlockNames,
            placeholderVoxelCount: result.preview.compatibility.placeholderVoxelCount,
            preservedBlockStateProperties: result.preview.compatibility.preservedBlockStateProperties,
            ignoredEntities: result.preview.compatibility.ignoredEntities,
            ignoredTileEntities: result.preview.compatibility.ignoredTileEntities,
            ignoredPendingTicks: result.preview.compatibility.ignoredPendingTicks,
          },
        },
      });
    } catch (error) {
      failures.push({
        file,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  }

  console.log(JSON.stringify({
    status: failures.length === 0 ? "validated" : "failed",
    inputDirectory: INPUT_DIRECTORY,
    expectedFiles: Object.keys(SOURCES).length,
    foundFiles: inputFiles.length,
    parsedFiles: parsed.length,
    files: parsed.map(({ report }) => report),
    failures,
  }));

  if (failures.length > 0 || parsed.length !== Object.keys(SOURCES).length) {
    process.exitCode = 1;
  } else {
    for (const item of parsed) {
      const directory = resolve(OUTPUT_DIRECTORY, item.outputDirectory);
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, `${item.blueprint.id}.json`), JSON.stringify(item.blueprint));
    }
    const generatedBytes = parsed.reduce((total, item) => total + Buffer.byteLength(JSON.stringify(item.blueprint)), 0);
    console.log(JSON.stringify({
      status: "packaged",
      assetCount: parsed.length,
      generatedBlueprintJsonBytes: generatedBytes,
      outputDirectory: OUTPUT_DIRECTORY,
      gitIgnoredLocalInput: true,
    }));
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
