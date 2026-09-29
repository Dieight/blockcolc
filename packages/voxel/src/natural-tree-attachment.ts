import * as THREE from "three";

export interface NaturalTreeAttachmentTransformInput {
  baseMatrix: THREE.Matrix4;
  pivot: readonly [number, number, number];
  axisAngle: number;
  swayAngle: number;
  hostVisible: boolean;
}

/** Reapply the host's root-pivot sway and quality visibility to one attached decoration. */
export function naturalTreeAttachmentMatrix(input: NaturalTreeAttachmentTransformInput): THREE.Matrix4 {
  if (!input.hostVisible) return new THREE.Matrix4().makeScale(0, 0, 0);
  const axis = new THREE.Vector3(Math.cos(input.axisAngle), 0, Math.sin(input.axisAngle));
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromAxisAngle(axis, input.swayAngle),
  );
  const pivotTo = new THREE.Matrix4().makeTranslation(...input.pivot);
  const pivotBack = new THREE.Matrix4().makeTranslation(-input.pivot[0], -input.pivot[1], -input.pivot[2]);
  return pivotTo.multiply(rotation).multiply(pivotBack).multiply(input.baseMatrix);
}
