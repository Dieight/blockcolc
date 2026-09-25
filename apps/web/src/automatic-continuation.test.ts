import { describe, expect, it } from 'vitest';
import type { DomainState, FocusSession } from '@tomato-clock/domain';
import {
  parseRoundPlan,
  automaticContinuationStartAt,
  reconcileRoundPlan,
  reserveAutomaticContinuation,
  type AutomaticContinuationSchedule,
  type RoundPlan,
} from './round-plan';

const projectId = 'project-auto';
const subtaskId = 'subtask-auto';
const authorization: AutomaticContinuationSchedule = {
  authorizationId: 'plan-a', focusDurationMs: 60_000, breakDurationMs: 5 * 60_000,
};
const base: RoundPlan = {
  projectId, subtaskId, mode: 'marathon', totalRounds: 3, completedRounds: 1,
  status: 'break', breakStartedAt: '2026-09-23T09:00:00.000Z',
  breakEndsAt: '2026-09-23T09:05:00.000Z', reportedSessionIds: ['session-1'],
  automaticContinuation: authorization,
};

function completedSession(id: string, startedAt: string, plannedDurationMs: number, extra: Partial<FocusSession> = {}): FocusSession {
  const endsAt = new Date(Date.parse(startedAt) + plannedDurationMs).toISOString();
  return {
    id, projectId, subtaskId, startedAt, endsAt, plannedDurationMs, timeZoneAtStart: 'UTC',
    status: 'completed', completedAt: endsAt, completedLocalDate: '2026-09-23', actualDurationMs: plannedDurationMs,
    ...extra,
  } as FocusSession;
}

function finiteProject() {
  return { id: projectId, kind: 'finite', status: 'active', subtasks: [{ id: subtaskId }] } as DomainState['projects'][number];
}

function state(overrides: Partial<DomainState> = {}): DomainState {
  return {
    projects: [finiteProject()], activeProjectId: projectId, activeFocusSession: null,
    focusHistory: [completedSession('session-1', '2026-09-23T08:00:00.000Z', 60_000, { marathon: true })],
    progressReports: [], ...overrides,
  } as DomainState;
}

describe('durable automatic continuation contract', () => {
  it('parses the opt-in schedule and rejects malformed write-ahead reservations', () => {
    expect(parseRoundPlan({ ...base, automaticContinuation: authorization }, projectId)?.automaticContinuation).toEqual(authorization);
    expect(parseRoundPlan({
      ...base,
      automaticContinuation: {
        ...authorization,
        nextRoundStartsAt: '2026-09-23T09:05:00.000Z',
        reservation: { round: 3, sessionId: 'auto-plan-a-round-2', scheduledAt: '2026-09-23T09:05:00.000Z' },
      },
    }, projectId)).toBeNull();
    expect(parseRoundPlan({ ...base, automaticContinuation: { ...authorization, reservation: { sessionId: 'missing-round' } } }, projectId)).toBeNull();
    expect(parseRoundPlan({
      ...base,
      automaticContinuation: { ...authorization, nextRoundStartsAt: '2026-09-23 09:05:00' },
    }, projectId)).toBeNull();
    expect(parseRoundPlan({ ...base, automaticContinuation: undefined }, projectId)?.automaticContinuation).toBeUndefined();
  });

  it('reserves an elapsed break at its exact deadline and repeats the same identity', () => {
    const current = state();
    const ready = reconcileRoundPlan(base, current, projectId, Date.parse('2026-09-23T09:15:00.000Z'))!;
    expect(ready).toMatchObject({
      status: 'ready',
      automaticContinuation: { nextRoundStartsAt: '2026-09-23T09:05:00.000Z' },
    });
    const first = reserveAutomaticContinuation(ready, current, Date.parse('2026-09-23T09:15:00.000Z'))!;
    expect(first).toMatchObject({
      sessionId: 'auto-plan-a-round-2', scheduledAt: '2026-09-23T09:05:00.000Z', plannedDurationMs: 60_000,
      plan: { automaticContinuation: { reservation: { round: 2, sessionId: 'auto-plan-a-round-2', scheduledAt: '2026-09-23T09:05:00.000Z' } } },
    });
    expect(reserveAutomaticContinuation(first.plan, current, Date.parse('2026-09-23T09:15:00.000Z'))).toEqual(first);
    expect(parseRoundPlan(first.plan, projectId)).toEqual(first.plan);
  });

  it('recovers a committed reserved session once, then schedules the next elapsed round', () => {
    const scheduledAt = '2026-09-23T09:05:00.000Z';
    const reservedPlan: RoundPlan = {
      ...base, status: 'ready', breakEndsAt: undefined, breakStartedAt: undefined,
      automaticContinuation: {
        ...authorization, nextRoundStartsAt: scheduledAt,
        reservation: { round: 2, sessionId: 'auto-plan-a-round-2', scheduledAt },
      },
    };
    const round2Active = {
      id: 'auto-plan-a-round-2', projectId, subtaskId, startedAt: scheduledAt,
      endsAt: '2026-09-23T09:06:00.000Z', plannedDurationMs: 60_000, timeZoneAtStart: 'UTC',
      marathon: true, integrity: { effectiveExcursions: 0, backgroundedAt: null, backgroundReason: null, exemptionPending: false },
    } as NonNullable<DomainState['activeFocusSession']>;
    const recoveredActive = reconcileRoundPlan(reservedPlan, state({ activeFocusSession: round2Active }), projectId, Date.parse('2026-09-23T09:05:30.000Z'))!;
    expect(recoveredActive).toMatchObject({
      status: 'focus', currentSessionId: round2Active.id,
      automaticContinuation: { authorizationId: 'plan-a' },
    });
    expect(recoveredActive.automaticContinuation?.reservation).toBeUndefined();
    expect(recoveredActive.automaticContinuation?.nextRoundStartsAt).toBeUndefined();

    const round2 = completedSession(round2Active.id, scheduledAt, 60_000, { marathon: true });
    const snapshot = state({ focusHistory: [...state().focusHistory, round2] });
    const recovered = reconcileRoundPlan(reservedPlan, snapshot, projectId, Date.parse('2026-09-23T09:15:00.000Z'))!;
    expect(recovered).toMatchObject({
      completedRounds: 2, status: 'ready', reportedSessionIds: ['session-1', round2.id],
      automaticContinuation: { nextRoundStartsAt: '2026-09-23T09:11:00.000Z' },
    });
    expect(recovered.automaticContinuation?.reservation).toBeUndefined();
    expect(reconcileRoundPlan(recovered, snapshot, projectId, Date.parse('2026-09-23T09:15:00.000Z'))?.completedRounds).toBe(2);
    expect(reserveAutomaticContinuation(recovered, snapshot, Date.parse('2026-09-23T09:15:00.000Z'))).toMatchObject({
      sessionId: 'auto-plan-a-round-3', scheduledAt: '2026-09-23T09:11:00.000Z',
    });
  });

  it('waits for explicit progress reporting in an ordinary finite plan', () => {
    const current = state({ focusHistory: [completedSession('session-1', '2026-09-23T08:00:00.000Z', 60_000)] });
    const finitePlan: RoundPlan = {
      ...base, mode: 'rounds', status: 'ready',
      automaticContinuation: { ...authorization, nextRoundStartsAt: '2026-09-23T09:05:00.000Z' },
    };
    expect(reserveAutomaticContinuation(finitePlan, current, Date.parse('2026-09-23T09:10:00.000Z'))).toBeNull();
    current.progressReports.push({
      id: 'report-1', projectId, subtaskId, focusSessionIds: ['session-1'], progressBasisPoints: 100,
      reportedAt: '2026-09-23T09:07:00.000Z',
    });
    expect(reserveAutomaticContinuation(finitePlan, current, Date.parse('2026-09-23T09:10:00.000Z'))).toMatchObject({
      sessionId: 'auto-plan-a-round-2', scheduledAt: '2026-09-23T09:07:00.000Z',
    });
  });

  it('reconstructs marathon recovery deadlines from endsAt plus the frozen break, never from focus end alone', () => {
    const session = completedSession('session-1', '2026-09-23T09:00:00.000Z', 60_000, { marathon: true });
    const recoveredPlan: RoundPlan = {
      ...base, status: 'ready', breakStartedAt: undefined, breakEndsAt: undefined,
      automaticContinuation: { ...authorization },
    };
    const current = state({ focusHistory: [session] });
    expect(automaticContinuationStartAt(recoveredPlan, current)).toBe('2026-09-23T09:06:00.000Z');

    const ordinary = { ...recoveredPlan, mode: 'rounds' as const };
    current.progressReports.push({
      id: 'late-report', projectId, subtaskId, focusSessionIds: ['session-1'], progressBasisPoints: 100,
      reportedAt: '2026-09-23T09:09:00.000Z',
    });
    expect(automaticContinuationStartAt(ordinary, current)).toBe('2026-09-23T09:09:00.000Z');
  });

  it('starts recovered ordinary finite breaks at the durable report instant', () => {
    const session = completedSession('session-1', '2026-09-23T09:00:00.000Z', 60_000);
    const current = state({
      focusHistory: [session],
      progressReports: [{
        id: 'late-report', projectId, subtaskId, focusSessionIds: [session.id], progressBasisPoints: 5_000,
        reportedAt: '2026-09-23T09:10:00.000Z',
      }],
    });
    const interruptedUiWrite: RoundPlan = {
      ...base, mode: 'rounds', status: 'focus', completedRounds: 0, currentSessionId: session.id,
      breakStartedAt: undefined, breakEndsAt: undefined, reportedSessionIds: [],
      automaticContinuation: { ...authorization },
    };

    expect(reconcileRoundPlan(interruptedUiWrite, current, projectId, Date.parse('2026-09-23T09:11:00.000Z'))).toMatchObject({
      status: 'break', completedRounds: 1,
      breakStartedAt: '2026-09-23T09:10:00.000Z',
      breakEndsAt: '2026-09-23T09:15:00.000Z',
    });
  });

  it('does not reconcile a write-ahead ID that belongs to a different focus', () => {
    const reservation = {
      round: 2, sessionId: 'auto-plan-a-round-2', scheduledAt: '2026-09-23T09:05:00.000Z',
    };
    const reservedPlan: RoundPlan = {
      ...base, status: 'ready', breakEndsAt: undefined, breakStartedAt: undefined,
      automaticContinuation: { ...authorization, nextRoundStartsAt: reservation.scheduledAt, reservation },
    };
    const collision = completedSession(reservation.sessionId, '2026-09-23T09:06:00.000Z', 60_000, { marathon: true });
    expect(reconcileRoundPlan(reservedPlan, state({ focusHistory: [collision] }), projectId, Date.parse('2026-09-23T09:10:00.000Z'))).toBeNull();
  });

  it('stops non-deferred habit automation at a completed building and defers minimal settlement', () => {
    const habitProject = {
      ...finiteProject(), kind: 'habit', subtasks: [],
      habit: { cycleNumber: 1, targetRounds: 10, completedFocusSessionIds: ['session-1'], awaitingNextBuilding: true },
    } as DomainState['projects'][number];
    const habitPlan: RoundPlan = {
      ...base, subtaskId: null, mode: 'marathon', status: 'ready',
      automaticContinuation: { ...authorization, nextRoundStartsAt: '2026-09-23T09:05:00.000Z' },
    };
    const completedHabitState = state({ projects: [habitProject], focusHistory: [completedSession('session-1', '2026-09-23T08:00:00.000Z', 60_000, { marathon: true, subtaskId: null })] });
    expect(reserveAutomaticContinuation(habitPlan, completedHabitState, Date.parse('2026-09-23T09:15:00.000Z'))).toBeNull();

    const deferredHabit = {
      ...finiteProject(), kind: 'habit', subtasks: [],
      habit: { cycleNumber: 1, targetRounds: 2, completedFocusSessionIds: [], awaitingNextBuilding: false },
    } as DomainState['projects'][number];
    const firstDeferred = completedSession('session-1', '2026-09-23T08:00:00.000Z', 60_000, {
      marathon: true, deferredSettlement: true, subtaskId: null,
    });
    const deferredState = state({ projects: [deferredHabit], focusHistory: [firstDeferred] });
    const minimalPlan: RoundPlan = {
      ...habitPlan, totalRounds: 2, completedRounds: 1, deferredSettlement: true,
      status: 'ready', reportedSessionIds: [firstDeferred.id],
      automaticContinuation: { ...authorization, nextRoundStartsAt: '2026-09-23T09:05:00.000Z' },
    };
    const deferred = reserveAutomaticContinuation(minimalPlan, deferredState, Date.parse('2026-09-23T09:15:00.000Z'));
    expect(deferred).toMatchObject({ plan: { deferredSettlement: true }, sessionId: 'auto-plan-a-round-2' });
    const finalRound = completedSession('auto-plan-a-round-2', deferred!.scheduledAt, 60_000, { marathon: true, deferredSettlement: true, subtaskId: null });
    const finalState = state({ projects: [deferredHabit], focusHistory: [...deferredState.focusHistory, finalRound] });
    const finalPlan = reconcileRoundPlan({ ...deferred!.plan, status: 'focus', currentSessionId: finalRound.id }, finalState, projectId, Date.parse('2026-09-23T09:15:00.000Z'))!;
    expect(finalPlan).toMatchObject({
      status: 'report', completedRounds: 2, deferredSettlement: true,
    });
    expect(finalState.projects[0]?.habit?.completedFocusSessionIds).toEqual([]);
    expect(reserveAutomaticContinuation({
      ...finalPlan, totalRounds: 3, status: 'ready',
      automaticContinuation: { ...authorization, nextRoundStartsAt: '2026-09-23T09:11:00.000Z' },
    }, finalState, Date.parse('2026-09-23T09:15:00.000Z'))).toBeNull();
  });

  it('revokes automatic continuation after an interrupted reserved round', () => {
    const plan: RoundPlan = {
      ...base, status: 'focus', currentSessionId: 'auto-plan-a-round-2',
      automaticContinuation: {
        ...authorization, nextRoundStartsAt: '2026-09-23T09:05:00.000Z',
        reservation: { round: 2, sessionId: 'auto-plan-a-round-2', scheduledAt: '2026-09-23T09:05:00.000Z' },
      },
    };
    const interrupted = {
      id: 'auto-plan-a-round-2', projectId, subtaskId, startedAt: '2026-09-23T09:05:00.000Z',
      endsAt: '2026-09-23T09:06:00.000Z', plannedDurationMs: 60_000, timeZoneAtStart: 'UTC',
      status: 'interrupted', interruptedAt: '2026-09-23T09:05:30.000Z', interruptionReason: 'user-cancelled',
      interruptionCategory: null, actualDurationMs: 30_000, marathon: true,
    } as FocusSession;
    const result = reconcileRoundPlan(plan, state({ focusHistory: [...state().focusHistory, interrupted] }), projectId, Date.parse('2026-09-23T09:06:00.000Z'))!;
    expect(result).toMatchObject({ status: 'ready', completedRounds: 1 });
    expect(result.automaticContinuation).toBeUndefined();
    expect(reserveAutomaticContinuation(result, state(), Date.parse('2026-09-23T09:10:00.000Z'))).toBeNull();
  });
});
