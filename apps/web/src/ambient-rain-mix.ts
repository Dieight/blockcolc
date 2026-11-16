/** The two full rain recordings share one bounded mix, not two user tracks. */
export const AMBIENT_MAIN_GAIN = .7;
export const RAIN_ASSETS = ['audio/rain-light.ogg', 'audio/rain-heavy.ogg'] as const;
export const rainIntensity = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : .3;

export function rainLayerGains(value: number): readonly [number, number] {
  const intensity = rainIntensity(value);
  const t = Math.max(0, Math.min(1, (intensity - .16) / .68));
  const blend = t * t * (3 - 2 * t);
  const level = .08 + .12 * Math.sqrt(intensity);
  return [level * Math.cos(blend * Math.PI / 2), level * Math.sin(blend * Math.PI / 2)];
}

/** Small provider fluctuations do not pump the mix. A new target glides in;
 * callbacks delayed in the background use elapsed time, not a fixed frame count. */
export class AmbientRainMix {
  private accepted: number | null = null;
  private target: readonly [number, number] = [0, 0];
  private current: [number, number] = [0, 0];
  set(enabled: boolean, value: number | undefined) {
    if (!enabled) { this.accepted = null; this.target = [0, 0]; return; }
    const next = rainIntensity(value);
    if (this.accepted !== null && Math.abs(next - this.accepted) < .025) return;
    this.accepted = next; this.target = rainLayerGains(next);
  }
  step(elapsedMs: number): readonly [number, number] {
    const alpha = 1 - Math.exp(-Math.max(0, Math.min(30_000, Number.isFinite(elapsedMs) ? elapsedMs : 0)) / 900);
    this.current = this.current.map((gain, i) => gain + (this.target[i] - gain) * alpha) as [number, number];
    return this.current;
  }
}
