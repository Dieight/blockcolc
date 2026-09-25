import { describe, expect, it } from 'vitest';
import { createInitialState, type DomainState, type FocusSession, type Project } from '@tomato-clock/domain';
import { ACHIEVEMENTS, newlyUnlockedAchievements, projectAchievements } from '../src/achievements.js';

function session(id: string, at: string, duration = 30 * 60_000, status: FocusSession['status'] = 'completed'): FocusSession {
  const base = { id, projectId: 'p', subtaskId: 's', startedAt: new Date(Date.parse(at) - duration).toISOString(), endsAt: at, plannedDurationMs: 45 * 60_000, timeZoneAtStart: 'UTC', actualDurationMs: duration };
  return status === 'interrupted'
    ? { ...base, status, interruptedAt: at, interruptionReason: 'user-cancelled', interruptionCategory: null }
    : { ...base, status, completedAt: at, completedLocalDate: at.slice(0, 10) };
}
function finite(): Project {
  return { id: 'p', title: '工坊', kind: 'finite', settlementIndex: 0, blueprintId: 'workshop', importedBlueprint: null,
    createdAt: '2026-09-01T00:00:00.000Z', status: 'monument', subtaskStructureLocked: true,
    subtasks: [{ id: 's', title: '收尾', order: 0, progressBasisPoints: 10000 }], habit: null };
}
function item(state: DomainState, id: string) { return projectAchievements(state).find(value => value.id === id)!; }

describe('achievements derived from retained history', () => {
  it('starts locked and does not mutate or add fields to the domain state', () => {
    const state = createInitialState(); const before = structuredClone(state);
    const result = projectAchievements(state);
    expect(result).toHaveLength(ACHIEVEMENTS.length);
    expect(new Set(ACHIEVEMENTS.map(item => item.id)).size).toBe(ACHIEVEMENTS.length);
    expect(result.every(item => !item.unlocked && item.progress === 0 && item.unlockedAt === null)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(state).toEqual(before);
  });
  it('counts normal and early rounds, not interruptions; actual time includes interrupted effort', () => {
    const state = createInitialState();
    state.focusHistory = [session('c', '2026-09-01T03:00:00.000Z', 20 * 60_000, 'interrupted'), session('a', '2026-09-01T01:00:00.000Z', 20 * 60_000), session('b', '2026-09-01T02:00:00.000Z', 20 * 60_000, 'completed-early')];
    expect(item(state, 'focus-first')).toMatchObject({ unlocked: true, progress: 1, unlockedAt: '2026-09-01T01:00:00.000Z' });
    expect(item(state, 'focus-ten').progress).toBe(2);
    expect(item(state, 'time-hour')).toMatchObject({ unlocked: true, unlockedAt: '2026-09-01T03:00:00.000Z' });
    expect(item(state, 'days-seven').progress).toBe(1);
  });
  it('uses integer actual duration and unlocks only at the recorded threshold crossing', () => {
    const state = createInitialState();
    state.focusHistory = Array.from({ length: 10 }, (_, index) => session(String(index), `2026-09-01T${String(index).padStart(2, '0')}:00:00.000Z`, 359_999));
    expect(item(state, 'time-hour')).toMatchObject({ progress: 59, unlocked: false });
    state.focusHistory.push(session('last', '2026-09-01T10:00:00.000Z', 10));
    expect(item(state, 'time-hour')).toMatchObject({ progress: 60, unlocked: true, unlockedAt: '2026-09-01T10:00:00.000Z' });
  });
  it('counts distinct frozen completion dates, without requiring a streak or current timezone', () => {
    const state = createInitialState('Pacific/Honolulu');
    state.focusHistory = Array.from({ length: 7 }, (_, index) => session(String(index), `2026-09-${String(index * 2 + 1).padStart(2, '0')}T23:59:00.000Z`));
    expect(item(state, 'days-seven')).toMatchObject({ unlocked: true, progress: 7, unlockedAt: '2026-09-13T23:59:00.000Z' });
    state.calendar.timeZone = 'Asia/Shanghai';
    expect(item(state, 'days-seven').progress).toBe(7);
  });
  it('combines completed finite and habit buildings and ignores decay or deleted source habits', () => {
    const state = createInitialState(); state.projects = [finite()];
    state.progressReports = [{ id: 'r', projectId: 'p', subtaskId: 's', focusSessionIds: ['a'], progressBasisPoints: 10000, reportedAt: '2026-09-03T00:00:00.000Z' }];
    state.habitBuildings = [{ id: 'h', habitProjectId: 'deleted-habit', habitTitle: '阅读', cycleNumber: 1, settlementIndex: 1, blueprintId: 'hut', importedBlueprint: null, targetRounds: 10, focusSessionIds: [], completedAt: '2026-09-02T00:00:00.000Z' }];
    expect(item(state, 'building-five').progress).toBe(2);
    expect(item(state, 'building-first').unlockedAt).toBe('2026-09-02T00:00:00.000Z');
    state.projects[0]!.status = 'deleted';
    expect(item(state, 'building-five').progress).toBe(2);
    state.projects[0]!.subtasks[0]!.progressBasisPoints = 9000;
    expect(item(state, 'building-five').progress).toBe(1);
  });
  it('does not invent a completion date when old facts cannot establish it', () => {
    const state = createInitialState(); state.projects = [finite()];
    expect(item(state, 'building-first')).toMatchObject({ unlocked: true, unlockedAt: null });
  });
  it('is deterministic across snapshot restoration and retains soft-deleted projects effort', () => {
    const state = createInitialState(); state.projects = [{ ...finite(), status: 'deleted' }];
    state.focusHistory = [session('a', '2026-09-01T01:00:00.000Z')];
    expect(projectAchievements(JSON.parse(JSON.stringify(state)))).toEqual(projectAchievements(state));
    expect(item(state, 'focus-first').unlocked).toBe(true);
  });
  it('does not replay historical unlocks on initial load, and emits only locked-to-unlocked changes', () => {
    const state = createInitialState(); const before = projectAchievements(state);
    state.focusHistory = [session('a', '2026-09-01T01:00:00.000Z')];
    const after = projectAchievements(state);
    expect(newlyUnlockedAchievements(null, after)).toEqual([]);
    expect(newlyUnlockedAchievements(before, after).map(item => item.id)).toEqual(['focus-first']);
    expect(newlyUnlockedAchievements(after, after)).toEqual([]);
    expect(newlyUnlockedAchievements(after, before)).toEqual([]);
  });
});
