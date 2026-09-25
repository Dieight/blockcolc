import { describe, expect, it } from "vitest";
import type {
  NormalizedBlockModel,
  NormalizedBlockState,
  ResourcePackColormap,
  ResourcePackManifest,
  ResourcePackSpecialTexture,
  ResourcePackTexture,
} from "../src";
import { resolveBlockGeometry, resolveBlockTextures } from "../src/block-models";
import { layerResourcePackManifests } from "../src/layering";

const faceTextures = {
  down: "#all",
  up: "#all",
  north: "#all",
  south: "#all",
  west: "#all",
  east: "#all",
} as const;

describe("layerResourcePackManifests", () => {
  it("lets a texture-only overlay recolor a base block while inheriting its state and geometry", () => {
    const baseTexture = texture("minecraft:block/stone", [10, 20, 30]);
    const overlayTexture = texture("minecraft:block/stone", [210, 90, 40]);
    const base = manifest({
      textures: [baseTexture],
      blockStates: [blockState("minecraft:block/stone", "minecraft:block/stone")],
      models: [fullCubeModel("minecraft:block/stone", "minecraft:block/stone")],
    });
    const overlay = manifest({ textures: [overlayTexture] });

    const layered = layerResourcePackManifests(base, overlay);
    const textureResolution = resolveBlockTextures(layered, "minecraft:block/stone");
    const geometryResolution = resolveBlockGeometry(layered, "minecraft:block/stone");

    expect(layered.textures).toEqual([overlayTexture]);
    expect(layered.blockStates).toEqual(base.blockStates);
    expect(layered.models).toEqual(base.models);
    expect(layered.textures[0]?.png).toEqual(new Uint8Array([210, 90, 40]));
    expect(textureResolution).toMatchObject({
      status: "resolved",
      modelId: "minecraft:block/stone",
      faces: { up: "minecraft:block/stone", north: "minecraft:block/stone" },
    });
    expect(geometryResolution).toMatchObject({
      status: "resolved_geometry",
      modelId: "minecraft:block/stone",
      elements: [{
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: { north: { texture: "minecraft:block/stone" } },
      }],
    });
  });

  it("uses overlay precedence for every resource collection and inherits missing IDs", () => {
    const baseState = blockState("minecraft:block/stone", "minecraft:block/base_model");
    const overlayState = blockState("minecraft:block/stone", "minecraft:block/overlay_model");
    const baseModel = fullCubeModel("minecraft:block/base_model", "minecraft:block/base_texture");
    const replacementModel = fullCubeModel("minecraft:block/base_model", "minecraft:block/overlay_texture");
    const inheritedModel = fullCubeModel("minecraft:block/inherited_model", "minecraft:block/base_texture");
    const baseGrass = colormap("grass", [1]);
    const overlayGrass = colormap("grass", [2]);
    const inheritedFoliage = colormap("foliage", [3]);
    const base = manifest({
      textures: [texture("minecraft:block/base_texture", [1, 1, 1]), texture("minecraft:block/overlay_texture", [2, 2, 2])],
      blockStates: [baseState],
      models: [baseModel, inheritedModel],
      colormaps: [baseGrass, inheritedFoliage],
      specialTextures: [specialTexture("minecraft:entity/chest/normal", [1]), specialTexture("minecraft:entity/shulker/shulker", [3])],
    });
    const overlay = manifest({
      textures: [texture("minecraft:block/base_texture", [9, 9, 9])],
      blockStates: [overlayState],
      models: [replacementModel],
      colormaps: [overlayGrass],
      specialTextures: [specialTexture("minecraft:entity/chest/normal", [2])],
    });

    const layered = layerResourcePackManifests(base, overlay);

    expect(layered.schemaVersion).toBe(1);
    expect(layered.pack).toEqual(overlay.pack);
    expect(layered.textures.map(({ resourceId, png }) => [resourceId, [...png]])).toEqual([
      ["minecraft:block/base_texture", [9, 9, 9]],
      ["minecraft:block/overlay_texture", [2, 2, 2]],
    ]);
    expect(layered.blockStates).toEqual([overlayState]);
    expect(layered.models).toEqual([replacementModel, inheritedModel].sort(byId));
    expect(layered.colormaps).toEqual([overlayGrass, inheritedFoliage].sort(byId));
    expect(layered.specialTextures?.map(({ resourceId, png }) => [resourceId, [...png]])).toEqual([
      ["minecraft:entity/chest/normal", [2]],
      ["minecraft:entity/shulker/shulker", [3]],
    ]);
  });

  it("keeps source diagnostics and aggregate source counts honest and deterministic", () => {
    const base = manifest({
      summary: {
        archiveFileCount: 5,
        candidateTextureCount: 3,
        acceptedTextureCount: 2,
        rejectedTextureCount: 1,
        ignoredFileCount: 1,
        namespaces: ["minecraft"],
        issues: [{ path: "assets/minecraft/models/block/bad.json", code: "INVALID_MODEL_JSON", message: "Invalid model." }],
      },
    });
    const overlay = manifest({
      textures: [texture("custom:block/overlay", [4, 5, 6])],
      summary: {
        archiveFileCount: 2,
        candidateTextureCount: 1,
        acceptedTextureCount: 1,
        rejectedTextureCount: 0,
        ignoredFileCount: 0,
        namespaces: ["custom"],
        issues: [{ path: "assets/custom/textures/block/bad.png", code: "INVALID_PNG", message: "Invalid PNG." }],
      },
    });

    const layered = layerResourcePackManifests(base, overlay);

    expect(layered.summary).toEqual({
      archiveFileCount: 7,
      candidateTextureCount: 4,
      acceptedTextureCount: 3,
      rejectedTextureCount: 1,
      ignoredFileCount: 1,
      namespaces: ["custom"],
      issues: [
        {
          path: "assets/custom/textures/block/bad.png",
          code: "INVALID_PNG",
          message: "Overlay pack: Invalid PNG.",
        },
        {
          path: "assets/minecraft/models/block/bad.json",
          code: "INVALID_MODEL_JSON",
          message: "Base pack: Invalid model.",
        },
      ],
    });
    expect(layerResourcePackManifests(base, overlay)).toEqual(layered);
  });

  it("does not mutate either input manifest", () => {
    const base = manifest({
      textures: [texture("minecraft:block/shared", [10, 0, 0])],
      blockStates: [blockState("minecraft:block/base_only", "minecraft:block/base_only")],
      models: [fullCubeModel("minecraft:block/base_only", "minecraft:block/shared")],
      colormaps: [colormap("grass", [7])],
    });
    const overlay = manifest({
      textures: [texture("minecraft:block/shared", [0, 10, 0])],
      summary: {
        archiveFileCount: 2,
        candidateTextureCount: 1,
        acceptedTextureCount: 1,
        rejectedTextureCount: 0,
        ignoredFileCount: 0,
        namespaces: ["minecraft"],
        issues: [],
      },
    });
    const baseBefore = structuredClone(base);
    const overlayBefore = structuredClone(overlay);

    layerResourcePackManifests(base, overlay);

    expect(base).toEqual(baseBefore);
    expect(overlay).toEqual(overlayBefore);
  });
});

function manifest(overrides: Partial<ResourcePackManifest> = {}): ResourcePackManifest {
  return {
    schemaVersion: 1,
    pack: { packFormat: 1, description: "test pack" },
    textures: [],
    blockStates: [],
    models: [],
    summary: {
      archiveFileCount: 0,
      candidateTextureCount: 0,
      acceptedTextureCount: 0,
      rejectedTextureCount: 0,
      ignoredFileCount: 0,
      namespaces: [],
      issues: [],
    },
    ...overrides,
  };
}

function texture(resourceId: string, pixels: number[]): ResourcePackTexture {
  const separator = resourceId.indexOf(":");
  const namespace = resourceId.slice(0, separator);
  const texturePath = resourceId.slice(separator + 1).replace(/^block\//, "");
  return {
    resourceId,
    namespace,
    texturePath,
    archivePath: `assets/${namespace}/textures/block/${texturePath}.png`,
    width: 16,
    height: 16,
    png: new Uint8Array(pixels),
  };
}

function specialTexture(resourceId: string, pixels: number[]): ResourcePackSpecialTexture {
  const separator = resourceId.indexOf(":");
  const namespace = resourceId.slice(0, separator);
  const texturePath = resourceId.slice(separator + ":entity/".length);
  return {
    resourceId,
    namespace,
    texturePath,
    archivePath: `assets/${namespace}/textures/entity/${texturePath}.png`,
    width: 16,
    height: 16,
    png: new Uint8Array(pixels),
  };
}

function blockState(resourceId: string, modelId: string): NormalizedBlockState {
  return {
    resourceId,
    archivePath: `assets/${resourceId.replace(":", "/blockstates/")}.json`,
    variants: [{
      key: "",
      conditions: {},
      choices: [{ model: modelId, x: 0, y: 0, uvlock: false, weight: 1 }],
    }],
  };
}

function fullCubeModel(resourceId: string, textureId: string): NormalizedBlockModel {
  return {
    resourceId,
    archivePath: `assets/${resourceId.replace(":", "/models/")}.json`,
    textures: { all: textureId },
    faces: faceTextures,
  };
}

function colormap(kind: "grass" | "foliage", values: number[]): ResourcePackColormap {
  return {
    kind,
    resourceId: `minecraft:colormap/${kind}`,
    archivePath: `assets/minecraft/textures/colormap/${kind}.png`,
    width: 256,
    height: 256,
    png: new Uint8Array(values),
  };
}

function byId(left: { resourceId: string }, right: { resourceId: string }): number {
  return left.resourceId < right.resourceId ? -1 : left.resourceId > right.resourceId ? 1 : 0;
}
