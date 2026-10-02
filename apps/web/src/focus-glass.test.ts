import { describe, expect, it } from 'vitest';
import { focusGlassMaterialFor } from './focus-glass';

describe('focusGlassMaterialFor', () => {
  it('keeps the frosted and clear endpoints visibly distinct', () => {
    expect(focusGlassMaterialFor(0)).toEqual({
      lightAlpha: '0.900',
      darkAlpha: '0.900',
      blur: '32px',
      saturation: '1.08',
      brightness: '1.03',
      highlightAlpha: '0.130',
      accentAlpha: '0.018',
      shadowAlpha: '0.120',
    });
    expect(focusGlassMaterialFor(100)).toEqual({
      lightAlpha: '0.075',
      darkAlpha: '0.130',
      blur: '2px',
      saturation: '1.26',
      brightness: '1.03',
      highlightAlpha: '0.065',
      accentAlpha: '0.030',
      shadowAlpha: '0.180',
    });
  });

  it('uses an eased midpoint and clamps invalid preference values', () => {
    expect(focusGlassMaterialFor(50)).toMatchObject({ darkAlpha: '0.473', lightAlpha: '0.392', blur: '17px' });
    expect(focusGlassMaterialFor(-1)).toEqual(focusGlassMaterialFor(0));
    expect(focusGlassMaterialFor(101)).toEqual(focusGlassMaterialFor(100));
  });
});
