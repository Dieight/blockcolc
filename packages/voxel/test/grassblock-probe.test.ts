import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseJava16xResourcePack, resolveBlockTextures } from "@tomato-clock/resource-pack";
import { expect, it } from "vitest";

it("probes stay-true grass_block", () => {
  const path = resolve(__dirname, "../../../litematic/v17-stay-true-1.21.5.zip");
  if (!existsSync(path)) return;
  const manifest = parseJava16xResourcePack(readFileSync(path));
  const entry = manifest.blockStates.find((candidate) => candidate.resourceId === "minecraft:grass_block");
  console.log("grass_block variants:", JSON.stringify(entry?.variants?.map((variant) => ({ key: variant.key, conditions: variant.conditions, model: variant.choices[0]?.model }))));
  console.log("grass_block multipart:", entry?.multipart !== undefined);
  const states: Readonly<Record<string, string>>[] = [{}, { snowy: "false" }, { snowy: "true" }];
  for (const state of states) {
    const resolution = resolveBlockTextures(manifest, "minecraft:grass_block", state);
    console.log("state", JSON.stringify(state), "->", resolution.status, "reason" in resolution ? resolution.reason : "");
  }
  expect(true).toBe(true);
});
