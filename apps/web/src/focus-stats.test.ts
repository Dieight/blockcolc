import { describe, expect, it } from 'vitest';
import { createInitialState, type FocusSession } from '@tomato-clock/domain';
import { effectiveFocusMillisecondsByDate, focusHeatmapLevel, focusHourDistribution, focusSessionCountByDate, focusSessionEndedAt, focusSessionLocalDate, focusWindowSummary, projectFocusAllocation, settlementTotals } from './focus-stats';

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

  it('counts focus sessions per local date, ignoring zero-time interruptions', () => {
    const history: FocusSession[] = [
      { ...base, id: 'completed', status: 'completed', completedAt: '2026-08-04T16:15:00.000Z', completedLocalDate: '2026-08-05', actualDurationMs: 20_000 },
      { ...base, id: 'interrupted', status: 'interrupted', interruptedAt: '2026-08-04T16:20:00.000Z', interruptionReason: 'user-cancelled', interruptionCategory: 'fatigue', actualDurationMs: 40_000 },
      { ...base, id: 'zero', status: 'interrupted', interruptedAt: '2026-08-04T16:21:00.000Z', interruptionReason: 'user-cancelled', interruptionCategory: 'fatigue', actualDurationMs: 0 },
    ];
    expect(focusSessionCountByDate(history).get('2026-08-05')).toBe(2);
  });

  it('explains recent rhythm and project allocation using actual time from every outcome', () => {
    const state = createInitialState('Asia/Shanghai', [0, 6]);
    state.projects.push(
      { id: 'project-a', title: '论文', kind: 'finite', settlementIndex: 0, blueprintId: 'builtin-small-workshop', importedBlueprint: null, createdAt: '2026-08-01T00:00:00.000Z', status: 'active', subtaskStructureLocked: true, subtasks: [{ id: 'task-a', title: '正文', progressBasisPoints: 0, order: 0 }], habit: null },
      { id: 'project-b', title: '阅读', kind: 'habit', settlementIndex: 1, blueprintId: 'builtin-small-workshop', importedBlueprint: null, createdAt: '2026-08-01T00:00:00.000Z', status: 'paused', subtaskStructureLocked: true, subtasks: [], habit: { cycleNumber: 1, targetRounds: 10, completedFocusSessionIds: [], awaitingNextBuilding: false } },
    );
    state.activeProjectId = 'project-a';
    state.focusHistory.push(
      { id: 'focus-a', projectId: 'project-a', subtaskId: 'task-a', startedAt: '2026-08-10T00:00:00.000Z', endsAt: '2026-08-10T00:45:00.000Z', plannedDurationMs: 2_700_000, timeZoneAtStart: 'Asia/Shanghai', status: 'completed', completedAt: '2026-08-10T00:45:00.000Z', completedLocalDate: '2026-08-10', actualDurationMs: 2_700_000 },
      { id: 'focus-b', projectId: 'project-b', subtaskId: null, startedAt: '2026-08-11T00:00:00.000Z', endsAt: '2026-08-11T00:45:00.000Z', plannedDurationMs: 2_700_000, timeZoneAtStart: 'Asia/Shanghai', status: 'interrupted', interruptedAt: '2026-08-11T00:15:00.000Z', interruptionReason: 'user-cancelled', interruptionCategory: 'external-interruption', actualDurationMs: 900_000 },
    );

    expect(focusWindowSummary(state, '2026-08-12', 7)).toEqual({ minutes: 60, activeDays: 2, completed: 1, early: 0, interrupted: 1 });
    expect(projectFocusAllocation(state, '2026-08-12')).toEqual([
      { projectId: 'project-a', title: '论文', minutes: 45, share: 75 },
      { projectId: 'project-b', title: '阅读', minutes: 15, share: 25 },
    ]);
  });

  it('buckets effective time by the local hour it ended and totals the settlement', () => {
    const state = createInitialState('Asia/Shanghai', [0, 6]);
    state.projects.push(
      { id: 'project-a', title: '论文', kind: 'finite', settlementIndex: 0, blueprintId: 'builtin-small-workshop', importedBlueprint: null, createdAt: '2026-08-01T00:00:00.000Z', status: 'monument', subtaskStructureLocked: true, subtasks: [], habit: null },
    );
    state.habitBuildings.push(
      { id: 'building-1', habitProjectId: 'project-b', habitTitle: '阅读', cycleNumber: 1, settlementIndex: 1, blueprintId: 'builtin-small-workshop', importedBlueprint: null, targetRounds: 10, focusSessionIds: [], completedAt: '2026-08-11T12:00:00.000Z' },
    );
    state.focusHistory.push(
      { id: 'focus-a', projectId: 'project-a', subtaskId: 'task-a', startedAt: '2026-08-10T14:00:00.000Z', endsAt: '2026-08-10T14:45:00.000Z', plannedDurationMs: 2_700_000, timeZoneAtStart: 'Asia/Shanghai', status: 'completed', completedAt: '2026-08-10T14:45:00.000Z', completedLocalDate: '2026-08-10', actualDurationMs: 2_700_000 },
      { id: 'focus-b', projectId: 'project-a', subtaskId: 'task-a', startedAt: '2026-08-10T21:00:00.000Z', endsAt: '2026-08-10T21:15:00.000Z', plannedDurationMs: 900_000, timeZoneAtStart: 'Asia/Shanghai', status: 'interrupted', interruptedAt: '2026-08-10T21:15:00.000Z', interruptionReason: 'user-cancelled', interruptionCategory: 'fatigue', actualDurationMs: 900_000 },
    );

    const distribution = focusHourDistribution(state, '2026-08-12', 7);
    expect(distribution.find((bucket) => bucket.hour === 22)?.minutes).toBe(45);
    expect(distribution.find((bucket) => bucket.hour === 22)?.projects).toEqual([{ projectId: 'project-a', minutes: 45 }]);
    expect(distribution.find((bucket) => bucket.hour === 5)?.minutes).toBe(15);
    expect(distribution.filter((bucket) => bucket.minutes > 0)).toHaveLength(2);
    expect(settlementTotals(state)).toEqual({ totalMinutes: 60, completedRounds: 1, buildings: 2 });
  });

  it('keeps explicit marathon ownership separate and puts legacy shared time in its own row', () => {
    const state = createInitialState('UTC');
    state.projects.push(
      { id: 'project-a', title: '主线', kind: 'finite', settlementIndex: 0, blueprintId: 'builtin-small-workshop', importedBlueprint: null, createdAt: '2026-08-01T00:00:00.000Z', status: 'monument', subtaskStructureLocked: true, subtasks: [{ id: 'task-a', title: '正文', progressBasisPoints: 10000, order: 0 }], habit: null },
      { id: 'project-b', title: '支线', kind: 'finite', settlementIndex: 1, blueprintId: 'builtin-small-workshop', importedBlueprint: null, createdAt: '2026-08-01T00:00:00.000Z', status: 'monument', subtaskStructureLocked: true, subtasks: [{ id: 'task-b', title: '另一项', progressBasisPoints: 10000, order: 0 }], habit: null },
    );
    state.focusHistory.push(
      { id: 'explicit-a', projectId: 'project-a', subtaskId: 'task-a', marathon: true, startedAt: '2026-08-10T00:00:00.000Z', endsAt: '2026-08-10T00:25:00.000Z', plannedDurationMs: 1_500_000, timeZoneAtStart: 'UTC', status: 'completed', completedAt: '2026-08-10T00:25:00.000Z', completedLocalDate: '2026-08-10', actualDurationMs: 1_500_000 },
      { id: 'explicit-b', projectId: 'project-a', subtaskId: 'task-a', marathon: true, startedAt: '2026-08-10T01:00:00.000Z', endsAt: '2026-08-10T01:15:00.000Z', plannedDurationMs: 900_000, timeZoneAtStart: 'UTC', status: 'completed', completedAt: '2026-08-10T01:15:00.000Z', completedLocalDate: '2026-08-10', actualDurationMs: 900_000 },
      { id: 'legacy-shared', projectId: 'project-a', subtaskId: 'task-a', marathon: true, startedAt: '2026-08-10T02:00:00.000Z', endsAt: '2026-08-10T02:10:00.000Z', plannedDurationMs: 600_000, timeZoneAtStart: 'UTC', status: 'completed', completedAt: '2026-08-10T02:10:00.000Z', completedLocalDate: '2026-08-10', actualDurationMs: 600_000 },
    );
    state.progressReports = [
      { id: 'explicit-a-report', projectId: 'project-a', subtaskId: 'task-a', focusSessionIds: ['explicit-a'], progressBasisPoints: 10000, reportedAt: '2026-08-10T03:00:00.000Z', allocation: 'explicit' },
      { id: 'explicit-b-report', projectId: 'project-b', subtaskId: 'task-b', focusSessionIds: ['explicit-b'], progressBasisPoints: 10000, reportedAt: '2026-08-10T03:00:00.000Z', allocation: 'explicit' },
      { id: 'legacy-a-report', projectId: 'project-a', subtaskId: 'task-a', focusSessionIds: ['legacy-shared'], progressBasisPoints: 10000, reportedAt: '2026-08-10T03:00:00.000Z', shared: true },
      { id: 'legacy-b-report', projectId: 'project-b', subtaskId: 'task-b', focusSessionIds: ['legacy-shared'], progressBasisPoints: 10000, reportedAt: '2026-08-10T03:00:00.000Z', shared: true },
    ];
    expect(projectFocusAllocation(state, '2026-08-10', 1)).toEqual([
      { projectId: 'project-a', title: '主线', minutes: 25, share: 50 },
      { projectId: 'project-b', title: '支线', minutes: 15, share: 30 },
      { projectId: 'unallocated', title: '未分配 / 不可追溯', minutes: 10, share: 20, unallocated: true },
    ]);
  });
});
