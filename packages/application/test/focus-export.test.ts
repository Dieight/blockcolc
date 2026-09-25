import { describe, expect, it } from 'vitest';
import { createInitialState, type FocusSession } from '@tomato-clock/domain';
import { focusExportDate, projectFocusExportDays, projectFocusExportSnapshot } from '../src/focus-export.js';

function history(id: string, start: string, duration: number, status: FocusSession['status'] = 'completed'): FocusSession {
  const end = new Date(Date.parse(start) + duration).toISOString();
  const base = { id, projectId: 'private-project', subtaskId: 'private-subtask', startedAt: start, endsAt: end,
    plannedDurationMs: duration, timeZoneAtStart: 'Pacific/Honolulu', actualDurationMs: duration };
  return status === 'interrupted'
    ? { ...base, status, interruptedAt: end, interruptionReason: 'user-cancelled', interruptionCategory: null }
    : { ...base, status, completedAt: end, completedLocalDate: end.slice(0, 10) };
}
function running() {
  const state = createInitialState();
  state.activeFocusSession = { id: 'secret-session', projectId: 'private-project', subtaskId: null,
    startedAt: '2026-09-07T01:00:00.000Z', endsAt: '2026-09-07T01:25:00.000Z', plannedDurationMs: 1_500_000,
    timeZoneAtStart: 'UTC', integrity: { effectiveExcursions: 0, backgroundedAt: null, backgroundReason: null, exemptionPending: false } };
  return state;
}

describe('read-only focus export', () => {
  it('exports exactly five fields and no private identifiers; idle does not leak last task', () => {
    const state = createInitialState();
    state.focusHistory = [history('secret', '2026-09-07T00:00:00.000Z', 600_000)];
    const before = structuredClone(state);
    expect(projectFocusExportSnapshot(state, '2026-09-07T01:00:00.000Z')).toEqual({
      currentName: null, startedAt: null, estimatedElapsedMs: 0, estimatedEndsAt: null, todayActualFocusMs: 600_000,
    });
    expect(state).toEqual(before);
  });
  it('maps minimal, marathon and unnamed habit without exporting parent titles', () => {
    const state = running();
    expect(projectFocusExportSnapshot(state, '2026-09-07T01:05:00.000Z').currentName).toBe('专注中');
    state.activeFocusSession!.marathon = true;
    expect(projectFocusExportSnapshot(state, '2026-09-07T01:05:00.000Z').currentName).toBe('马拉松');
    state.activeFocusSession!.deferredSettlement = true;
    const output = projectFocusExportSnapshot(state, '2026-09-07T01:05:00.000Z');
    expect(output).toMatchObject({ currentName: '极简模式', estimatedElapsedMs: 300_000, todayActualFocusMs: 0 });
    expect(JSON.stringify(output)).not.toContain('secret');
  });
  it('caps overdue estimates without manufacturing history', () => {
    const state = running();
    expect(projectFocusExportSnapshot(state, '2026-09-07T02:00:00.000Z')).toMatchObject({ estimatedElapsedMs: 1_500_000, todayActualFocusMs: 0 });
    expect(state.focusHistory).toEqual([]);
  });
  it('uses saved break context, excludes break time, and ignores stale break while focusing', () => {
    const rest = { breakInterval: { startedAt: '2026-09-07T01:00:00.000Z', endsAt: '2026-09-07T01:10:00.000Z' } };
    expect(projectFocusExportSnapshot(createInitialState(), '2026-09-07T01:05:00.000Z', rest)).toMatchObject({ currentName: '休息', estimatedElapsedMs: 300_000, todayActualFocusMs: 0 });
    expect(projectFocusExportSnapshot(running(), '2026-09-07T01:05:00.000Z', rest).currentName).toBe('专注中');
    expect(projectFocusExportSnapshot(createInitialState(), '2026-09-07T01:10:00.000Z', rest).currentName).toBeNull();
  });
  it('splits actual intervals at UTC+8 midnight, including early and interrupted work', () => {
    const state = createInitialState('Pacific/Honolulu');
    state.focusHistory = [history('a', '2026-09-06T15:50:00.000Z', 1_200_000),
      history('b', '2026-09-07T01:00:00.000Z', 60_000, 'completed-early'), history('c', '2026-09-07T02:00:00.000Z', 30_000, 'interrupted')];
    expect(projectFocusExportDays(state, '2026-09-06', '2026-09-07', '2026-09-07T03:00:00.000Z')).toEqual([
      { date: '2026-09-06', actualFocusMs: 600_000, confirmed: true },
      { date: '2026-09-07', actualFocusMs: 690_000, confirmed: false },
    ]);
  });
  it('keeps a closed day pending until its active cross-midnight interval is reconciled', () => {
    const state = running();
    state.activeFocusSession!.startedAt = '2026-09-06T15:50:00.000Z';
    state.activeFocusSession!.endsAt = '2026-09-06T16:10:00.000Z';
    expect(projectFocusExportDays(state, '2026-09-06', '2026-09-07', '2026-09-07T03:00:00.000Z').map(day => day.confirmed)).toEqual([false, false]);
  });
  it('has half-open boundaries and leap-day/zero-day results', () => {
    expect(focusExportDate('2024-02-28T16:00:00.000Z')).toBe('2024-02-29');
    const state = createInitialState(); state.focusHistory = [history('a', '2024-02-28T15:50:00.000Z', 600_000)];
    expect(projectFocusExportDays(state, '2024-02-28', '2024-02-29', '2024-03-01T00:00:00.000Z').map(day => day.actualFocusMs)).toEqual([600_000, 0]);
  });
  it('fails closed for invalid dates, future ranges, future history and duplicate records', () => {
    const state = createInitialState();
    expect(() => projectFocusExportDays(state, '2026-02-30', '2026-03-01', '2026-09-07T00:00:00Z')).toThrow();
    expect(() => projectFocusExportDays(state, '2026-09-07', '2026-09-08', '2026-09-07T00:00:00Z')).toThrow();
    const record = history('a', '2026-09-07T00:00:00.000Z', 60_000); state.focusHistory = [record];
    expect(() => projectFocusExportSnapshot(state, '2026-09-06T00:00:00Z')).toThrow();
    state.focusHistory.push(record);
    expect(() => projectFocusExportSnapshot(state, '2026-09-07T01:00:00Z')).toThrow();
  });
});
