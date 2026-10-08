import { describe, expect, it } from 'vitest';
import { goalSliderCommand } from './DailyGoalControl';
describe('daily goal slider commands', () => {
  it('turns zero into disable, never a zero target or a spurious reward', () => {
    expect(goalSliderCommand('2026-10-07', 0)).toEqual({ type: 'DisableDailyGoal', date: '2026-10-07' });
  });
  it('keeps integer goals at both ends of the range', () => {
    for (const rounds of [1, 8, 20]) expect(goalSliderCommand('2026-10-07', rounds)).toEqual({ type: 'SetDailyGoal', date: '2026-10-07', targetPomodoros: rounds });
  });
  it('rejects invalid UI values without widening the domain range', () => {
    for (const rounds of [-1, 21, .5, NaN]) expect(() => goalSliderCommand('2026-10-07', rounds)).toThrow();
  });
});
