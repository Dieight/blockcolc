import type { ApplicationCommand, ApplicationResult } from '@tomato-clock/application';
import type { DomainState, FocusInterruptionCategory } from '@tomato-clock/domain';
import type { FocusPreferences } from './app-types';
import { marathonEndInstant } from './marathon-end-time';
import { unsettledMarathonSessions } from './marathon-settlement';
import { createAutomaticContinuationSchedule, newAutomaticContinuationAuthorizationId, planRoundsForDuration, reconcileRoundPlan, type RoundPlan } from './round-plan';
import { markFocusPerformance } from './focus-performance';

interface FocusDispatchOptions { deferRefresh?: boolean }

export interface FocusFlowPorts {
  snapshot: () => DomainState;
  dispatch: (command: ApplicationCommand, options?: FocusDispatchOptions) => Promise<ApplicationResult>;
  refresh?: () => void;
  resume: () => Promise<void>;
  readPlan: () => RoundPlan | null;
  writePlan: (plan: RoundPlan | null) => void;
  preferences: () => FocusPreferences;
  draft: () => { rounds: number; mode: 'rounds' | 'marathon'; endAt: string; selectedId: string | null };
  nowMs: () => number;
  closeEnding: () => void;
  closePlan: () => void;
  resetDraftMode: () => void;
  constructionFeedback: () => void;
  newAuthorizationId?: () => string;
}

/** Orchestration only: commands still commit through the application's single queue. */
export function createFocusFlow(ports: FocusFlowPorts) {
  let busy = false;
  const breakIntervalFrom = (startMs: number, plan: RoundPlan | null, fallbackMinutes: number) => {
    const durationMs = plan?.automaticContinuation?.breakDurationMs ?? fallbackMinutes * 60_000;
    return {
      breakStartedAt: new Date(startMs).toISOString(),
      breakEndsAt: new Date(startMs + durationMs).toISOString(),
    };
  };
  const context = () => {
    const state = ports.snapshot();
    const preferences = ports.preferences();
    const nowMs = ports.nowMs();
    const active = state.projects.find(project => project.id === state.activeProjectId);
    const plan = reconcileRoundPlan(ports.readPlan(), state, state.activeProjectId ?? '', nowMs, preferences.breakMinutes * 60000, preferences.breakMinutes * 60000);
    return { state, preferences, nowMs, active, plan, draft: ports.draft() };
  };
  // This is a local double-submission guard, not another command queue.
  const submit = async (operation: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    try { await operation(); } finally { busy = false; }
  };
  const finishBreak = (skip: boolean) => {
    const plan = ports.readPlan();
    if (plan?.status !== 'break') return;
    if (!skip && (!plan.breakEndsAt || Date.parse(plan.breakEndsAt) > ports.nowMs())) return;
    if (plan.endAfterBreak) ports.writePlan(null);
    else {
      const { breakStartedAt: _breakStartedAt, breakEndsAt: _breakEndsAt, ...withoutBreak } = plan;
      const nextRoundStartsAt = new Date(skip ? ports.nowMs() : Date.parse(plan.breakEndsAt!)).toISOString();
      const automaticContinuation = plan.automaticContinuation
        ? { ...plan.automaticContinuation, nextRoundStartsAt, reservation: undefined }
        : undefined;
      ports.writePlan({ ...withoutBreak, status: 'ready',
        ...(automaticContinuation ? { automaticContinuation } : {}) });
    }
  };
  const cancelPlan = async () => {
    const { plan } = context();
    if (plan?.mode !== 'marathon') {
      ports.writePlan(null); ports.closePlan(); return;
    }
    ports.resetDraftMode(); ports.closePlan();
    const current = ports.snapshot().activeFocusSession;
    if (current) {
      if (Date.parse(current.endsAt) <= ports.nowMs()) await ports.resume();
      else await ports.dispatch({ type: 'CancelFocus', interruptionCategory: null });
    }
    // Read after the command, never use a render-time snapshot to settle it.
    const latest = ports.snapshot();
    const host = latest.projects.find(project => project.id === plan.projectId);
    if (host?.kind === 'habit' && plan.deferredSettlement !== true) { ports.writePlan(null); return; }
    ports.writePlan(unsettledMarathonSessions(latest, plan.projectId).length > 0
      ? { ...plan, status: 'report', currentSessionId: undefined, breakStartedAt: undefined, breakEndsAt: undefined, endAfterBreak: undefined }
      : null);
  };
  const flow = {
    get busy() { return busy; },
    finishBreak: () => finishBreak(false),
    skipBreak: () => finishBreak(true),
    continueFromBreak: async (): Promise<void> => {
      if (busy) return;
      const plan = ports.readPlan();
      if (!plan || (plan.status !== 'break' && plan.status !== 'ready') || ports.snapshot().activeFocusSession) return;
      // Starting the next round can commit the final `focus` plan directly.
      // The old path first persisted `ready`, published a React render, then
      // persisted `focus`; that duplicate storage/render hop was the visible
      // ready-double-tap delay. If the domain command fails, the untouched
      // break remains recoverable, so this does not trade away truth.
      if (plan.status === 'break' && plan.endAfterBreak) finishBreak(true);
      if (plan.endAfterBreak || plan.completedRounds >= plan.totalRounds) return;
      // Keep the domain commit and the final plan write in one caller task.
      await flow.startFocus();
    },
    cancelPlan: () => submit(cancelPlan),
    confirmPlan: () => submit(async () => {
      const { active, plan, draft, preferences, nowMs } = context();
      if (plan) { await cancelPlan(); return; }
      if (!active) return;
      if (draft.mode === 'marathon') {
        const endMs = marathonEndInstant(draft.endAt, nowMs);
        const schedule = endMs === null ? null : planRoundsForDuration(endMs - nowMs, preferences.focusMinutes, preferences.breakMinutes);
        if (!schedule) return;
        const subtaskId = active.kind === 'habit' ? null : active.subtasks.find(item => item.progressBasisPoints < 10000)?.id ?? active.subtasks[0]?.id ?? null;
        if (active.kind !== 'habit' && subtaskId === null) return;
        ports.writePlan({ projectId: active.id, subtaskId, totalRounds: schedule.rounds, completedRounds: 0, status: 'ready', reportedSessionIds: [], mode: 'marathon', endAt: new Date(endMs!).toISOString() });
      }
      ports.closePlan();
    }),
    startFocus: (total?: number) => submit(async () => {
      const { state, active, plan, draft, preferences, nowMs } = context();
      if (!active || (active.kind === 'habit' && active.habit?.awaitingNextBuilding && plan?.deferredSettlement !== true)) return;
      const marathonDraft = draft.mode === 'marathon' && !plan;
      const host = plan?.mode === 'marathon' ? state.projects.find(project => project.id === plan.projectId) ?? active : active;
      const isHabit = host.kind === 'habit';
      const marathonRound = plan?.mode === 'marathon' || marathonDraft;
      const focusMinutes = marathonRound ? preferences.focusMinutes : isHabit ? preferences.habitFocusMinutes : preferences.focusMinutes;
      let rounds = total ?? plan?.totalRounds ?? draft.rounds;
      let endAt = plan?.endAt;
      if (marathonDraft) {
        const endMs = marathonEndInstant(draft.endAt, nowMs);
        const schedule = endMs === null ? null : planRoundsForDuration(endMs - nowMs, focusMinutes, preferences.breakMinutes);
        if (!schedule) return;
        rounds = schedule.rounds; endAt = new Date(endMs!).toISOString();
      }
      const deferred = plan?.deferredSettlement === true;
      const selected = active.subtasks.find(item => item.id === draft.selectedId) ?? active.subtasks[0];
      const subtaskId = isHabit || deferred ? null : marathonRound
        ? host.subtasks.find(item => item.progressBasisPoints < 10000)?.id ?? host.subtasks[0]?.id ?? null
        : plan?.subtaskId ?? selected?.id ?? null;
      if (!isHabit && !deferred && subtaskId === null) return;
      const next: RoundPlan = plan ? { ...plan } : { projectId: host.id, subtaskId, totalRounds: rounds, completedRounds: 0, status: 'focus', reportedSessionIds: [] };
      if (!isHabit && !deferred) next.subtaskId = subtaskId;
      if (marathonDraft) { next.mode = 'marathon'; next.endAt = endAt; }
      const previousPlan = ports.readPlan();
      const focusDurationMs = preferences.autoContinueFocus && plan?.automaticContinuation
        ? plan.automaticContinuation.focusDurationMs
        : focusMinutes * 60_000;
      const hasNextRound = next.completedRounds + 1 < next.totalRounds && !next.endAfterBreak && next.status !== 'report';
      if (preferences.autoContinueFocus && hasNextRound) {
        next.automaticContinuation ??= createAutomaticContinuationSchedule(
          ports.newAuthorizationId?.() ?? newAutomaticContinuationAuthorizationId(),
          focusDurationMs,
          preferences.breakMinutes * 60_000,
        );
        // A user-started round consumes the current due slot. The next absolute
        // start is derived from this round's end and frozen break duration.
        next.automaticContinuation = { ...next.automaticContinuation, nextRoundStartsAt: undefined, reservation: undefined };
      } else if (next.automaticContinuation) {
        delete next.automaticContinuation;
      }
      const automaticPlanChanged = JSON.stringify(previousPlan?.automaticContinuation ?? null)
        !== JSON.stringify(next.automaticContinuation ?? null);
      if (automaticPlanChanged) {
        // The plan context is not atomic with domain focus. Persist a ready
        // write-ahead copy when this call is creating the first plan; if the
        // process dies after StartFocus, authoritative active focus reconciles it.
        const writeAhead = plan ? next : { ...next, status: 'ready' as const, currentSessionId: undefined };
        ports.writePlan(writeAhead);
      }
      markFocusPerformance('command-queued');
      const result = await ports.dispatch({ type: 'StartFocus', subtaskId: next.subtaskId, plannedDurationMs: focusDurationMs,
        ...(deferred ? { deferredSettlement: true } : {}), ...(marathonRound ? { projectId: host.id, marathon: true } : {}) }, { deferRefresh: true });
      if (!result.ok) {
        if (automaticPlanChanged && !ports.snapshot().activeFocusSession) ports.writePlan(previousPlan);
        return;
      }
      markFocusPerformance('command-committed');
      const { breakStartedAt: _breakStartedAt, breakEndsAt: _breakEndsAt, ...withoutBreak } = next;
      const started = result.events.find(event => event.type === 'FocusStarted');
      ports.writePlan({ ...withoutBreak, status: 'focus', currentSessionId: started?.sessionId });
      ports.refresh?.();
    }),
    interruptFocus: (interruptionCategory: FocusInterruptionCategory | null) => submit(async () => {
      const { plan } = context();
      const current = ports.snapshot().activeFocusSession;
      if (current && Date.parse(current.endsAt) <= ports.nowMs()) { ports.closeEnding(); await ports.resume(); return; }
      const result = await ports.dispatch({ type: 'CancelFocus', interruptionCategory });
      if (!result.ok) return;
      if (plan?.mode === 'marathon') {
        const { breakStartedAt: _breakStartedAt, breakEndsAt: _breakEndsAt, endAfterBreak: _endAfterBreak,
          automaticContinuation: _automaticContinuation, ...withoutAuthorization } = plan;
        ports.writePlan({ ...withoutAuthorization, status: 'ready', currentSessionId: undefined });
      } else ports.writePlan(null);
      ports.closeEnding();
    }),
    completeEarly: () => submit(async () => {
      const { plan, active } = context();
      const current = ports.snapshot().activeFocusSession;
      if (current && Date.parse(current.endsAt) <= ports.nowMs()) { ports.closeEnding(); await ports.resume(); return; }
      const result = await ports.dispatch({ type: 'CompleteFocusEarly' });
      if (!result.ok) return;
      ports.closeEnding();
      const sealed = result.events.some(event => event.type === 'ProjectSealedAsMonument' || event.type === 'HabitBuildingCompleted');
      const isHabit = plan?.mode === 'marathon'
        ? plan.deferredSettlement !== true && result.state.projects.find(project => project.id === plan.projectId)?.kind === 'habit'
        : active?.kind === 'habit';
      const sessionId = result.events.find(event => event.type === 'FocusCompletedEarly')?.sessionId;
      const breakMinutes = ports.preferences().breakMinutes;
      const reportedSessionIds = plan && sessionId && !plan.reportedSessionIds.includes(sessionId) ? [...plan.reportedSessionIds, sessionId] : plan?.reportedSessionIds ?? [];
      const completedSession = sessionId ? result.state.focusHistory.find(session => session.id === sessionId) : undefined;
      const completedAt = completedSession?.status === 'completed-early' ? completedSession.completedAt
        : completedSession?.status === 'completed' ? completedSession.endsAt : undefined;
      const breakStartMs = completedAt ? Date.parse(completedAt) : ports.nowMs();
      if (plan?.mode === 'marathon') {
        const completedRounds = plan.completedRounds + 1;
        const next = { ...plan, completedRounds, currentSessionId: undefined, reportedSessionIds };
        if (isHabit && (sealed || completedRounds >= plan.totalRounds)) { ports.resetDraftMode(); ports.writePlan(null); }
        else if (completedRounds >= plan.totalRounds) {
          const { automaticContinuation: _automaticContinuation, ...withoutAuthorization } = next;
          ports.writePlan({ ...withoutAuthorization, status: 'report' });
        }
        else {
          const interval = breakIntervalFrom(breakStartMs, plan, breakMinutes);
          const durationMs = Date.parse(interval.breakEndsAt) - breakStartMs;
          if (durationMs === 0) ports.writePlan({ ...next, status: 'ready',
            automaticContinuation: undefined });
          else ports.writePlan({ ...next, status: 'break', ...interval,
            automaticContinuation: undefined });
        }
        return;
      }
      if (sealed || !plan || plan.totalRounds === 1 || breakMinutes === 0) { ports.writePlan(null); return; }
      const interval = breakIntervalFrom(breakStartMs, plan, breakMinutes);
      const { automaticContinuation: _automaticContinuation, ...withoutAuthorization } = plan;
      ports.writePlan({ ...withoutAuthorization, completedRounds: plan.completedRounds + 1, status: 'break', endAfterBreak: true, ...interval, currentSessionId: undefined, reportedSessionIds });
    }),
    /** The report UI supplies its pre-submit plan, preventing a recovered round from being counted twice. */
    afterReport: (plan: RoundPlan | null, sessionId: string) => {
      if (!plan) return;
      ports.constructionFeedback();
      const completedRounds = plan.completedRounds + 1;
      const reportedSessionIds = plan.reportedSessionIds.includes(sessionId) ? plan.reportedSessionIds : [...plan.reportedSessionIds, sessionId];
      if (completedRounds >= plan.totalRounds) { ports.writePlan(null); return; }
      const breakMinutes = ports.preferences().breakMinutes;
      const reportedAt = ports.snapshot().progressReports.find(report => report.focusSessionIds.includes(sessionId))?.reportedAt;
      const breakStartMs = reportedAt ? Date.parse(reportedAt) : ports.nowMs();
      const interval = breakIntervalFrom(breakStartMs, plan, breakMinutes);
      const durationMs = Date.parse(interval.breakEndsAt) - breakStartMs;
      const automaticContinuation = plan.automaticContinuation
        ? { ...plan.automaticContinuation,
            ...(durationMs === 0 ? { nextRoundStartsAt: interval.breakEndsAt } : { nextRoundStartsAt: undefined }),
            reservation: undefined }
        : undefined;
      if (durationMs === 0) {
        const { breakStartedAt: _breakStartedAt, breakEndsAt: _breakEndsAt, endAfterBreak: _endAfterBreak, ...withoutBreak } = plan;
        ports.writePlan({ ...withoutBreak, completedRounds, status: 'ready', currentSessionId: undefined, reportedSessionIds,
          ...(automaticContinuation ? { automaticContinuation } : {}) });
      } else ports.writePlan({ ...plan, completedRounds, status: 'break', ...interval, currentSessionId: undefined, reportedSessionIds,
        ...(automaticContinuation ? { automaticContinuation } : {}) });
    },
    afterMarathonReport: () => { ports.resetDraftMode(); ports.writePlan(null); ports.constructionFeedback(); },
};
  return flow;
}
