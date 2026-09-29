import * as THREE from "three";
import type { BlueprintVoxel } from "./blueprint";

const FLOWER_COLORS: Readonly<Record<string, number>> = {
  allium: 0xb46bcc,
  azure_bluet: 0xe3d5d0,
  blue_orchid: 0x568cb7,
  cornflower: 0x477dbb,
  dandelion: 0xe5c947,
  lily_of_the_valley: 0xe8e8d8,
  orange_tulip: 0xe07838,
  oxeye_daisy: 0xe4ded2,
  pink_tulip: 0xd77c9a,
  poppy: 0xc84a43,
  red_tulip: 0xc54a47,
  torchflower: 0xe27d3e,
  white_tulip: 0xe2d8cd,
  wither_rose: 0x382b37,
};

/** Deliberate four-species mapping for world-owned natural flowers; every ID is legal and has an original fallback. */
export const NATURAL_FLOWER_SOURCE_BLOCK_IDS = Object.freeze([
  "minecraft:poppy",
  "minecraft:dandelion",
  "minecraft:azure_bluet",
  "minecraft:oxeye_daisy",
] as const);

export function naturalFlowerSourceBlockId(variant: number): typeof NATURAL_FLOWER_SOURCE_BLOCK_IDS[number] {
  return NATURAL_FLOWER_SOURCE_BLOCK_IDS[((Math.trunc(variant) % NATURAL_FLOWER_SOURCE_BLOCK_IDS.length)
    + NATURAL_FLOWER_SOURCE_BLOCK_IDS.length) % NATURAL_FLOWER_SOURCE_BLOCK_IDS.length]!;
}

/** Original, pack-free crossed-plane approximations for common vanilla flower blocks. */
export function addOriginalFlowerShapes(
  root: THREE.Group,
  voxels: readonly BlueprintVoxel[],
  transformForVoxel?: (voxel: BlueprintVoxel) => THREE.Matrix4 | undefined,
): Set<BlueprintVoxel> {
  const entries = new Map<string, BlueprintVoxel[]>();
  for (const voxel of voxels) {
    const path = voxel.sourceBlockId?.toLowerCase().replace(/^minecraft:/, "");
    if (!path || FLOWER_COLORS[path] === undefined) continue;
    const list = entries.get(path) ?? [];
    list.push(voxel);
    entries.set(path, list);
  }
  const handled = new Set<BlueprintVoxel>();
  for (const [path, placements] of entries) {
    const color = FLOWER_COLORS[path]!;
    const geometry = makeFlowerGeometry(color);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide,
      roughness: 0.88, metalness: 0 });
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    mesh.name = `blockcolc-original-flower-${path}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.originalShape = "crossed-flower-approximation";
    mesh.userData.sourceBlockId = `minecraft:${path}`;
    mesh.userData.ownedMaterial = material;
    const matrix = new THREE.Matrix4();
    placements.forEach((voxel, index) => {
      const transformed = transformForVoxel?.(voxel);
      if (transformed) mesh.setMatrixAt(index, transformed);
      else {
        matrix.makeTranslation(voxel.x, voxel.y, voxel.z);
        mesh.setMatrixAt(index, matrix);
      }
      handled.add(voxel);
    });
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
  }
  return handled;
}

function makeFlowerGeometry(petalColor: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const addBox = (size: readonly [number, number, number], center: readonly [number, number, number], color: number,
    rotationY = 0, rotationZ = 0): void => {
    const box = new THREE.BoxGeometry(...size).toNonIndexed();
    const transform = new THREE.Matrix4().makeRotationZ(rotationZ).multiply(new THREE.Matrix4().makeRotationY(rotationY));
    transform.setPosition(...center);
    box.applyMatrix4(transform);
    const attribute = box.getAttribute("position");
    const rgb = new THREE.Color(color);
    for (let index = 0; index < attribute.count; index += 1) {
      positions.push(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
      colors.push(rgb.r, rgb.g, rgb.b);
    }
    box.dispose();
  };
  addBox([0.075, 0.58, 0.075], [0, -0.16, 0], 0x527b43);
  addBox([0.26, 0.065, 0.12], [-0.1, -0.25, 0], 0x668b4c, 0, -0.24);
  addBox([0.26, 0.065, 0.12], [0.1, -0.09, 0], 0x668b4c, 0, 0.24);
  // Two crossed, thin petal planes read as a flower from all camera azimuths.
  addBox([0.42, 0.43, 0.035], [0, 0.19, 0], petalColor, 0, 0.03);
  addBox([0.42, 0.43, 0.035], [0, 0.19, 0], petalColor, Math.PI / 2, -0.03);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
