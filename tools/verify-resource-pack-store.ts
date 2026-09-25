/**
 * In-memory import/storage round trip for a user-owned resource archive.
 * No asset bytes are written to disk or emitted to stdout.
 * Run with: node_modules/.bin/vite-node --script tools/verify-resource-pack-store.ts <zip-or-jar>
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbResourcePackRepository } from "../packages/resource-pack-indexeddb/src/index";
import { parseJava16xResourcePack } from "../packages/resource-pack/src/index";

const archivePath = process.argv[2];
if (!archivePath) {
  process.stderr.write("Usage: verify-resource-pack-store.ts <zip-or-jar>\n");
  process.exitCode = 2;
} else {
  const bytes = readFileSync(archivePath);
  const manifest = parseJava16xResourcePack(bytes);
  const repository = new IndexedDbResourcePackRepository({
    databaseName: "blockcolc-resource-pack-roundtrip",
    indexedDb: new IDBFactory(),
  });
  try {
    await repository.save({
      id: "roundtrip",
      name: basename(archivePath),
      importedAt: "2026-09-24T00:00:00.000Z",
      archive: bytes,
      manifest,
    });
    await repository.select("roundtrip");
    const loaded = await repository.getActive();
    const expectedSpecialTextures = manifest.specialTextures ?? [];
    const actualSpecialTextures = loaded?.manifest.specialTextures ?? [];
    if (!loaded || loaded.archive.byteLength !== bytes.byteLength
      || loaded.manifest.textures.length !== manifest.textures.length
      || loaded.manifest.models.length !== manifest.models.length
      || actualSpecialTextures.length !== expectedSpecialTextures.length
      || expectedSpecialTextures.some((texture, index) => {
        const stored = actualSpecialTextures[index];
        return !stored || texture.resourceId !== stored.resourceId
          || !Buffer.from(texture.png).equals(Buffer.from(stored.png));
      })) {
      throw new Error("Resource-pack IndexedDB round trip changed the imported archive or manifest.");
    }
    process.stdout.write(`${JSON.stringify({
      archive: basename(archivePath),
      archiveBytes: bytes.byteLength,
      blockTextures: loaded.manifest.textures.length,
      specialTextures: actualSpecialTextures.length,
      blockStates: loaded.manifest.blockStates.length,
      models: loaded.manifest.models.length,
      issues: loaded.manifest.summary.issues.length,
      storageRoundTrip: "passed",
    })}\n`);
  } finally {
    repository.close();
  }
}
