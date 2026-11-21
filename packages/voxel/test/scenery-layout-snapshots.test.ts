import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { planWorldScenery } from '../src/scenery';
import { SCENERY_PLANNING_CASES, sceneryPlanningFixture } from './scenery-planning-fixture';

// v2.9.0 changed the valley relief and watercourses, which also move
// supported background sites. Separate tests check paths, water and support.
const SNAPSHOTS: Readonly<Record<string, string>> = {
  "natural-valley:1:4": "908fa73a0b9fffa1602be0a36781011b5a44b1cce44fcf4bde13ffa83b1cc5eb",
  "classic-island:1:4": "fd711c694053ec1bcc972008ad3f58033001a26e5e1f4b226b84893e239ef935",
  "ocean-island:1:4": "760028152bfc267b8f55f82ce19a20bcd3466617855c3b25483a7c8854e2b5a9",
  "natural-valley:7:4": "e8f6d13b00c129e12f0188783ab676df1f1753ef4c228f8bdb5a82d0ff721bad",
  "ocean-island:12:4": "4484026c0f9da1c95236441ebcb781322155b87d05c1dbe43829e0354056b068",
};

it.each(SCENERY_PLANNING_CASES)('preserves scenery blocks and placements: $style / $count tasks / v$version', ({ style, count, version }) => {
  const input = sceneryPlanningFixture(style, count, version);
  const before = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const plan = planWorldScenery(input);
  expect(createHash('sha256').update(JSON.stringify(plan)).digest('hex'))
    .toBe(SNAPSHOTS[`${style}:${count}:${version}`]);
  expect(createHash('sha256').update(JSON.stringify(input)).digest('hex')).toBe(before);
}, 60_000);
