import { describe, expect, it } from 'vitest';
import { clusterEmissivePoints, sunStateForLocalTime } from '../src/lighting';

describe('local sun path', () => {
  it('raises the light at noon and moves it from east to west', () => {
    const dawn = sunStateForLocalTime(new Date(2026, 6, 24, 6));
    const noon = sunStateForLocalTime(new Date(2026, 6, 24, 12));
    const dusk = sunStateForLocalTime(new Date(2026, 6, 24, 18));
    expect(dawn.position[0]).toBeGreaterThan(0);
    expect(dusk.position[0]).toBeLessThan(0);
    expect(noon.position[1]).toBeGreaterThan(dawn.position[1]);
    expect(noon.intensity).toBeGreaterThan(dawn.intensity);
    expect(dawn.sunPosition[1]).toBeCloseTo(0, 6);
    expect(noon.sunPosition[1]).toBeGreaterThan(0);
    expect(noon.moonPosition[1]).toBeLessThan(0);
  });

  it('keeps night readable while remaining darker than daylight', () => {
    const night = sunStateForLocalTime(new Date(2026, 6, 24, 2));
    expect(night.intensity).toBeLessThan(0.72);
    expect(night.intensity).toBeGreaterThanOrEqual(0.65);
    expect(night.nightFactor).toBeGreaterThan(0.95);
    expect(night.exposure).toBeGreaterThanOrEqual(1.2);
    expect(night.hemisphereIntensity).toBeGreaterThanOrEqual(1.05);
    expect(night.moonVisibility).toBeGreaterThan(0.95);
    expect(night.starVisibility).toBeGreaterThan(0.95);
    expect(night.sunVisibility).toBeLessThan(0.05);
  });

  it('coordinates warm horizon light, sky, environment and exposure', () => {
    const dawn = sunStateForLocalTime(new Date(2026, 6, 24, 6, 30));
    const noon = sunStateForLocalTime(new Date(2026, 6, 24, 12));
    expect(dawn.phase).toBe('dawn');
    expect(dawn.color).not.toBe(noon.color);
    expect(dawn.skyColor).not.toBe(noon.skyColor);
    expect(noon.hemisphereIntensity).toBeGreaterThan(dawn.hemisphereIntensity);
    expect(noon.exposure).toBeGreaterThan(dawn.exposure);
    expect(dawn.skyHorizonColor).not.toBe(noon.skyHorizonColor);
    expect(dawn.cloudColor).not.toBe(noon.cloudColor);
    expect(noon.skyZenithColor).not.toBe(noon.skyLowerColor);
  });
});

describe('emissive light clustering', () => {
  it('deterministically reduces many semantic lights to at most two representatives', () => {
    const points = [
      { x: -10, y: 3, z: 0, intensity: 15 },
      { x: -9, y: 3, z: 1, intensity: 12 },
      { x: 10, y: 4, z: 0, intensity: 15 },
      { x: 9, y: 4, z: 1, intensity: 10 },
    ];
    const first = clusterEmissivePoints(points, 2);
    expect(first).toHaveLength(2);
    expect(clusterEmissivePoints([...points].reverse(), 2)).toEqual(first);
    expect(first.some((point) => point.x < 0)).toBe(true);
    expect(first.some((point) => point.x > 0)).toBe(true);
    expect(clusterEmissivePoints(points, 0)).toEqual([]);
  });
});
