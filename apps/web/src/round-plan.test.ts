import { describe, expect, it } from 'vitest';
import type { DomainState } from '@tomato-clock/domain';
import { MAX_MARATHON_ROUNDS, parseRoundPlan, planRoundsForDuration, plannedDurationMs, reconcileRoundPlan, type RoundPlan } from './round-plan';

const projectId = 'project-1';
const subtaskId = 'task-1';
const basePlan: RoundPlan = {
  projectId,
  subtaskId,
  totalRounds: 3,
  completedRounds: 0,
  status: 'focus',
  reportedSessionIds: [],
};

function completedSession(id: string, targetSubtaskId: string | null, at: string): DomainState['focusHistory'][number] {
  const instant = new Date(Date.parse(at));
  return {
    id, projectId, subtaskId: targetSubtaskId, status: 'completed',
    startedAt: new Date(instant.getTime() - 45 * 60_000).toISOString(), endsAt: at,
    plannedDurationMs: 2_700_000, timeZoneAtStart: 'Asia/Shanghai',
    completedAt: at, completedLocalDate: '2026-08-05', actualDurationMs: 2_700_000,
  };
}

function state(overrides: Partial<DomainState>): DomainState {
  return {
    projects: [],
    activeFocusSession: null,
    focusHistory: [],
    progressReports: [],
    ...overrides,
  } as DomainState;
}

describe('planned duration', () => {
  it('includes focus rounds and only the breaks between them', () => {
    expect(plannedDurationMs(45, 5, 1)).toBe(45 * 60_000);
    expect(plannedDurationMs(45, 5, 2)).toBe(95 * 60_000);
    expect(plannedDurationMs(45, 5, 4)).toBe(195 * 60_000);
    expect(plannedDurationMs(25, 0, 4)).toBe(100 * 60_000);
  });

  it('rejects values outside the settings contract', () => {
    expect(() => plannedDurationMs(0, 5, 1)).toThrow(RangeError);
    expect(() => plannedDurationMs(45, -1, 1)).toThrow(RangeError);
    expect(() => plannedDurationMs(45, 5, 25)).toThrow(RangeError);
  });
});

describe('marathon scheduling from a chosen end time', () => {
  it('derives focus and break rounds from the raw duration', () => {
    // 3 blocks of [45 focus + 5 break] ending with a final 45 focus = 145 minutes.
    expect(planRoundsForDuration(145 * 60_000, 45, 5)).toEqual({ rounds: 3, breaks: 2, usableMs: 145 * 60_000 });
    // 95 minutes fits 2 rounds + 1 break; 94 minutes only 1 round + no break.
    expect(planRoundsForDuration(95 * 60_000, 45, 5)?.rounds).toBe(2);
    expect(planRoundsForDuration(94 * 60_000, 45, 5)?.rounds).toBe(1);
    // Without breaks, rounds are a straight floor division.
    expect(planRoundsForDuration(100 * 60_000, 25, 0)).toEqual({ rounds: 4, breaks: 0, usableMs: 100 * 60_000 });
    // Not enough for a single round.
    expect(planRoundsForDuration(44 * 60_000, 45, 5)).toBeNull();
  });

  it('caps marathon rounds and reports the usable schedule', () => {
    const capped = planRoundsForDuration(48 * 60 * 60_000, 45, 5, 8);
    expect(capped).toEqual({ rounds: 8, breaks: 7, usableMs: 8 * 45 * 60_000 + 7 * 5 * 60_000 });
    expect(MAX_MARATHON_ROUNDS).toBe(24);
  });

  it('rejects a persisted plan with more than 24 rounds', () => {
    expect(parseRoundPlan({ ...basePlan, totalRounds: 25 }, projectId)).toBeNull();
    expect(parseRoundPlan({ ...basePlan, totalRounds: 24 }, projectId)).not.toBeNull();
  });

  it('preserves the marathon mode and end time when persisted', () => {
    const marathon: RoundPlan = { ...basePlan, mode: 'marathon', endAt: '2026-08-05T12:00:00.000Z', status: 'report' };
    expect(parseRoundPlan(marathon, projectId)).toEqual(marathon);
  });
});

describe('round-plan recovery', () => {
  it('accepts legacy persisted plans and initializes their recovery evidence', () => {
    expect(parseRoundPlan({ ...basePlan, reportedSessionIds: undefined }, projectId)?.reportedSessionIds).toEqual([]);
  });

  it('recovers a running one-round plan from the persisted domain session', () => {
    const activeFocusSession = {
      id: 'session-1', projectId, subtaskId,
      startedAt: '2026-08-05T08:00:00.000Z', endsAt: '2026-08-05T08:45:00.000Z',
      plannedDurationMs: 2_700_000, timeZoneAtStart: 'Asia/Shanghai',
      integrity: { effectiveExcursions: 0, backgroundedAt: null, backgroundReason: null, exemptionPending: false },
    } as NonNullable<DomainState['activeFocusSession']>;
    expect(reconcileRoundPlan(null, state({ activeFocusSession }), projectId)).toMatchObject({
      projectId, subtaskId, totalRounds: 1, completedRounds: 0, status: 'focus',
    });
  });

  it('keeps the report as the unique next step after a completed focus', () => {
    const focusHistory = [{
      id: 'session-1', projectId, subtaskId, status: 'completed',
      startedAt: '2026-08-05T08:00:00.000Z', endsAt: '2026-08-05T08:45:00.000Z',
      plannedDurationMs: 2_700_000, timeZoneAtStart: 'Asia/Shanghai',
      completedAt: '2026-08-05T08:45:00.000Z', completedLocalDate: '2026-08-05', actualDurationMs: 2_700_000,
    }] as DomainState['focusHistory'];
    expect(reconcileRoundPlan(basePlan, state({ focusHistory }), projectId)).toBe(basePlan);
  });

  it('advances once when the report committed before the UI plan update', () => {
    const focusHistory = [{
      id: 'session-1', projectId, subtaskId, status: 'completed',
      startedAt: '2026-08-05T08:00:00.000Z', endsAt: '2026-08-05T08:45:00.000Z',
      plannedDurationMs: 2_700_000, timeZoneAtStart: 'Asia/Shanghai',
      completedAt: '2026-08-05T08:45:00.000Z', completedLocalDate: '2026-08-05', actualDurationMs: 2_700_000,
    }] as DomainState['focusHistory'];
    const progressReports = [{ id: 'report-1', projectId, subtaskId, focusSessionIds: ['session-1'], progressBasisPoints: 2500, reportedAt: '2026-08-05T08:46:00.000Z' }] as DomainState['progressReports'];
    expect(reconcileRoundPlan(basePlan, state({ focusHistory, progressReports }), projectId)).toMatchObject({
      completedRounds: 1, status: 'ready', reportedSessionIds: ['session-1'],
    });
  });

  it('never advances an interrupted focus and expires breaks deterministically', () => {
    const focusHistory = [{
      id: 'session-1', projectId, subtaskId, status: 'interrupted',
      startedAt: '2026-08-05T08:00:00.000Z', endsAt: '2026-08-05T08:45:00.000Z',
      plannedDurationMs: 2_700_000, timeZoneAtStart: 'Asia/Shanghai',
      interruptedAt: '2026-08-05T08:20:00.000Z', interruptionReason: 'user-cancelled', interruptionCategory: null, actualDurationMs: 1_200_000,
    }] as DomainState['focusHistory'];
    expect(reconcileRoundPlan(basePlan, state({ focusHistory }), projectId)).toBeNull();
    const breakPlan = { ...basePlan, status: 'break' as const, completedRounds: 1, breakEndsAt: '2026-08-05T08:50:00.000Z' };
    expect(reconcileRoundPlan(breakPlan, state({}), projectId, Date.parse('2026-08-05T08:51:00.000Z'))).toMatchObject({ status: 'ready', completedRounds: 1 });
  });

  it('starts a habit break from the persisted completion instant and stops when the building is complete', () => {
    const habitPlan: RoundPlan = { ...basePlan, subtaskId: null, currentSessionId: 'session-1' };
    const focusHistory = [{
      id: 'session-1', projectId, subtaskId: null, status: 'completed',
      startedAt: '2026-08-05T08:00:00.000Z', endsAt: '2026-08-05T08:45:00.000Z',
      plannedDurationMs: 2_700_000, timeZoneAtStart: 'Asia/Shanghai',
      completedAt: '2026-08-05T08:45:00.000Z', completedLocalDate: '2026-08-05', actualDurationMs: 2_700_000,
    }] as DomainState['focusHistory'];
    const habitProject = {
      id: projectId, kind: 'habit', habit: { cycleNumber: 1, targetRounds: 10, completedFocusSessionIds: ['session-1'], awaitingNextBuilding: false },
    } as DomainState['projects'][number];
    expect(reconcileRoundPlan(habitPlan, state({ projects: [habitProject], focusHistory }), projectId, Date.parse('2026-08-05T08:46:00.000Z'), 300_000)).toMatchObject({
      completedRounds: 1, status: 'break', breakEndsAt: '2026-08-05T08:50:00.000Z', reportedSessionIds: ['session-1'],
    });
    expect(reconcileRoundPlan(habitPlan, state({ projects: [habitProject], focusHistory }), projectId, Date.parse('2026-08-05T08:51:00.000Z'), 300_000)).toMatchObject({
      completedRounds: 1, status: 'ready', reportedSessionIds: ['session-1'],
    });
    const awaiting = { ...habitProject, habit: { ...habitProject.habit!, completedFocusSessionIds: [], awaitingNextBuilding: true } };
    expect(reconcileRoundPlan(habitPlan, state({ projects: [awaiting], focusHistory }), projectId, Date.parse('2026-08-05T08:46:00.000Z'), 300_000)).toBeNull();
  });

  it('advances a completed marathon round into a break without waiting for a report', () => {
    const marathon: RoundPlan = { ...basePlan, mode: 'marathon', totalRounds: 3, currentSessionId: 'session-1' };
    const focusHistory = [completedSession('session-1', subtaskId, '2026-08-05T08:45:00.000Z')];
    expect(reconcileRoundPlan(marathon, state({ focusHistory }), projectId, Date.parse('2026-08-05T08:46:00.000Z'), 0, 300_000)).toMatchObject({
      mode: 'marathon', status: 'break', completedRounds: 1, breakEndsAt: '2026-08-05T08:50:00.000Z', reportedSessionIds: ['session-1'],
    });
  });

  it('enters the report phase after the final marathon round and stays until reported', () => {
    const marathon: RoundPlan = { ...basePlan, mode: 'marathon', totalRounds: 1, currentSessionId: 'session-1' };
    const focusHistory = [completedSession('session-1', subtaskId, '2026-08-05T08:45:00.000Z')];
    const afterRound = reconcileRoundPlan(marathon, state({ focusHistory }), projectId, Date.parse('2026-08-05T08:46:00.000Z'), 0, 300_000);
    expect(afterRound).toMatchObject({ mode: 'marathon', status: 'report', completedRounds: 1, reportedSessionIds: ['session-1'] });
    expect(reconcileRoundPlan(afterRound, state({ focusHistory }), projectId, Date.parse('2026-08-05T12:00:00.000Z'), 0, 300_000)).toBe(afterRound);
  });

  it('never advances an interrupted marathon round', () => {
    const marathon: RoundPlan = { ...basePlan, mode: 'marathon', totalRounds: 3, currentSessionId: 'session-1' };
    const focusHistory = [{
      id: 'session-1', projectId, subtaskId, status: 'interrupted',
      startedAt: '2026-08-05T08:00:00.000Z', endsAt: '2026-08-05T08:45:00.000Z',
      plannedDurationMs: 2_700_000, timeZoneAtStart: 'Asia/Shanghai',
      interruptedAt: '2026-08-05T08:20:00.000Z', interruptionReason: 'user-cancelled', interruptionCategory: null, actualDurationMs: 1_200_000,
    }] as DomainState['focusHistory'];
    expect(reconcileRoundPlan(marathon, state({ focusHistory }), projectId, Date.parse('2026-08-05T08:21:00.000Z'), 0, 300_000)).toBeNull();
  });
});
