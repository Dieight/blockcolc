import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_COLOR, normalizeWorldColor, worldColorIsNeutral } from '../src/world-color-adjustment';

describe('world colour adjustment', () => {
  it('keeps old/default preferences neutral, including malformed inputs', () => {
    for (const input of [undefined, null, [], 'bright', { saturation: NaN, brightness: Infinity, contrast: '120' }]) {
      expect(normalizeWorldColor(input)).toEqual(DEFAULT_WORLD_COLOR);
      expect(worldColorIsNeutral(normalizeWorldColor(input))).toBe(true);
    }
  });
  it('clamps bounded perceptual controls without altering weather or quality', () => {
    expect(normalizeWorldColor({ saturation: 250, brightness: -2, contrast: 119.6 })).toEqual({ saturation: 150, brightness: 80, contrast: 120 });
    expect(worldColorIsNeutral(normalizeWorldColor({ saturation: 75 }))).toBe(false);
  });
});
