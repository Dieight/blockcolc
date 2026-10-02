import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { planWorldScenery } from '../src/scenery';
import { SCENERY_PLANNING_CASES, sceneryPlanningFixture } from './scenery-planning-fixture';

// Legacy/island snapshots predate the planner optimization; v4 valley
// snapshots include the approved wider detail bands in build 46. New shore
// fallback must not relocate a valid existing island landmark.
const SNAPSHOTS: Readonly<Record<string, string>> = {
  "natural-valley:1:4": "44a0e6c1cbc6c2725c9a90da3912bdbbeb11cc812da30db1e5c37bb5954c4109",
  "classic-island:1:4": "fd711c694053ec1bcc972008ad3f58033001a26e5e1f4b226b84893e239ef935",
  "ocean-island:1:4": "369dc3c6451f28049108ed1a8a63426d5f3df1b34a70253d790c50f76a555bca",
  "natural-valley:7:4": "2e53660657d1a5c9de9d1e7259eade1e621d7c0d9d8305311bd51b4c3a695563",
  "ocean-island:12:4": "9282f8af79a7f79e5b76e83042e97441b6df715776df4c5f96eb20acbe822cb2",
  "natural-valley:1:3": "211a9d881efc0a430b45c917cbef92a66c2d2435a98fc25cbb9affded3070407",
};

it.each(SCENERY_PLANNING_CASES)('preserves scenery blocks and placements: $style / $count tasks / v$version', ({ style, count, version }) => {
  const input = sceneryPlanningFixture(style, count, version);
  const before = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const plan = planWorldScenery(input);
  expect(createHash('sha256').update(JSON.stringify(plan)).digest('hex'))
    .toBe(SNAPSHOTS[`${style}:${count}:${version}`]);
  expect(createHash('sha256').update(JSON.stringify(input)).digest('hex')).toBe(before);
}, 60_000);
