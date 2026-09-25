import { strToU8, zlibSync } from "fflate";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ResourcePackSpecialTexture } from "@tomato-clock/resource-pack";
import type { BlueprintVoxel } from "../src/blueprint";
import { addResourceSpecialPortals } from "../src/resource-special-portals";

const voxel = (sourceBlockId: string, x: number): BlueprintVoxel => ({
  x, y: 2, z: 3, materialId: "stone", buildOrder: 10_000, sourceBlockId,
});

describe("26.3 special portal geometry", () => {
  it("uses the user-owned entity texture and vanilla portal/gateway static extents", () => {
    const root = new THREE.Group();
    const portal = voxel("minecraft:end_portal", 1);
    const gateway = voxel("minecraft:end_gateway", 2);
    const texture: ResourcePackSpecialTexture = {
      resourceId: "minecraft:entity/end_portal/end_portal",
      namespace: "minecraft",
      texturePath: "end_portal/end_portal",
      archivePath: "assets/minecraft/textures/entity/end_portal/end_portal.png",
      width: 2, height: 2, png: png(2, 2),
    };
    const handled = addResourceSpecialPortals(root, [portal, gateway], [texture]);

    expect(handled).toEqual(new Set([portal, gateway]));
    expect(root.children).toHaveLength(2);
    const portalMesh = root.children.find((child) => child.userData.specialBlockKind === "end_portal") as THREE.InstancedMesh;
    const gatewayMesh = root.children.find((child) => child.userData.specialBlockKind === "end_gateway") as THREE.InstancedMesh;
    portalMesh.geometry.computeBoundingBox();
    gatewayMesh.geometry.computeBoundingBox();
    expect(portalMesh.geometry.boundingBox!.max.y - portalMesh.geometry.boundingBox!.min.y).toBeCloseTo(0.375);
    expect(gatewayMesh.geometry.boundingBox!.max.y - gatewayMesh.geometry.boundingBox!.min.y).toBeCloseTo(1);
    const transform = new THREE.Matrix4();
    portalMesh.getMatrixAt(0, transform);
    expect(new THREE.Vector3().setFromMatrixPosition(transform).toArray()).toEqual([1, 2.0625, 3]);
    expect(portalMesh.userData.ownedTexture).toBeInstanceOf(THREE.DataTexture);
    expect((portalMesh.material as THREE.MeshBasicMaterial).map).toBe(portalMesh.userData.ownedTexture);
    for (const mesh of [portalMesh, gatewayMesh]) mesh.geometry.dispose();
    (portalMesh.material as THREE.Material).dispose();
    (portalMesh.userData.ownedTexture as THREE.Texture).dispose();
  });

  it("keeps unsupported custom packs on the existing fallback path", () => {
    const root = new THREE.Group();
    const portal = voxel("minecraft:end_portal", 0);
    expect(addResourceSpecialPortals(root, [portal], [])).toEqual(new Set());
    expect(root.children).toHaveLength(0);
  });
});

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
