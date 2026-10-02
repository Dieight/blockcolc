import { describe, expect, it } from 'vitest';
import { allocationPercentageUnits } from './focus-allocation-field';

describe('time allocation percentage field', () => {
  it('has exactly 100 units even when the individual rounded shares do not add up', () => {
    expect(allocationPercentageUnits([{minutes:1},{minutes:1},{minutes:1}])).toEqual([34,33,33]);
    expect(allocationPercentageUnits([{minutes:45},{minutes:15}])).toEqual([75,25]);
  });
  it('weights original milliseconds rather than already rounded display minutes', () => {
    expect(allocationPercentageUnits([{minutes:0,durationMs:10_000},{minutes:0,durationMs:20_000}])).toEqual([33,67]);
    expect(allocationPercentageUnits([{minutes:100,durationMs:1},{minutes:1,durationMs:999}])).toEqual([0,100]);
  });
  it('does not manufacture units for empty, zero, negative or invalid durations', () => {
    expect(allocationPercentageUnits([])).toEqual([]);
    expect(allocationPercentageUnits([{minutes:0},{minutes:-10},{minutes:NaN}])).toEqual([0,0,0]);
    expect(allocationPercentageUnits([{minutes:0},{minutes:120}])).toEqual([0,100]);
  });
});
