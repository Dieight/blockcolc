import { describe, expect, it } from 'vitest';
import type { FocusSession } from '@tomato-clock/domain';
import { effectiveFocusMillisecondsByDate, focusHeatmapLevel, focusSessionEndedAt, focusSessionLocalDate } from './focus-stats';

const base = {
  projectId: 'project',
  subtaskId: 'subtask',
  plannedDurationMs: 25 * 60_000,
  startedAt: '2026-08-04T15:50:00.000Z',
  endsAt: '2026-08-04T16:15:00.000Z',
  timeZoneAtStart: 'Asia/Shanghai',
} as const;

describe('effective focus statistics', () => {
  it('includes interrupted actual time without treating the interruption as a completion', () => {
    const history: FocusSession[] = [
      { ...base, id: 'completed', status: 'completed', completedAt: '2026-08-04T16:15:00.000Z', completedLocalDate: '2026-08-05', actualDurationMs: 20_000 },
      { ...base, id: 'interrupted', status: 'interrupted', interruptedAt: '2026-08-04T16:20:00.000Z', interruptionReason: 'user-cancelled', interruptionCategory: 'fatigue', actualDurationMs: 40_000 },
    ];

    expect(effectiveFocusMillisecondsByDate(history).get('2026-08-05')).toBe(60_000);
    expect(focusSessionEndedAt(history[1]!)).toBe('2026-08-04T16:20:00.000Z');
    expect(focusSessionLocalDate(history[1]!)).toBe('2026-08-05');
  });

  it('maps heatmap minutes at the V13 thresholds', () => {
    expect([0, 1, 89, 90, 179, 180, 269, 270, 359, 360].map(focusHeatmapLevel)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4, 5,
    ]);
  });
});
