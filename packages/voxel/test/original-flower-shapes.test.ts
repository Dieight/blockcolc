import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BlueprintVoxel } from "../src/blueprint";
import { addOriginalFlowerShapes, NATURAL_FLOWER_SOURCE_BLOCK_IDS, naturalFlowerSourceBlockId } from "../src/original-flower-shapes";

const voxel = (sourceBlockId: string, x = 0): BlueprintVoxel => ({
  x, y: 2, z: -1, materialId: "accent", buildOrder: 12, sourceBlockId,
});

describe("original pack-free flower shapes", () => {
  it("uses a fixed legal species registration with a matching whole-flower fallback for every variant", () => {
    expect(NATURAL_FLOWER_SOURCE_BLOCK_IDS).toEqual([
      "minecraft:poppy", "minecraft:dandelion", "minecraft:azure_bluet", "minecraft:oxeye_daisy",
    ]);
    expect([0, 1, 2, 3, 4, -1].map(naturalFlowerSourceBlockId)).toEqual([
      "minecraft:poppy", "minecraft:dandelion", "minecraft:azure_bluet", "minecraft:oxeye_daisy",
      "minecraft:poppy", "minecraft:oxeye_daisy",
    ]);
    const root = new THREE.Group();
    const voxels = NATURAL_FLOWER_SOURCE_BLOCK_IDS.map((sourceBlockId, index) => voxel(sourceBlockId, index));
    expect(addOriginalFlowerShapes(root, voxels)).toEqual(new Set(voxels));
    expect(root.children).toHaveLength(NATURAL_FLOWER_SOURCE_BLOCK_IDS.length);
    for (const child of root.children) {
      const mesh = child as THREE.InstancedMesh;
      expect(mesh.userData.originalShape).toBe("crossed-flower-approximation");
      mesh.geometry.dispose();
      (mesh.userData.ownedMaterial as THREE.Material).dispose();
    }
  });

  it("turns recognized flower fallbacks into bounded crossed-plane silhouettes", () => {
    const root = new THREE.Group();
    const flowers = [voxel("minecraft:poppy"), voxel("minecraft:dandelion", 2), voxel("minecraft:allium", 4)];
    const unknown = voxel("minecraft:blue_ice", 6);
    expect(addOriginalFlowerShapes(root, [...flowers, unknown])).toEqual(new Set(flowers));
    expect(root.children).toHaveLength(3);
    for (const child of root.children) {
      const mesh = child as THREE.InstancedMesh;
      expect(mesh.count).toBe(1);
      expect(mesh.userData.originalShape).toBe("crossed-flower-approximation");
      expect(mesh.geometry.getAttribute("color").count).toBe(mesh.geometry.getAttribute("position").count);
      mesh.geometry.computeBoundingBox();
      expect(mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).y).toBeGreaterThan(0.5);
      expect(mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).x).toBeLessThan(0.8);
      expect((mesh.material as THREE.MeshStandardMaterial).side).toBe(THREE.DoubleSide);
      mesh.geometry.dispose();
      (mesh.userData.ownedMaterial as THREE.Material).dispose();
    }
  });

  it("keeps unsupported and non-vanilla namespaces for their normal legal route", () => {
    const root = new THREE.Group();
    expect(addOriginalFlowerShapes(root, [
      voxel("minecraft:rose_bush"),
      voxel("example:custom_flower"),
      voxel("minecraft:missing_custom_flower"),
    ])).toEqual(new Set());
    expect(root.children).toHaveLength(0);
  });

  it("applies the exact natural placement transform to original fallback batches", () => {
    const root = new THREE.Group();
    const flower = voxel("minecraft:poppy");
    const transform = new THREE.Matrix4().compose(
      new THREE.Vector3(4, 7, -2),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
      new THREE.Vector3(3, 3, 3),
    );
    addOriginalFlowerShapes(root, [flower], () => transform);
    const matrix = new THREE.Matrix4();
    (root.children[0] as THREE.InstancedMesh).getMatrixAt(0, matrix);
    expect(matrix.elements).toEqual(transform.elements);
    const mesh = root.children[0] as THREE.InstancedMesh;
    mesh.geometry.dispose();
    (mesh.userData.ownedMaterial as THREE.Material).dispose();
  });
});
