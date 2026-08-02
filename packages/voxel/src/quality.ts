export type QualityTier = "low" | "balanced" | "high";

export interface QualityProfile {
  tier: QualityTier;
  maxPixelRatio: number;
  shadowMapSize: number;
  maxLocalLights: number;
  maxGlowSprites: number;
  weatherDensity: number;
  starCount: number;
  cloudLobes: number;
}

export interface QualitySignals {
  devicePixelRatio: number;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
  maxTextureSize?: number;
  voxelCount?: number;
}

export const QUALITY_PROFILES: Readonly<Record<QualityTier, QualityProfile>> = {
  low: { tier: "low", maxPixelRatio: 1.25, shadowMapSize: 512, maxLocalLights: 0, maxGlowSprites: 0, weatherDensity: 0.45, starCount: 280, cloudLobes: 2 },
  balanced: { tier: "balanced", maxPixelRatio: 1.5, shadowMapSize: 1024, maxLocalLights: 2, maxGlowSprites: 1, weatherDensity: 0.72, starCount: 560, cloudLobes: 3 },
  high: { tier: "high", maxPixelRatio: 2, shadowMapSize: 1536, maxLocalLights: 2, maxGlowSprites: 2, weatherDensity: 1, starCount: 960, cloudLobes: 4 },
};

export function selectQualityTier(signals: QualitySignals): QualityTier {
  if ((signals.voxelCount ?? 0) > 100_000 || (signals.maxTextureSize ?? 4096) < 4096
    || (signals.hardwareConcurrency ?? 4) <= 2 || (signals.deviceMemoryGb ?? 4) <= 2) return "low";
  if ((signals.voxelCount ?? 0) > 55_000 || (signals.hardwareConcurrency ?? 8) <= 4
    || (signals.deviceMemoryGb ?? 8) <= 4 || signals.devicePixelRatio > 2.5) return "balanced";
  return "high";
}

export function lowerQualityTier(tier: QualityTier): QualityTier {
  return tier === "high" ? "balanced" : "low";
}
