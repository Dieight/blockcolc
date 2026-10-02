import { describe, expect, it } from 'vitest';
import { planWorldScenery, sceneryHouseBlocks, sceneryTreeBlocks, sceneryLod, scenerySurfaceAt,
  sceneryBiome, sceneryCampBlocks, sceneryWreckBlocks, sceneryGeometryLayers, type ScenerySurface } from '../src/scenery';
import { alignWorldsToEnvironment, layoutWorlds, terrainSurfaceRectangles } from '../src/renderer';
import { createSteppedTerrainData } from '../src/terrain';
import { roadCellsForVillage } from '../src/village';

const flat = Array.from({ length: 61 * 61 }, (_, i) => {
  const x = (i % 61 - 30) * 4, z = (Math.floor(i / 61) - 30) * 4;
  return { minX: x, maxX: x + 4, minZ: z, maxZ: z + 4, supportY: 1, water: false };
});
const input = { environmentStyle: 'natural-valley' as const, worldSeed: 'review-valley',
  surfaces: flat, protectedRects: [{ x: 0, z: 0, width: 27, depth: 27 }],
  roads: [{ x: 0, z: 17 }], trees: [{ x: 25, y: 1, z: 18, scale: 1 }] };

describe('deterministic biome scenery', () => {
  it.each([
    { count: 1, seed: 'world-default' }, { count: 2, seed: 'ocean-single' },
    { count: 7, seed: 'review-valley' }, { count: 12, seed: 'archipelago-230' },
    { count: 24, seed: 'world-default' }, { count: 32, seed: 'archipelago-230' },
    { count: 48, seed: 'scenery-review-fixed' },
  ])('exposes a ship beside the real ocean shore for $count tasks / $seed', ({ count, seed }) => {
    const worlds = alignWorldsToEnvironment(layoutWorlds(Array.from({ length: count }, (_, settlementIndex) => ({
      projectId: `ocean-${settlementIndex}`, settlementIndex, blueprintId: 'builtin-timber-house',
      buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false,
    }))), 'ocean-island');
    const roads = roadCellsForVillage(worlds);
    const pads = worlds.map(w => ({ x: w.worldPosition.x, z: w.worldPosition.z,
      width: w.footprint.width, depth: w.footprint.depth, groundLevel: w.worldPosition.y }));
    const terrain = createSteppedTerrainData(worlds, roads, pads, undefined,
      { environmentStyle: 'ocean-island', worldSeed: seed, terrainGenerationVersion: 4 });
    const surfaces = terrainSurfaceRectangles(terrain);
    const result = planWorldScenery({ environmentStyle: 'ocean-island', worldSeed: seed, surfaces,
      trees: terrain.naturalTrees, roads, protectedRects: worlds.map(w => ({ x: w.worldPosition.x,
        z: w.worldPosition.z, width: w.footprint.width + 5, depth: w.footprint.depth + 5 })) });
    const wreck = result.objects.find(o => o.role === 'wreck');
    expect(wreck, `missing ship for ${seed}/${count}`).toBeDefined();
    expect(scenerySurfaceAt(surfaces, wreck!.x, wreck!.z)?.water).toBe(true);
    const waterY = scenerySurfaceAt(surfaces, wreck!.x, wreck!.z)!.supportY;
    expect(wreck!.y + Math.max(...wreck!.distantVoxels.map(v => v.y))).toBeGreaterThan(waterY + 7);
  }, 60_000);
  it('partitions shared silhouettes without dropping, replacing or duplicating near detail', () => {
    for (const object of [sceneryHouseBlocks(), sceneryCampBlocks(), sceneryWreckBlocks()]) {
      const before = structuredClone(object);
      const layers = sceneryGeometryLayers(object)!;
      expect(layers.silhouette).toBe(object.distantVoxels);
      expect(layers.detail.every(voxel => !layers.silhouette.includes(voxel))).toBe(true);
      expect(new Set([...layers.silhouette, ...layers.detail])).toEqual(new Set(object.voxels));
      expect(layers.silhouette.length + layers.detail.length).toBe(object.voxels.length);
      expect(object).toEqual(before);
    }
  });
  it('keeps independently simplified far geometry on the two-model route', () => {
    const object = sceneryHouseBlocks();
    expect(sceneryGeometryLayers({ ...object, distantVoxels: object.distantVoxels.map(voxel => ({ ...voxel })) })).toBeNull();
    expect(sceneryGeometryLayers({ ...object, distantVoxels: [{ ...object.voxels[0]!, y: 99 }] })).toBeNull();
  });
  it('places exactly one locality, deterministic even when surface order changes', () => {
    const plan = planWorldScenery(input);
    expect(plan.village).not.toBeNull();
    expect(plan.objects.filter(o => o.role === 'house')).toHaveLength(3);
    expect(plan).toEqual(planWorldScenery({ ...input, surfaces: [...flat].reverse() }));
    expect(Math.hypot(plan.village!.x, plan.village!.z)).toBeGreaterThan(65);
    expect(plan.objects.every(o => !('projectId' in o) && !('rewardId' in o))).toBe(true);
    for (const o of plan.objects.filter(o => o.role !== 'path' && o.role !== 'tree')) {
      expect(Math.abs(o.x) > 27 / 2 + o.width / 2 + 2 || Math.abs(o.z) > 27 / 2 + o.depth / 2 + 2).toBe(true);
    }
  });
  it('never substitutes a land village when no supported site exists', () => {
    const ocean = flat.map(s => ({ ...s, water: true }));
    const before = structuredClone(ocean);
    const plan = planWorldScenery({ ...input, environmentStyle: 'ocean-island', surfaces: ocean });
    expect(plan.village).toBeNull(); expect(plan.objects).toEqual([]);
    expect(ocean).toEqual(before);
  });
  it('rejects submerged ground and accepts land genuinely above water', () => {
    const land: ScenerySurface = { minX: -5, maxX: 5, minZ: -5, maxZ: 5, supportY: 1, water: false };
    expect(scenerySurfaceAt([land, { ...land, water: true, supportY: 3 }], 0, 0)?.water).toBe(true);
    expect(scenerySurfaceAt([land, { ...land, water: true, supportY: .5 }], 0, 0)?.water).toBe(false);
  });
  it('builds connected unit-block trunks and layered crowns, never a giant-box tree', () => {
    for (const species of ['oak', 'birch', 'spruce'] as const) {
      const { voxels } = sceneryTreeBlocks(species, 2);
      const trunk = voxels.filter(v => v.sourceBlockId === `minecraft:${species}_log` && v.x === 0 && v.z === 0);
      expect(trunk.length).toBeGreaterThanOrEqual(4);
      expect(trunk.map(v => v.y)).toEqual(Array.from({ length: trunk.length }, (_, i) => i));
      const leaves = voxels.filter(v => v.sourceBlockId === `minecraft:${species}_leaves`);
      expect(new Set(leaves.map(v => v.y)).size).toBeGreaterThanOrEqual(4);
      expect(new Set(voxels.map(v => `${v.x}:${v.y}:${v.z}`)).size).toBe(voxels.length);
    }
  });
  it('keeps stepped roofs and walls at far LOD while dropping only small detail', () => {
    const house = sceneryHouseBlocks();
    expect(house.distantVoxels.length).toBeLessThan(house.voxels.length);
    expect(house.distantVoxels.filter(v => v.sourceBlockId?.endsWith('_stairs'))).toEqual(
      house.voxels.filter(v => v.sourceBlockId?.endsWith('_stairs')));
    expect(new Set(house.distantVoxels.filter(v => v.sourceBlockId?.endsWith('_stairs')).map(v => v.y)).size).toBe(5);
    expect(sceneryLod(29, 'full')).toBe('distant');
    expect(sceneryLod(36, 'distant')).toBe('distant');
    expect(sceneryLod(43, 'distant')).toBe('full');
    expect(sceneryLod(36, 'full')).toBe('full');
  });
  it.each(['natural-valley', 'classic-island', 'ocean-island'] as const)(
    'reviews the actual %s terrain without mutating its task layout or surface', (style) => {
      const worlds = layoutWorlds(Array.from({ length: 7 }, (_, settlementIndex) => ({
        projectId: `demo-${settlementIndex}`, settlementIndex,
        blueprintId: ['builtin-timber-house', 'builtin-small-workshop', 'builtin-village-chapel'][settlementIndex % 3]!,
        buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false,
      })));
      const roads = roadCellsForVillage(worlds);
      const terrain = createSteppedTerrainData(worlds, roads, [], undefined,
        { environmentStyle: style, worldSeed: 'scenery-review-fixed', terrainGenerationVersion: 4 });
      const before = JSON.stringify([worlds, terrain]);
      const result = planWorldScenery({ environmentStyle: style, worldSeed: 'scenery-review-fixed',
        surfaces: terrainSurfaceRectangles(terrain), trees: terrain.naturalTrees, roads,
        protectedRects: worlds.map(w => ({ x: w.worldPosition.x, z: w.worldPosition.z,
          width: w.footprint.width + 5, depth: w.footprint.depth + 5 })) });
      expect(JSON.stringify([worlds, terrain])).toBe(before);
      // Report unsupported scenes honestly rather than carving terrain silently.
      expect(result.objects.filter(o => o.role === 'house').length).toBe(style === 'classic-island' ? 0 : 3);
      if (style === 'classic-island') expect(result.village).toBeNull();
      else expect(Math.hypot(result.village!.x, result.village!.z)).toBeGreaterThan(80);
      if (style === 'ocean-island') expect(result.objects.some(o => o.role === 'wreck')).toBe(true);
      if (style === 'natural-valley') expect(result.objects.some(o => o.role === 'camp')).toBe(true);
    }, 60_000,
  );
  it('retains abandoned camp and exposed wreck silhouettes at both detail levels', () => {
    const camp = sceneryCampBlocks(), wreck = sceneryWreckBlocks();
    expect(camp.voxels.some(v => v.sourceBlockId === 'minecraft:campfire')).toBe(true);
    expect(new Set(camp.distantVoxels.map(v => v.y)).size).toBeGreaterThan(3);
    expect(Math.min(...wreck.distantVoxels.map(v => v.y))).toBe(-2);
    expect(Math.max(...wreck.distantVoxels.map(v => v.y))).toBe(10);
    expect(wreck.distantVoxels.some(v => v.sourceBlockId === 'minecraft:white_wool')).toBe(true);
  });
  it('finds an exposed wreck beside real land even when the ocean is one broad quad', () => {
    const land = flat.filter(s => Math.hypot((s.minX + s.maxX) / 2, (s.minZ + s.maxZ) / 2) < 78);
    const water = { minX: -160, maxX: 160, minZ: -160, maxZ: 160, supportY: 0, water: true };
    const plan = planWorldScenery({ ...input, environmentStyle: 'ocean-island', surfaces: [...land, water] });
    const wreck = plan.objects.find(o => o.role === 'wreck');
    expect(wreck).toBeDefined();
    expect(scenerySurfaceAt([...land, water], wreck!.x, wreck!.z)?.water).toBe(true);
    expect(wreck!.voxels.some(v => v.y > 4)).toBe(true);
  });
  it('connects biome patches across neighboring blocks and keeps highland trees distinct', () => {
    expect(sceneryBiome('grove', 14, 20, 'natural-valley', 24)).toBe('highland');
    const kinds = Array.from({ length: 100 }, (_, x) => sceneryBiome('grove', x, 20, 'natural-valley', 2));
    expect(kinds.filter((v, i) => i > 0 && v !== kinds[i - 1]).length).toBeLessThan(10);
    expect(new Set(kinds).size).toBeGreaterThan(1);
  });
});
