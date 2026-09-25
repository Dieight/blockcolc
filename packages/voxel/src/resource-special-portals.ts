import { decodeResourcePackSpecialTexture, type ResourcePackSpecialTexture } from "@tomato-clock/resource-pack";
import * as THREE from "three";
import type { BlueprintVoxel } from "./blueprint";

const PORTAL_TEXTURE_ID = "minecraft:entity/end_portal/end_portal";

/**
 * Java 26.3 renders these as block entities, not ordinary JSON block models.
 * The end portal uses a 0.375-high cube translated 0.375 above the block base;
 * the gateway uses a full cube. Portal sky/projective effects are not simulated.
 */
export function addResourceSpecialPortals(
  root: THREE.Group,
  voxels: readonly BlueprintVoxel[],
  specialTextures: readonly ResourcePackSpecialTexture[],
): Set<BlueprintVoxel> {
  const portal = voxels.filter((voxel) => voxel.sourceBlockId === "minecraft:end_portal");
  const gateway = voxels.filter((voxel) => voxel.sourceBlockId === "minecraft:end_gateway");
  if (portal.length === 0 && gateway.length === 0) return new Set();
  const source = specialTextures.find((texture) => texture.resourceId === PORTAL_TEXTURE_ID);
  if (!source) return new Set();
  const rgba = decodeResourcePackSpecialTexture(source);
  const texture = new THREE.DataTexture(rgba, source.width, source.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({ map: texture, color: 0xffffff, side: THREE.DoubleSide });
  material.name = "blockcolc-java-end-portal";
  let textureOwnerAssigned = false;
  const handled = new Set<BlueprintVoxel>();
  for (const [kind, entries, height, centerOffset] of [
    ["end_portal", portal, 0.375, 0.0625],
    ["end_gateway", gateway, 1, 0],
  ] as const) {
    if (entries.length === 0) continue;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.995, height, 0.995), material, entries.length);
    const matrix = new THREE.Matrix4();
    entries.forEach((voxel, index) => {
      matrix.makeTranslation(voxel.x, voxel.y + centerOffset, voxel.z);
      mesh.setMatrixAt(index, matrix);
      handled.add(voxel);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 12;
    mesh.userData.specialBlockKind = kind;
    if (!textureOwnerAssigned) {
      mesh.userData.ownedMaterial = material;
      mesh.userData.ownedTexture = texture;
      textureOwnerAssigned = true;
    }
    root.add(mesh);
  }
  return handled;
}
