import { describe, expect, it, vi } from 'vitest';
import { MeshStandardMaterial } from 'three';
import { releaseOwnedMaterials } from '../src/owned-mesh-materials';

describe('mesh-owned material lifetime', () => {
  it('releases all terrain clones once, leaving shared palette materials alive', () => {
    const shared = new MeshStandardMaterial(), pack = new MeshStandardMaterial(), side = shared.clone();
    const sharedDispose = vi.spyOn(shared, 'dispose'), packDispose = vi.spyOn(pack, 'dispose'), sideDispose = vi.spyOn(side, 'dispose');
    const cleanPatch = vi.fn();
    releaseOwnedMaterials({ ownedMaterial: side, ownedMaterials: [pack, side, pack] }, cleanPatch);
    expect(sharedDispose).not.toHaveBeenCalled();
    expect(packDispose).toHaveBeenCalledTimes(1); expect(sideDispose).toHaveBeenCalledTimes(1);
    expect(cleanPatch).toHaveBeenCalledTimes(2);
    shared.dispose();
  });
  it('handles palette-only meshes without assuming ownership', () => {
    const cleanPatch = vi.fn(); releaseOwnedMaterials({}, cleanPatch);
    expect(cleanPatch).not.toHaveBeenCalled();
  });
});
