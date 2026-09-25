import type { DomainState } from '@tomato-clock/domain';
import { unsettledMarathonSessions } from './marathon-settlement';

export interface RoundPlan {
  projectId: string;
  subtaskId: string | null;
  totalRounds: number;
  completedRounds: number;
  status: 'focus' | 'break' | 'ready' | 'report';
  breakEndsAt?: string;
  /** Exact adopted break start; legacy plans may omit it. */
  breakStartedAt?: string;
  endAfterBreak?: boolean;
  currentSessionId?: string;
  /** Session IDs already represented by a progress report in this plan. */
  reportedSessionIds: string[];
  /**
   * V21 marathon scheduling: the user picks an end time, rounds are derived from
   * the remaining duration, and progress is reported once after the last round.
   * Absent (or "rounds") means the classic per-round schedule.
   */
  mode?: 'rounds' | 'marathon';
  /** Minimal mode defers both finite and habit work to one final report. */
  deferredSettlement?: true;
  /** Chosen marathon end instant (ISO); informational, survives reloads. */
  endAt?: string;
  /**
   * Durable, plan-scoped user authorization for automatic continuation.
   * Settings only grant this to a plan after explicit opt-in. It deliberately
   * lives with the recoverable local round plan rather than domain backups.
   */
  automaticContinuation?: AutomaticContinuationSchedule;
}

export interface AutomaticContinuationSchedule {
  /** Stable, opaque identity for this authorization and its reserved sessions. */
  authorizationId: string;
  /** Frozen schedule inputs so a preference edit or process restart cannot move deadlines. */
  focusDurationMs: number;
  breakDurationMs: number;
  /** Exact absolute start for the next automatic round, set only after a round is due. */
  nextRoundStartsAt?: string;
  /** Write-ahead reservation persisted before the domain StartFocus command. */
  reservation?: {
    round: number;
    sessionId: string;
    scheduledAt: string;
  };
}

export const MAX_MARATHON_ROUNDS = 24;
export const MIN_PLANNED_ROUNDS = 1;

export interface MarathonSchedule {
  rounds: number;
  breaks: number;
  /** Wall-clock time consumed by the schedule (focus + inter-round breaks). */
  usableMs: number;
}

/**
 * Derives focus/break rounds from a raw duration and the normal per-round
 * settings: blocks are [focus][break][focus]…[focus], so for duration D,
 * focus rounds n = floor((D + break) / (focus + break)). Returns null when even
 * one round does not fit.
 */
export function planRoundsForDuration(
  durationMs: number,
  focusMinutes: number,
  breakMinutes: number,
  maxRounds = MAX_MARATHON_ROUNDS,
): MarathonSchedule | null {
  if (!Number.isSafeInteger(focusMinutes) || focusMinutes < 1 || focusMinutes > 180) {
    throw new RangeError('focusMinutes must be an integer between 1 and 180');
  }
  if (!Number.isSafeInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 60) {
    throw new RangeError('breakMinutes must be an integer between 0 and 60');
  }
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1) {
    throw new RangeError('maxRounds must be a positive integer');
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const focusMs = focusMinutes * 60_000;
  const breakMs = breakMinutes * 60_000;
  const cycleMs = focusMs + breakMs;
  const rounds = breakMs === 0 ? Math.floor(durationMs / focusMs) : Math.floor((durationMs + breakMs) / cycleMs);
  if (rounds < 1) return null;
  const capped = Math.min(rounds, maxRounds);
  return {
    rounds: capped,
    breaks: breakMs > 0 ? Math.max(0, capped - 1) : 0,
    usableMs: capped * focusMs + Math.max(0, capped - 1) * breakMs,
  };
}

export function plannedDurationMs(focusMinutes: number, breakMinutes: number, rounds: number): number {
  if (!Number.isSafeInteger(focusMinutes) || focusMinutes < 1 || focusMinutes > 180) {
    throw new RangeError('focusMinutes must be an integer between 1 and 180');
  }
  if (!Number.isSafeInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 60) {
    throw new RangeError('breakMinutes must be an integer between 0 and 60');
  }
  if (!Number.isSafeInteger(rounds) || rounds < MIN_PLANNED_ROUNDS || rounds > MAX_MARATHON_ROUNDS) {
    throw new RangeError(`rounds must be an integer between ${MIN_PLANNED_ROUNDS} and ${MAX_MARATHON_ROUNDS}`);
  }
  return (focusMinutes * rounds + breakMinutes * Math.max(0, rounds - 1)) * 60_000;
}

export function parseRoundPlan(value: unknown, projectId: string): RoundPlan | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RoundPlan>;
  // V22: an end-time (marathon) plan is its own lane and survives switching the
  // active project, so its host project id need not match the caller's.
  const isMarathon = candidate.mode === 'marathon';
  if (candidate.deferredSettlement !== undefined
    && (candidate.deferredSettlement !== true || !isMarathon || candidate.subtaskId !== null)) return null;
  const hostProjectId = isMarathon
    ? (typeof candidate.projectId === 'string' && candidate.projectId.length > 0 ? candidate.projectId : projectId)
    : projectId;
  if (!isMarathon && candidate.projectId !== projectId) return null;
  if (candidate.subtaskId !== null && typeof candidate.subtaskId !== 'string') return null;
  const totalRounds = candidate.totalRounds;
  const completedRounds = candidate.completedRounds;
  if (typeof totalRounds !== 'number' || !Number.isInteger(totalRounds) || totalRounds < MIN_PLANNED_ROUNDS || totalRounds > MAX_MARATHON_ROUNDS) return null;
  if (typeof completedRounds !== 'number' || !Number.isInteger(completedRounds) || completedRounds < 0 || completedRounds > totalRounds) return null;
  if (candidate.status !== 'focus' && candidate.status !== 'break' && candidate.status !== 'ready' && candidate.status !== 'report') return null;
  const breakEndsAt = typeof candidate.breakEndsAt === 'string' && Number.isFinite(Date.parse(candidate.breakEndsAt)) ? candidate.breakEndsAt : undefined;
  if (candidate.status === 'break' && !breakEndsAt) return null;
  const breakStartedAt = typeof candidate.breakStartedAt === 'string'
    && Number.isFinite(Date.parse(candidate.breakStartedAt)) && breakEndsAt
    && Date.parse(candidate.breakStartedAt) < Date.parse(breakEndsAt) ? candidate.breakStartedAt : undefined;
  const reportedSessionIds = Array.isArray(candidate.reportedSessionIds)
    ? [...new Set(candidate.reportedSessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];
  const mode = candidate.mode === 'marathon' ? 'marathon' : candidate.mode === 'rounds' ? 'rounds' : undefined;
  const endAt = typeof candidate.endAt === 'string' && Number.isFinite(Date.parse(candidate.endAt)) ? candidate.endAt : undefined;
  const automaticContinuation = parseAutomaticContinuation(candidate.automaticContinuation, completedRounds);
  if (candidate.automaticContinuation !== undefined && automaticContinuation === null) return null;
  return {
    projectId: hostProjectId,
    subtaskId: candidate.subtaskId,
    totalRounds,
    completedRounds,
    status: candidate.status,
    ...(breakEndsAt ? { breakEndsAt } : {}),
    ...(candidate.status === 'break' && breakStartedAt ? { breakStartedAt } : {}),
    ...(candidate.endAfterBreak === true ? { endAfterBreak: true } : {}),
    ...(typeof candidate.currentSessionId === 'string' && candidate.currentSessionId.length > 0 ? { currentSessionId: candidate.currentSessionId } : {}),
    reportedSessionIds,
    ...(mode ? { mode } : {}),
    ...(candidate.deferredSettlement === true ? { deferredSettlement: true } : {}),
    ...(endAt ? { endAt } : {}),
    ...(automaticContinuation ? { automaticContinuation } : {}),
  };
}

function parseAutomaticContinuation(value: unknown, completedRounds: number): AutomaticContinuationSchedule | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['authorizationId', 'focusDurationMs', 'breakDurationMs', 'nextRoundStartsAt', 'reservation'].includes(key))) return null;
  if (typeof raw.authorizationId !== 'string' || raw.authorizationId.length < 1 || raw.authorizationId.length > 128
    || /[\u0000-\u001f]/.test(raw.authorizationId)) return null;
  if (!Number.isSafeInteger(raw.focusDurationMs) || (raw.focusDurationMs as number) < 1 || (raw.focusDurationMs as number) > 180 * 60_000) return null;
  if (!Number.isSafeInteger(raw.breakDurationMs) || (raw.breakDurationMs as number) < 0 || (raw.breakDurationMs as number) > 60 * 60_000) return null;
  const nextRoundStartsAt = raw.nextRoundStartsAt;
  if (nextRoundStartsAt !== undefined && !isCanonicalInstant(nextRoundStartsAt)) return null;
  let reservation: AutomaticContinuationSchedule['reservation'];
  if (raw.reservation !== undefined) {
    if (!raw.reservation || typeof raw.reservation !== 'object' || Array.isArray(raw.reservation)) return null;
    const reserved = raw.reservation as Record<string, unknown>;
    if (Object.keys(reserved).some(key => !['round', 'sessionId', 'scheduledAt'].includes(key))) return null;
    if (!Number.isInteger(reserved.round) || reserved.round !== completedRounds + 1
      || typeof reserved.sessionId !== 'string' || reserved.sessionId.length < 1 || reserved.sessionId.length > 256
      || !isCanonicalInstant(reserved.scheduledAt)) return null;
    const scheduledAt = reserved.scheduledAt as string;
    if (typeof nextRoundStartsAt !== 'string' || scheduledAt !== nextRoundStartsAt) return null;
    reservation = { round: reserved.round as number, sessionId: reserved.sessionId, scheduledAt };
  }
  return {
    authorizationId: raw.authorizationId,
    focusDurationMs: raw.focusDurationMs as number,
    breakDurationMs: raw.breakDurationMs as number,
    ...(typeof nextRoundStartsAt === 'string' ? { nextRoundStartsAt } : {}),
    ...(reservation ? { reservation } : {}),
  };
}

function isCanonicalInstant(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

export interface AutomaticContinuationReservation {
  /** Save this plan before calling ApplicationService.startScheduledFocus. */
  plan: RoundPlan;
  sessionId: string;
  scheduledAt: string;
  plannedDurationMs: number;
}

export function automaticContinuationEventId(authorizationId: string, round: number): string {
  return `${authorizationId}:round:${round}`;
}

export function automaticContinuationSessionId(authorizationId: string, round: number): string {
  return `auto-${authorizationId}-round-${round}`;
}

export function createAutomaticContinuationSchedule(
  authorizationId: string,
  focusDurationMs: number,
  breakDurationMs: number,
): AutomaticContinuationSchedule {
  return { authorizationId, focusDurationMs, breakDurationMs };
}

export function newAutomaticContinuationAuthorizationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('Secure randomness is unavailable');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Reserve exactly one due automatic round. The caller must durably write the
 * returned plan before starting the domain session. Repeating this function
 * with that saved plan returns the same session identity and scheduled instant.
 */
export function reserveAutomaticContinuation(
  plan: RoundPlan | null,
  state: DomainState,
  nowMs = Date.now(),
): AutomaticContinuationReservation | null {
  if (!plan || plan.status !== 'ready' || plan.endAfterBreak || plan.completedRounds <= 0
    || plan.completedRounds >= plan.totalRounds || state.activeFocusSession) return null;
  const automatic = plan.automaticContinuation;
  if (!automatic) return null;
  const project = state.projects.find(candidate => candidate.id === plan.projectId);
  if (!project || (project.kind === 'habit' && automaticStopsAtHabitBoundary(plan, state, project))) return null;
  if (plan.mode !== 'marathon' && plan.deferredSettlement !== true && project.kind === 'finite'
    && !hasExplicitRoundProgressReports(plan, state)) return null;

  const lastScheduledAt = automaticContinuationStartAt(plan, state);
  if (!lastScheduledAt || !Number.isFinite(Date.parse(lastScheduledAt)) || Date.parse(lastScheduledAt) > nowMs) return null;
  if (plan.mode === 'marathon' && plan.endAt
    && Date.parse(lastScheduledAt) + automatic.focusDurationMs > Date.parse(plan.endAt)) return null;

  const round = plan.completedRounds + 1;
  const sessionId = automatic.reservation?.sessionId ?? automaticContinuationSessionId(automatic.authorizationId, round);
  const scheduledAt = automatic.reservation?.scheduledAt ?? lastScheduledAt;
  if (automatic.reservation && automatic.reservation.round !== round) return null;
  const reservation = { round, sessionId, scheduledAt };
  const reservedAutomatic = {
    ...automatic,
    nextRoundStartsAt: scheduledAt,
    reservation,
  };
  return {
    plan: { ...plan, automaticContinuation: reservedAutomatic },
    sessionId,
    scheduledAt,
    plannedDurationMs: automatic.focusDurationMs,
  };
}

function automaticStopsAtHabitBoundary(plan: RoundPlan, state: DomainState, project: DomainState['projects'][number]): boolean {
  if (project.kind !== 'habit' || !project.habit) return false;
  if (project.habit.awaitingNextBuilding) return true;
  if (plan.deferredSettlement !== true) return false;
  // Deferred/minimal rounds do not mutate habit progress until final settlement.
  // Count this plan's already-completed deferred sessions prospectively so an
  // automatic chain cannot pass the current building's remaining-round boundary.
  if (plan.reportedSessionIds.length < plan.completedRounds) return true;
  const deferredRounds = plan.reportedSessionIds.filter(sessionId => state.focusHistory.some(session =>
    session.id === sessionId && session.projectId === plan.projectId && session.deferredSettlement === true,
  )).length;
  return project.habit.completedFocusSessionIds.length + deferredRounds >= project.habit.targetRounds;
}

function hasExplicitRoundProgressReports(plan: RoundPlan, state: DomainState): boolean {
  if (plan.reportedSessionIds.length < plan.completedRounds) return false;
  return plan.reportedSessionIds.slice(0, plan.completedRounds).every(sessionId => state.progressReports.some(report =>
    report.projectId === plan.projectId && report.subtaskId === plan.subtaskId && report.focusSessionIds.includes(sessionId),
  ));
}

export function automaticContinuationStartAt(plan: RoundPlan, state: DomainState): string | undefined {
  const automatic = plan.automaticContinuation;
  if (!automatic) return undefined;
  const storedNext = automatic.nextRoundStartsAt;
  const nextFromFacts = nextRoundStartsAtFromFacts(plan, state);
  const project = state.projects.find(candidate => candidate.id === plan.projectId);
  // An ordinary finite round is not authorized to begin until its explicit
  // progress report is durable. If reporting happened after the break deadline,
  // start from the report instant rather than backdating the next round.
  return plan.mode !== 'marathon' && plan.deferredSettlement !== true && project?.kind === 'finite'
    ? maxInstant(storedNext, nextFromFacts)
    : storedNext ?? nextFromFacts;
}

function nextRoundStartsAtFromFacts(plan: RoundPlan, state: DomainState): string | undefined {
  const automatic = plan.automaticContinuation;
  if (!automatic) return undefined;
  const sessionId = plan.reportedSessionIds[plan.completedRounds - 1];
  if (!sessionId) return undefined;
  const session = state.focusHistory.find(candidate => candidate.id === sessionId);
  if (!session) return undefined;
  if (plan.mode !== 'marathon' && plan.deferredSettlement !== true
    && state.projects.find(candidate => candidate.id === plan.projectId)?.kind === 'finite') {
    return state.progressReports.find(report => report.focusSessionIds.includes(sessionId))?.reportedAt;
  }
  const completedAt = session.status === 'completed-early' ? session.completedAt
    : session.status === 'completed' ? session.endsAt : undefined;
  if (!completedAt) return undefined;
  // When the local plan's absolute next-start field was lost, reconstruct the
  // whole focus/break boundary from immutable focus facts and the frozen plan
  // settings. Returning `endsAt` alone would silently turn a marathon break
  // into focus time after storage recovery.
  return new Date(Date.parse(completedAt) + automatic.breakDurationMs).toISOString();
}

function maxInstant(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export function reconcileRoundPlan(
  plan: RoundPlan | null,
  state: DomainState,
  activeProjectId: string,
  nowMs = Date.now(),
  habitBreakDurationMs = 0,
  finiteBreakDurationMs = 0,
): RoundPlan | null {
  const active = state.activeFocusSession;
  if (active && plan?.status === 'report') {
    return reconcileRoundPlan(null, state, active.projectId, nowMs, habitBreakDurationMs, finiteBreakDurationMs);
  }
  if (!plan) {
    // The schedule is optional UI context, the completed focus records are not.
    // Recover a report from retained deferred rounds rather than inventing the
    // lost remaining schedule or allowing a habit host to hide those rounds.
    if (!active && state.focusHistory.some(session => session.deferredSettlement === true)) {
      const pending = unsettledMarathonSessions(state).filter(session => session.deferredSettlement === true);
      const host = pending[0]?.projectId;
      if (host) {
        const ids = pending.filter(session => session.projectId === host).map(session => session.id);
        return {
          projectId: host, subtaskId: null, mode: 'marathon', deferredSettlement: true,
          status: 'report', totalRounds: Math.min(ids.length, MAX_MARATHON_ROUNDS),
          completedRounds: Math.min(ids.length, MAX_MARATHON_ROUNDS), reportedSessionIds: ids,
        };
      }
    }
    return active?.projectId === activeProjectId ? {
      projectId: active.projectId,
      subtaskId: active.subtaskId,
      totalRounds: 1,
      completedRounds: 0,
      status: 'focus',
      currentSessionId: active.id,
      reportedSessionIds: [],
      ...(active.deferredSettlement === true ? { mode: 'marathon', deferredSettlement: true } : {}),
    } : null;
  }
  const reserved = plan.automaticContinuation?.reservation;
  if (reserved) {
    const activeReserved = active?.id === reserved.sessionId;
    const historySession = state.focusHistory.find(session => session.id === reserved.sessionId);
    const committedSession = activeReserved ? active : historySession;
    if (committedSession && !reservedSessionMatches(plan, reserved, committedSession)) return null;
    const historyReserved = historySession !== undefined;
    if (activeReserved || historyReserved) {
      // The domain save can outlive a crash before the following plan write.
      // Match the write-ahead reservation back to its committed session, then
      // run the ordinary recovery path so the round advances at most once.
      const { reservation: _reservation, nextRoundStartsAt: _nextRoundStartsAt, ...authorization } = plan.automaticContinuation!;
      return reconcileRoundPlan({
        ...plan,
        status: 'focus',
        currentSessionId: reserved.sessionId,
        automaticContinuation: authorization,
      }, state, activeProjectId, nowMs, habitBreakDurationMs, finiteBreakDurationMs);
    }
  }
  if (plan.projectId !== activeProjectId && plan.mode !== 'marathon') return null;
  const project = state.projects.find((candidate) => candidate.id === plan.projectId);
  // The final marathon report is a durable UI phase: once every round is done,
  // keep the plan alive until the user submits the combined progress report.
  // Habit rounds are already settled one by one and never enter that report.
  if (plan.status === 'report') {
    if (plan.deferredSettlement === true && unsettledMarathonSessions(state, plan.projectId).length === 0) return null;
    return project?.kind === 'habit' && plan.deferredSettlement !== true ? null : plan;
  }
  if (plan.completedRounds >= plan.totalRounds) return null;

  const isMarathon = plan.mode === 'marathon';

  if (active) {
    if (active.projectId !== plan.projectId || active.subtaskId !== plan.subtaskId) return null;
    if (plan.status !== 'focus' || plan.breakEndsAt || plan.endAfterBreak || plan.currentSessionId !== active.id) {
      const { breakStartedAt: _breakStartedAt, breakEndsAt: _breakEndsAt, endAfterBreak: _endAfterBreak, ...withoutBreak } = plan;
      const automaticContinuation = plan.automaticContinuation
        ? (() => {
            const { reservation: _reservation, nextRoundStartsAt: _nextRoundStartsAt, ...authorization } = plan.automaticContinuation!;
            return authorization;
          })()
        : undefined;
      return { ...withoutBreak, status: 'focus', currentSessionId: active.id,
        ...(automaticContinuation ? { automaticContinuation } : {}) };
    }
    return plan;
  }

  if (project?.kind === 'habit' && project.habit?.awaitingNextBuilding && plan.deferredSettlement !== true) return null;
  const reported = new Set(state.progressReports.flatMap((report) => report.focusSessionIds));
  const pending = project?.kind !== 'habit' && state.focusHistory.some((session) =>
    session.projectId === plan.projectId && session.subtaskId === plan.subtaskId
      && session.status === 'completed' && !reported.has(session.id),
  );
  // A marathon advances itself: its sessions are reported together at the end,
  // so a pending single-session report must not freeze the plan mid-way.
  if (pending && !isMarathon) return plan;

  if (plan.status === 'break') {
    if (!plan.breakEndsAt || Date.parse(plan.breakEndsAt) > nowMs) return plan;
    if (plan.endAfterBreak) return null;
    const { breakStartedAt: _breakStartedAt, breakEndsAt: _breakEndsAt, endAfterBreak: _endAfterBreak, ...withoutBreak } = plan;
    return { ...withoutBreak, status: 'ready',
      ...(plan.automaticContinuation
        ? { automaticContinuation: { ...plan.automaticContinuation, nextRoundStartsAt: plan.breakEndsAt, reservation: undefined } }
        : {}) };
  }

  if (plan.status !== 'focus') return plan;

  // A completed session can be persisted before the UI writes its next plan
  // state. Advance exactly that one round during recovery. An interrupted
  // session must never advance a plan.
  const latest = plan.currentSessionId
    ? state.focusHistory.find((session) => session.id === plan.currentSessionId)
    : [...state.focusHistory].reverse().find((session) =>
        isMarathon
          ? session.projectId === plan.projectId
          : session.projectId === plan.projectId && session.subtaskId === plan.subtaskId);
  if (!latest) return null;
  if (latest.status === 'interrupted') {
    // V23: an interrupted marathon round keeps the end-time schedule at the same
    // round so the next focus resumes here — an integrity-limit exit behaves
    // exactly like a user interrupt. Classic per-round plans drop the schedule.
    if (isMarathon) {
      const { automaticContinuation: _automaticContinuation, ...withoutAutomaticContinuation } = plan;
      return {
        ...withoutAutomaticContinuation,
        status: 'ready',
        breakStartedAt: undefined,
        breakEndsAt: undefined,
        endAfterBreak: undefined,
        currentSessionId: undefined,
      };
    }
    return null;
  }
  if (latest.status !== 'completed' && latest.status !== 'completed-early') return null;
  const alreadyRecorded = plan.reportedSessionIds.includes(latest.id);
  const nextCompletedRounds = alreadyRecorded
    ? Math.max(plan.completedRounds, plan.reportedSessionIds.length)
    : plan.completedRounds + 1;
  const reportedSessionIds = alreadyRecorded ? plan.reportedSessionIds : [...plan.reportedSessionIds, latest.id];
  // A normally completed focus is authoritative at its planned absolute end,
  // even if process recovery observes it later. Early completion is factual at
  // its user-confirmed completion instant.
  const explicitReportAt = plan.automaticContinuation
    && plan.mode !== 'marathon' && plan.deferredSettlement !== true && project?.kind === 'finite'
    ? state.progressReports.find(report => report.projectId === plan.projectId && report.subtaskId === plan.subtaskId
        && report.focusSessionIds.includes(latest.id))?.reportedAt
    : undefined;
  const completionInstant = explicitReportAt
    ?? (plan.automaticContinuation && latest.status === 'completed' ? latest.endsAt : latest.completedAt);
  const autoBreakMs = plan.automaticContinuation?.breakDurationMs;
  if (isMarathon) {
    if (nextCompletedRounds >= plan.totalRounds) {
      if (project?.kind === 'habit' && plan.deferredSettlement !== true) return null;
      return {
        ...plan,
        completedRounds: nextCompletedRounds,
        status: 'report',
        breakStartedAt: undefined,
        breakEndsAt: undefined,
        endAfterBreak: undefined,
        currentSessionId: undefined,
        reportedSessionIds,
        ...(plan.automaticContinuation
          ? { automaticContinuation: { ...plan.automaticContinuation, nextRoundStartsAt: undefined, reservation: undefined } }
          : {}),
      };
    }
    const breakMs = autoBreakMs ?? (project?.kind === 'habit' ? habitBreakDurationMs : finiteBreakDurationMs);
    if (breakMs > 0) {
      const breakEndsAt = new Date(Date.parse(completionInstant) + breakMs).toISOString();
      if (Date.parse(breakEndsAt) > nowMs) {
        return {
          ...plan,
          completedRounds: nextCompletedRounds,
          status: 'break',
          breakStartedAt: completionInstant,
          breakEndsAt,
          endAfterBreak: undefined,
          currentSessionId: undefined,
          reportedSessionIds,
          ...(plan.automaticContinuation
            ? { automaticContinuation: { ...plan.automaticContinuation, nextRoundStartsAt: undefined, reservation: undefined } }
            : {}),
        };
      }
    }
    return {
      ...plan,
      completedRounds: nextCompletedRounds,
      status: 'ready',
      breakStartedAt: undefined,
      breakEndsAt: undefined,
      endAfterBreak: undefined,
      currentSessionId: undefined,
      reportedSessionIds,
      ...(plan.automaticContinuation
        ? { automaticContinuation: { ...plan.automaticContinuation, nextRoundStartsAt: new Date(Date.parse(completionInstant) + breakMs).toISOString(), reservation: undefined } }
        : {}),
    };
  }
  if (nextCompletedRounds >= plan.totalRounds) return null;
  const breakMs = autoBreakMs ?? (project?.kind === 'habit' ? habitBreakDurationMs : 0);
  if (breakMs > 0) {
    const breakEndsAt = new Date(Date.parse(completionInstant) + breakMs).toISOString();
    if (Date.parse(breakEndsAt) > nowMs) {
      return {
        ...plan,
        completedRounds: nextCompletedRounds,
        status: 'break',
        breakStartedAt: completionInstant,
        breakEndsAt,
        endAfterBreak: undefined,
        currentSessionId: undefined,
        reportedSessionIds,
        ...(plan.automaticContinuation
          ? { automaticContinuation: { ...plan.automaticContinuation, nextRoundStartsAt: undefined, reservation: undefined } }
          : {}),
      };
    }
  }
  return {
    ...plan,
    completedRounds: nextCompletedRounds,
    status: 'ready',
    breakStartedAt: undefined,
    breakEndsAt: undefined,
    endAfterBreak: undefined,
    currentSessionId: undefined,
    reportedSessionIds,
    ...(plan.automaticContinuation
      ? { automaticContinuation: { ...plan.automaticContinuation, nextRoundStartsAt: new Date(Date.parse(completionInstant) + breakMs).toISOString(), reservation: undefined } }
      : {}),
  };
}

function reservedSessionMatches(
  plan: RoundPlan,
  reservation: NonNullable<AutomaticContinuationSchedule['reservation']>,
  session: NonNullable<DomainState['activeFocusSession']> | DomainState['focusHistory'][number],
): boolean {
  const automatic = plan.automaticContinuation;
  return !!automatic
    && session.projectId === plan.projectId
    && session.subtaskId === plan.subtaskId
    && session.startedAt === reservation.scheduledAt
    && session.plannedDurationMs === automatic.focusDurationMs
    && (session.marathon === true) === (plan.mode === 'marathon')
    && (session.deferredSettlement === true) === (plan.deferredSettlement === true);
}

export function roundPlansEqual(left: RoundPlan | null, right: RoundPlan | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.projectId === right.projectId
    && left.subtaskId === right.subtaskId
    && left.totalRounds === right.totalRounds
    && left.completedRounds === right.completedRounds
    && left.status === right.status
    && left.breakEndsAt === right.breakEndsAt
    && left.breakStartedAt === right.breakStartedAt
    && left.endAfterBreak === right.endAfterBreak
    && left.currentSessionId === right.currentSessionId
    && left.reportedSessionIds.join('|') === right.reportedSessionIds.join('|')
    && (left.mode ?? 'rounds') === (right.mode ?? 'rounds')
    && left.deferredSettlement === right.deferredSettlement
    && left.endAt === right.endAt
    && automaticContinuationEqual(left.automaticContinuation, right.automaticContinuation);
}

function automaticContinuationEqual(left?: AutomaticContinuationSchedule, right?: AutomaticContinuationSchedule): boolean {
  return left === right || (!!left && !!right
    && left.authorizationId === right.authorizationId
    && left.focusDurationMs === right.focusDurationMs
    && left.breakDurationMs === right.breakDurationMs
    && left.nextRoundStartsAt === right.nextRoundStartsAt
    && left.reservation?.round === right.reservation?.round
    && left.reservation?.sessionId === right.reservation?.sessionId
    && left.reservation?.scheduledAt === right.reservation?.scheduledAt);
}

/** Remaining focus plus only the breaks that still occur between rounds. */
export function remainingPlanDurationMs(plan: Pick<RoundPlan, 'totalRounds' | 'completedRounds'>, focusMinutes: number, breakMinutes: number): number {
  const remainingRounds = Math.max(0, plan.totalRounds - plan.completedRounds);
  return remainingRounds * focusMinutes * 60_000
    + Math.max(0, remainingRounds - 1) * breakMinutes * 60_000;
}
