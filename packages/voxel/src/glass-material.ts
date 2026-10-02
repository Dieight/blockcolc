/** Shared CSS fallback/GPU material parameters, without importing Three or the world module. */
export interface GlassSurfacePreference {
  enabled: boolean;
  /** Persisted product meaning: 0 = frosted, 100 = clear. */
  clarity: number;
  theme: 'light' | 'dark';
  reducedTransparency: boolean;
}

export function glassMaterialFor(clarity: number) {
  const value = Number.isFinite(clarity) ? Math.max(0, Math.min(100, clarity)) / 100 : .5;
  const eased = value * value * (3 - 2 * value);
  return {
    lightAlpha: .9 - .825 * Math.pow(eased, .7),
    darkAlpha: .9 - .77 * Math.pow(eased, .85),
    blur: 32 - 30 * eased,
    saturation: 1.08 + .18 * eased,
    brightness: 1.03,
    highlightAlpha: .13 - .065 * eased,
    accentAlpha: .018 + .012 * eased,
    shadowAlpha: .12 + .06 * eased,
  };
}

export interface GlassRegion { x: number; y: number; width: number; height: number }
export function glassRegionFor(width: number, height: number, bottom: number, right: number): GlassRegion | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const fraction = (v: number) => Number.isFinite(v) ? Math.max(0, Math.min(.75, v)) : 0;
  const w = Math.floor(width), h = Math.floor(height);
  if (fraction(right) > 0) {
    const band = Math.max(1, Math.min(w, Math.ceil(w * fraction(right))));
    return { x: w - band, y: 0, width: band, height: h };
  }
  if (fraction(bottom) > 0) return { x: 0, y: 0, width: w, height: Math.max(1, Math.ceil(h * fraction(bottom))) };
  return null;
}
