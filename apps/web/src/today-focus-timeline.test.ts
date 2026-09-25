import { describe, expect, it } from 'vitest';
import { createInitialState, type DomainState, type FocusSession } from '@tomato-clock/domain';
import { projectTodayFocusTimeline } from './today-focus-timeline';

function seed(zone = 'Asia/Shanghai') {
  const state = createInitialState(zone);
  state.projects.push({ id: 'p', title: '论文', kind: 'finite', settlementIndex: 0,
    blueprintId: 'cottage', importedBlueprint: null, createdAt: '2026-01-01T00:00:00.000Z',
    status: 'active', subtaskStructureLocked: true, habit: null,
    subtasks: [{ id: 's', title: '正文', progressBasisPoints: 0, order: 0 }] });
  return state;
}

function add(state: DomainState, start: string, end: string, extra: Partial<FocusSession> = {}) {
  const duration = Date.parse(end) - Date.parse(start);
  state.focusHistory.push({ id: `f${state.focusHistory.length}`, projectId: 'p', subtaskId: 's',
    startedAt: start, endsAt: end, plannedDurationMs: duration, actualDurationMs: duration,
    timeZoneAtStart: state.calendar.timeZone, status: 'completed', completedAt: end,
    completedLocalDate: '2026-09-21', ...extra } as FocusSession);
}

describe('today focus timeline', () => {
  it('splits actual intervals across bins, leaving idle gaps empty', () => {
    const state = seed();
    add(state, '2026-09-21T00:10:00Z', '2026-09-21T00:35:00Z');
    const data = projectTodayFocusTimeline(state, '2026-09-21');
    expect(data.totalMs).toBe(25 * 60_000);
    expect(data.series[0]!.milliseconds.slice(31, 36)).toEqual([0, 5 * 60_000, 15 * 60_000, 5 * 60_000, 0]);
    expect(data.series[0]!.title).toBe('论文 · 正文');
    expect(data.completedRounds).toBe(1);
  });

  it('clips a crossing-midnight round to the actual day without changing goal counts', () => {
    const state = seed();
    add(state, '2026-09-20T15:50:00Z', '2026-09-20T16:20:00Z');
    expect(projectTodayFocusTimeline(state, '2026-09-20').totalMs).toBe(10 * 60_000);
    expect(projectTodayFocusTimeline(state, '2026-09-21').totalMs).toBe(20 * 60_000);
    expect(projectTodayFocusTimeline(state, '2026-09-21').completedRounds).toBe(1);
  });

  it('does not claim a deferred host subtask, or count interruptions as completed rounds', () => {
    const state = seed();
    add(state, '2026-09-21T00:00:00Z', '2026-09-21T00:15:00Z', { subtaskId: null, marathon: true, deferredSettlement: true });
    add(state, '2026-09-21T01:00:00Z', '2026-09-21T01:05:00Z', {
      status: 'interrupted', interruptedAt: '2026-09-21T01:05:00Z', interruptionReason: 'user-cancelled', interruptionCategory: null,
    });
    const data = projectTodayFocusTimeline(state, '2026-09-21');
    expect(data.totalMs).toBe(20 * 60_000);
    expect(data.completedRounds).toBe(1);
    expect(data.series.find(row => row.unallocated)?.totalMs).toBe(15 * 60_000);
  });

  it('preserves seconds and does not smear a short interruption across the planned duration', () => {
    const state = seed();
    add(state, '2026-09-21T00:14:45Z', '2026-09-21T00:15:15Z');
    const row = projectTodayFocusTimeline(state, '2026-09-21').series[0]!;
    expect(row.totalMs).toBe(30_000);
    expect(row.milliseconds.slice(32, 34)).toEqual([15_000, 15_000]);
  });

  it('accumulates both real occurrences of the autumn DST hour', () => {
    const state = seed('America/New_York');
    add(state, '2026-11-01T05:00:00Z', '2026-11-01T07:00:00Z');
    const data = projectTodayFocusTimeline(state, '2026-11-01');
    expect(data.totalMs).toBe(120 * 60_000);
    expect(data.series[0]!.milliseconds.slice(4, 8)).toEqual(Array(4).fill(30 * 60_000));
  });

  it('keeps no-data and disabled goals honest and rejects malformed dates', () => {
    const state = seed();
    state.dailyGoals.push({ date: '2026-09-21', targetPomodoros: 8, reachedAt: null, enabled: false });
    expect(projectTodayFocusTimeline(state, '2026-09-21')).toMatchObject({ totalMs: 0, targetRounds: null, series: [] });
    expect(() => projectTodayFocusTimeline(state, '2026-02-30')).toThrow('Invalid timeline date');
  });
});
