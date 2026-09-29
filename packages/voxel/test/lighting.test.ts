import { describe, expect, it } from 'vitest';
import {
  clusterEmissivePoints,
  emissiveColorForPoint,
  lightingDirectionFingerprint,
  registerEmissivePoint,
  selectEmissiveVisualPoints,
  shadowDirectionFromPosition,
  shadowLightPositionForExtent,
  sunStateForLocalTime,
  sourceLanternEmissionForVoxel,
} from '../src/lighting';

describe('local sun path', () => {
  it('keeps the astronomical shadow direction while placing its depth camera behind large settlements', () => {
    const source = sunStateForLocalTime(new Date(2026, 6, 24, 10)).position;
    const near = shadowLightPositionForExtent(source, 10);
    const large = shadowLightPositionForExtent(source, 70);
    expect(Math.hypot(...near)).toBeCloseTo(48, 8);
    expect(Math.hypot(...large)).toBeCloseTo(168, 8);
    shadowDirectionFromPosition(large).forEach((value, axis) =>
      expect(value).toBeCloseTo(shadowDirectionFromPosition(source)[axis]!, 8));
  });
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
    expect(night.intensity).toBeGreaterThan(0.9);
    expect(night.intensity).toBeLessThan(1);
    expect(night.nightFactor).toBeGreaterThan(0.95);
    expect(night.exposure).toBeGreaterThanOrEqual(1.28);
    expect(night.hemisphereIntensity).toBeGreaterThanOrEqual(1.24);
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
    // v2.1 lifts night/twilight fill and exposure for readability; daytime
    // stays brighter through direct sunlight rather than artificial fill.
    expect(dawn.hemisphereIntensity).toBeGreaterThan(noon.hemisphereIntensity);
    expect(dawn.exposure).toBeGreaterThan(noon.exposure);
    expect(noon.intensity).toBeGreaterThan(dawn.intensity);
    expect(dawn.skyHorizonColor).not.toBe(noon.skyHorizonColor);
    expect(dawn.cloudColor).not.toBe(noon.cloudColor);
    expect(noon.skyZenithColor).not.toBe(noon.skyLowerColor);
  });

  it('keeps the applied shadow direction distinct through dawn, noon, dusk and night', () => {
    const samples = [6, 12, 18, 2].map((hour) => sunStateForLocalTime(new Date(2026, 6, 24, hour)));
    const fingerprints = samples.map((state) => lightingDirectionFingerprint(state));
    const directions = samples.map((state) => shadowDirectionFromPosition(state.position));
    expect(new Set(fingerprints).size).toBe(samples.length);
    expect(new Set(directions.map((direction) => direction.join(','))).size).toBe(samples.length);
    expect(directions.every((direction) => Math.abs(Math.hypot(...direction) - 1) < 1e-6)).toBe(true);
    // A time sample changes the vector, not only the light's colour/intensity.
    expect(directions[0]).not.toEqual(directions[1]);
    expect(directions[1]).not.toEqual(directions[2]);
    expect(directions[2]).not.toEqual(directions[3]);
  });
});

describe('emissive light clustering', () => {
  it('keeps the full lamp color domain warm by default and matches soul lights in clustered and sprite routes', () => {
    const roadLamp = { x: 0, y: 2, z: 0, intensity: 15 };
    const legacyLamp = { x: 4, y: 2, z: 0, intensity: 12 };
    const soulLamp = { x: 80, y: 2, z: 0, intensity: 10 };
    const points: Array<typeof roadLamp> = [];
    const colors = new Map<string, number>();
    registerEmissivePoint(points, colors, roadLamp);
    registerEmissivePoint(points, colors, legacyLamp, 0xffb45f);
    registerEmissivePoint(points, colors, soulLamp, 0x65cfe3);

    expect(colors.size).toBe(points.length);
    expect(emissiveColorForPoint(roadLamp, colors)).toBe(0xffb45f);
    expect(emissiveColorForPoint(legacyLamp, colors)).toBe(0xffb45f);
    expect(emissiveColorForPoint(soulLamp, colors)).toBe(0x65cfe3);

    const clustered = clusterEmissivePoints(points, 2);
    expect(clustered).toHaveLength(2);
    expect(new Set(clustered.map((point) => emissiveColorForPoint(point, colors))))
      .toEqual(new Set([0xffb45f, 0x65cfe3]));
    const spriteAnchors = selectEmissiveVisualPoints(points, 3);
    expect(spriteAnchors.map((point) => emissiveColorForPoint(point, colors)))
      .toEqual([0xffb45f, 0xffb45f, 0x65cfe3]);
  });

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

  it('anchors visible glow only to deterministic real emissive blocks', () => {
    const points = [
      { x: -10, y: 3, z: 0, intensity: 15 },
      { x: -9, y: 3, z: 1, intensity: 12 },
      { x: 10, y: 4, z: 0, intensity: 15 },
      { x: 9, y: 4, z: 1, intensity: 10 },
    ];
    const selected = selectEmissiveVisualPoints(points, 2);
    expect(selected).toHaveLength(2);
    expect(selectEmissiveVisualPoints([...points].reverse(), 2)).toEqual(selected);
    expect(selected.every((entry) => points.some((point) => point.x === entry.x
      && point.y === entry.y && point.z === entry.z && point.intensity === entry.intensity))).toBe(true);
    expect(selectEmissiveVisualPoints([points[0]!, { ...points[0]! }], 2)).toEqual([points[0]]);
    expect(selectEmissiveVisualPoints(points, 0)).toEqual([]);
  });
});

describe('source lantern emission projection', () => {
  it('projects only complete exact lantern states and preserves explicit emission facts', () => {
    const lantern = {
      sourceBlockId: 'minecraft:lantern',
      sourceBlockState: { hanging: 'false', waterlogged: 'true' },
    };
    const soul = {
      sourceBlockId: 'minecraft:soul_lantern',
      sourceBlockState: { hanging: 'true', waterlogged: 'false' },
    };
    expect(sourceLanternEmissionForVoxel(lantern)).toEqual({ kind: 'lantern', level: 15, color: 0xffb45f });
    expect(sourceLanternEmissionForVoxel(soul)).toEqual({ kind: 'soul-lantern', level: 10, color: 0x65cfe3 });
    expect(sourceLanternEmissionForVoxel({ ...lantern, sourceBlockState: { hanging: 'false' } })).toBeUndefined();
    expect(sourceLanternEmissionForVoxel({ ...lantern, sourceBlockState: { hanging: 'false', waterlogged: 'false', extra: 'true' } })).toBeUndefined();
    expect(sourceLanternEmissionForVoxel({ ...lantern, sourceBlockId: 'mod:lantern' })).toBeUndefined();
    expect(sourceLanternEmissionForVoxel({ ...lantern, sourceBlockId: 'minecraft:lever' })).toBeUndefined();
    expect(sourceLanternEmissionForVoxel({ ...soul, emissiveKind: 'legacy-redstone', emissiveLevel: 7 }))
      .toEqual({ kind: 'legacy-redstone', level: 7, color: 0xe94b35 });
    expect(sourceLanternEmissionForVoxel({ ...lantern, emissiveLevel: 0 })).toBeUndefined();
    expect(sourceLanternEmissionForVoxel({ ...lantern, emissiveKind: 'legacy-lantern', emissiveLevel: 0 })).toBeUndefined();
    expect(sourceLanternEmissionForVoxel({ ...lantern, emissiveKind: 'legacy-lantern', emissiveLevel: 6 }))
      .toEqual({ kind: 'legacy-lantern', level: 6, color: 0xffb45f });
    expect(sourceLanternEmissionForVoxel({ ...lantern, emissiveKind: 'legacy-lantern' }))
      .toEqual({ kind: 'legacy-lantern', level: 15, color: 0xffb45f });
  });
});
