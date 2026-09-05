export type TerrainProfileStyle = 'natural-valley' | 'classic-island' | 'ocean-island';
export type TerrainProfileGeneration = 1 | 2 | 3 | 4;

export interface ClassicIslandTerrainProfile {
  kind: 'classic-island';
  cellSize: 1 | 2;
}

export interface NaturalValleyTerrainProfile {
  kind: 'natural-valley';
  nearExtent: number;
  middleExtent: number;
  farExtent: number;
  farFineExtent: number;
  refinedFar: boolean;
  farCellSize: 16;
}

export interface OceanIslandTerrainProfile {
  kind: 'ocean-island';
  mainRadius: number;
  beach: number;
  nearExtent: number;
  middleExtent: number;
  farExtent: number;
  farCellSize: 32;
  strait: 60;
}

export type TerrainGenerationProfile = ClassicIslandTerrainProfile | NaturalValleyTerrainProfile | OceanIslandTerrainProfile;

const alignTo = (value: number, multiple: number): number => Math.ceil(value / multiple) * multiple;

/** Environment shape budgets only; sampling and mesh closure stay shared. */
export function terrainGenerationProfile(
  style: TerrainProfileStyle,
  coreRadius: number,
  generation: TerrainProfileGeneration,
  refinedFarOverride?: boolean,
): TerrainGenerationProfile {
  if (style === 'classic-island') {
    return { kind: style, cellSize: coreRadius > 70 ? 2 : 1 };
  }
  const nearExtent = alignTo(Math.max(80, coreRadius + 28), 8);
  if (style === 'ocean-island') {
    const mainRadius = coreRadius * 1.55 + 20;
    const beach = Math.max(12, Math.round(mainRadius * 0.22));
    const maximumMainCoastReach = mainRadius * 1.2 + beach * 1.18 + 16;
    const middleExtent = alignTo(Math.max(160, nearExtent + 64, maximumMainCoastReach), 16);
    return {
      kind: style,
      mainRadius,
      beach,
      nearExtent,
      middleExtent,
      farExtent: alignTo(Math.max(1_200, middleExtent + 80, coreRadius * 5), 16),
      farCellSize: 32,
      strait: 60,
    };
  }
  const middleExtent = alignTo(Math.max(160, nearExtent + 64), 16);
  const farExtent = alignTo(Math.max(720, middleExtent + 80, coreRadius * 4.5), 16);
  const refinedFar = refinedFarOverride ?? (generation === 4 && farExtent <= 1_024);
  return {
    kind: style,
    nearExtent,
    middleExtent,
    farExtent,
    farFineExtent: refinedFar ? alignTo(Math.max(middleExtent + 96, middleExtent * 1.4), 16) : middleExtent,
    refinedFar,
    farCellSize: 16,
  };
}
