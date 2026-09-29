import * as THREE from "three";

/** Ambient flower batches stay out of both ordinary and atlas-cutout shadow passes. */
export function disableNaturalFlowerShadowCasting(
  mesh: THREE.InstancedMesh,
  cutoutShadowMeshes: Set<THREE.Mesh>,
): void {
  mesh.castShadow = false;
  cutoutShadowMeshes.delete(mesh);
  const depthMaterial = mesh.userData.ownedDepthMaterial as THREE.Material | undefined;
  if (depthMaterial) {
    depthMaterial.dispose();
    delete mesh.userData.ownedDepthMaterial;
    mesh.customDepthMaterial = undefined;
  }
}
