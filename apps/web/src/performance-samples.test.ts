import { describe, expect, it } from 'vitest';
import { durationSamples } from './performance-samples';

describe('bounded performance samples', () => {
  it('does not count invalid values or turn an absent sample into zero', () => {
    const sample = durationSamples();
    for (const value of [NaN, Infinity, -1]) sample.add(value);
    expect(sample.summary()).toMatchObject({ count: 0, p50Ms: null, p95Ms: null, meanMs: null });
  });
  it('keeps total/max/counters exact while bounding percentile storage', () => {
    const sample = durationSamples(2);
    [10, 20, 60, 120].forEach(ms => sample.add(ms));
    expect(sample.summary()).toEqual({ count: 4, sampled: 2, meanMs: 52.5, p50Ms: 10, p95Ms: 20, maxMs: 120, totalMs: 210, over34: 2, over50: 2, over100: 1 });
  });
});
