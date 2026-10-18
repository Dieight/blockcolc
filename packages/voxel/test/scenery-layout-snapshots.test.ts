import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { planWorldScenery } from '../src/scenery';
import { SCENERY_PLANNING_CASES, sceneryPlanningFixture } from './scenery-planning-fixture';

// Adopted v2.8.0 landforms intentionally change supported background sites.
// Old hashes remain in the integration evidence; task/water/road/wreck and
// support checks are separate assertions, not replaced by accepting a hash.
const SNAPSHOTS: Readonly<Record<string, string>> = {
  "natural-valley:1:4": "b5df30c226364a76a011b83419d6d6b55ecdf39591d5a6927bb58e1d322a32e9",
  "classic-island:1:4": "fd711c694053ec1bcc972008ad3f58033001a26e5e1f4b226b84893e239ef935",
  "ocean-island:1:4": "760028152bfc267b8f55f82ce19a20bcd3466617855c3b25483a7c8854e2b5a9",
  "natural-valley:7:4": "9ee4e9581d5a15a143ec18535e7724f263e38b0cd3d02f940142aba1b1dc6f75",
  "ocean-island:12:4": "4484026c0f9da1c95236441ebcb781322155b87d05c1dbe43829e0354056b068",
};

it.each(SCENERY_PLANNING_CASES)('preserves scenery blocks and placements: $style / $count tasks / v$version', ({ style, count, version }) => {
  const input = sceneryPlanningFixture(style, count, version);
  const before = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const plan = planWorldScenery(input);
  expect({digest:createHash('sha256').update(JSON.stringify(plan)).digest('hex')})
    .toEqual({digest:SNAPSHOTS[`${style}:${count}:${version}`]});
  expect(createHash('sha256').update(JSON.stringify(input)).digest('hex')).toBe(before);
}, 60_000);
