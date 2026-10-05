import type { Material } from 'three';

/** Only materials created for this mesh; shared palette entries remain alive. */
export function releaseOwnedMaterials(
  data: { ownedMaterial?: Material; ownedMaterials?: readonly Material[] },
  beforeRelease: (material: Material) => void,
): void {
  const owned = new Set(data.ownedMaterials ?? []);
  if (data.ownedMaterial) owned.add(data.ownedMaterial);
  for (const material of owned) { beforeRelease(material); material.dispose(); }
}
