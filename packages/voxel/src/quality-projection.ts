import { selectQualityTierForLighting, type QualitySignals, type QualityTier, type VoxelLightingQuality } from "./quality";

export interface QualityProjectionState {
  preference: VoxelLightingQuality;
  tier: QualityTier;
}

export interface QualityProjectionAttempt {
  state: QualityProjectionState;
  succeeded: boolean;
  noOp: boolean;
}

/** Geometry counts describe a scene, not a device's ability to draw it. Changing
 * tiers creates new GL programs, so only sustained measured cost can justify it.
 * A 48-frame window also prevents two expensive tier changes in one short drag. */
export function shouldDowngradeQuality(sample: {
  calls: number; triangles: number; refreshedShadow: boolean;
  interactionSamples: number; interactionP95Ms: number | null;
}): boolean {
  return sample.interactionSamples >= 48 && sample.interactionP95Ms !== null && sample.interactionP95Ms > 22;
}

/** Keep the accepted preference separate from a conservative adaptive ceiling. */
export function resolveCappedQualityTier(
  signals: QualitySignals,
  preference: VoxelLightingQuality,
  adaptiveCap: QualityTier,
): QualityTier {
  const requested = selectQualityTierForLighting(signals, preference);
  const rank: Record<QualityTier, number> = { low: 0, balanced: 1, high: 2 };
  return rank[requested] <= rank[adaptiveCap] ? requested : adaptiveCap;
}

/** A failed projection does not consume the request; invoking it again retries. */
export function attemptQualityProjection(
  current: QualityProjectionState,
  preference: VoxelLightingQuality,
  tier: QualityTier,
  apply: (tier: QualityTier) => boolean,
): QualityProjectionAttempt {
  if (preference === current.preference) return { state: current, succeeded: true, noOp: true };
  if (tier === current.tier) return { state: { preference, tier }, succeeded: true, noOp: true };
  if (!apply(tier)) return { state: current, succeeded: false, noOp: false };
  return { state: { preference, tier }, succeeded: true, noOp: false };
}
