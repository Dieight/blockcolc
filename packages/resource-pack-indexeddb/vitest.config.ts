import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const candidates = [
  new URL("./node_modules/fake-indexeddb/build/esm/index.js", import.meta.url),
  new URL("../../node_modules/fake-indexeddb/build/esm/index.js", import.meta.url),
  new URL("../storage-indexeddb/node_modules/fake-indexeddb/build/esm/index.js", import.meta.url),
];
const fakeIndexedDb = candidates.find((candidate) => existsSync(candidate));

export default defineConfig({
  ...(fakeIndexedDb
    ? { resolve: { alias: { "fake-indexeddb": fileURLToPath(fakeIndexedDb) } } }
    : {}),
});
