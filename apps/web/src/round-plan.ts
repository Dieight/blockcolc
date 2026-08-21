import type { DomainState } from '@tomato-clock/domain';

export interface RoundPlan {
  projectId: string;
  subtaskId: string | null;
  totalRounds: number;
  completedRounds: number;
  status: 'focus' | 'break' | 'ready' | 'report';
  breakEndsAt?: string;
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
  /** Chosen marathon end instant (ISO); informational, survives reloads. */
  endAt?: string;
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
  const reportedSessionIds = Array.isArray(candidate.reportedSessionIds)
    ? [...new Set(candidate.reportedSessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];
  const mode = candidate.mode === 'marathon' ? 'marathon' : candidate.mode === 'rounds' ? 'rounds' : undefined;
  const endAt = typeof candidate.endAt === 'string' && Number.isFinite(Date.parse(candidate.endAt)) ? candidate.endAt : undefined;
  return {
    projectId: hostProjectId,
    subtaskId: candidate.subtaskId,
    totalRounds,
    completedRounds,
    status: candidate.status,
    ...(breakEndsAt ? { breakEndsAt } : {}),
    ...(candidate.endAfterBreak === true ? { endAfterBreak: true } : {}),
    ...(typeof candidate.currentSessionId === 'string' && candidate.currentSessionId.length > 0 ? { currentSessionId: candidate.currentSessionId } : {}),
    reportedSessionIds,
    ...(mode ? { mode } : {}),
    ...(endAt ? { endAt } : {}),
  };
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
  if (!plan) {
    return active?.projectId === activeProjectId ? {
      projectId: active.projectId,
      subtaskId: active.subtaskId,
      totalRounds: 1,
      completedRounds: 0,
      status: 'focus',
      currentSessionId: active.id,
      reportedSessionIds: [],
    } : null;
  }
  if (plan.projectId !== activeProjectId && plan.mode !== 'marathon') return null;
  // The final marathon report is a durable UI phase: once every round is done,
  // keep the plan alive until the user submits the combined progress report.
  if (plan.status === 'report') return plan;
  if (plan.completedRounds >= plan.totalRounds) return null;

  const isMarathon = plan.mode === 'marathon';

  if (active) {
    if (active.projectId !== plan.projectId || active.subtaskId !== plan.subtaskId) return null;
    if (plan.status !== 'focus' || plan.breakEndsAt || plan.endAfterBreak || plan.currentSessionId !== active.id) {
      const { breakEndsAt: _breakEndsAt, endAfterBreak: _endAfterBreak, ...withoutBreak } = plan;
      return { ...withoutBreak, status: 'focus', currentSessionId: active.id };
    }
    return plan;
  }

  const project = state.projects.find((candidate) => candidate.id === plan.projectId);
  if (project?.kind === 'habit' && project.habit?.awaitingNextBuilding) return null;
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
    const { breakEndsAt: _breakEndsAt, endAfterBreak: _endAfterBreak, ...withoutBreak } = plan;
    return { ...withoutBreak, status: 'ready' };
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
  if (latest.status === 'interrupted') return null;
  if (latest.status !== 'completed' && latest.status !== 'completed-early') return null;
  const alreadyRecorded = plan.reportedSessionIds.includes(latest.id);
  const nextCompletedRounds = alreadyRecorded
    ? Math.max(plan.completedRounds, plan.reportedSessionIds.length)
    : plan.completedRounds + 1;
  const reportedSessionIds = alreadyRecorded ? plan.reportedSessionIds : [...plan.reportedSessionIds, latest.id];
  if (isMarathon) {
    if (nextCompletedRounds >= plan.totalRounds) {
      return {
        ...plan,
        completedRounds: nextCompletedRounds,
        status: 'report',
        breakEndsAt: undefined,
        endAfterBreak: undefined,
        currentSessionId: undefined,
        reportedSessionIds,
      };
    }
    const breakMs = project?.kind === 'habit' ? habitBreakDurationMs : finiteBreakDurationMs;
    if (breakMs > 0) {
      const breakEndsAt = new Date(Date.parse(latest.completedAt) + breakMs).toISOString();
      if (Date.parse(breakEndsAt) > nowMs) {
        return {
          ...plan,
          completedRounds: nextCompletedRounds,
          status: 'break',
          breakEndsAt,
          endAfterBreak: undefined,
          currentSessionId: undefined,
          reportedSessionIds,
        };
      }
    }
    return {
      ...plan,
      completedRounds: nextCompletedRounds,
      status: 'ready',
      breakEndsAt: undefined,
      endAfterBreak: undefined,
      currentSessionId: undefined,
      reportedSessionIds,
    };
  }
  if (nextCompletedRounds >= plan.totalRounds) return null;
  if (project?.kind === 'habit' && habitBreakDurationMs > 0) {
    const breakEndsAt = new Date(Date.parse(latest.completedAt) + habitBreakDurationMs).toISOString();
    if (Date.parse(breakEndsAt) > nowMs) {
      return {
        ...plan,
        completedRounds: nextCompletedRounds,
        status: 'break',
        breakEndsAt,
        endAfterBreak: undefined,
        currentSessionId: undefined,
        reportedSessionIds,
      };
    }
  }
  return {
    ...plan,
    completedRounds: nextCompletedRounds,
    status: 'ready',
    breakEndsAt: undefined,
    endAfterBreak: undefined,
    currentSessionId: undefined,
    reportedSessionIds,
  };
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
    && left.endAfterBreak === right.endAfterBreak
    && left.currentSessionId === right.currentSessionId
    && left.reportedSessionIds.join('|') === right.reportedSessionIds.join('|')
    && (left.mode ?? 'rounds') === (right.mode ?? 'rounds')
    && left.endAt === right.endAt;
}