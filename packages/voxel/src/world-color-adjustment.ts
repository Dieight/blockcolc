export interface WorldColorAdjustment { saturation: number; brightness: number; contrast: number }
export const DEFAULT_WORLD_COLOR: Readonly<WorldColorAdjustment> = Object.freeze({ saturation: 100, brightness: 100, contrast: 100 });
export function normalizeWorldColor(input: unknown): WorldColorAdjustment {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const bounded = (key: string, min: number, max: number) => typeof value[key] === 'number' && Number.isFinite(value[key])
    ? Math.round(Math.max(min, Math.min(max, value[key] as number))) : 100;
  return { saturation: bounded('saturation', 50, 150), brightness: bounded('brightness', 80, 120), contrast: bounded('contrast', 80, 120) };
}
export function worldColorIsNeutral(value: WorldColorAdjustment): boolean {
  return value.saturation === 100 && value.brightness === 100 && value.contrast === 100;
}
