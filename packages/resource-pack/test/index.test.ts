import { strToU8, zipSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  buildJava16xTextureAtlas,
  classifyJava16xPngAlpha,
  mapBlockTexturesToAtlas,
  parseJava16xResourcePack,
  resolveFaceTextureRotation,
  resolveBlockTextures,
  ResourcePackError,
} from "../src/index";

const packMetadata = strToU8(JSON.stringify({ pack: { pack_format: 34, description: "Test pack" } }));

describe("parseJava16xResourcePack", () => {
  it("collects deterministic 16x block textures and optional metadata", () => {
    const zip = makeZip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/textures/block/stone.png": makePng(16, 16),
      "assets/minecraft/textures/block/oak_log.png": makePng(16, 16),
      "assets/minecraft/textures/block/oak_log.png.mcmeta": strToU8(JSON.stringify({ animation: { frametime: 2 } })),
      "assets/minecraft/textures/item/apple.png": makePng(16, 16),
    });

    const result = parseJava16xResourcePack(zip);

    expect(result.pack).toEqual({ packFormat: 34, description: "Test pack" });
    expect(result.textures.map((texture) => texture.resourceId)).toEqual([
      "minecraft:block/oak_log",
      "minecraft:block/stone",
    ]);
    expect(result.textures[0]?.metadata).toEqual({ animation: { frametime: 2 } });
    expect(result.summary).toMatchObject({
      archiveFileCount: 5,
      candidateTextureCount: 2,
      acceptedTextureCount: 2,
      rejectedTextureCount: 0,
      ignoredFileCount: 1,
      namespaces: ["minecraft"],
      issues: [],
    });
  });

  it("requires a valid root pack.mcmeta", () => {
    expect(() => parseJava16xResourcePack(makeZip({ "readme.txt": strToU8("hello") }))).toThrowError(
      expect.objectContaining({ code: "MISSING_PACK_MCMETA" }),
    );
    expect(() =>
      parseJava16xResourcePack(makeZip({ "pack.mcmeta": strToU8('{"pack":{"description":"x"}}') })),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PACK_MCMETA" }));
  });

  it("accepts the larger file lists used by current 16x packs while retaining an explicit override gate", () => {
    const files: Record<string, Uint8Array> = { "pack.mcmeta": packMetadata };
    for (let index = 0; index < 4_200; index += 1) files[`assets/minecraft/opt/${index}.json`] = strToU8("{}");
    files["assets/minecraft/textures/block/stone.png"] = makePng(16, 16);
    const result = parseJava16xResourcePack(makeZip(files));
    expect(result.summary.archiveFileCount).toBe(4_202);
    expect(result.textures).toHaveLength(1);
    expect(() => parseJava16xResourcePack(makeZip(files), { maxFileCount: 4_096 })).toThrowError(
      expect.objectContaining({ code: "TOO_MANY_FILES" }),
    );
  });

  it("reports non-16x and invalid PNG files without inventing textures", () => {
    const result = parseJava16xResourcePack(
      makeZip({
        "pack.mcmeta": packMetadata,
        "assets/minecraft/textures/block/high_res.png": makePng(32, 32),
        "assets/minecraft/textures/block/broken.png": strToU8("not a png"),
      }),
    );

    expect(result.textures).toEqual([]);
    expect(result.summary.rejectedTextureCount).toBe(2);
    expect(result.summary.issues.map((entry) => entry.code)).toEqual(["INVALID_PNG", "NOT_16X16"]);
  });

  it("rejects per-file and total expanded-size limits before extraction", () => {
    const zip = makeZip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/textures/block/stone.png": makePng(16, 16),
      "padding.bin": new Uint8Array(2048),
    });
    expect(() => parseJava16xResourcePack(zip, { maxSingleFileBytes: 1024 })).toThrowError(
      expect.objectContaining({ code: "FILE_TOO_LARGE", path: "padding.bin" }),
    );
    expect(() => parseJava16xResourcePack(zip, { maxTotalUncompressedBytes: 2100 })).toThrowError(
      expect.objectContaining({ code: "TOTAL_UNCOMPRESSED_TOO_LARGE" }),
    );
  });

  it("rejects traversal, duplicate normalized paths, and case collisions", () => {
    expect(() =>
      parseJava16xResourcePack(makeZip({ "pack.mcmeta": packMetadata, "../escape.png": makePng(16, 16) })),
    ).toThrowError(expect.objectContaining({ code: "UNSAFE_PATH" }));

    const duplicate = appendDuplicateCentralDirectoryEntry(
      makeZip({ "pack.mcmeta": packMetadata, "assets/minecraft/textures/block/a.png": makePng(16, 16) }),
    );
    expect(() => parseJava16xResourcePack(duplicate)).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_PATH" }),
    );

    expect(() =>
      parseJava16xResourcePack(
        makeZip({
          "pack.mcmeta": packMetadata,
          "assets/minecraft/textures/block/stone.png": makePng(16, 16),
          "assets/Minecraft/textures/block/stone.png": makePng(16, 16),
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "CASE_COLLISION" }));
  });

  it("supports deterministic custom namespaces and reports invalid namespaces", () => {
    const result = parseJava16xResourcePack(
      makeZip({
        "pack.mcmeta": packMetadata,
        "assets/zeta_mod/textures/block/copper_tiles.png": makePng(16, 16),
        "assets/acme/textures/block/marble/polished.png": makePng(16, 16),
        "assets/BadNamespace/textures/block/nope.png": makePng(16, 16),
      }),
    );

    expect(result.textures.map((texture) => texture.resourceId)).toEqual([
      "acme:block/marble/polished",
      "zeta_mod:block/copper_tiles",
    ]);
    expect(result.summary.namespaces).toEqual(["acme", "zeta_mod"]);
    expect(result.summary.issues).toEqual([
      expect.objectContaining({ code: "INVALID_NAMESPACE", path: "assets/BadNamespace/textures/block/nope.png" }),
    ]);
  });

  it("normalizes variants and resolves cube_all textures deterministically", () => {
    const result = parseJava16xResourcePack(makeZip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/blockstates/stone.json": json({ variants: { "": { model: "minecraft:block/stone" } } }),
      "assets/minecraft/models/block/stone.json": json({ parent: "block/cube_all", textures: { all: "block/stone" } }),
      "assets/minecraft/textures/block/stone.png": makePng(16, 16),
    }));

    expect(result.blockStates).toEqual([expect.objectContaining({ resourceId: "minecraft:stone", variants: [expect.objectContaining({ key: "", conditions: {} })] })]);
    expect(result.models).toEqual([expect.objectContaining({ resourceId: "minecraft:block/stone", parent: "minecraft:block/cube_all" })]);
    expect(resolveBlockTextures(result, "minecraft:stone")).toMatchObject({
      status: "resolved",
      modelId: "minecraft:block/stone",
      faces: {
        down: "minecraft:block/stone", up: "minecraft:block/stone",
        north: "minecraft:block/stone", south: "minecraft:block/stone",
        west: "minecraft:block/stone", east: "minecraft:block/stone",
      },
    });
  });

  it("resolves canonical state variants, inherited texture variables, and cube templates", () => {
    const result = parseJava16xResourcePack(makeZip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/blockstates/oak_log.json": json({ variants: {
        "axis=y": { model: "minecraft:block/oak_log" },
        "axis=x": { model: "minecraft:block/oak_log", x: 90 },
      } }),
      "assets/minecraft/models/block/oak_log.json": json({ parent: "block/cube_column", textures: { end: "#cap", cap: "block/oak_log_top", side: "block/oak_log" } }),
      "assets/minecraft/textures/block/oak_log.png": makePng(16, 16),
      "assets/minecraft/textures/block/oak_log_top.png": makePng(16, 16),
    }));

    expect(result.blockStates[0]?.variants.map((variant) => variant.key)).toEqual(["axis=x", "axis=y"]);
    expect(resolveBlockTextures(result, "minecraft:oak_log", { axis: "y" })).toMatchObject({
      status: "resolved",
      faces: { up: "minecraft:block/oak_log_top", down: "minecraft:block/oak_log_top", north: "minecraft:block/oak_log" },
    });
    expect(resolveBlockTextures(result, "minecraft:oak_log", { axis: "x" })).toMatchObject({
      status: "resolved",
      faces: { north: "minecraft:block/oak_log_top", south: "minecraft:block/oak_log_top", up: "minecraft:block/oak_log" },
    });
  });

  it("supports cube_bottom_top and one full-cube element with six explicit faces", () => {
    const explicitFaces = Object.fromEntries(
      ["down", "up", "north", "south", "west", "east"].map((face) => [face, { texture: `#${face}` }]),
    );
    const files: Record<string, Uint8Array> = {
      "pack.mcmeta": packMetadata,
      "assets/minecraft/blockstates/grass_block.json": json({ variants: { "": { model: "minecraft:block/grass_block" } } }),
      "assets/minecraft/models/block/grass_block.json": json({ parent: "block/cube_bottom_top", textures: { bottom: "block/dirt", top: "block/grass_block_top", side: "block/grass_block_side" } }),
      "assets/acme/blockstates/six.json": json({ variants: { "": { model: "acme:block/six" } } }),
      "assets/acme/models/block/six.json": json({
        textures: Object.fromEntries(["down", "up", "north", "south", "west", "east"].map((face) => [face, `acme:block/${face}`])),
        elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: explicitFaces }],
      }),
    };
    for (const texture of ["dirt", "grass_block_top", "grass_block_side"]) files[`assets/minecraft/textures/block/${texture}.png`] = makePng(16, 16);
    for (const face of ["down", "up", "north", "south", "west", "east"]) files[`assets/acme/textures/block/${face}.png`] = makePng(16, 16);
    const result = parseJava16xResourcePack(makeZip(files));

    expect(resolveBlockTextures(result, "minecraft:grass_block")).toMatchObject({
      status: "resolved",
      faces: { down: "minecraft:block/dirt", up: "minecraft:block/grass_block_top", north: "minecraft:block/grass_block_side" },
    });
    expect(resolveBlockTextures(result, "acme:six")).toMatchObject({
      status: "resolved", modelId: "acme:block/six",
      faces: Object.fromEntries(["down", "up", "north", "south", "west", "east"].map((face) => [face, `acme:block/${face}`])),
    });
  });

  it("strictly preserves inherited full-cube face UV and rotation metadata", () => {
    const explicitFaces = Object.fromEntries(
      ["down", "up", "north", "south", "west", "east"].map((face, index) => [face, {
        texture: `#${face}`,
        uv: [index, 1, 16 - index, 15],
        rotation: (index % 4) * 90,
      }]),
    );
    const textures = Object.fromEntries(
      ["down", "up", "north", "south", "west", "east"].map((face) => [face, `acme:block/${face}`]),
    );
    const files: Record<string, Uint8Array> = {
      "pack.mcmeta": packMetadata,
      "assets/acme/blockstates/oriented.json": json({ variants: {
        "locked=false": { model: "acme:block/child", y: 90 },
        "locked=true": { model: "acme:block/child", y: 90, uvlock: true },
      } }),
      "assets/acme/models/block/parent.json": json({ textures, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: explicitFaces }] }),
      "assets/acme/models/block/child.json": json({ parent: "acme:block/parent" }),
    };
    for (const face of ["down", "up", "north", "south", "west", "east"]) {
      files[`assets/acme/textures/block/${face}.png`] = makePng(16, 16);
    }
    const result = parseJava16xResourcePack(makeZip(files));
    const parent = result.models.find((model) => model.resourceId === "acme:block/parent");
    const unlocked = resolveBlockTextures(result, "acme:oriented", { locked: "false" });
    const locked = resolveBlockTextures(result, "acme:oriented", { locked: "true" });

    expect(parent?.faces?.north).toBe("#north");
    expect(parent?.faceMetadata?.north).toEqual({ texture: "#north", uv: [2, 1, 14, 15], rotation: 180 });
    expect(unlocked).toMatchObject({
      status: "resolved",
      faceMetadata: {
        west: { texture: "acme:block/north", uv: [2, 1, 14, 15], rotation: 180 },
        up: { texture: "acme:block/up", uv: [1, 1, 15, 15], rotation: 0 },
      },
    });
    expect(locked).toMatchObject({
      status: "resolved",
      faceMetadata: {
        west: { texture: "acme:block/north", uv: [2, 1, 14, 15], rotation: 180 },
        up: { texture: "acme:block/up", uv: [1, 1, 15, 15], rotation: 90 },
      },
    });
  });

  it("resolves omitted vanilla full-cube parent templates with mirrored and directional UVs", () => {
    const files: Record<string, Uint8Array> = {
      "pack.mcmeta": packMetadata,
      "assets/minecraft/blockstates/mirrored.json": json({ variants: { "": { model: "minecraft:block/mirrored_child" } } }),
      "assets/minecraft/blockstates/directional.json": json({ variants: { "": { model: "minecraft:block/directional_child" } } }),
      "assets/minecraft/models/block/mirrored_child.json": json({ parent: "block/cube_mirrored", textures: {
        down: "block/down", up: "block/up", north: "block/north", south: "block/south", west: "block/west", east: "block/east",
      } }),
      "assets/minecraft/models/block/directional_child.json": json({ parent: "block/cube_directional", textures: {
        down: "block/down", up: "block/up", north: "block/north", south: "block/south", west: "block/west", east: "block/east",
      } }),
    };
    for (const face of ["down", "up", "north", "south", "west", "east"]) files[`assets/minecraft/textures/block/${face}.png`] = makePng(16, 16);
    const result = parseJava16xResourcePack(makeZip(files));
    const mirrored = resolveBlockTextures(result, "minecraft:mirrored");
    const directional = resolveBlockTextures(result, "minecraft:directional");

    expect(mirrored).toMatchObject({ status: "resolved", faceMetadata: {
      north: { uv: [16, 0, 0, 16], rotation: 0 }, east: { uv: [16, 0, 0, 16], rotation: 0 },
    } });
    expect(directional).toMatchObject({ status: "resolved", faceMetadata: {
      down: { rotation: 180 }, west: { rotation: 270 }, east: { rotation: 90 },
    } });
  });

  it("maps x/y model rotation and uvlock deterministically for every cube face", () => {
    expect(["down", "up", "north", "south", "west", "east"].map((face) =>
      resolveFaceTextureRotation(face as "down" | "up" | "north" | "south" | "west" | "east", 90, 0, false),
    )).toEqual([180, 0, 180, 0, 90, 270]);
    expect(["down", "up", "north", "south", "west", "east"].map((face) =>
      resolveFaceTextureRotation(face as "down" | "up" | "north" | "south" | "west" | "east", 0, 90, false),
    )).toEqual([90, 270, 0, 0, 0, 0]);
    expect(["down", "up", "north", "south", "west", "east"].map((face) =>
      resolveFaceTextureRotation(face as "down" | "up" | "north" | "south" | "west" | "east", 90, 270, true, 90),
    )).toEqual([90, 90, 90, 90, 90, 90]);
  });

  it("rejects malformed explicit face UVs and face rotations", () => {
    const fullCube = (face: Record<string, unknown>) => ({
      textures: { all: "block/stone" },
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "#all", ...face } } }],
    });
    const result = parseJava16xResourcePack(makeZip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/models/block/short_uv.json": json(fullCube({ uv: [0, 0, 16] })),
      "assets/minecraft/models/block/nonfinite_uv.json": strToU8('{"textures":{"all":"block/stone"},"elements":[{"from":[0,0,0],"to":[16,16,16],"faces":{"north":{"texture":"#all","uv":[0,0,1e999,16]}}}]}'),
      "assets/minecraft/models/block/outside_uv.json": json(fullCube({ uv: [-1, 0, 16, 16] })),
      "assets/minecraft/models/block/bad_rotation.json": json(fullCube({ rotation: 45 })),
    }));

    expect(result.models).toEqual([]);
    expect(result.summary.issues.filter((issue) => issue.code === "INVALID_MODEL_JSON")).toHaveLength(4);
  });

  it("accepts bounded multipart and rotated geometry while retaining explicit resolution fallbacks", () => {
    const result = parseJava16xResourcePack(makeZip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/blockstates/redstone_wire.json": json({ multipart: [{ apply: { model: "minecraft:block/redstone_dot" } }] }),
      "assets/minecraft/blockstates/complex.json": json({ variants: { "": { model: "minecraft:block/complex" } } }),
      "assets/minecraft/blockstates/missing.json": json({ variants: { "": { model: "minecraft:block/missing" } } }),
      "assets/minecraft/models/block/complex.json": json({ elements: [{
        from: [0, 0, 0], to: [16, 8, 16],
        rotation: { origin: [8, 8, 8], axis: "y", angle: 45 },
        faces: { north: { texture: "#all" } },
      }] }),
    }));

    expect(result.summary.issues).toEqual([]);
    expect(result.blockStates.find((state) => state.resourceId === "minecraft:redstone_wire")?.multipart).toHaveLength(1);
    expect(result.models.find((model) => model.resourceId === "minecraft:block/complex")?.elements?.[0]?.rotation).toEqual({
      origin: [8, 8, 8], axis: "y", angle: 45, rescale: false,
    });
    expect(resolveBlockTextures(result, "minecraft:redstone_wire")).toMatchObject({ status: "fallback", reason: "NO_MATCHING_VARIANT" });
    expect(resolveBlockTextures(result, "minecraft:complex")).toMatchObject({ status: "fallback", reason: "COMPLEX_GEOMETRY" });
    expect(resolveBlockTextures(result, "minecraft:missing")).toMatchObject({ status: "fallback", reason: "MISSING_MODEL" });
  });

  it("detects model and texture cycles, missing variables, textures, and unmatched variants", () => {
    const result = parseJava16xResourcePack(makeZip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/blockstates/cycle.json": json({ variants: { "": { model: "minecraft:block/cycle_a" } } }),
      "assets/minecraft/blockstates/texture_cycle.json": json({ variants: { "": { model: "minecraft:block/texture_cycle" } } }),
      "assets/minecraft/blockstates/missing_var.json": json({ variants: { "": { model: "minecraft:block/missing_var" } } }),
      "assets/minecraft/blockstates/missing_texture.json": json({ variants: { "": { model: "minecraft:block/missing_texture" } } }),
      "assets/minecraft/blockstates/oriented.json": json({ variants: { "facing=north": { model: "minecraft:block/missing" } } }),
      "assets/minecraft/models/block/cycle_a.json": json({ parent: "block/cycle_b" }),
      "assets/minecraft/models/block/cycle_b.json": json({ parent: "block/cycle_a" }),
      "assets/minecraft/models/block/texture_cycle.json": json({ parent: "block/cube_all", textures: { all: "#other", other: "#all" } }),
      "assets/minecraft/models/block/missing_var.json": json({ parent: "block/cube_all", textures: {} }),
      "assets/minecraft/models/block/missing_texture.json": json({ parent: "block/cube_all", textures: { all: "block/not_present" } }),
    }));

    expect(resolveBlockTextures(result, "minecraft:cycle")).toMatchObject({ status: "fallback", reason: "MODEL_REFERENCE_CYCLE" });
    expect(resolveBlockTextures(result, "minecraft:texture_cycle")).toMatchObject({ status: "fallback", reason: "TEXTURE_REFERENCE_CYCLE" });
    expect(resolveBlockTextures(result, "minecraft:missing_var")).toMatchObject({ status: "fallback", reason: "MISSING_TEXTURE_VARIABLE" });
    expect(resolveBlockTextures(result, "minecraft:missing_texture")).toMatchObject({ status: "fallback", reason: "MISSING_TEXTURE" });
    expect(resolveBlockTextures(result, "minecraft:oriented", { facing: "south" })).toMatchObject({ status: "fallback", reason: "NO_MATCHING_VARIANT" });
  });

  it("rejects unsafe normalized names and invalid model rotations without affecting ZIP safety", () => {
    const result = parseJava16xResourcePack(makeZip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/blockstates/unsafe.json": json({ variants: { "__proto__=x": { model: "minecraft:block/stone" } } }),
      "assets/minecraft/blockstates/rotation.json": json({ variants: { "": { model: "minecraft:block/stone", x: 45 } } }),
      "assets/minecraft/models/block/unsafe.json": strToU8('{"parent":"block/cube_all","textures":{"__proto__":"block/stone"}}'),
    }));

    expect(result.blockStates).toEqual([]);
    expect(result.models).toEqual([]);
    expect(result.summary.issues.filter((entry) => entry.code === "INVALID_BLOCKSTATE_JSON")).toHaveLength(2);
    expect(result.summary.issues).toContainEqual(expect.objectContaining({ code: "INVALID_MODEL_JSON" }));
  });
});

describe("16x texture atlas", () => {
  it("classifies alpha without treating fully transparent textures as air", () => {
    const opaque = makeRgbaPng(() => [20, 40, 60, 255]);
    const cutout = makeRgbaPng(() => [20, 40, 60, 0]);
    const translucent = makeRgbaPng((x) => [20, 40, 60, x === 0 ? 128 : 255]);
    expect(classifyJava16xPngAlpha(opaque)).toBe("opaque");
    expect(classifyJava16xPngAlpha(cutout)).toBe("cutout");
    expect(classifyJava16xPngAlpha(translucent)).toBe("translucent");

    const manifest = parseJava16xResourcePack(makeZip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/textures/block/invisible_but_present.png": cutout,
    }));
    const atlas = buildJava16xTextureAtlas(manifest);
    expect(atlas.entries).toEqual([expect.objectContaining({ resourceId: "minecraft:block/invisible_but_present", alphaMode: "cutout" })]);
  });

  it("builds deterministic padded atlas pages and stable indices", () => {
    const red = makeRgbaPng((x, y) => [x, y, 10, 255]);
    const green = makeRgbaPng(() => [0, 200, 0, 255]);
    const first = parseJava16xResourcePack(makeZip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/textures/block/zeta.png": green,
      "assets/minecraft/textures/block/alpha.png": red,
    }));
    const second = parseJava16xResourcePack(makeZip({
      "assets/minecraft/textures/block/alpha.png": red,
      "assets/minecraft/textures/block/zeta.png": green,
      "pack.mcmeta": packMetadata,
    }));
    const atlasA = buildJava16xTextureAtlas(first);
    const atlasB = buildJava16xTextureAtlas(second);

    expect(atlasA.entries.map(({ resourceId, index, page }) => ({ resourceId, index, page }))).toEqual([
      { resourceId: "minecraft:block/alpha", index: 0, page: 0 },
      { resourceId: "minecraft:block/zeta", index: 1, page: 0 },
    ]);
    expect(atlasA.pages[0]?.rgba).toEqual(atlasB.pages[0]?.rgba);
    expect(atlasA.entries).toEqual(atlasB.entries);
    expect(atlasA.gutter).toBe(2);
    expect(atlasA.safeMipLevels).toBe(2);

    const entry = atlasA.entries[0]!;
    const page = atlasA.pages[0]!;
    expect(pixelAt(page.rgba, page.width, entry.x, entry.y)).toEqual([0, 0, 10, 255]);
    expect(pixelAt(page.rgba, page.width, entry.x - 1, entry.y)).toEqual([0, 0, 10, 255]);
    expect(pixelAt(page.rgba, page.width, entry.x + 16, entry.y + 15)).toEqual([15, 15, 10, 255]);
    expect(entry.uv).toEqual({ u0: entry.x / page.width, v0: entry.y / page.height, u1: (entry.x + 16) / page.width, v1: (entry.y + 16) / page.height });
  });

  it("maps resolved six-face resources to pure atlas references", () => {
    const manifest = parseJava16xResourcePack(makeZip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/blockstates/stone.json": json({ variants: { "": { model: "minecraft:block/stone" } } }),
      "assets/minecraft/models/block/stone.json": json({ parent: "block/cube_all", textures: { all: "block/stone" } }),
      "assets/minecraft/textures/block/stone.png": makeRgbaPng(() => [100, 100, 100, 255]),
    }));
    const atlas = buildJava16xTextureAtlas(manifest);
    const resolved = resolveBlockTextures(manifest, "minecraft:stone");
    const mapped = mapBlockTexturesToAtlas(resolved, atlas);
    expect(mapped).toMatchObject({
      status: "resolved",
      modelId: "minecraft:block/stone",
      faces: {
        down: { textureIndex: 0, page: 0, alphaMode: "opaque" },
        up: { textureIndex: 0, page: 0, alphaMode: "opaque" },
        north: { textureIndex: 0, page: 0, alphaMode: "opaque" },
      },
    });
    expect(mapBlockTexturesToAtlas({ status: "resolved", modelId: "x", faces: {
      down: "missing:block/x", up: "missing:block/x", north: "missing:block/x",
      south: "missing:block/x", west: "missing:block/x", east: "missing:block/x",
    } }, atlas)).toEqual({ status: "fallback", reason: "MISSING_ATLAS_TEXTURE", resourceId: "missing:block/x" });
  });

  it("uses bounded deterministic pagination and rejects hostile resource demands", () => {
    const manifest = parseJava16xResourcePack(makeZip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/textures/block/a.png": makeRgbaPng(() => [1, 2, 3, 255]),
      "assets/minecraft/textures/block/b.png": makeRgbaPng(() => [4, 5, 6, 255]),
    }));
    expect(buildJava16xTextureAtlas(manifest, { maxPageSize: 32, maxPages: 2 }).pages).toHaveLength(2);
    expect(() => buildJava16xTextureAtlas(manifest, { maxTextures: 1 })).toThrowError(expect.objectContaining({ code: "TOO_MANY_TEXTURES" }));
    expect(() => buildJava16xTextureAtlas(manifest, { maxPageSize: 32, maxPages: 1 })).toThrowError(expect.objectContaining({ code: "TOO_MANY_PAGES" }));
    expect(() => buildJava16xTextureAtlas(manifest, { maxDecodedBytes: 1024 })).toThrowError(expect.objectContaining({ code: "ATLAS_TOO_LARGE" }));
    expect(() => buildJava16xTextureAtlas(manifest, { gutter: 17 })).toThrowError(expect.objectContaining({ code: "INVALID_LIMITS" }));
  });

  it("rejects structurally accepted PNGs whose compressed pixels are hostile or invalid", () => {
    const manifest = parseJava16xResourcePack(makeZip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/textures/block/broken.png": makePng(16, 16),
    }));
    expect(() => buildJava16xTextureAtlas(manifest)).toThrowError(expect.objectContaining({ code: "INVALID_PNG_PIXELS", resourceId: "minecraft:block/broken" }));
  });
});

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}

function makeZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { level: 6 });
}

function makePng(width: number, height: number): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concat(signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", new Uint8Array([0])), pngChunk("IEND", new Uint8Array()));
}

function makeRgbaPng(pixel: (x: number, y: number) => readonly [number, number, number, number]): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, 16, false);
  ihdrView.setUint32(4, 16, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const rows = new Uint8Array(16 * (1 + 16 * 4));
  for (let y = 0; y < 16; y += 1) {
    const row = y * 65;
    rows[row] = 0;
    for (let x = 0; x < 16; x += 1) rows.set(pixel(x, y), row + 1 + x * 4);
  }
  return concat(signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlibSync(rows)), pngChunk("IEND", new Uint8Array()));
}

function pixelAt(rgba: Uint8Array, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4;
  return [...rgba.subarray(offset, offset + 4)];
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = strToU8(type);
  const output = new Uint8Array(12 + data.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length, false);
  output.set(typeBytes, 4);
  output.set(data, 8);
  view.setUint32(8 + data.length, crc32(concat(typeBytes, data)), false);
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
  const output = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
  return output;
}

function appendDuplicateCentralDirectoryEntry(zip: Uint8Array): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.byteLength - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("Missing EOCD in test ZIP.");
  const centralOffset = view.getUint32(eocd + 16, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const firstLength = centralEntryLength(view, centralOffset);
  const duplicate = zip.subarray(centralOffset, centralOffset + firstLength);
  const output = concat(zip.subarray(0, eocd), duplicate, zip.subarray(eocd));
  const outputView = new DataView(output.buffer);
  const newEocd = eocd + duplicate.length;
  const count = view.getUint16(eocd + 10, true);
  outputView.setUint16(newEocd + 8, count + 1, true);
  outputView.setUint16(newEocd + 10, count + 1, true);
  outputView.setUint32(newEocd + 12, centralSize + duplicate.length, true);
  return output;
}

function centralEntryLength(view: DataView, offset: number): number {
  return 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
}

void ResourcePackError;
