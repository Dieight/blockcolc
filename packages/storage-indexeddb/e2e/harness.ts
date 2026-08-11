import { IndexedDbStateRepository } from "../src/index.js";

declare global {
  interface Window { storageHarness: { create(name: string): IndexedDbStateRepository } }
}

window.storageHarness = { create: (name) => new IndexedDbStateRepository({ databaseName: name }) };
