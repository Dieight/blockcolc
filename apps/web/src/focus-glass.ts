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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Maps the product's 0-100 "clarity" setting to a complete glass material.
 * The eased curve keeps the middle useful while making the frosted and clear
 * endpoints visually distinct. Clear glass retains a small dimming tint so
 * timer labels remain readable over the media-rich voxel world.
 */
export function focusGlassMaterialFor(transparency: number): FocusGlassMaterial {
  const progress = clamp(transparency, 0, 100) / 100;
  const eased = progress * progress * (3 - 2 * progress);
  const blur = 30 - 27 * eased;

  return {
    lightAlpha: (0.96 - 0.90 * eased).toFixed(3),
    darkAlpha: (0.94 - 0.82 * eased).toFixed(3),
    blur: `${Number(blur.toFixed(1))}px`,
    saturation: (1.05 + 0.40 * eased).toFixed(2),
    brightness: (1 + 0.05 * eased).toFixed(2),
    highlightAlpha: (0.18 - 0.13 * eased).toFixed(3),
    accentAlpha: (0.06 - 0.04 * eased).toFixed(3),
    shadowAlpha: (0.22 + 0.10 * eased).toFixed(3),
  };
}
