import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { planWorldScenery } from '../src/scenery';
import { SCENERY_PLANNING_CASES, sceneryPlanningFixture } from './scenery-planning-fixture';

// Legacy/island snapshots predate the planner optimization; v4 valley
// snapshots include v2.5.6's common-height LOD seam (32-block transition).
// Safe ground/cone exclusion removes unsupported trees and gardens; structural
// placement tests still guard the primary legacy landmarks and the terrain.
const SNAPSHOTS: Readonly<Record<string, string>> = {
  "natural-valley:1:4": "cff6df0c74daaa1ca5a0624928e3804ce9af7748c1a6587d2a72d50f323b33ad",
  "classic-island:1:4": "fd711c694053ec1bcc972008ad3f58033001a26e5e1f4b226b84893e239ef935",
  "ocean-island:1:4": "045b5c67ec56ecc7691f1815054625f66014fd28aa16555460efa1acdaece9ac",
  "natural-valley:7:4": "a43c1b5a98fc996183709735e71a343a96a370c1626944e981b22a30ca839818",
  "ocean-island:12:4": "7866bc98fa6424df1d04580af5565a8b9585d3e75d2b52cb6b1b954d1803e7b1",
  "natural-valley:1:3": "660b26e147871cd050d05da7603f2a1ce7bfa0d6bb4c5faf69b941ef42fb7e83",
};

it.each(SCENERY_PLANNING_CASES)('preserves scenery blocks and placements: $style / $count tasks / v$version', ({ style, count, version }) => {
  const input = sceneryPlanningFixture(style, count, version);
  const before = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const plan = planWorldScenery(input);
  expect({digest:createHash('sha256').update(JSON.stringify(plan)).digest('hex')})
    .toEqual({digest:SNAPSHOTS[`${style}:${count}:${version}`]});
  expect(createHash('sha256').update(JSON.stringify(input)).digest('hex')).toBe(before);
}, 60_000);
