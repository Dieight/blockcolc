import { expect, it } from 'vitest';
import { TerrainLineIndex } from '../src/terrain-line-index';

it('preserves mixed-LOD insertion order, nesting, negative coordinates and fractional edges', () => {
  const intervals = [{ start: 32, end: 64 }, { start: -32, end: 32 },
    { start: 0, end: 2 }, { start: -1.5, end: -.5 }, { start: 2, end: 4 }, { start: 0, end: 64 }];
  const index = new TerrainLineIndex(intervals);
  for (let start = -40; start < 72; start += .5) for (const width of [.05, 1, 2, 4, 32]) {
    const expected = intervals.filter(item => item.start < start + width && item.end > start);
    const actual = index.overlapping(start, start + width);
    expect(actual).toEqual(expected);
    actual.forEach((item, i) => expect(item).toBe(expected[i]));
  }
  expect(new TerrainLineIndex([]).overlapping(0, 2)).toEqual([]);
});
