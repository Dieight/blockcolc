import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { disableNaturalFlowerShadowCasting } from "../src/natural-flower-shadow";

describe("natural flower shadow policy", () => {
  it("removes ambient pack flowers from ordinary and atlas-cutout shadow passes", () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 1);
    const depthMaterial = new THREE.MeshDepthMaterial();
    const dispose = vi.spyOn(depthMaterial, "dispose");
    mesh.castShadow = true;
    mesh.customDepthMaterial = depthMaterial;
    mesh.userData.ownedDepthMaterial = depthMaterial;
    const cutoutShadowMeshes = new Set<THREE.Mesh>([mesh]);

    disableNaturalFlowerShadowCasting(mesh, cutoutShadowMeshes);

    expect(mesh.castShadow).toBe(false);
    expect(cutoutShadowMeshes.has(mesh)).toBe(false);
    expect(mesh.customDepthMaterial).toBeUndefined();
    expect(mesh.userData.ownedDepthMaterial).toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
});
