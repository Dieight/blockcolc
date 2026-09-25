import { strToU8, zlibSync } from "fflate";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ResourcePackSpecialTexture } from "@tomato-clock/resource-pack";
import type { BlueprintVoxel } from "../src/blueprint";
import { addResourceSpecialBoxes } from "../src/resource-special-boxes";

const DYE_COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
] as const;

function voxel(
  sourceBlockId: string,
  x: number,
  sourceBlockState: Record<string, string> = {},
): BlueprintVoxel {
  return { x, y: 3, z: -2, materialId: "stone", buildOrder: 10_000, sourceBlockId, sourceBlockState };
}

function specialTexture(path: string, width = 64, height = 64): ResourcePackSpecialTexture {
  return {
    resourceId: `minecraft:entity/${path}`,
    namespace: "minecraft",
    texturePath: path,
    archivePath: `assets/minecraft/textures/entity/${path}.png`,
    width,
    height,
    png: png(width, height),
  };
}

function findMesh(root: THREE.Group, resourceId: string, shape?: string): THREE.InstancedMesh {
  const mesh = root.children.find((child) => child.userData.specialTextureResourceId === resourceId
    && (shape === undefined || child.userData.specialShape === shape));
  if (!(mesh instanceof THREE.InstancedMesh)) throw new Error(`Missing special mesh ${resourceId}/${shape ?? ""}`);
  return mesh;
}

function rotateDirection(mesh: THREE.InstancedMesh, index: number, direction: THREE.Vector3): THREE.Vector3 {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return direction.clone().transformDirection(matrix);
}

function expectVector(actual: THREE.Vector3, expected: readonly [number, number, number]): void {
  expect(actual.x).toBeCloseTo(expected[0], 5);
  expect(actual.y).toBeCloseTo(expected[1], 5);
  expect(actual.z).toBeCloseTo(expected[2], 5);
}

function expectUv(vertex: number, expected: readonly [number, number], geometry: THREE.BufferGeometry): void {
  const uv = geometry.getAttribute("uv");
  expect(uv.getX(vertex)).toBeCloseTo(expected[0] / 64, 6);
  expect(uv.getY(vertex)).toBeCloseTo(expected[1] / 64, 6);
}

describe("Java 26.3 special chest and shulker-box rendering", () => {
  it("uses Mojang single/left/right chest cuboids, directional lock and copper material routing", () => {
    const voxels = [
      voxel("minecraft:chest", 0, { type: "single", facing: "south" }),
      voxel("minecraft:chest", 1, { type: "left", facing: "east" }),
      voxel("minecraft:chest", 2, { type: "right", facing: "west" }),
      voxel("minecraft:trapped_chest", 3, { type: "left", facing: "north" }),
      // Ender chests are single-only in vanilla; an irrelevant type property
      // cannot accidentally select an absent double-texture variant.
      voxel("minecraft:ender_chest", 4, { type: "right", facing: "north" }),
      voxel("minecraft:copper_chest", 5, { type: "single", facing: "south" }),
      voxel("minecraft:exposed_copper_chest", 6, { type: "single", facing: "south" }),
      voxel("minecraft:weathered_copper_chest", 7, { type: "single", facing: "south" }),
      voxel("minecraft:oxidized_copper_chest", 8, { type: "single", facing: "south" }),
      voxel("minecraft:waxed_copper_chest", 9, { type: "single", facing: "south" }),
      voxel("minecraft:waxed_exposed_copper_chest", 10, { type: "single", facing: "south" }),
      voxel("minecraft:waxed_weathered_copper_chest", 11, { type: "single", facing: "south" }),
      voxel("minecraft:waxed_oxidized_copper_chest", 12, { type: "single", facing: "south" }),
    ];
    const paths = [
      "chest/normal", "chest/normal_left", "chest/normal_right",
      "chest/trapped", "chest/trapped_left", "chest/ender",
      "chest/copper", "chest/copper_left", "chest/copper_right",
      "chest/copper_exposed", "chest/copper_exposed_left", "chest/copper_exposed_right",
      "chest/copper_weathered", "chest/copper_weathered_left", "chest/copper_weathered_right",
      "chest/copper_oxidized", "chest/copper_oxidized_left", "chest/copper_oxidized_right",
    ];
    const root = new THREE.Group();

    const handled = addResourceSpecialBoxes(root, voxels, paths.map((path) => specialTexture(path)));

    expect(handled).toEqual(new Set(voxels));
    expect(findMesh(root, "minecraft:entity/chest/normal", "single").count).toBe(1);
    expect(findMesh(root, "minecraft:entity/chest/normal_left", "left").count).toBe(1);
    expect(findMesh(root, "minecraft:entity/chest/normal_right", "right").count).toBe(1);
    expect(findMesh(root, "minecraft:entity/chest/ender", "single").count).toBe(1);
    for (const texture of ["copper", "copper_exposed", "copper_weathered", "copper_oxidized"]) {
      expect(findMesh(root, `minecraft:entity/chest/${texture}`, "single").count).toBe(2);
    }

    const single = findMesh(root, "minecraft:entity/chest/normal", "single");
    single.geometry.computeBoundingBox();
    expect(single.geometry.boundingBox!.min.toArray()).toEqual([-0.4375, -0.5, -0.4375]);
    expect(single.geometry.boundingBox!.max.toArray()).toEqual([0.4375, 0.375, 0.5]);
    expect(single.geometry.getAttribute("position").count).toBe(72);
    // Exact 64x64 Mojang layer UV for the bottom's south/front face.
    expectUv(20, [56, 33], single.geometry);
    expectUv(21, [42, 33], single.geometry);
    expectUv(22, [42, 43], single.geometry);
    expectUv(23, [56, 43], single.geometry);

    const right = findMesh(root, "minecraft:entity/chest/normal_right", "right");
    const left = findMesh(root, "minecraft:entity/chest/normal_left", "left");
    right.geometry.computeBoundingBox();
    left.geometry.computeBoundingBox();
    expect(right.geometry.boundingBox!.min.x).toBeCloseTo(-0.4375);
    expect(right.geometry.boundingBox!.max.x).toBeCloseTo(0.5);
    expect(left.geometry.boundingBox!.min.x).toBeCloseTo(-0.5);
    expect(left.geometry.boundingBox!.max.x).toBeCloseTo(0.4375);
    expect(right.geometry.getAttribute("position").count).toBe(60);
    expect(left.geometry.getAttribute("position").count).toBe(60);
    for (let index = 0; index < right.geometry.getAttribute("normal").count; index += 1) {
      expect(right.geometry.getAttribute("normal").getX(index)).not.toBeGreaterThan(0.5);
    }
    for (let index = 0; index < left.geometry.getAttribute("normal").count; index += 1) {
      expect(left.geometry.getAttribute("normal").getX(index)).not.toBeLessThan(-0.5);
    }
    expect(right.userData.ownedMaterial).toBeInstanceOf(THREE.Material);
    expect(right.userData.ownedTexture).toBeInstanceOf(THREE.DataTexture);
    expect((right.material as THREE.MeshStandardMaterial).map).toBe(right.userData.ownedTexture);
    disposeSpecialMeshes(root);
  });

  it("rotates the chest's +Z lock/front using ChestRenderer's facing transform", () => {
    const voxels = [
      voxel("minecraft:chest", 0, { facing: "south" }),
      voxel("minecraft:chest", 1, { facing: "north" }),
      voxel("minecraft:chest", 2, { facing: "west" }),
      voxel("minecraft:chest", 3, { facing: "east" }),
    ];
    const root = new THREE.Group();
    const handled = addResourceSpecialBoxes(root, voxels, [specialTexture("chest/normal")]);
    const mesh = findMesh(root, "minecraft:entity/chest/normal", "single");

    expect(handled).toEqual(new Set(voxels));
    expect(mesh.count).toBe(4);
    expectVector(rotateDirection(mesh, 0, new THREE.Vector3(0, 0, 1)), [0, 0, 1]);
    expectVector(rotateDirection(mesh, 1, new THREE.Vector3(0, 0, 1)), [0, 0, -1]);
    expectVector(rotateDirection(mesh, 2, new THREE.Vector3(0, 0, 1)), [-1, 0, 0]);
    expectVector(rotateDirection(mesh, 3, new THREE.Vector3(0, 0, 1)), [1, 0, 0]);
    disposeSpecialMeshes(root);
  });

  it("renders default and all 16 dye shulker textures, with all six Mojang orientations", () => {
    const directions = ["up", "down", "north", "south", "west", "east"] as const;
    const defaultBoxes = directions.map((facing, index) => voxel("minecraft:shulker_box", index, { facing }));
    const coloredBoxes = DYE_COLORS.map((color, index) => voxel(`minecraft:${color}_shulker_box`, index + 6));
    const voxels = [...defaultBoxes, ...coloredBoxes];
    const texturePaths = ["shulker/shulker", ...DYE_COLORS.map((color) => `shulker/shulker_${color}`)];
    const textures = texturePaths.map((path) => specialTexture(path, 128, 64));
    const root = new THREE.Group();

    const handled = addResourceSpecialBoxes(root, voxels, textures);

    expect(handled).toEqual(new Set(voxels));
    expect(root.children).toHaveLength(17);
    const defaultMesh = findMesh(root, "minecraft:entity/shulker/shulker", "shulker");
    expect(defaultMesh.count).toBe(6);
    expect((defaultMesh.material as THREE.MeshStandardMaterial).map?.image).toMatchObject({ width: 128, height: 64 });
    expect(defaultMesh.geometry.getAttribute("position").count).toBe(48);
    defaultMesh.geometry.computeBoundingBox();
    expect(defaultMesh.geometry.boundingBox!.min.x).toBeCloseTo(-0.49975, 5);
    expect(defaultMesh.geometry.boundingBox!.min.y).toBeCloseTo(-0.49975, 5);
    expect(defaultMesh.geometry.boundingBox!.min.z).toBeCloseTo(-0.49975, 5);
    expect(defaultMesh.geometry.boundingBox!.max.x).toBeCloseTo(0.49975, 5);
    expect(defaultMesh.geometry.boundingBox!.max.y).toBeCloseTo(0.49975, 5);
    expect(defaultMesh.geometry.boundingBox!.max.z).toBeCloseTo(0.49975, 5);
    const uv = defaultMesh.geometry.getAttribute("uv");
    let maxU = 0;
    let maxV = 0;
    for (let index = 0; index < uv.count; index += 1) {
      maxU = Math.max(maxU, uv.getX(index));
      maxV = Math.max(maxV, uv.getY(index));
    }
    expect(maxU).toBe(1);
    expect(maxV).toBeCloseTo(52 / 64);
    expect(defaultMesh.geometry.userData.specialBoxCuboids).toEqual([
      { name: "lid", from: [-8, 8, -8], to: [8, 20, 8], texU: 0, texV: 0, faces: 6 },
      { name: "base", from: [-8, 16, -8], to: [8, 24, 8], texU: 0, texV: 28, faces: 6 },
    ]);

    const expectedFacing: readonly [number, number, number][] = [
      [0, 1, 0], [0, -1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0],
    ];
    directions.forEach((_facing, index) => {
      expectVector(rotateDirection(defaultMesh, index, new THREE.Vector3(0, 1, 0)), expectedFacing[index]!);
    });
    for (const color of DYE_COLORS) {
      expect(findMesh(root, `minecraft:entity/shulker/shulker_${color}`, "shulker").count).toBe(1);
    }
    expect(defaultMesh.userData.ownedMaterial).toBeInstanceOf(THREE.Material);
    expect(defaultMesh.userData.ownedTexture).toBeInstanceOf(THREE.DataTexture);
    disposeSpecialMeshes(root);
  });

  it("does not consume unsupported states, missing half textures, or corrupt texture data", () => {
    const voxels = [
      voxel("minecraft:chest", 0, { type: "left", facing: "south" }),
      voxel("minecraft:chest", 1, { type: "invalid", facing: "south" }),
      voxel("minecraft:chest", 2, { type: "single", facing: "up" }),
      voxel("minecraft:purple_shulker_box", 3, { facing: "sideways" }),
      voxel("example:chest", 4, { type: "single" }),
      voxel("minecraft:acacia_chest", 5, { type: "single" }),
    ];
    const root = new THREE.Group();

    const handled = addResourceSpecialBoxes(root, voxels, [specialTexture("chest/normal")]);

    expect(handled.size).toBe(0);
    expect(root.children).toHaveLength(0);

    const damaged = { ...specialTexture("chest/normal"), png: new Uint8Array([1, 2, 3]) };
    const corruptRoot = new THREE.Group();
    expect(addResourceSpecialBoxes(corruptRoot, [voxel("minecraft:chest", 0)], [damaged])).toEqual(new Set());
    expect(corruptRoot.children).toHaveLength(0);
  });
});

function disposeSpecialMeshes(root: THREE.Group): void {
  for (const child of root.children) {
    if (!(child instanceof THREE.InstancedMesh)) continue;
    child.geometry.dispose();
    (child.userData.ownedMaterial as THREE.Material | undefined)?.dispose();
    (child.userData.ownedTexture as THREE.Texture | undefined)?.dispose();
  }
}

function png(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width, false);
  new DataView(header.buffer).setUint32(4, height, false);
  header.set([8, 6, 0, 0, 0], 8);
  const scanlines = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      scanlines.set([x % 256, y % 256, 90, 255], y * (1 + width * 4) + 1 + x * 4);
    }
  }
  return join(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(scanlines)),
    chunk("IEND", new Uint8Array()),
  );
}

function chunk(name: string, bytes: Uint8Array): Uint8Array {
  const type = strToU8(name);
  const result = new Uint8Array(bytes.length + 12);
  new DataView(result.buffer).setUint32(0, bytes.length, false);
  result.set(type, 4);
  result.set(bytes, 8);
  new DataView(result.buffer).setUint32(8 + bytes.length, crc32(join(type, bytes)), false);
  return result;
}

function join(...arrays: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((total, array) => total + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
