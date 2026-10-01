import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  advanceGlassRaindrops,
  LIGHTNING_AFTERIMAGE_MS,
  MAX_GLASS_RAINDROPS,
  mergeGlassRaindrops,
  MinimalPanelWeatherOverlay,
  panelLightningOpacity,
  panelRainVisualProfile,
  panelSnowAccumulationProfile,
  shouldRenderMinimalPanelWeather,
  type GlassRaindrop,
} from './MinimalPanelWeatherOverlay';

describe('minimal panel weather overlay', () => {
  it('has no layer or animation source for clear, cloudy, mist, or dry snow', () => {
    for (const kind of ['clear', 'cloudy', 'mist', 'snow'] as const) {
      expect(shouldRenderMinimalPanelWeather(true, { kind, visualPrecipitationIntensity: 0 })).toBe(false);
      expect(renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind, visualPrecipitationIntensity: 0 }}/>)).toBe('');
    }
    expect(shouldRenderMinimalPanelWeather(false, { kind: 'rain', visualPrecipitationIntensity: 0.3 })).toBe(false);
    expect(renderToStaticMarkup(<MinimalPanelWeatherOverlay active={false} weather={{ kind: 'rain', visualPrecipitationIntensity: 0.3 }}/>)).toBe('');
  });

  it('renders a snow canvas while preserving the panel layout', () => {
    const html = renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind: 'snow', visualPrecipitationIntensity: 0.3 }}/>);
    expect(html).toContain('data-weather-kind="snow"');
    expect(html).toContain('data-weather-style="pixel-layered"');
    expect(html.match(/<canvas/g)).toHaveLength(1);
  });

  it('uses four non-linear accumulation tiers with monotonic, bounded depths', () => {
    const samples = [0.01, 0.119, 0.12, 0.339, 0.34, 0.679, 0.68, 1];
    const profiles = samples.map(panelSnowAccumulationProfile);
    expect(profiles.map(profile => profile.tier)).toEqual(['thin', 'thin', 'low', 'low', 'medium', 'medium', 'high', 'high']);
    expect(profiles.map(profile => profile.depthCssPx)).toEqual([3, 3, 7, 7, 12, 12, 20, 20]);
    for (let index = 1; index < profiles.length; index += 1) {
      expect(profiles[index]!.depthCssPx).toBeGreaterThanOrEqual(profiles[index - 1]!.depthCssPx);
    }
    for (const malformed of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      expect(panelSnowAccumulationProfile(malformed)).toEqual({ tier: 'thin', depthCssPx: 3 });
    }
    expect(panelSnowAccumulationProfile(3)).toEqual({ tier: 'high', depthCssPx: 20 });
  });

  it('selects snow depth from the measured amount, without remapping particle visibility again', () => {
    const html = renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind: 'snow',
      precipitationIntensity: 0.05, visualPrecipitationIntensity: 0.7 }}/>);
    expect(html).toContain('data-snow-tier="thin"');
    expect(html).toContain('data-rain-intensity="0.700"');
    const fallback = renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind: 'snow',
      visualPrecipitationIntensity: 0.7 }}/>);
    expect(fallback).toContain('data-snow-tier="high"');
    const rain = renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind: 'rain',
      precipitationIntensity: 1, visualPrecipitationIntensity: 1 }}/>);
    expect(rain).not.toContain('data-snow-tier');
  });

  it('renders one inert canvas for sparse rain and does not infer thunder from ordinary rain', () => {
    const html = renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind: 'rain', precipitationIntensity: 0.2, visualPrecipitationIntensity: 0.2 }}/>);
    expect(html).toContain('class="minimal-panel-weather-overlay"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-thunderstorm="false"');
    expect(html.match(/<canvas/g)).toHaveLength(1);
    expect(shouldRenderMinimalPanelWeather(true, { kind: 'rain', precipitationIntensity: -4, visualPrecipitationIntensity: 0 })).toBe(false);
  });

  it('allows a lightning signal only when the caller explicitly identifies a thunderstorm', () => {
    const ordinaryRain = renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind: 'rain', visualPrecipitationIntensity: 0.2 }}/>);
    const thunderstorm = renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind: 'rain', visualPrecipitationIntensity: 0.2, thunderstorm: true }}/>);
    const unrelatedThunderFlag = renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind: 'cloudy', visualPrecipitationIntensity: 0, thunderstorm: true }}/>);
    expect(ordinaryRain).toContain('data-thunderstorm="false"');
    expect(thunderstorm).toContain('data-thunderstorm="true"');
    expect(unrelatedThunderFlag).toBe('');
  });

  it('leaves a visible lightning afterimage for 1–2 seconds', () => {
    expect(panelLightningOpacity(80)).toBeGreaterThan(0.7);
    expect(panelLightningOpacity(1_000)).toBeGreaterThan(0.2);
    expect(panelLightningOpacity(LIGHTNING_AFTERIMAGE_MS + 1)).toBe(0);
  });

  it('lets a fresh bead settle, then slide under gravity with glass drag', () => {
    const bead: GlassRaindrop = { x: 40, y: 12, vx: 2, vy: 0, radius: 2, age: 0 };
    const initial = advanceGlassRaindrops([bead], 0.05, 240)[0];
    expect(initial.y).toBe(bead.y);
    const settled = advanceGlassRaindrops([initial], 0.05, 240)[0];
    expect(settled.y).toBe(initial.y);
    let pinned = settled;
    for (let index = 0; index < 13; index += 1) pinned = advanceGlassRaindrops([pinned], 0.05, 240)[0];
    expect(pinned.y).toBe(initial.y);
    const sliding = advanceGlassRaindrops([pinned], 0.05, 240)[0];
    expect(sliding.y).toBeGreaterThan(initial.y);
    expect(sliding.vy).toBeGreaterThan(0);
    expect(sliding.vy).toBeLessThan(TERMINAL_SPEED_LIMIT);
    expect(sliding.radius).toBeGreaterThan(bead.radius);
  });

  it('merges colliding beads into one larger and earlier-sliding droplet', () => {
    const merged = mergeGlassRaindrops([
      { x: 20, y: 30, vx: 0, vy: 0, radius: 2, age: 2, holdSeconds: 4 },
      { x: 22, y: 30, vx: 0, vy: 3, radius: 2, age: 1, holdSeconds: 1 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.radius).toBeGreaterThan(2);
    expect(merged[0]!.holdSeconds).toBeLessThan(merged[0]!.age + 0.2);
    expect(merged[0]!.vy).toBe(3);
  });

  it('does not fast-forward a bead through its hold after a suspended frame', () => {
    const bead: GlassRaindrop = { x: 40, y: 12, vx: 0, vy: 0, radius: 2, age: 0, holdSeconds: 2 };
    const next = advanceGlassRaindrops([bead], 60, 240)[0];
    expect(next.age).toBe(0.05);
    expect(next.y).toBe(bead.y);
  });

  it('caps the particle pool and removes drops that have run off the panel', () => {
    const drops = Array.from({ length: MAX_GLASS_RAINDROPS + 5 }, (_, index): GlassRaindrop => ({
      x: index,
      y: index === 0 ? 220 : 0,
      vx: 0,
      vy: 1,
      radius: 2,
      age: 0,
    }));
    const next = advanceGlassRaindrops(drops, 0.05, 200);
    expect(next).toHaveLength(MAX_GLASS_RAINDROPS - 1);
    expect(next.every(drop => drop.y <= 200 + drop.radius * 2)).toBe(true);
  });

  it('uses the renderer projection monotonically and remains bounded under malformed samples', () => {
    const light = panelRainVisualProfile(0.16);
    const heavy = panelRainVisualProfile(1);
    expect(light.maxDrops).toBeGreaterThanOrEqual(2);
    expect(heavy.maxDrops).toBe(MAX_GLASS_RAINDROPS);
    expect(heavy.maxDrops).toBeGreaterThanOrEqual(light.maxDrops);
    expect(panelRainVisualProfile(Number.NaN).maxDrops).toBe(5);
    expect(shouldRenderMinimalPanelWeather(true, { kind: 'rain', visualPrecipitationIntensity: Number.NaN })).toBe(false);
    const malformed = advanceGlassRaindrops([
      { x: Number.NaN, y: 1, vx: 0, vy: 1, radius: 1, age: 0 },
      { x: 2, y: 3, vx: Number.NaN, vy: Number.POSITIVE_INFINITY, radius: 2, age: 0 },
    ], Number.NaN, Number.NaN, Number.NaN);
    expect(malformed).toHaveLength(1);
    expect([malformed[0]!.x, malformed[0]!.y, malformed[0]!.vx, malformed[0]!.vy,
      malformed[0]!.radius, malformed[0]!.age].every(Number.isFinite)).toBe(true);
  });
});

const TERMINAL_SPEED_LIMIT = 22;
