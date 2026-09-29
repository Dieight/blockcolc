import { describe, expect, it } from 'vitest';
import { decorationDatesByProject } from './world-projection';

describe('world decoration projection', () => {
  it('preserves the earliest non-interrupted completion match and skips imported reward dates', () => {
    const state = {
      focusHistory: [
        { completedAt: 'same-time', status: 'completed', projectId: 'first-project' },
        { completedAt: 'same-time', status: 'completed', projectId: 'second-project' },
        { completedAt: 'interrupted-time', status: 'interrupted', projectId: 'interrupted-project' },
        { completedAt: 'normal-time', status: 'completed', projectId: 'normal-project' },
      ],
      dailyGoals: [
        { date: '2026-01-01', reachedAt: 'same-time' },
        { date: '2026-01-02', reachedAt: 'interrupted-time' },
        { date: '2026-01-03', reachedAt: 'normal-time' },
        { date: '2026-01-04', reachedAt: 'missing-time' },
        { date: '2026-01-05', reachedAt: 'normal-time' },
      ],
      decorationRewards: [{ date: '2026-01-05' }],
    } as never;

    expect([...decorationDatesByProject(state)]).toEqual([
      ['first-project', ['2026-01-01']],
      ['normal-project', ['2026-01-03']],
    ]);
  });

  it('does not create an empty entry for goals without a completion timestamp', () => {
    const state = {
      focusHistory: [],
      dailyGoals: [{ date: '2026-02-01', reachedAt: null }],
      decorationRewards: [],
    } as never;
    expect(decorationDatesByProject(state)).toEqual(new Map());
  });
});
