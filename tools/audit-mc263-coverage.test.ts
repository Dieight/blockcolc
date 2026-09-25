import { describe, expect, it } from "vitest";
import { strToU8, zipSync, zlibSync } from "fflate";
import {
  auditMinecraft263Coverage,
  enumerateMinecraftBlockStates,
} from "./audit-mc263-coverage";
import { parseJava16xResourcePack } from "../packages/resource-pack/src/index";
import { buildResourcePackAtlas } from "../packages/voxel/src/resource-textures";

describe("Minecraft 26.3 coverage inventory", () => {
  it("keeps the official report's concrete property maps and state IDs exact", () => {
    const registry = enumerateMinecraftBlockStates({
      "minecraft:axis_sample": {
        properties: { axis: ["x", "y"], powered: ["false", "true"] },
        states: [
          { id: 10, default: true, properties: { axis: "x", powered: "false" } },
          { id: 11, properties: { axis: "x", powered: "true" } },
          { id: 12, properties: { axis: "y", powered: "false" } },
          { id: 13, properties: { axis: "y", powered: "true" } },
        ],
      },
      "minecraft:plain": { states: [{ id: 14, default: true }] },
    });

    expect(registry.blockCount).toBe(2);
    expect(registry.stateCount).toBe(5);
    expect(registry.states.find((state) => state.stateId === 12)).toMatchObject({
      blockId: "minecraft:axis_sample",
      properties: { axis: "y", powered: "false" },
    });
    expect(registry.states.find((state) => state.stateId === 14)).toMatchObject({ blockId: "minecraft:plain", properties: {} });
  });

  it("rejects incomplete or internally inconsistent registry combinations", () => {
    expect(() => enumerateMinecraftBlockStates({
      "minecraft:bad": {
        properties: { facing: ["north", "south"] },
        states: [{ id: 1, default: true, properties: { facing: "north" } }],
      },
    })).toThrow(/property domains imply 2/);

    expect(() => enumerateMinecraftBlockStates({
      "minecraft:bad": {
        properties: { facing: ["north"] },
        states: [{ id: 1, default: true, properties: { facing: "south" } }],
      },
    })).toThrow(/undeclared value/);
  });

  it("reports exact variant and multipart states through the app's cube and geometry planners", () => {
    const manifest = parseJava16xResourcePack(makePack());
    const atlas = buildResourcePackAtlas(manifest);
    try {
      const registry = enumerateMinecraftBlockStates({
        "minecraft:custom_block": { states: [{ id: 1, default: true }] },
        "minecraft:attached_melon_stem": {
          properties: { facing: ["north"] },
          states: [{ id: 11, default: true, properties: { facing: "north" } }],
        },
        "example:mod_tinted": { states: [{ id: 7, default: true }] },
        "minecraft:grass_block": { states: [{ id: 2, default: true }] },
        "minecraft:missing_blockstate": { states: [{ id: 3, default: true }] },
        "minecraft:model_less": { states: [{ id: 8, default: true }] },
        "minecraft:empty_multipart": {
          properties: { up: ["false", "true"] },
          states: [
            { id: 9, default: true, properties: { up: "false" } },
            { id: 10, properties: { up: "true" } },
          ],
        },
        "minecraft:redstone_wire": {
          properties: { north: ["none", "side"] },
          states: [
            { id: 4, default: true, properties: { north: "none" } },
            { id: 5, properties: { north: "side" } },
          ],
        },
        "minecraft:stone": { states: [{ id: 6, default: true }] },
      });
      const report = auditMinecraft263Coverage(manifest, registry, atlas, {
        clientJarSha1: "fixture-client-sha1",
        clientJarBytes: 1,
        serverJarSha1: "fixture-server-sha1",
        blocksReportSha256: "fixture-report-sha256",
        officialServerJarUrl: "fixture://server.jar",
        blocksReportBlockCount: registry.blockCount,
        blocksReportStateCount: registry.stateCount,
      });

      expect(report.coverage).toMatchObject({
        blocks: 9,
        exactBlockStates: 11,
        exactStatesUsingMultipart: 4,
        runtimeTexturedCubeStates: 4,
        runtimeModelGeometryStates: 3,
        runtimeFallbackStates: 4,
      });
      expect(report.coverage.routesByFallbackReason).toMatchObject({
        MISSING_BLOCKSTATE_FILE: 1,
        COLOR_UNSUPPORTED_TINT_PROVIDER: 1,
        MODEL_HAS_NO_STATIC_GEOMETRY: 1,
        EMPTY_MULTIPART_STATE: 1,
      });
      expect(report.coverage.color).toMatchObject({
        tintedFaces: 4,
        supportedTintFaces: 2,
        unappliedTintFaces: 1,
        unsupportedTintFaces: 1,
        tintKindsByFace: { grass: 1 },
        exactVanillaColorParity: "not_compared",
      });
      expect(report.states).toHaveLength(11);
      expect(report.blocks.find((block) => block.blockId === "minecraft:redstone_wire")).toMatchObject({
        stateDefinitions: "multipart",
        geometryStates: 2,
      });
      expect(report.states.find((state) => state.blockId === "minecraft:custom_block")).toMatchObject({
        route: "textured_cube",
        unappliedTintFaces: 1,
      });
      const colorFallback = report.coverage.fallbackDiagnostics.find((entry) => entry.reason === "COLOR_UNSUPPORTED_TINT_PROVIDER");
      expect(colorFallback).toMatchObject({
        fallbackStateCount: 1,
        uniqueBlockCount: 1,
        tintProviderTypes: ["external_namespace_provider_not_mapped"],
      });
      expect(colorFallback?.blocks.find((block) => block.blockId === "example:mod_tinted")).toMatchObject({
        representativeStates: [{ stateId: 7, isDefault: true, properties: {}, unsupportedTintProviders: [
          { type: "external_namespace_provider_not_mapped", tintIndex: 0, faceNames: ["up"] },
        ] }],
      });
      expect(report.states.find((state) => state.blockId === "minecraft:attached_melon_stem")).toMatchObject({
        route: "textured_cube",
        tintKinds: { attached_stem: 1 },
      });
      expect(report.coverage.fallbackDiagnostics.find((entry) => entry.reason === "MODEL_HAS_NO_STATIC_GEOMETRY")).toMatchObject({
        fallbackStateCount: 1,
        blocks: [{
          blockId: "minecraft:model_less",
          representativeStates: [{
            geometryFallbackReason: "GEOMETRY_LIMIT_EXCEEDED",
            geometryFallbackResourceId: "minecraft:block/model_less",
          }],
        }],
      });
      expect(report.coverage.fallbackDiagnostics.find((entry) => entry.reason === "EMPTY_MULTIPART_STATE")).toMatchObject({
        fallbackStateCount: 1,
        blocks: [{
          blockId: "minecraft:empty_multipart",
          representativeStates: [{
            stateId: 9,
            properties: { up: "false" },
            geometryFallbackReason: "NO_MATCHING_VARIANT",
            geometryFallbackResourceId: "minecraft:empty_multipart",
          }],
        }],
      });
    } finally {
      atlas.dispose();
    }
  });

  it("partitions planner fallbacks by actual post-planner helper output", () => {
    const manifest = parseJava16xResourcePack(makePack({
      "assets/minecraft/textures/block/water_still.png": makeRgbaPng(),
      "assets/minecraft/textures/block/water_flow.png": makeRgbaPng(),
      "assets/minecraft/textures/entity/chest/normal.png": makeRgbaPng(64, 64),
      "assets/minecraft/textures/entity/end_portal/end_portal.png": makeRgbaPng(),
    }));
    const atlas = buildResourcePackAtlas(manifest);
    try {
      const registry = enumerateMinecraftBlockStates({
        "minecraft:water": { states: [{ id: 101, default: true }] },
        "minecraft:barrier": { states: [{ id: 102, default: true }] },
        "minecraft:moving_piston": { states: [{ id: 103, default: true }] },
        "minecraft:chest": {
          properties: { facing: ["north"], type: ["single"] },
          states: [{ id: 104, default: true, properties: { facing: "north", type: "single" } }],
        },
        "minecraft:end_portal": { states: [{ id: 105, default: true }] },
        "minecraft:unsupported_fallback": { states: [{ id: 106, default: true }] },
      });
      const report = auditMinecraft263Coverage(manifest, registry, atlas, {
        clientJarSha1: "fixture-client-sha1",
        clientJarBytes: 1,
        serverJarSha1: "fixture-server-sha1",
        blocksReportSha256: "fixture-report-sha256",
        officialServerJarUrl: "fixture://server.jar",
        blocksReportBlockCount: registry.blockCount,
        blocksReportStateCount: registry.stateCount,
      });

      expect(report.schemaVersion).toBe(1);
      expect(report.coverage.runtimeFallbackStates).toBe(6);
      expect(report.coverage.postPlanner).toMatchObject({
        plannerFallbackStates: 6,
        special: {
          states: 2,
          blocks: ["minecraft:chest", "minecraft:end_portal"],
          byRenderer: {
            boxes: { states: 1, blocks: ["minecraft:chest"] },
            portals: { states: 1, blocks: ["minecraft:end_portal"] },
            decor: { states: 0, blocks: [] },
            figures: { states: 0, blocks: [] },
          },
        },
        fluids: { states: 1, blocks: ["minecraft:water"] },
        intentionallyEmpty: { states: 1, blocks: ["minecraft:barrier"] },
        blockEntityDependent: {
          states: 1,
          blocks: ["minecraft:moving_piston"],
        },
        unresolved: { states: 1, blocks: ["minecraft:unsupported_fallback"] },
      });
      const postPlanner = report.coverage.postPlanner;
      expect(postPlanner.special.states
        + postPlanner.fluids.states
        + postPlanner.intentionallyEmpty.states
        + postPlanner.blockEntityDependent.states
        + postPlanner.unresolved.states).toBe(postPlanner.plannerFallbackStates);
    } finally {
      atlas.dispose();
    }
  });

  it("does not call a special box handled unless its required entity texture is available", () => {
    const manifest = parseJava16xResourcePack(makePack());
    const atlas = buildResourcePackAtlas(manifest);
    try {
      const registry = enumerateMinecraftBlockStates({
        "minecraft:chest": {
          properties: { facing: ["north"], type: ["single"] },
          states: [{ id: 201, default: true, properties: { facing: "north", type: "single" } }],
        },
      });
      const report = auditMinecraft263Coverage(manifest, registry, atlas, {
        clientJarSha1: "fixture-client-sha1",
        clientJarBytes: 1,
        serverJarSha1: "fixture-server-sha1",
        blocksReportSha256: "fixture-report-sha256",
        officialServerJarUrl: "fixture://server.jar",
        blocksReportBlockCount: registry.blockCount,
        blocksReportStateCount: registry.stateCount,
      });
      expect(report.coverage.postPlanner.special.byRenderer.boxes).toEqual({ states: 0, blocks: [] });
      expect(report.coverage.postPlanner.unresolved).toEqual({ states: 1, blocks: ["minecraft:chest"] });
    } finally {
      atlas.dispose();
    }
  });

  it("audits waterlogged eligibility independently and probes overlay planning in bounded chunks", () => {
    const manifest = parseJava16xResourcePack(makePack({
      "assets/minecraft/textures/block/water_still.png": makeRgbaPng(),
      "assets/minecraft/textures/block/water_flow.png": makeRgbaPng(),
    }));
    const atlas = buildResourcePackAtlas(manifest);
    try {
      const registry = enumerateMinecraftBlockStates({
        "minecraft:oak_stairs": {
          properties: { shape: ["straight"], waterlogged: ["false", "true"] },
          states: [
            { id: 301, default: true, properties: { shape: "straight", waterlogged: "false" } },
            { id: 302, properties: { shape: "straight", waterlogged: "true" } },
          ],
        },
        "minecraft:oak_fence": {
          properties: { waterlogged: ["false", "true"] },
          states: [
            { id: 303, default: true, properties: { waterlogged: "false" } },
            { id: 304, properties: { waterlogged: "true" } },
          ],
        },
      });
      const report = auditMinecraft263Coverage(manifest, registry, atlas, {
        clientJarSha1: "fixture-client-sha1",
        clientJarBytes: 1,
        serverJarSha1: "fixture-server-sha1",
        blocksReportSha256: "fixture-report-sha256",
        officialServerJarUrl: "fixture://server.jar",
        blocksReportBlockCount: registry.blockCount,
        blocksReportStateCount: registry.stateCount,
      });

      expect(report.coverage.waterlogged.registry).toEqual({
        eligibleStates: 2,
        eligibleBlocks: 2,
        blockIds: ["minecraft:oak_fence", "minecraft:oak_stairs"],
      });
      expect(report.coverage.waterlogged.isolatedPlannerProbe).toMatchObject({
        inputStates: 2,
        inputBlocks: 2,
        chunks: 1,
        atlasAvailable: true,
        atlasBackedPlanStates: 2,
        proceduralFallbackPlanStates: 0,
        plannedOverlayStates: 2,
        statesWithoutExposedOverlay: 0,
        omittedVoxelCount: 0,
        fullSceneVisibility: "not_measured",
      });
      expect(report.coverage.waterlogged.isolatedPlannerProbe.visibilityNote).toMatch(/host-model depth\/alpha/);
      expect(report.coverage.waterlogged.isolatedPlannerProbe.plannedOverlayStates
        + report.coverage.waterlogged.isolatedPlannerProbe.statesWithoutExposedOverlay)
        .toBe(report.coverage.waterlogged.registry.eligibleStates);
      expect(report.coverage.runtimeFallbackStates).toBe(4);
    } finally {
      atlas.dispose();
    }
  });

  it("counts the waterlogged procedural overlay planner output when no resource water tile exists", () => {
    const manifest = parseJava16xResourcePack(makePack());
    const atlas = buildResourcePackAtlas(manifest);
    try {
      const registry = enumerateMinecraftBlockStates({
        "minecraft:oak_stairs": {
          properties: { waterlogged: ["false", "true"] },
          states: [
            { id: 401, default: true, properties: { waterlogged: "false" } },
            { id: 402, properties: { waterlogged: "true" } },
          ],
        },
      });
      const report = auditMinecraft263Coverage(manifest, registry, atlas, {
        clientJarSha1: "fixture-client-sha1",
        clientJarBytes: 1,
        serverJarSha1: "fixture-server-sha1",
        blocksReportSha256: "fixture-report-sha256",
        officialServerJarUrl: "fixture://server.jar",
        blocksReportBlockCount: registry.blockCount,
        blocksReportStateCount: registry.stateCount,
      });
      expect(report.coverage.waterlogged.isolatedPlannerProbe).toMatchObject({
        inputStates: 1,
        atlasBackedPlanStates: 0,
        proceduralFallbackPlanStates: 1,
        plannedOverlayStates: 1,
        statesWithoutExposedOverlay: 0,
      });
    } finally {
      atlas.dispose();
    }
  });
});

function makePack(extraFiles: Record<string, Uint8Array> = {}): Uint8Array {
  const cubeFaces = Object.fromEntries(["down", "up", "north", "south", "west", "east"].map((face) => [face, { texture: "#all" }]));
  const tintedFaces = { ...cubeFaces, up: { texture: "#all", tintindex: 0 } };
  const model = (faces: unknown) => ({ textures: { all: "block/white" }, elements: [{
    from: [0, 0, 0], to: [16, 16, 16], faces,
  }] });
  const files: Record<string, Uint8Array> = {
    "pack.mcmeta": json({ pack: { pack_format: 97, description: "audit fixture" } }),
    "assets/minecraft/blockstates/stone.json": json({ variants: { "": { model: "minecraft:block/cube" } } }),
    "assets/minecraft/blockstates/grass_block.json": json({ variants: { "": { model: "minecraft:block/tinted" } } }),
    "assets/minecraft/blockstates/custom_block.json": json({ variants: { "": { model: "minecraft:block/tinted" } } }),
    "assets/minecraft/blockstates/attached_melon_stem.json": json({ variants: { "facing=north": { model: "minecraft:block/tinted" } } }),
    "assets/minecraft/blockstates/model_less.json": json({ variants: { "": { model: "minecraft:block/model_less" } } }),
    "assets/minecraft/blockstates/empty_multipart.json": json({ multipart: [
      { when: { up: "true" }, apply: { model: "minecraft:block/cube" } },
    ] }),
    "assets/example/blockstates/mod_tinted.json": json({ variants: { "": { model: "minecraft:block/tinted" } } }),
    "assets/minecraft/blockstates/redstone_wire.json": json({ multipart: [
      { when: { north: "none" }, apply: { model: "minecraft:block/cube" } },
      { when: { north: "side" }, apply: { model: "minecraft:block/cube" } },
    ] }),
    "assets/minecraft/models/block/cube.json": json(model(cubeFaces)),
    "assets/minecraft/models/block/tinted.json": json(model(tintedFaces)),
    "assets/minecraft/models/block/model_less.json": json({ textures: { particle: "block/white" } }),
    "assets/minecraft/textures/block/white.png": makeRgbaPng(),
    ...extraFiles,
  };
  return zipSync(files, { level: 6 });
}

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}

function makeRgbaPng(width = 16, height = 16): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const rows = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    rows[rowStart] = 0;
    for (let x = 0; x < width; x += 1) rows.set([245, 245, 245, 255], rowStart + 1 + x * 4);
  }
  const type = strToU8("IDAT");
  const compressed = zlibSync(rows);
  return concat(signature, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", new Uint8Array()));
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = strToU8(type);
  const output = new Uint8Array(12 + data.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.byteLength, false);
  output.set(typeBytes, 4);
  output.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(concat(typeBytes, data)), false);
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

function concat(...arrays: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((total, item) => total + item.byteLength, 0));
  let offset = 0;
  for (const item of arrays) {
    result.set(item, offset);
    offset += item.byteLength;
  }
  return result;
}
