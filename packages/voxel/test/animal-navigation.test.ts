import { describe, it, expect } from 'vitest';
import { CollisionWorld, Navigator, Walker, SHEEP, PIG, HORSE, edgePoint, traversable } from '../src/animal-navigation';
import { box, course, testWorld } from './animal-fixture';

describe('world animals: collision and navigation', () => {
  it('walks through the building district rather than excluding its footprint', () => {
    const world = testWorld([box('house-wall', -.5, .5, 0, 4, -2.5, 2.5)]), nav = new Navigator(world, SHEEP);
    const route = nav.plan({ x: -4, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });
    expect(route.reason).toBe('arrived'); expect(route.points.some(p => Math.abs(p.z) >= 3)).toBe(true);
    expect(route.points.every(p => world.clear(p, SHEEP))).toBe(true);
  });
  it('retains walkable ground below a bridge without jumping onto the roof', () => {
    const sample = course(), world = new CollisionWorld({ minX: -9, maxX: 9, minZ: -6, maxZ: 6 }, sample.solids);
    const nav = new Navigator(world, SHEEP), layers = nav.column(1, -1).map(p => p.y);
    expect(layers).toEqual([0, 2.5]);
    const route = nav.plan(sample.bridge[0]!, sample.bridge[1]!);
    expect(route.reason).toBe('arrived'); expect(route.points.every(p => p.y === 0)).toBe(true);
  });
  it('checks height and width: pig fits a narrow low door, horse does not', () => {
    const world = testWorld([box('door-left', -.5, .5, 0, 4, -12, -.5), box('door-right', -.5, .5, 0, 4, .5, 12),
      box('lintel', -.5, .5, 1.2, 4, -.5, .5)]);
    expect(new Navigator(world, PIG).plan({ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }).reason).toBe('arrived');
    expect(new Navigator(world, HORSE).plan({ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }).reason).toBe('unreachable');
  });
  it('uses a step and a jump while every intermediate pose stays out of solids', () => {
    const world = testWorld([box('half', -.5, .5, 0, .5, -12, 12), box('full', .5, 1.5, 0, 1.5, -12, 12)]);
    const route = new Navigator(world, SHEEP).plan({ x: -2, y: 0, z: 0 }, { x: 1, y: 1.5, z: 0 });
    expect(route.reason).toBe('arrived'); expect(route.actions).toContain('step'); expect(route.actions).toContain('jump');
    for (let i = 1; i < route.points.length; i++) for (let sample = 0; sample <= 100; sample++)
      expect(world.clear(edgePoint(route.points[i - 1]!, route.points[i]!, sample / 100, SHEEP), SHEEP)).toBe(true);
  });
  it('does not walk off a cliff or into water', () => {
    const cliff = new CollisionWorld({ minX: -5, maxX: 5, minZ: -3, maxZ: 3 },
      [box('high', -5, -.5, -5, 3, -3, 3), box('low', -.5, 5, -5, 0, -3, 3)]);
    expect(new Navigator(cliff, SHEEP).plan({ x: -2, y: 3, z: 0 }, { x: 2, y: 0, z: 0 }).reason).toBe('unreachable');
    const water = testWorld([box('water', -.5, .5, -2, .1, -12, 12, { water: true })]);
    expect(new Navigator(water, SHEEP).plan({ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }).reason).toBe('unreachable');
  });
  it('rejects low overhead clearance along a jump, not just at its endpoints', () => {
    const world = testWorld([box('step', -.5, .5, 0, 1, -2, 2), box('ceiling', -1.8, .5, 2.5, 3, -2, 2)]);
    expect(world.clear({ x: 0, y: 1, z: 0 }, SHEEP)).toBe(true);
    expect(traversable(world, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, SHEEP)).toBe(false);
  });
  it('treats a thin fence as an obstacle, including a delayed frame', () => {
    const world = testWorld(), actor = new Walker(new Navigator(world, SHEEP), { x: -3, y: 0, z: 0 });
    actor.setTarget({ x: 3, y: 0, z: 0 });
    world.replaceOwner('new-wall', [box('thin-fence', -.03, .03, 0, 2, -12, 12, { walkable: false })]);
    actor.update(3); expect(actor.position.x).toBeLessThan(-.4); expect(actor.replans).toBe(1);
    expect(actor.droppedSeconds).toBeCloseTo(2.88); expect(actor.blocked).toBe(0);
  });
  it('locally invalidates navigation after construction, without regenerating terrain', () => {
    const world = testWorld(), nav = new Navigator(world, SHEEP), actor = new Walker(nav, { x: -4, y: 0, z: 0 });
    actor.setTarget({ x: 4, y: 0, z: 0 }); const far = nav.column(-10, -10), count = world.solids.size;
    const update = world.replaceOwner('construction', [box('new-wall', -.5, .5, 0, 3, -2.5, 2.5)]);
    expect(update.dirtyBins).toBeLessThanOrEqual(4); expect(nav.column(-10, -10)).toBe(far);
    actor.update(.016); expect(actor.replans).toBe(1); expect(actor.route?.points.some(p => Math.abs(p.z) >= 3)).toBe(true);
    for (let i = 0; i < 1200; i++) { actor.update(1 / 60); expect(world.clear(actor.position, SHEEP)).toBe(true); }
    expect(actor.position.x).toBe(4); expect(world.solids.size).toBe(count + 1);
  });
  it('has bounded query caches and no movement writes into static geometry', () => {
    const world = testWorld(), nav = new Navigator(world, SHEEP, 1, 64), actor = new Walker(nav, { x: -4, y: 0, z: 0 });
    const revision = world.revision; actor.setTarget({ x: 4, y: 0, z: 0 });
    for (let i = 0; i < 1500; i++) { actor.update(1 / 60); nav.column(i % 80 - 40, Math.floor(i / 80) - 10); }
    expect(nav.stats().columns).toBeLessThanOrEqual(64); expect(world.revision).toBe(revision);
    expect(world.stats().queries).toBeGreaterThan(0);
  });
  it('tap pauses and responds, then resumes its original route', () => {
    const actor = new Walker(new Navigator(testWorld(), SHEEP), { x: -4, y: 0, z: 0 });
    actor.setTarget({ x: 4, y: 0, z: 0 }); actor.update(.1); actor.tap(); const x = actor.position.x;
    for (let i = 0; i < 20; i++) actor.update(.05); expect(actor.position.x).toBe(x); expect(actor.reactions).toBe(1);
    for (let i = 0; i < 30; i++) actor.update(.05); expect(actor.position.x).toBeGreaterThan(x);
  });
  it('construction during a jump replans after landing instead of freezing in midair', () => {
    const world = testWorld([box('raised', -.5, 1.5, 0, 1, -2, 2)]), actor = new Walker(new Navigator(world, SHEEP), { x: -2, y: 0, z: 0 });
    actor.setTarget({ x: 1, y: 1, z: 0 });
    for (let i = 0; i < 120 && world.supported(actor.position, SHEEP); i++) actor.update(1 / 60);
    expect(world.supported(actor.position, SHEEP)).toBe(false);
    world.replaceOwner('far-construction', [box('far-wall', 8, 9, 0, 3, 8, 9)]); actor.tap();
    for (let i = 0; i < 1200; i++) actor.update(1 / 60);
    expect(actor.position).toEqual({ x: 1, y: 1, z: 0 }); expect(actor.replans).toBe(1); expect(actor.blocked).toBe(0);
  });
  it('rejects an invalid collider replacement atomically', () => {
    const world = testWorld(); world.replaceOwner('construction', [box('existing', -.5, .5, 0, 3, -2, 2)]);
    const revision = world.revision, count = world.solids.size;
    expect(() => world.replaceOwner('construction', [box('replacement', 0, 1, 0, 2, 0, 1), box('invalid', 0, NaN, 0, 1, 0, 1)])).toThrow();
    expect(world.solids.has('existing')).toBe(true); expect(world.solids.size).toBe(count); expect(world.revision).toBe(revision);
  });
  it('cooperative and synchronous searches produce the same route', async () => {
    const world = testWorld([box('wall', -.5, .5, 0, 3, -5, 5)]), start = { x: -8, y: 0, z: 0 }, end = { x: 8, y: 0, z: 0 };
    const baseline = new Navigator(world, SHEEP).plan(start, end);
    const candidate = await new Navigator(world, SHEEP).planCooperatively(start, end);
    expect(candidate.route.reason).toBe(baseline.reason); expect(candidate.route.points).toEqual(baseline.points); expect(candidate.route.expanded).toBe(baseline.expanded);
    expect(candidate.slices.length).toBeGreaterThan(0);
  });
  it('discards cooperative work after visibility/caller/world changes', async () => {
    const world = testWorld(), nav = new Navigator(world, SHEEP), p = { x: 0, y: 0, z: 0 };
    expect((await nav.planCooperatively(p, p, () => false)).route.reason).toBe('cancelled');
  });
});
