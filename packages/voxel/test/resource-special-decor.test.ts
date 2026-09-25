import { strToU8, zlibSync } from "fflate";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ResourcePackSpecialTexture } from "@tomato-clock/resource-pack";
import type { BlueprintVoxel } from "../src/blueprint";
import { addResourceSpecialDecor } from "../src/resource-special-decor";

const voxel = (id: string, state: Record<string, string> = {}): BlueprintVoxel => ({
  x: 2, y: 3, z: 4, materialId: "stone", buildOrder: 10_000,
  sourceBlockId: id, sourceBlockState: state,
});

describe("26.3 static block-entity decor", () => {
  it("renders standing and wall banners using imported base plus exact dye color", () => {
    const root = new THREE.Group();
    const standing = voxel("minecraft:red_banner", { rotation: "4" });
    const wall = voxel("minecraft:light_blue_wall_banner", { facing: "west" });
    const handled = addResourceSpecialDecor(root, [standing, wall], [
      texture("banner/banner_base", 64, 64, [20, 40, 60, 255]),
      texture("banner/base", 64, 64, [70, 110, 150, 255]),
    ]);
    expect(handled).toEqual(new Set([standing, wall]));
    expect(root.children.filter((child) => child.userData.specialBlockKind === "banner_pole")).toHaveLength(1);
    expect(root.children.filter((child) => child.userData.specialBlockKind === "wall_banner_bar")).toHaveLength(1);
    const red = root.children.find((child) => child.userData.specialBlockKind === "banner_dye") as THREE.InstancedMesh;
    const blue = root.children.find((child) => child.userData.specialBlockKind === "wall_banner_dye") as THREE.InstancedMesh;
    expect((red.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xb02e26);
    expect((blue.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x3ab3da);
    red.geometry.computeBoundingBox();
    expect(red.geometry.boundingBox!.max.y - red.geometry.boundingBox!.min.y).toBeCloseTo(40 / 24);
    expect(red.geometry.boundingBox!.min.y).toBeCloseTo(-1 / 3);
    expect(red.geometry.boundingBox!.max.y).toBeCloseTo(4 / 3);
    expect((root.children.find((child) => child.userData.specialBlockKind === "wall_banner_dye")
      ?.userData.blockEntityDataLimitations as string[])[0]).toMatch(/require block-entity NBT/i);
    const wallMatrix = new THREE.Matrix4();
    (root.children.find((child) => child.userData.specialBlockKind === "wall_banner_dye") as THREE.InstancedMesh)
      .getMatrixAt(0, wallMatrix);
    expect(wallMatrix.elements[8]).toBeCloseTo(-1);
    expect((red.material as THREE.MeshStandardMaterial).map).toBeInstanceOf(THREE.DataTexture);
    expect((red.material as THREE.MeshStandardMaterial).map?.name).toBe("blockcolc-minecraft:entity/banner/base");
    const plainFlag = root.children.find((child) => child.userData.specialBlockKind === "banner_flag") as THREE.InstancedMesh;
    const plainFlagMap = (plainFlag.material as THREE.MeshStandardMaterial).map!;
    expect(plainFlagMap.name).toBe("blockcolc-minecraft:entity/banner/banner_base");
    expect(Array.from((plainFlagMap.image as { data: Uint8Array }).data.slice(0, 3))).toEqual([20, 40, 60]);
    const bannerUv = plainFlag.geometry.getAttribute("uv");
    const bannerUs = Array.from({ length: bannerUv.count }, (_, point) => bannerUv.getX(point));
    expect(Math.min(...bannerUs)).toBeCloseTo(0);
    expect(Math.max(...bannerUs)).toBeCloseTo(62 / 64);
    expectOwnedResources(root, 3, 2);
    dispose(root);
  });

  it("matches 26.3 pot planes, UV crops, neck cuboids, facing transform, and inactive conduit shell", () => {
    const root = new THREE.Group();
    const pot = voxel("minecraft:decorated_pot", { facing: "north" });
    const conduit = voxel("minecraft:conduit");
    expect(addResourceSpecialDecor(root, [pot, conduit], [
      texture("decorated_pot/decorated_pot_base", 32, 32),
      texture("decorated_pot/decorated_pot_side", 16, 16),
      texture("conduit/base", 32, 16),
    ])).toEqual(new Set([pot, conduit]));
    expect(root.children.map((child) => child.userData.specialBlockKind)).toEqual([
      "decorated_pot_front", "decorated_pot_back", "decorated_pot_left", "decorated_pot_right",
      "decorated_pot_neck", "decorated_pot_neck_lip", "decorated_pot_top", "decorated_pot_bottom",
      "conduit_shell",
    ]);
    for (const [index, side] of root.children.slice(0, 4).entries()) {
      const mesh = side as THREE.InstancedMesh;
      const position = mesh.geometry.getAttribute("position");
      mesh.geometry.computeBoundingBox();
      expect(position.count).toBe(4);
      if (index < 2) {
        expect(mesh.geometry.boundingBox!.max.x - mesh.geometry.boundingBox!.min.x).toBeCloseTo(14 / 16);
        expect(mesh.geometry.boundingBox!.max.z - mesh.geometry.boundingBox!.min.z).toBeCloseTo(0);
      } else {
        expect(mesh.geometry.boundingBox!.max.x - mesh.geometry.boundingBox!.min.x).toBeCloseTo(0);
        expect(mesh.geometry.boundingBox!.max.z - mesh.geometry.boundingBox!.min.z).toBeCloseTo(14 / 16);
      }
      expect(mesh.geometry.boundingBox!.max.y - mesh.geometry.boundingBox!.min.y).toBeCloseTo(1);
      const uv = mesh.geometry.getAttribute("uv");
      const uValues = Array.from({ length: uv.count }, (_, point) => uv.getX(point));
      expect(Math.min(...uValues)).toBeCloseTo(1 / 16);
      expect(Math.max(...uValues)).toBeCloseTo(15 / 16);
      expect((mesh.material as THREE.MeshStandardMaterial).map?.image.width).toBe(16);
    }
    const neck = (root.children[4] as THREE.InstancedMesh).geometry;
    neck.computeBoundingBox();
    expect(neck.boundingBox!.max.y).toBeCloseTo(19.9 / 16 - 0.5);
    expect(neck.boundingBox!.min.y).toBeCloseTo(17.1 / 16 - 0.5);
    const top = (root.children[6] as THREE.InstancedMesh).geometry;
    top.computeBoundingBox();
    expect(top.boundingBox!.max.y - top.boundingBox!.min.y).toBeCloseTo(0);
    expect(top.boundingBox!.max.y).toBeCloseTo(0.5);
    const topUvs = top.getAttribute("uv");
    expect(Array.from({ length: topUvs.count }, (_, point) => topUvs.getX(point)))
      .toEqual([28 / 32, 14 / 32, 14 / 32, 28 / 32]);
    expect((root.children[0] as THREE.InstancedMesh).material as THREE.MeshStandardMaterial)
      .toHaveProperty("map.name", "blockcolc-minecraft:entity/decorated_pot/decorated_pot_side");
    const potMatrix = new THREE.Matrix4();
    (root.children[0] as THREE.InstancedMesh).getMatrixAt(0, potMatrix);
    expect(potMatrix.elements[0]).toBeCloseTo(1);
    expect(potMatrix.elements[10]).toBeCloseTo(1);

    const shell = root.children[8] as THREE.InstancedMesh;
    shell.geometry.computeBoundingBox();
    expect(shell.geometry.boundingBox!.max.x - shell.geometry.boundingBox!.min.x).toBeCloseTo(6 / 16);
    expect(shell.geometry.boundingBox!.min.x).toBeCloseTo(-3 / 16);
    expect(shell.geometry.boundingBox!.min.y).toBeCloseTo(-3 / 16);
    expect((shell.userData.blockEntityDataLimitations as string[])[0]).toMatch(/inactive shell/i);
    expectOwnedResources(root, 3, 3);
    dispose(root);
  });

  it("uses Mojang 26.3 diffuse RGB for all sixteen standing and wall banner colors", () => {
    const dyeIds = [
      "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
      "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
    ];
    const expected = [
      0xf9fffe, 0xf9801d, 0xc74ebd, 0x3ab3da, 0xfed83d, 0x80c71f, 0xf38baa, 0x474f52,
      0x9d9d97, 0x169c9c, 0x8932b8, 0x3c44aa, 0x835432, 0x5e7c16, 0xb02e26, 0x1d1d21,
    ];
    const voxels = dyeIds.flatMap((dye) => [
      voxel(`minecraft:${dye}_banner`), voxel(`minecraft:${dye}_wall_banner`, { facing: "east" }),
    ]);
    const root = new THREE.Group();
    expect(addResourceSpecialDecor(root, voxels, [
      texture("banner/banner_base", 64, 64), texture("banner/base", 64, 64),
    ])).toHaveProperty("size", 32);
    const dyedMeshes = root.children.filter((child) =>
      child.userData.specialBlockKind === "banner_dye" || child.userData.specialBlockKind === "wall_banner_dye");
    const colors = new Set(dyedMeshes.map((child) => (child as THREE.InstancedMesh).material as THREE.MeshStandardMaterial)
      .map((material) => material.color.getHex()));
    expect(dyedMeshes).toHaveLength(32);
    expect(new Set(dyedMeshes.map((child) => (child as THREE.InstancedMesh).geometry))).toHaveProperty("size", 32);
    expect(colors).toEqual(new Set(expected));
    dispose(root);
  });

  it("does not consume a block when required pack-owned entity resources are absent", () => {
    const root = new THREE.Group();
    const banner = voxel("minecraft:black_banner");
    expect(addResourceSpecialDecor(root, [banner], [texture("banner/banner_base", 64, 64)])).toEqual(new Set());
    expect(root.children).toHaveLength(0);
  });
});

function texture(path: string, width: number, height: number, pixel?: readonly [number, number, number, number]): ResourcePackSpecialTexture {
  return {
    resourceId: `minecraft:entity/${path}`, namespace: "minecraft", texturePath: path,
    archivePath: `assets/minecraft/textures/entity/${path}.png`, width, height, png: png(width, height, pixel),
  };
}

function png(width: number, height: number, pixel: readonly [number, number, number, number] = [255, 255, 255, 255]): Uint8Array {
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width, false);
  new DataView(header.buffer).setUint32(4, height, false);
  header.set([8, 6, 0, 0, 0], 8);
  const scanlines = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) scanlines.set(pixel, y * (1 + width * 4) + 1 + x * 4);
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

function dispose(root: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const material = object.material as THREE.MeshStandardMaterial;
    materials.add(material);
    if (material.map) textures.add(material.map);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

function expectOwnedResources(root: THREE.Group, expectedMaterials: number, expectedTextures: number): void {
  const ownedMaterials = new Set<THREE.Material>();
  const ownedTextures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.userData.ownedMaterial as THREE.Material | undefined;
    const texture = object.userData.ownedTexture as THREE.Texture | undefined;
    if (material) ownedMaterials.add(material);
    if (texture) ownedTextures.add(texture);
  });
  expect(ownedMaterials.size).toBe(expectedMaterials);
  expect(ownedTextures.size).toBe(expectedTextures);
}
