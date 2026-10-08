import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { planWorldScenery } from '../src/scenery';
import { sceneryPlanningFixture } from './scenery-planning-fixture';

// The performance rewrite preserved the original complete plan (archived in
// artifacts/performance/v2.6.0-audit/scenery-performance-equivalence-before-feedback.ts).
// The subsequent authorised coast/tree fixes intentionally change this biome.
// Lock the revised plan only after semantic regressions and real rendering.
const hashes: Readonly<Record<string, string>> = {
  'world-default': 'e039b3e8f5ccf4022ebcc646a4ac9822bfde7913da43f14adbbafb6ef23c4222',
  'world-portal-0': '025ca7eeeb48c1e90cddf6b75e859762775d329d7e682868e252c732da1d0730',
  'cold-edge-regression': 'd77da661fe2bc64a3ae025b65b8c7fcf9085b540c64326bc0f4751dfca4c7daa',
};

it.each(['world-default', 'world-portal-0', 'cold-edge-regression'])('preserves the complete coastal scenery: %s', seed => {
  const input = sceneryPlanningFixture('mosaic-coast', 24, 4, seed);
  const started = performance.now(), plan = planWorldScenery(input);
  const digest = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  console.log(JSON.stringify({ seed, durationMs: performance.now() - started, digest, objects: plan.objects.length }));
  expect(digest).toBe(hashes[seed]);
}, 60_000);
