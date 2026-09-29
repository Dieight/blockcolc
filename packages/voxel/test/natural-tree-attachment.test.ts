import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { naturalTreeAttachmentMatrix } from "../src/natural-tree-attachment";

describe("natural tree attachment transforms", () => {
  const pivot = [3, 5, -2] as const;
  const baseMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(3.8, 6.4, -2),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
    new THREE.Vector3(2.2, 2.2, 2.2),
  );

  it("stays hidden across LOD base-matrix replacement and restores with host sway", () => {
    const hidden = naturalTreeAttachmentMatrix({ baseMatrix, pivot, axisAngle: 0.7, swayAngle: 0.2, hostVisible: false });
    const hiddenPosition = new THREE.Vector3().setFromMatrixPosition(hidden);
    expect(hiddenPosition.toArray()).toEqual([0, 0, 0]);
    expect(new THREE.Vector3(1, 1, 1).applyMatrix4(hidden).toArray()).toEqual([0, 0, 0]);

    // LOD swaps the source instance transform; reapplying the same visibility rule must not revive it.
    const silhouetteBase = baseMatrix.clone().multiply(new THREE.Matrix4().makeTranslation(0.1, 0, 0));
    const stillHidden = naturalTreeAttachmentMatrix({ baseMatrix: silhouetteBase, pivot, axisAngle: 0.7, swayAngle: 0.2, hostVisible: false });
    expect(new THREE.Vector3(1, 1, 1).applyMatrix4(stillHidden).toArray()).toEqual([0, 0, 0]);

    const restored = naturalTreeAttachmentMatrix({ baseMatrix: silhouetteBase, pivot, axisAngle: 0.7, swayAngle: 0, hostVisible: true });
    expect(restored.elements).toEqual(silhouetteBase.elements);
    const swayed = naturalTreeAttachmentMatrix({ baseMatrix: silhouetteBase, pivot, axisAngle: 0.7, swayAngle: 0.2, hostVisible: true });
    const originalPosition = new THREE.Vector3().setFromMatrixPosition(silhouetteBase);
    const swayPosition = new THREE.Vector3().setFromMatrixPosition(swayed);
    expect(swayPosition.distanceTo(new THREE.Vector3(...pivot))).toBeCloseTo(originalPosition.distanceTo(new THREE.Vector3(...pivot)), 10);
    expect(swayPosition.distanceTo(originalPosition)).toBeGreaterThan(0.01);
  });
});
