import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { planWorldScenery } from '../src/scenery';
import { sceneryPlanningFixture } from './scenery-planning-fixture';

// The performance rewrite preserved the original complete plan (archived in
// artifacts/performance/v2.6.0-audit/scenery-performance-equivalence-before-feedback.ts).
// The authorised coast seam/coral fixes intentionally change this biome.
// Revised for the adopted v2.8 ecotones/landforms after region, footing and reef
// checks. Prior hashes and failures remain in release99-20261018/full-first.log.
const hashes: Readonly<Record<string, string>> = {
  'world-default': 'b878984c697f21a5b5a515b64a978ceae61bdb3848bd1b97176a6cc721a74da9',
  'world-portal-0': '14b3f205c980da5a1a36149e962fe4b10f067ce1677c843f098b0539b70aae3d',
  'cold-edge-regression': 'f4f91114e628287f383b8c64d1dac7575971e68be66161186588894dbe8eda60',
};

it.each(['world-default', 'world-portal-0', 'cold-edge-regression'])('preserves the complete coastal scenery: %s', seed => {
  const input = sceneryPlanningFixture('mosaic-coast', 24, 4, seed);
  const started = performance.now(), plan = planWorldScenery(input);
  const digest = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  console.log(JSON.stringify({ seed, durationMs: performance.now() - started, digest, objects: plan.objects.length }));
  expect(digest).toBe(hashes[seed]);
}, 60_000);
