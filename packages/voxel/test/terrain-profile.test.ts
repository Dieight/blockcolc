import { describe, expect, it } from 'vitest';
import { terrainGenerationProfile } from '../src/terrain-profile';

describe('terrain generation profiles', () => {
  it('keeps natural-valley LOD boundaries aligned and enables the v4 fine band', () => {
    const profile = terrainGenerationProfile('natural-valley', 60, 4);
    expect(profile.kind).toBe('natural-valley');
    if (profile.kind !== 'natural-valley') return;
    expect(profile.nearExtent % 8).toBe(0);
    expect(profile.middleExtent % 16).toBe(0);
    expect(profile.farFineExtent % 16).toBe(0);
    expect(profile.farExtent % 16).toBe(0);
    expect(profile.nearExtent).toBeLessThan(profile.middleExtent);
    expect(profile.middleExtent).toBeLessThan(profile.farFineExtent);
    expect(profile.farFineExtent).toBeLessThan(profile.farExtent);
  });

  it('keeps ocean coast cells out of the coarse 32-unit water ring', () => {
    const profile = terrainGenerationProfile('ocean-island', 60, 4);
    expect(profile.kind).toBe('ocean-island');
    if (profile.kind !== 'ocean-island') return;
    const coastReach = profile.mainRadius * 1.2 + profile.beach * 1.18 + 16;
    expect(profile.middleExtent).toBeGreaterThanOrEqual(coastReach);
    expect(profile.middleExtent % 16).toBe(0);
    expect(profile.farExtent).toBeGreaterThanOrEqual(1_200);
    expect(profile.farCellSize).toBe(32);
    expect(profile.strait).toBe(60);
  });

  it('keeps classic island density independent from other environment budgets', () => {
    expect(terrainGenerationProfile('classic-island', 70, 4)).toEqual({ kind: 'classic-island', cellSize: 1 });
    expect(terrainGenerationProfile('classic-island', 71, 4)).toEqual({ kind: 'classic-island', cellSize: 2 });
  });
});
