import { glassMaterialFor } from '@blockcolc/voxel/glass-material';

export interface FocusGlassMaterial {
  lightAlpha: string;
  darkAlpha: string;
  blur: string;
  saturation: string;
  brightness: string;
  highlightAlpha: string;
  accentAlpha: string;
  shadowAlpha: string;
}

/**
 * Maps the product's 0-100 "clarity" setting to a complete glass material.
 * The eased curve keeps the middle useful while making the frosted and clear
 * endpoints visually distinct. Clear glass retains a small dimming tint so
 * timer labels remain readable over the media-rich voxel world.
 */
export function focusGlassMaterialFor(transparency: number): FocusGlassMaterial {
  const material = glassMaterialFor(transparency);
  return {
    lightAlpha: material.lightAlpha.toFixed(3),
    darkAlpha: material.darkAlpha.toFixed(3),
    blur: `${Number(material.blur.toFixed(1))}px`,
    saturation: material.saturation.toFixed(2),
    brightness: material.brightness.toFixed(2),
    highlightAlpha: material.highlightAlpha.toFixed(3),
    accentAlpha: material.accentAlpha.toFixed(3),
    shadowAlpha: material.shadowAlpha.toFixed(3),
  };
}
