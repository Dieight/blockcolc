import { describe, expect, it } from 'vitest';
import { CLOCK_ROUND_DWELL_MS, clockRoundDetent } from './ui/MinimalClockGesture';
describe('timed whole-round detents', () => {
  const now = 1_800_000_000_000, minute = 60_000;
  it('holds within the requested range without blocking the UI thread', () => {
    expect(CLOCK_ROUND_DWELL_MS).toBe(500);
  });
  it('stops fast drags at the first boundary; later rounds include the rests', () => {
    expect(clockRoundDetent(now, now + 100 * minute, now, 25, 5)).toEqual({ round: 1, endMs: now + 25 * minute });
    expect(clockRoundDetent(now + 25 * minute, now + 100 * minute, now, 25, 5)).toEqual({ round: 2, endMs: now + 55 * minute });
    expect(clockRoundDetent(now + 90 * minute, now + 40 * minute, now, 25, 5)).toEqual({ round: 3, endMs: now + 85 * minute });
  });
  it('does not accumulate repeated or sub-five-minute locks at one grid tick', () => {
    expect(clockRoundDetent(now + 25 * minute, now + 30 * minute, now, 25, 5)).toBeNull();
    expect(clockRoundDetent(now + 25 * minute, now + 20 * minute, now, 25, 5)).toBeNull();
    expect(clockRoundDetent(now, now + 5 * minute, now, 1, 0)).toEqual({ round: 1, endMs: now + 5 * minute });
    expect(clockRoundDetent(now + 5 * minute, now + 10 * minute, now, 1, 0)).toEqual({ round: 6, endMs: now + 10 * minute });
  });
});
