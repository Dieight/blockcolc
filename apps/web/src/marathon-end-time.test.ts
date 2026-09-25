import { describe, expect, it } from 'vitest';
import { marathonEndInstant } from './marathon-end-time';

describe('shared marathon end-time draft', () => {
  it('keeps an explicit day instead of silently rolling a passed today into tomorrow', () => {
    const localNow = new Date(2026, 8, 5, 14, 30, 25).getTime();
    expect(marathonEndInstant('14:00', localNow, 'today')).toBe(new Date(2026, 8, 5, 14).getTime());
    expect(marathonEndInstant('15:00', localNow, 'tomorrow')).toBe(new Date(2026, 8, 6, 15).getTime());
  });
  const now = new Date(2026, 8, 5, 14, 30, 25).getTime();
  it('uses a future local time today and clears seconds', () => {
    expect(marathonEndInstant('15:20', now)).toBe(new Date(2026, 8, 5, 15, 20).getTime());
  });
  it('rolls a passed or current minute into tomorrow', () => {
    expect(marathonEndInstant('14:30', now)).toBe(new Date(2026, 8, 6, 14, 30).getTime());
    expect(marathonEndInstant('14:29', now)).toBe(new Date(2026, 8, 6, 14, 29).getTime());
  });
  it('rolls midnight over the year boundary', () => {
    expect(marathonEndInstant('00:00', new Date(2026, 11, 31, 23, 59).getTime()))
      .toBe(new Date(2027, 0, 1).getTime());
  });
  it('rejects invalid clock values instead of Date normalizing them', () => {
    for (const draft of ['', '1:20', '12:3', '24:00', '12:60', '99:99', ' 12:00', '12:00:00']) {
      expect(marathonEndInstant(draft, now)).toBeNull();
    }
  });
  it('rejects an invalid reference clock', () => {
    expect(marathonEndInstant('12:00', NaN)).toBeNull();
    expect(marathonEndInstant('12:00', Infinity)).toBeNull();
  });
});
