import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  advanceGlassRaindrops,
  MAX_GLASS_RAINDROPS,
  MinimalPanelWeatherOverlay,
  shouldRenderMinimalPanelWeather,
  type GlassRaindrop,
} from './MinimalPanelWeatherOverlay';

describe('minimal panel weather overlay', () => {
  it('has no layer or animation source for clear and non-rain weather', () => {
    for (const kind of ['clear', 'cloudy', 'mist', 'snow'] as const) {
      expect(shouldRenderMinimalPanelWeather(true, { kind })).toBe(false);
      expect(renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind }}/>)).toBe('');
    }
    expect(shouldRenderMinimalPanelWeather(false, { kind: 'rain' })).toBe(false);
    expect(renderToStaticMarkup(<MinimalPanelWeatherOverlay active={false} weather={{ kind: 'rain' }}/>)).toBe('');
  });

  it('renders one inert canvas for sparse rain and does not infer thunder from ordinary rain', () => {
    const html = renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind: 'rain', precipitationIntensity: 0.2 }}/>);
    expect(html).toContain('class="minimal-panel-weather-overlay"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-thunderstorm="false"');
    expect(html.match(/<canvas/g)).toHaveLength(1);
    expect(shouldRenderMinimalPanelWeather(true, { kind: 'rain', precipitationIntensity: -4 })).toBe(false);
  });

  it('allows a lightning signal only when the caller explicitly identifies a thunderstorm', () => {
    const ordinaryRain = renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind: 'rain' }}/>);
    const thunderstorm = renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind: 'rain', thunderstorm: true }}/>);
    const unrelatedThunderFlag = renderToStaticMarkup(<MinimalPanelWeatherOverlay active weather={{ kind: 'cloudy', thunderstorm: true }}/>);
    expect(ordinaryRain).toContain('data-thunderstorm="false"');
    expect(thunderstorm).toContain('data-thunderstorm="true"');
    expect(unrelatedThunderFlag).toBe('');
  });

  it('lets a fresh bead settle, then slide under gravity with glass drag', () => {
    const bead: GlassRaindrop = { x: 40, y: 12, vx: 2, vy: 0, radius: 2, age: 0 };
    const initial = advanceGlassRaindrops([bead], 0.05, 240)[0];
    expect(initial.y).toBe(bead.y);
    const settled = advanceGlassRaindrops([initial], 0.05, 240)[0];
    expect(settled.y).toBe(initial.y);
    const sliding = advanceGlassRaindrops([settled], 0.05, 240)[0];
    expect(sliding.y).toBeGreaterThan(initial.y);
    expect(sliding.vy).toBeGreaterThan(0);
    expect(sliding.vy).toBeLessThan(TERMINAL_SPEED_LIMIT);
    expect(sliding.radius).toBeGreaterThan(bead.radius);
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
});

const TERMINAL_SPEED_LIMIT = 22;
