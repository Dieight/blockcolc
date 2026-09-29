/** Night-only ambient fill shared by synthetic and astronomy lighting. */
export interface NightReadabilityState {
  nightFactor: number;
  hemisphereSkyColor: number;
  hemisphereGroundColor: number;
  hemisphereIntensity: number;
  exposure: number;
}

const NIGHT_SKY_FILL = 0x9fb4cc;
const NIGHT_GROUND_FILL = 0x586456;
const NIGHT_HEMISPHERE_INTENSITY = 1.58;
const NIGHT_EXPOSURE = 1.48;

/**
 * Lifts scene readability without changing the ephemeris, direct sun, or sky
 * gradient. `lunarInfluence` is already visibility * illuminated fraction,
 * so moon phase contributes only a small amount over the same no-moon floor.
 */
export function applyNightReadability<T extends NightReadabilityState>(
  state: T,
  lunarInfluence = 0,
): Omit<T, keyof NightReadabilityState> & NightReadabilityState {
  const rawNight = Number.isFinite(state.nightFactor) ? state.nightFactor : 0;
  const night = Math.max(0, Math.min(1, rawNight));
  const amount = smoothstep(0.05, 0.95, night);
  const moon = Number.isFinite(lunarInfluence) ? Math.max(0, Math.min(1, lunarInfluence)) : 0;
  return {
    ...state,
    hemisphereSkyColor: mixColor(state.hemisphereSkyColor, NIGHT_SKY_FILL, amount),
    hemisphereGroundColor: mixColor(state.hemisphereGroundColor, NIGHT_GROUND_FILL, amount),
    hemisphereIntensity: mix(state.hemisphereIntensity, NIGHT_HEMISPHERE_INTENSITY, amount) + moon * amount * 0.04,
    exposure: mix(state.exposure, NIGHT_EXPOSURE, amount) + moon * amount * 0.02,
  } as Omit<T, keyof NightReadabilityState> & NightReadabilityState;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function mixColor(from: number, to: number, amount: number): number {
  const fromR = (from >> 16) & 0xff; const fromG = (from >> 8) & 0xff; const fromB = from & 0xff;
  const toR = (to >> 16) & 0xff; const toG = (to >> 8) & 0xff; const toB = to & 0xff;
  return (Math.round(mix(fromR, toR, amount)) << 16)
    | (Math.round(mix(fromG, toG, amount)) << 8)
    | Math.round(mix(fromB, toB, amount));
}
