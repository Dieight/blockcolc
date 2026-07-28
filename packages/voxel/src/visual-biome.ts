export type VisualBiomeColormapKind = "grass" | "foliage";

export interface DecodedVisualBiomeColormap {
  kind: VisualBiomeColormapKind;
  width: 256;
  height: 256;
  rgba: Uint8Array;
}

export interface VisualBiomePalette {
  grass: number;
  foliage: number;
  temperature: number;
  downfall: number;
  source: "original" | "resource-pack";
}

export const TEMPERATE_VILLAGE_CLIMATE = Object.freeze({ temperature: 0.8, downfall: 0.4 });
export const ORIGINAL_VISUAL_BIOME_COLORS = Object.freeze({ grass: 0x78a95a, foliage: 0x619a52 });

/**
 * V3 deliberately uses one calm temperate-village climate for the settlement.
 * This makes pack colormaps useful without adding location permission, stored
 * biome facts, per-block noise, or colors that change when projects are added.
 */
export function createVisualBiomePalette(
  colormaps: readonly DecodedVisualBiomeColormap[],
  climate = TEMPERATE_VILLAGE_CLIMATE,
): VisualBiomePalette {
  const temperature = clamp01(climate.temperature);
  const downfall = clamp01(climate.downfall);
  const grass = colormaps.find((colormap) => colormap.kind === "grass");
  const foliage = colormaps.find((colormap) => colormap.kind === "foliage");
  return {
    grass: grass ? sampleMinecraftColormap(grass, temperature, downfall) : ORIGINAL_VISUAL_BIOME_COLORS.grass,
    foliage: foliage ? sampleMinecraftColormap(foliage, temperature, downfall) : ORIGINAL_VISUAL_BIOME_COLORS.foliage,
    temperature,
    downfall,
    source: grass || foliage ? "resource-pack" : "original",
  };
}

export function sampleMinecraftColormap(
  colormap: DecodedVisualBiomeColormap,
  temperature: number,
  downfall: number,
): number {
  if (colormap.rgba.byteLength !== 256 * 256 * 4) throw new Error("Visual biome colormap must contain exactly 256x256 RGBA pixels.");
  const safeTemperature = clamp01(temperature);
  const humidTemperature = clamp01(downfall) * safeTemperature;
  const x = Math.max(0, Math.min(255, Math.floor((1 - safeTemperature) * 255)));
  const y = Math.max(0, Math.min(255, Math.floor((1 - humidTemperature) * 255)));
  const offset = (y * 256 + x) * 4;
  return (colormap.rgba[offset]! << 16) | (colormap.rgba[offset + 1]! << 8) | colormap.rgba[offset + 2]!;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
