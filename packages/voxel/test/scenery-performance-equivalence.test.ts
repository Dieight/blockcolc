import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { planWorldScenery } from '../src/scenery';
import { sceneryPlanningFixture } from './scenery-planning-fixture';

// The performance rewrite preserved the original complete plan (archived in
// artifacts/performance/v2.6.0-audit/scenery-performance-equivalence-before-feedback.ts).
// The authorised coast seam/coral fixes intentionally change this biome.
// Revised after region/footing/cross-tile regressions and real reef rendering;
// old hashes and the failing comparison remain in latest83-scenery-fixture-before.log.
const hashes: Readonly<Record<string, string>> = {
  'world-default': '870b6f3e70a025fad8fdffe14f7af88e9385551824187897da5f3f310c62e7f8',
  'world-portal-0': '7966c93fd2065b9333084f04f793c1fa077d487731db541c2ceb832ec980a17c',
  'cold-edge-regression': 'f801b5c87f869e65c34bda376ff6fda1d667e70d66d354206bf008d898899dac',
};

it.each(['world-default', 'world-portal-0', 'cold-edge-regression'])('preserves the complete coastal scenery: %s', seed => {
  const input = sceneryPlanningFixture('mosaic-coast', 24, 4, seed);
  const started = performance.now(), plan = planWorldScenery(input);
  const digest = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  console.log(JSON.stringify({ seed, durationMs: performance.now() - started, digest, objects: plan.objects.length }));
  expect(digest).toBe(hashes[seed]);
}, 60_000);
