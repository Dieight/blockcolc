import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseJava16xResourcePack } from "@blockcolc/resource-pack";
import { IDBFactory as FakeIDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { IndexedDbResourcePackRepository } from "../src/index";

describe("resource-pack repository read diagnostic", () => {
  it("measures validated selected-pack reads using a local sample and fake IndexedDB", async () => {
    const samplePath = resolve(__dirname, "../../../artifacts/resourcepacks_test/Bare Bones 1.21.11.zip");
    if (!existsSync(samplePath)) {
      console.warn("Local resource-pack repository diagnostic skipped: permitted sample is unavailable.");
      return;
    }
    const archive = new Uint8Array(readFileSync(samplePath));
    const manifest = parseJava16xResourcePack(archive);
    const repository = new IndexedDbResourcePackRepository({ databaseName: "resource-pack-performance-diagnostic", indexedDb: new FakeIDBFactory() });
    await repository.save({ id: "diagnostic-pack", name: "diagnostic pack", importedAt: "2026-09-27T00:00:00.000Z", archive, manifest });

    const values: number[] = [];
    for (let index = 0; index < 7; index += 1) {
      const started = performance.now();
      const selected = await repository.getActive();
      values.push(performance.now() - started);
      expect(selected?.id).toBe("diagnostic-pack");
    }
    values.sort((left, right) => left - right);
    console.log(`[resource-pack-repository-read] ${JSON.stringify({
      archiveBytes: archive.byteLength,
      textureCount: manifest.textures.length,
      medianReadMs: Number(values[3]!.toFixed(3)),
      phase: "fake IndexedDB read + strict validation + normalization clone; local data only",
    })}`);
    repository.close();
  });
});
