import { describe, expect, it } from 'vitest';
import { focusGlassMaterialFor } from './focus-glass';

describe('focusGlassMaterialFor', () => {
  it('keeps the frosted and clear endpoints visibly distinct', () => {
    expect(focusGlassMaterialFor(0)).toEqual({
      lightAlpha: '0.960',
      darkAlpha: '0.940',
      blur: '30px',
      saturation: '1.05',
      brightness: '1.00',
      highlightAlpha: '0.180',
      accentAlpha: '0.060',
      shadowAlpha: '0.220',
    });
    expect(focusGlassMaterialFor(100)).toEqual({
      lightAlpha: '0.060',
      darkAlpha: '0.120',
      blur: '3px',
      saturation: '1.45',
      brightness: '1.05',
      highlightAlpha: '0.050',
      accentAlpha: '0.020',
      shadowAlpha: '0.320',
    });
  });

  it('uses an eased midpoint and clamps invalid preference values', () => {
    expect(focusGlassMaterialFor(50)).toMatchObject({ darkAlpha: '0.530', blur: '16.5px' });
    expect(focusGlassMaterialFor(-1)).toEqual(focusGlassMaterialFor(0));
    expect(focusGlassMaterialFor(101)).toEqual(focusGlassMaterialFor(100));
  });
});
