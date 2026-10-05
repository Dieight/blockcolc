import { describe, expect, it } from 'vitest';
import { cloudBudgetForView } from '../src/environment';
import { cloudDrawCountForQuality, cloudGroupsForBudget } from '../src/cloud-layout';

function random(seed = 42) { return () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; }; }
const world = { previewMode: false, weatherCloudCount: 9, weatherDensity: 1,
  weatherKind: 'cloudy' as const, contentWidth: 80, contentDepth: 80,
  visibleWidth: 1440, visibleDepth: 1440, normalWidth: 256, normalDepth: 256 };

describe('near/LOD connected cloud layout', () => {
  it('reduces the old near share, gives the outer terrain more groups and broader footprints', () => {
    const budget = cloudBudgetForView(world);
    expect(budget.nearCloudCount).toBeLessThan(budget.cloudCount * .5);
    expect(budget.nearCloudCount).toBeGreaterThan(budget.cloudCount * .4);
    expect(budget.farCloudCount).toBeGreaterThanOrEqual(budget.nearCloudCount);
    expect(budget.farBlockScale).toBeGreaterThan(3);
    expect(budget.nearSpanX).toBe(256);
  });
  it('is deterministic, covers all outer directions and does not relocate far groups into the core', () => {
    const budget = cloudBudgetForView(world);
    const groups = cloudGroupsForBudget(budget, { kind: 'cloudy', thunderstorm: false }, random());
    expect(groups).toEqual(cloudGroupsForBudget(budget, { kind: 'cloudy', thunderstorm: false }, random()));
    expect(groups).toHaveLength(budget.cloudCount);
    const far = groups.filter(group => group.region === 'far');
    expect(far).toHaveLength(budget.farCloudCount);
    for (const group of far) {
      expect(Math.abs(group.x) > budget.nearSpanX / 2 || Math.abs(group.z) > budget.nearSpanZ / 2).toBe(true);
      expect(Math.abs(group.x)).toBeLessThan(budget.spanX / 2);
      expect(Math.abs(group.z)).toBeLessThan(budget.spanZ / 2);
    }
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      expect(far.some(group => Math.sign(group.x) === sx && Math.sign(group.z) === sz)).toBe(true);
    }
    expect(groups.reduce((sum, group) => sum + group.blocks, 0)).toBeLessThanOrEqual(1600);
  });
  it('retains both near and far complete groups at every quality tier', () => {
    const groups = cloudGroupsForBudget(cloudBudgetForView(world), { kind: 'cloudy', thunderstorm: false }, random());
    let total = 0;
    const ends = groups.map(group => total += group.blocks);
    for (const density of [.45, .72, 1]) {
      const count = cloudDrawCountForQuality(ends, density);
      expect(ends).toContain(count);
      const visible = groups.filter((_, index) => ends[index]! <= count);
      expect(visible.some(group => group.region === 'near')).toBe(true);
      expect(visible.some(group => group.region === 'far')).toBe(true);
      expect(visible.some(group => group.kind === 'bank')).toBe(true);
    }
    expect(cloudDrawCountForQuality(ends, 0)).toBe(0);
    expect(cloudDrawCountForQuality(ends, Number.NaN)).toBe(0);
    expect(cloudDrawCountForQuality([], 1)).toBe(0);
  });
  it('links broad outer banks to cloudy/rain/snow but not clear/mist', () => {
    for (const kind of ['cloudy', 'rain', 'snow', 'clear', 'mist'] as const) {
      const budget = cloudBudgetForView({ ...world, weatherKind: kind });
      const groups = cloudGroupsForBudget(budget, { kind, thunderstorm: kind === 'rain' }, random());
      expect(groups.some(group => group.kind === 'bank')).toBe(['cloudy', 'rain', 'snow'].includes(kind));
    }
  });
  it('leaves a tiny preview independent and empty skies truly empty', () => {
    const budget = cloudBudgetForView({ ...world, previewMode: true, contentWidth: 12, contentDepth: 10 });
    const groups = cloudGroupsForBudget(budget, { kind: 'cloudy', thunderstorm: false }, random());
    expect(groups).toHaveLength(1);
    expect(groups[0]!.region).toBe('near');
    expect(groups[0]!.horizontalScale).toBe(1);
    expect(groups[0]!.kind).not.toBe('bank');
    expect(groups[0]!.blocks).toBeLessThanOrEqual(7);
    expect(cloudGroupsForBudget(cloudBudgetForView({ ...world, weatherCloudCount: 0 }),
      { kind: 'clear', thunderstorm: false }, random())).toEqual([]);
    expect(cloudBudgetForView({ ...world, weatherDensity: 0 }).cloudCount).toBe(0);
  });
  it('never covers the core with broad clouds except under cloudy skies, and keeps all clear-sky groups small',()=>{
    for(const kind of ['clear','cloudy','rain','snow','mist'] as const){
      const groups=cloudGroupsForBudget(cloudBudgetForView({...world,weatherKind:kind}),{kind,thunderstorm:kind==='rain'},random());
      for(const group of groups){
        if(group.region==='near'&&kind!=='cloudy'){expect(group.blocks).toBeLessThanOrEqual(7);expect(group.horizontalScale).toBe(1);expect(group.kind).not.toBe('bank');}
        if(kind==='clear'){expect(group.kind).not.toBe('bank');expect(group.kind).not.toBe('stratus');expect(group.horizontalScale).toBe(1);}
      }
    }
  });
  it('covers a rectangular envelope without NaN, including no distant area on a compact island', () => {
    const budget = cloudBudgetForView({ ...world, visibleWidth: 2000, visibleDepth: 300, normalWidth: 256, normalDepth: 300 });
    const groups = cloudGroupsForBudget(budget, { kind: 'cloudy', thunderstorm: false }, random());
    expect(groups.every(group => Number.isFinite(group.x) && Number.isFinite(group.z))).toBe(true);
    const compact = cloudBudgetForView({ ...world, visibleWidth: 80, visibleDepth: 80, normalWidth: 80, normalDepth: 80 });
    expect(compact.farCloudCount).toBe(0);
    expect(cloudGroupsForBudget(compact, { kind: 'clear', thunderstorm: false }, random())
      .every(group => group.region === 'near')).toBe(true);
  });
});
