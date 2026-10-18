import * as THREE from 'three';
import { ORIGINAL_VISUAL_BIOME_COLORS, type VisualBiomePalette } from './visual-biome';

export const TERRAIN_SIDE_SHADE = .65;

/** Only independent opaque terrain crops use automatic mip levels. Never
 * apply this policy to the shared block atlas or its animated/alpha routes. */
export function configureTerrainTile(texture: THREE.Texture, maxAnisotropy: number): void {
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.max(1, Math.min(4, maxAnisotropy));
  texture.needsUpdate = true;
}

export function terrainTileColor(blockId: string, tintIndex: number | undefined, palette?: VisualBiomePalette): number {
  return blockId === 'minecraft:grass_block' && tintIndex === 0
    ? palette?.grass ?? ORIGINAL_VISUAL_BIOME_COLORS.grass : 0xffffff;
}
