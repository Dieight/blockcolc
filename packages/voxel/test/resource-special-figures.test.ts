import { strToU8, zlibSync } from "fflate";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ResourcePackSpecialTexture } from "@tomato-clock/resource-pack";
import type { BlueprintVoxel } from "../src/blueprint";
import { addResourceSpecialFigures } from "../src/resource-special-figures";

const figure = (
  sourceBlockId: string,
  x: number,
  sourceBlockState: Record<string, string> = {},
): BlueprintVoxel => ({
  x, y: 3, z: 2, materialId: "stone", buildOrder: 10_000, sourceBlockId, sourceBlockState,
});

const texture = (resourceId: string, width = 64, height = 64): ResourcePackSpecialTexture => {
  const texturePath = resourceId.slice("minecraft:entity/".length);
  return {
    resourceId, namespace: "minecraft", texturePath,
    archivePath: `assets/minecraft/textures/entity/${texturePath}.png`,
    width, height, png: png(width, height),
  };
};

describe("26.3 skull/head and copper statue special figures", () => {
  it("renders floor rotations and wall facings with official skull extents and grouped instances", () => {
    const root = new THREE.Group();
    const floor0 = figure("minecraft:skeleton_skull", 0, { rotation: "0" });
    const floor4 = figure("minecraft:skeleton_skull", 1, { rotation: "4" });
    const wall = figure("minecraft:skeleton_wall_skull", 2, { facing: "east", waterlogged: "true" });
    const handled = addResourceSpecialFigures(root, [floor0, floor4, wall], [
      texture("minecraft:entity/skeleton/skeleton", 64, 32),
    ]);

    expect(handled).toEqual(new Set([floor0, floor4, wall]));
    expect(root.children).toHaveLength(1);
    const mesh = root.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(3);
    expect(mesh.userData.specialTextureResourceId).toBe("minecraft:entity/skeleton/skeleton");
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.min.x).toBeCloseTo(-0.25);
    expect(mesh.geometry.boundingBox!.max.x).toBeCloseTo(0.25);
    expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(0);
    expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(0.5);
    expect(mesh.geometry.boundingBox!.min.z).toBeCloseTo(-0.25);
    expect(mesh.geometry.boundingBox!.max.z).toBeCloseTo(0.25);

    const uv = mesh.geometry.getAttribute("uv");
    // Down-face vertex zero starts at Mojang's cube-net U=depth+width (16), V=0.
    expect(uv.getX(0)).toBeCloseTo(16 / 64);
    expect(uv.getY(0)).toBeCloseTo(1);
    const matrix0 = new THREE.Matrix4();
    const matrix4 = new THREE.Matrix4();
    const wallMatrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix0);
    mesh.getMatrixAt(1, matrix4);
    mesh.getMatrixAt(2, wallMatrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix0).toArray()).toEqual([0, 2.5, 2]);
    expect(new THREE.Vector3().setFromMatrixPosition(wallMatrix).toArray()).toEqual([1.75, 2.75, 2]);
    const forward0 = new THREE.Vector3(0, 0, -1).transformDirection(matrix0);
    const forward4 = new THREE.Vector3(0, 0, -1).transformDirection(matrix4);
    expect(forward0.distanceTo(forward4)).toBeGreaterThan(1);
    const forwardWall = new THREE.Vector3(0, 0, -1).transformDirection(wallMatrix);
    expect(forwardWall.x).toBeCloseTo(1);
    expect(mesh.userData.ownedMaterial).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(mesh.userData.ownedTexture).toBeInstanceOf(THREE.DataTexture);
    expect((mesh.material as THREE.MeshStandardMaterial).map).toBe(mesh.userData.ownedTexture);
    dispose(root);
  });

  it("maps all copper oxidation textures, waxed variants, poses and horizontal facing", () => {
    const root = new THREE.Group();
    const voxels = [
      figure("minecraft:copper_golem_statue", 0, { facing: "north", pose: "standing" }),
      figure("minecraft:exposed_copper_golem_statue", 1, { facing: "east", pose: "running" }),
      figure("minecraft:waxed_weathered_copper_golem_statue", 2, { facing: "south", pose: "sitting" }),
      figure("minecraft:oxidized_copper_golem_statue", 3, { facing: "west", pose: "star" }),
      figure("minecraft:waxed_oxidized_copper_golem_statue", 4, { facing: "west", pose: "star" }),
    ];
    const textures = [
      texture("minecraft:entity/copper_golem/copper_golem"),
      texture("minecraft:entity/copper_golem/copper_golem_exposed"),
      texture("minecraft:entity/copper_golem/copper_golem_weathered"),
      texture("minecraft:entity/copper_golem/copper_golem_oxidized"),
    ];
    const handled = addResourceSpecialFigures(root, voxels, textures);

    expect(handled).toEqual(new Set(voxels));
    expect(root.children).toHaveLength(4);
    const byPose = new Map(root.children.map((child) => [child.userData.specialBlockKind, child as THREE.InstancedMesh]));
    for (const pose of ["copper-standing", "copper-running", "copper-sitting", "copper-star"]) {
      expect(byPose.has(pose)).toBe(true);
    }
    const exposed = byPose.get("copper-running")!;
    expect(exposed.userData.specialTextureResourceId).toBe("minecraft:entity/copper_golem/copper_golem_exposed");
    const waxedAndUnwaxedOxidized = byPose.get("copper-star")!;
    expect(waxedAndUnwaxedOxidized.count).toBe(2);
    expect(waxedAndUnwaxedOxidized.userData.specialTextureResourceId).toBe("minecraft:entity/copper_golem/copper_golem_oxidized");
    expect((waxedAndUnwaxedOxidized.material as THREE.MeshStandardMaterial).map?.image.width).toBe(64);

    const eastFacing = new THREE.Matrix4();
    exposed.getMatrixAt(0, eastFacing);
    expect(new THREE.Vector3(0, 0, -1).transformDirection(eastFacing).x).toBeCloseTo(1);
    const standing = byPose.get("copper-standing")!;
    standing.geometry.computeBoundingBox();
    expect(standing.geometry.boundingBox!.max.y).toBeGreaterThan(0.9);
    expect(standing.geometry.boundingBox!.min.y).toBeCloseTo(0);
    for (const mesh of root.children as THREE.InstancedMesh[]) {
      expect(mesh.userData.ownedMaterial).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(mesh.userData.ownedTexture).toBeInstanceOf(THREE.DataTexture);
    }
    dispose(root);
  });

  it("uses only the official no-profile slim Steve skin and falls back on missing or invalid resources", () => {
    const root = new THREE.Group();
    const player = figure("minecraft:player_head", 0, { rotation: "5" });
    const missing = figure("minecraft:dragon_head", 1, { rotation: "0" });
    const wrongFacing = figure("minecraft:piglin_wall_head", 2, { facing: "up" });
    const handled = addResourceSpecialFigures(root, [player, missing, wrongFacing], [
      texture("minecraft:entity/player/wide/steve"),
    ]);
    expect(handled.size).toBe(0);
    expect(root.children).toHaveLength(0);

    const slimTexture = texture("minecraft:entity/player/slim/steve");
    const handledPlayer = addResourceSpecialFigures(root, [player], [slimTexture]);
    expect(handledPlayer).toEqual(new Set([player]));
    expect(root.children[0]!.userData.specialTextureResourceId).toBe("minecraft:entity/player/slim/steve");
    dispose(root);

    const brokenRoot = new THREE.Group();
    const invalid = { ...slimTexture, png: new Uint8Array([1, 2, 3]) };
    expect(addResourceSpecialFigures(brokenRoot, [player], [invalid])).toEqual(new Set());
    expect(brokenRoot.children).toHaveLength(0);
  });

  it("leaves unsupported block ids and malformed orientations untouched", () => {
    const root = new THREE.Group();
    const unrelated = figure("minecraft:stone", 0);
    const invalidRotation = figure("minecraft:skeleton_skull", 1, { rotation: "16" });
    const invalidPose = figure("minecraft:copper_golem_statue", 2, { pose: "animated" });
    expect(addResourceSpecialFigures(root, [unrelated, invalidRotation, invalidPose], [
      texture("minecraft:entity/skeleton/skeleton", 64, 32),
      texture("minecraft:entity/copper_golem/copper_golem"),
    ])).toEqual(new Set());
    expect(root.children).toHaveLength(0);
  });
});

function dispose(root: THREE.Group): void {
  for (const child of root.children) {
    const mesh = child as THREE.InstancedMesh;
    mesh.geometry.dispose();
    (mesh.userData.ownedMaterial as THREE.Material | undefined)?.dispose();
    (mesh.userData.ownedTexture as THREE.Texture | undefined)?.dispose();
  }
}

function png(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width, false);
  new DataView(header.buffer).setUint32(4, height, false);
  header.set([8, 6, 0, 0, 0], 8);
  const scanlines = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) scanlines.set([12, 34, 56, 255], y * (1 + width * 4) + 1 + x * 4);
  }
  return join(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlibSync(scanlines)), chunk("IEND", new Uint8Array()));
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
  for (const array of arrays) { result.set(array, offset); offset += array.length; }
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
