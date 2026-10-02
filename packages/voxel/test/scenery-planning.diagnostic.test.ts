import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { planWorldScenery } from '../src/scenery';
import { SCENERY_PLANNING_CASES, sceneryPlanningFixture } from './scenery-planning-fixture';

it.each(SCENERY_PLANNING_CASES)('measures scenery planner: $style / $count tasks / v$version', ({ style, count, version }) => {
  const input = sceneryPlanningFixture(style, count, version);
  const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const rawMs: number[] = [], hashes: string[] = [];
  let objectCount = 0;
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now();
    const plan = planWorldScenery(input);
    rawMs.push(Number((performance.now() - start).toFixed(3)));
    objectCount = plan.objects.length;
    hashes.push(createHash('sha256').update(JSON.stringify(plan)).digest('hex'));
  }
  expect(new Set(hashes).size).toBe(1);
  expect(createHash('sha256').update(JSON.stringify(input)).digest('hex')).toBe(inputHash);
  console.log('[scenery-planner] ' + JSON.stringify({ style, count, version, inputHash, outputHash: hashes[0],
    objectCount, rawMs, medianMs: [...rawMs].sort((a, b) => a - b)[2],
    scope: 'Node planner only; terrain preparation, hashing, geometry and rendering excluded' }));
}, 60_000);
