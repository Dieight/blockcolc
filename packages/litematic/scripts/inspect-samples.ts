import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseLitematic } from "../src/index.js";

const sampleDirectory = resolve(import.meta.dirname, "../../../litematic");
for (const file of readdirSync(sampleDirectory).filter((name) => name.endsWith(".litematic")).sort()) {
  const result = await parseLitematic(readFileSync(resolve(sampleDirectory, file)));
  const withoutBlockState = {
    ...result.blueprint,
    voxels: result.blueprint.voxels.map(({ sourceBlockState: _sourceBlockState, ...voxel }) => voxel),
  };
  console.log(JSON.stringify({
    file,
    name: result.preview.name,
    author: result.preview.author,
    litematicVersion: result.preview.litematicVersion,
    minecraftDataVersion: result.preview.minecraftDataVersion,
    dimensions: result.preview.dimensions,
    nonAirBlockCount: result.preview.nonAirBlockCount,
    statefulVoxelCount: result.blueprint.voxels.filter((voxel) => voxel.sourceBlockState !== undefined).length,
    blueprintJsonBytes: new TextEncoder().encode(JSON.stringify(result.blueprint)).byteLength,
    blockStateJsonBytes: new TextEncoder().encode(JSON.stringify(result.blueprint)).byteLength
      - new TextEncoder().encode(JSON.stringify(withoutBlockState)).byteLength,
    paletteEntries: result.preview.paletteEntries,
    compatibility: result.preview.compatibility,
    blueprintBounds: result.blueprint.bounds,
  }));
}
