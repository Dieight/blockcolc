import { IDBFactory as FakeIDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import {
  IndexedDbResourcePackRepository,
  type SaveResourcePackInput,
} from "../src/index";

let indexedDb: IDBFactory;
let databaseCounter = 0;

beforeEach(() => {
  indexedDb = new FakeIDBFactory();
  databaseCounter += 1;
});

describe("IndexedDbResourcePackRepository", () => {
  it("saves, lists, gets, and reloads binary packs independently", async () => {
    const name = databaseName();
    const first = repository(name);
    await first.save(fixture("stone", "2026-07-26T01:00:00.000Z"));
    expect(await first.list()).toEqual([
      expect.objectContaining({ id: "stone", archiveBytes: 4, textureCount: 1, active: true }),
    ]);
    first.close();

    const reloaded = repository(name);
    const stored = await reloaded.get("stone");
    expect(stored?.archive).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(stored?.manifest.textures[0]?.resourceId).toBe("minecraft:block/stone");
    expect(stored?.manifest.textures[0]?.animation?.frames).toEqual([{ index: 1, time: 3 }, { index: 0, time: 2 }]);
    expect(stored?.manifest.models[0]?.faceMetadata?.north).toEqual({ texture: "#all", uv: [2.5, 1, 13.5, 15], rotation: 90, tintIndex: 0 });
    expect(stored?.manifest.models[0]?.forceTranslucentTextures).toEqual({ all: true });
    expect((await reloaded.getActive())?.id).toBe("stone");
  });

  it("keeps legacy static manifests valid and rejects corrupt animation or tint metadata", async () => {
    const name = databaseName();
    const repo = repository(name);
    const legacy = fixture("legacy", "2026-07-26T00:00:00.000Z");
    legacy.manifest.textures[0]!.height = 16;
    delete legacy.manifest.textures[0]!.animation;
    delete legacy.manifest.models[0]!.faceMetadata!.north!.tintIndex;
    await repo.save(legacy);
    repo.close();

    const database = await openRaw(name);
    const transaction = database.transaction("resourcePacks", "readwrite");
    const invalidAnimation = fixture("invalid-animation", "2026-07-26T01:00:00.000Z");
    invalidAnimation.manifest.textures[0]!.animation!.frames[0]!.index = 2;
    transaction.objectStore("resourcePacks").put({ ...invalidAnimation, schemaVersion: 1 });
    const invalidTint = fixture("invalid-tint", "2026-07-26T02:00:00.000Z");
    invalidTint.manifest.models[0]!.faceMetadata!.north!.tintIndex = 256;
    transaction.objectStore("resourcePacks").put({ ...invalidTint, schemaVersion: 1 });
    await transactionDone(transaction);
    database.close();

    const reloaded = repository(name);
    expect((await reloaded.list()).map((entry) => entry.id)).toEqual(["legacy"]);
  });

  it("round-trips optional grass and foliage colormaps without changing schema-v1", async () => {
    const repo = repository(databaseName());
    const valid = fixture("colormaps", "2026-07-27T01:00:00.000Z");
    valid.manifest.colormaps = [
      {
        kind: "grass",
        resourceId: "minecraft:colormap/grass",
        archivePath: "assets/minecraft/textures/colormap/grass.png",
        width: 256,
        height: 256,
        png: colormapPng(1),
      },
      {
        kind: "foliage",
        resourceId: "minecraft:colormap/foliage",
        archivePath: "assets/minecraft/textures/colormap/foliage.png",
        width: 256,
        height: 256,
        png: colormapPng(2),
      },
    ];

    await repo.save(valid);
    const stored = await repo.get("colormaps");
    expect(stored?.schemaVersion).toBe(1);
    expect(stored?.manifest.schemaVersion).toBe(1);
    expect(stored?.manifest.colormaps).toEqual(valid.manifest.colormaps);
  });

  it("round-trips a 32px two-dimensional animation grid", async () => {
    const repo = repository(databaseName());
    const value = fixture("grid32", "2026-07-27T01:30:00.000Z");
    const texture = value.manifest.textures[0]!;
    texture.width = 64;
    texture.height = 64;
    texture.animation = {
      frameWidth: 32, frameHeight: 32, sourceColumns: 2, sourceRows: 2,
      sourceFrameCount: 4, frametime: 2, interpolate: true,
      frames: [{ index: 0, time: 2 }, { index: 3, time: 4 }],
    };
    await repo.save(value);
    expect((await repo.get("grid32"))?.manifest.textures[0]?.animation).toEqual(texture.animation);
  });

  it("rejects corrupt, duplicate and oversized colormap payloads", async () => {
    const repo = repository(databaseName());
    const withGrass = (id: string): SaveResourcePackInput => {
      const value = fixture(id, "2026-07-27T02:00:00.000Z");
      value.manifest.colormaps = [{
        kind: "grass",
        resourceId: "minecraft:colormap/grass",
        archivePath: "assets/minecraft/textures/colormap/grass.png",
        width: 256,
        height: 256,
        png: colormapPng(3),
      }];
      return value;
    };
    const corrupt: SaveResourcePackInput[] = [];

    const empty = withGrass("empty-colormaps");
    empty.manifest.colormaps = [];
    corrupt.push(empty);
    const duplicate = withGrass("duplicate-colormap");
    duplicate.manifest.colormaps!.push(structuredClone(duplicate.manifest.colormaps![0]!));
    corrupt.push(duplicate);
    const tooMany = withGrass("too-many-colormaps");
    const foliage = {
      kind: "foliage" as const,
      resourceId: "minecraft:colormap/foliage" as const,
      archivePath: "assets/minecraft/textures/colormap/foliage.png" as const,
      width: 256 as const,
      height: 256 as const,
      png: colormapPng(4),
    };
    tooMany.manifest.colormaps!.push(foliage, structuredClone(tooMany.manifest.colormaps![0]!));
    corrupt.push(tooMany);
    const badKind = withGrass("bad-kind");
    (badKind.manifest.colormaps![0] as unknown as Record<string, unknown>).kind = "water";
    corrupt.push(badKind);
    const mismatchedId = withGrass("mismatched-id");
    (mismatchedId.manifest.colormaps![0] as unknown as Record<string, unknown>).resourceId = "minecraft:colormap/foliage";
    corrupt.push(mismatchedId);
    const mismatchedPath = withGrass("mismatched-path");
    (mismatchedPath.manifest.colormaps![0] as unknown as Record<string, unknown>).archivePath = "assets/minecraft/textures/colormap/foliage.png";
    corrupt.push(mismatchedPath);
    const wrongDimensions = withGrass("wrong-dimensions");
    (wrongDimensions.manifest.colormaps![0] as unknown as Record<string, unknown>).width = 255;
    corrupt.push(wrongDimensions);
    const wrongPngDimensions = withGrass("wrong-png-dimensions");
    wrongPngDimensions.manifest.colormaps![0]!.png = colormapPng(3, 255, 256);
    corrupt.push(wrongPngDimensions);
    const wrongBytes = withGrass("wrong-bytes");
    (wrongBytes.manifest.colormaps![0] as unknown as Record<string, unknown>).png = [137, 80, 78, 71];
    corrupt.push(wrongBytes);
    const badSignature = withGrass("bad-signature");
    badSignature.manifest.colormaps![0]!.png[0] = 0;
    corrupt.push(badSignature);
    const oversized = withGrass("oversized-colormap");
    (oversized.manifest.colormaps![0] as unknown as Record<string, unknown>).png = new Uint8Array(4 * 1024 * 1024 + 1);
    corrupt.push(oversized);

    for (const value of corrupt) await expect(repo.save(value)).rejects.toThrow(/colormap/i);
    expect(await repo.list()).toEqual([]);
  });

  it("round-trips validated axis-aligned model elements and rejects hostile geometry", async () => {
    const name = databaseName();
    const repo = repository(name);
    const valid = fixture("slab", "2026-07-26T01:00:00.000Z");
    valid.manifest.models[0]!.elements = [{
      from: [0, 0, 0],
      to: [16, 8, 16],
      shade: true,
      rotation: { origin: [8, 8, 8], axis: "y", angle: -67.5, rescale: false },
      faces: {
        up: { texture: "#all", uv: [0, 0, 16, 16], rotation: 0, cullFace: "up" },
        north: { texture: "#all", uv: [0, 8, 16, 16], rotation: 0 },
      },
    }];
    await repo.save(valid);
    expect((await repo.get("slab"))?.manifest.models[0]?.elements).toEqual(valid.manifest.models[0]!.elements);
    repo.close();

    const database = await openRaw(name);
    const transaction = database.transaction("resourcePacks", "readwrite");
    for (const [id, mutate] of [
      ["bad-vector", (model: Record<string, any>) => { model.elements[0].from = [-17, 0, 0]; }],
      ["bad-bounds", (model: Record<string, any>) => {
        model.elements[0].rotation = undefined;
        model.elements[0].from = [0, 8, 0];
        model.elements[0].to = [16, 8, 16];
      }],
      ["bad-face", (model: Record<string, any>) => { model.elements[0].faces.diagonal = model.elements[0].faces.up; }],
      ["bad-cull", (model: Record<string, any>) => { model.elements[0].faces.up.cullFace = "diagonal"; }],
      ["bad-rotation", (model: Record<string, any>) => { model.elements[0].rotation = { axis: "y", angle: 45 }; }],
      ["bad-mixed-state", (model: Record<string, any>) => { model.unsupportedReason = "COMPLEX_GEOMETRY"; }],
    ] as const) {
      const hostile = fixture(id, "2026-07-26T02:00:00.000Z");
      hostile.manifest.models[0]!.elements = structuredClone(valid.manifest.models[0]!.elements);
      mutate(hostile.manifest.models[0] as unknown as Record<string, any>);
      transaction.objectStore("resourcePacks").put({ ...hostile, schemaVersion: 1 });
    }
    await transactionDone(transaction);
    database.close();

    const reloaded = repository(name);
    expect((await reloaded.list()).map((entry) => entry.id)).toEqual(["slab"]);
  });

  it("round-trips bounded weighted multipart choices and plane elements", async () => {
    const repo = repository(databaseName());
    const valid = fixture("pane", "2026-07-26T01:00:00.000Z");
    valid.manifest.blockStates = [{
      resourceId: "custom:multipart_block",
      archivePath: "assets/custom/blockstates/multipart_block.json",
      variants: [],
      multipart: [
        {
          when: { clauses: [{}] },
          apply: [{ model: "minecraft:block/glass_pane_post", x: 0, y: 0, uvlock: false, weight: 1 }],
        },
        {
          when: { clauses: [{ north: ["true"] }, { east: ["true"], west: ["false"] }] },
          apply: [
            { model: "minecraft:block/glass_pane_side", x: 0, y: 90, uvlock: true, weight: 2 },
            { model: "minecraft:block/glass_pane_alt", x: 0, y: 0, uvlock: false, weight: 1 },
          ],
        },
      ],
    }];
    valid.manifest.models[0]!.elements = [{
      from: [8, 0, 7],
      to: [8, 16, 9],
      shade: true,
      rotation: { origin: [8, 0, 8], euler: [180, -67.5, -180], rescale: false },
      faces: {
        west: { texture: "#all", uv: [7, 0, 9, 16], rotation: 0 },
        east: { texture: "#all", uv: [7, 0, 9, 16], rotation: 0 },
      },
    }];

    await repo.save(valid);
    const stored = await repo.get("pane");
    expect(stored?.manifest.blockStates[0]?.multipart).toEqual(valid.manifest.blockStates[0]?.multipart);
    expect(stored?.manifest.models[0]?.elements).toEqual(valid.manifest.models[0]?.elements);
  });

  it("rejects invalid multipart contracts and hostile planes while preserving legacy records", async () => {
    const name = databaseName();
    const repo = repository(name);
    await repo.save(fixture("legacy", "2026-07-26T00:00:00.000Z"));
    repo.close();

    const multipartFixture = (id: string): SaveResourcePackInput => {
      const value = fixture(id, "2026-07-26T01:00:00.000Z");
      value.manifest.blockStates = [{
        resourceId: "minecraft:oak_fence",
        archivePath: "assets/minecraft/blockstates/oak_fence.json",
        variants: [],
        multipart: [{
          when: { clauses: [{ north: ["true"] }] },
          apply: [{ model: "minecraft:block/oak_fence_side", x: 0, y: 0, uvlock: false, weight: 1 }],
        }],
      }];
      return value;
    };
    const planeFixture = (id: string): SaveResourcePackInput => {
      const value = fixture(id, "2026-07-26T01:00:00.000Z");
      value.manifest.models[0]!.elements = [{
        from: [8, 0, 7],
        to: [8, 16, 9],
        shade: true,
        faces: { west: { texture: "#all", uv: [0, 0, 16, 16], rotation: 0 } },
      }];
      return value;
    };

    const hostile: SaveResourcePackInput[] = [];
    const mixed = multipartFixture("mixed-contract");
    mixed.manifest.blockStates[0]!.variants = [{ key: "", conditions: {}, choices: [{ model: "minecraft:block/stone", x: 0, y: 0, uvlock: false, weight: 1 }] }];
    hostile.push(mixed);
    const missing = multipartFixture("missing-contract");
    delete (missing.manifest.blockStates[0] as unknown as Record<string, unknown>).multipart;
    hostile.push(missing);
    const invalidModel = multipartFixture("invalid-model");
    invalidModel.manifest.blockStates[0]!.multipart![0]!.apply[0]!.model = "not normalized";
    hostile.push(invalidModel);
    const emptyOrClause = multipartFixture("empty-or-clause");
    emptyOrClause.manifest.blockStates[0]!.multipart![0]!.when.clauses = [{}, { east: ["true"] }];
    hostile.push(emptyOrClause);
    const unsafeProperty = multipartFixture("unsafe-property");
    unsafeProperty.manifest.blockStates[0]!.multipart![0]!.when.clauses = [{ constructor: ["true"] }];
    hostile.push(unsafeProperty);
    const tooManyAlternatives = multipartFixture("too-many-alternatives");
    tooManyAlternatives.manifest.blockStates[0]!.multipart![0]!.when.clauses = [{ north: Array.from({ length: 17 }, (_, index) => String(index)) }];
    hostile.push(tooManyAlternatives);
    const line = planeFixture("line");
    line.manifest.models[0]!.elements![0]!.to = [8, 16, 7];
    hostile.push(line);
    const point = planeFixture("point");
    point.manifest.models[0]!.elements![0]!.to = [8, 0, 7];
    hostile.push(point);
    const wrongFace = planeFixture("wrong-plane-face");
    wrongFace.manifest.models[0]!.elements![0]!.faces = { north: { texture: "#all", uv: [0, 0, 16, 16], rotation: 0 } };
    hostile.push(wrongFace);

    const database = await openRaw(name);
    const transaction = database.transaction("resourcePacks", "readwrite");
    for (const value of hostile) transaction.objectStore("resourcePacks").put({ ...value, schemaVersion: 1 });
    await transactionDone(transaction);
    database.close();

    const reloaded = repository(name);
    expect((await reloaded.list()).map((entry) => entry.id)).toEqual(["legacy"]);
  });

  it("switches active packs without changing stored content", async () => {
    const repo = repository(databaseName());
    await repo.save(fixture("first", "2026-07-26T01:00:00.000Z"));
    await repo.save(fixture("second", "2026-07-26T02:00:00.000Z"));
    expect((await repo.getActive())?.id).toBe("first");
    expect((await repo.select("second"))?.id).toBe("second");
    expect((await repo.getActive())?.id).toBe("second");
    expect((await repo.list()).find((entry) => entry.id === "second")?.active).toBe(true);
    await expect(repo.select("missing")).rejects.toThrow(/not found or is invalid/);

    await repo.select(null);
    await repo.save(fixture("third", "2026-07-26T03:00:00.000Z"));
    expect(await repo.getActive()).toBeUndefined();
  });

  it("falls back to original materials when the active pack is deleted", async () => {
    const repo = repository(databaseName());
    await repo.save(fixture("old", "2026-07-26T01:00:00.000Z"));
    await repo.save(fixture("new", "2026-07-26T03:00:00.000Z"));
    await repo.save(fixture("middle", "2026-07-26T02:00:00.000Z"));
    await repo.select("old");

    expect(await repo.delete("old")).toBeNull();
    expect(await repo.getActive()).toBeUndefined();
    expect((await repo.list()).map((entry) => entry.id)).toEqual(["new", "middle"]);
  });

  it("ignores unsupported or corrupt records and repairs a broken active pointer", async () => {
    const name = databaseName();
    const repo = repository(name);
    await repo.save(fixture("valid", "2026-07-26T01:00:00.000Z"));
    repo.close();

    const database = await openRaw(name);
    const transaction = database.transaction(["resourcePacks", "metadata"], "readwrite");
    transaction.objectStore("resourcePacks").put({ id: "future", schemaVersion: 99 });
    transaction.objectStore("resourcePacks").put({ id: "corrupt", schemaVersion: 1, archive: "not bytes" });
    const nested = fixture("nested-corrupt", "2026-07-26T02:00:00.000Z");
    nested.manifest.blockStates = [{ resourceId: "minecraft:stone", archivePath: "stone.json", variants: [{ key: "", conditions: {}, choices: [{ model: "minecraft:block/stone", x: 45, y: 0, uvlock: false, weight: 1 }] }] }] as never;
    transaction.objectStore("resourcePacks").put({ ...nested, schemaVersion: 1 });
    const invalidFace = fixture("invalid-face", "2026-07-26T03:00:00.000Z");
    invalidFace.manifest.models[0]!.faceMetadata!.north!.uv = [0, -1, 16, 16] as never;
    transaction.objectStore("resourcePacks").put({ ...invalidFace, schemaVersion: 1 });
    transaction.objectStore("metadata").put({ key: "active-pack", packId: "future" });
    await transactionDone(transaction);
    database.close();

    const reloaded = repository(name);
    expect((await reloaded.list()).map((entry) => entry.id)).toEqual(["valid"]);
    expect(await reloaded.get("future")).toBeUndefined();
    expect(await reloaded.getActive()).toBeUndefined();
    reloaded.close();

    const repaired = await openRaw(name);
    const read = repaired.transaction("metadata", "readonly");
    const active = await requestResult<{ key: string; packId: string }>(read.objectStore("metadata").get("active-pack"));
    await transactionDone(read);
    expect(active.packId).toBeNull();
    repaired.close();
  });

  it("clears both packs and active selection", async () => {
    const repo = repository(databaseName());
    await repo.save(fixture("one", "2026-07-26T01:00:00.000Z"));
    await repo.clear();
    expect(await repo.list()).toEqual([]);
    expect(await repo.getActive()).toBeUndefined();
  });
});

function repository(databaseName: string): IndexedDbResourcePackRepository {
  return new IndexedDbResourcePackRepository({ databaseName, indexedDb });
}

function databaseName(): string {
  return `resource-pack-test-${databaseCounter}`;
}

function fixture(id: string, importedAt: string): SaveResourcePackInput {
  return {
    id,
    name: `${id} pack`,
    importedAt,
    archive: new Uint8Array([1, 2, 3, 4]),
    manifest: {
      schemaVersion: 1,
      pack: { packFormat: 34, description: `${id} description` },
      textures: [
        {
          resourceId: "minecraft:block/stone",
          namespace: "minecraft",
          texturePath: "stone",
          archivePath: "assets/minecraft/textures/block/stone.png",
          width: 16,
          height: 32,
          png: new Uint8Array([137, 80, 78, 71]),
          animation: {
            frameWidth: 16,
            frameHeight: 16,
            sourceColumns: 1,
            sourceRows: 2,
            sourceFrameCount: 2,
            frametime: 2,
            interpolate: false,
            frames: [{ index: 1, time: 3 }, { index: 0, time: 2 }],
          },
        },
      ],
      blockStates: [],
      models: [{
        resourceId: "minecraft:block/stone",
        archivePath: "assets/minecraft/models/block/stone.json",
        parent: "minecraft:block/cube_all",
        textures: { all: "minecraft:block/stone" },
        forceTranslucentTextures: { all: true },
        faces: { north: "#all" },
        faceMetadata: { north: { texture: "#all", uv: [2.5, 1, 13.5, 15], rotation: 90, tintIndex: 0 } },
      }],
      summary: {
        archiveFileCount: 2,
        candidateTextureCount: 1,
        acceptedTextureCount: 1,
        rejectedTextureCount: 0,
        ignoredFileCount: 0,
        namespaces: ["minecraft"],
        issues: [],
      },
    },
  };
}

function colormapPng(marker: number, width = 256, height = 256): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  header.set([8, 0, 0, 0, 0], 8);
  const scanlines = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width + 1);
    scanlines[row] = 0;
    scanlines.fill(marker, row + 1, row + width + 1);
  }
  return joinBytes(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibStored(scanlines)),
    pngChunk("IEND", new Uint8Array()),
  );
}

function zlibStored(input: Uint8Array): Uint8Array {
  const blockCount = Math.ceil(input.length / 65_535);
  const output = new Uint8Array(2 + input.length + blockCount * 5 + 4);
  output.set([0x78, 0x01]);
  let sourceOffset = 0;
  let targetOffset = 2;
  while (sourceOffset < input.length) {
    const length = Math.min(65_535, input.length - sourceOffset);
    const final = sourceOffset + length === input.length;
    output[targetOffset] = final ? 1 : 0;
    output[targetOffset + 1] = length & 0xff;
    output[targetOffset + 2] = length >>> 8;
    const inverse = (~length) & 0xffff;
    output[targetOffset + 3] = inverse & 0xff;
    output[targetOffset + 4] = inverse >>> 8;
    output.set(input.subarray(sourceOffset, sourceOffset + length), targetOffset + 5);
    sourceOffset += length;
    targetOffset += length + 5;
  }
  new DataView(output.buffer).setUint32(targetOffset, adler32(input), false);
  return output;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const output = new Uint8Array(12 + data.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length, false);
  output.set(typeBytes, 4);
  output.set(data, 8);
  view.setUint32(8 + data.length, crc32(joinBytes(typeBytes, data)), false);
  return output;
}

function joinBytes(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function openRaw(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(name, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
