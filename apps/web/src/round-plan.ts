import type { DomainState } from '@tomato-clock/domain';

export interface RoundPlan {
  projectId: string;
  subtaskId: string | null;
  totalRounds: number;
  completedRounds: number;
  status: 'focus' | 'break' | 'ready';
  breakEndsAt?: string;
  endAfterBreak?: boolean;
  currentSessionId?: string;
  /** Session IDs already represented by a progress report in this plan. */
  reportedSessionIds: string[];
}

export function parseRoundPlan(value: unknown, projectId: string): RoundPlan | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RoundPlan>;
  if (candidate.projectId !== projectId || (candidate.subtaskId !== null && typeof candidate.subtaskId !== 'string')) return null;
  const totalRounds = candidate.totalRounds;
  const completedRounds = candidate.completedRounds;
  if (typeof totalRounds !== 'number' || !Number.isInteger(totalRounds) || totalRounds < 1 || totalRounds > 4) return null;
  if (typeof completedRounds !== 'number' || !Number.isInteger(completedRounds) || completedRounds < 0 || completedRounds > totalRounds) return null;
  if (candidate.status !== 'focus' && candidate.status !== 'break' && candidate.status !== 'ready') return null;
  const breakEndsAt = typeof candidate.breakEndsAt === 'string' && Number.isFinite(Date.parse(candidate.breakEndsAt)) ? candidate.breakEndsAt : undefined;
  if (candidate.status === 'break' && !breakEndsAt) return null;
  const reportedSessionIds = Array.isArray(candidate.reportedSessionIds)
    ? [...new Set(candidate.reportedSessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];
  return {
    projectId,
    subtaskId: candidate.subtaskId,
    totalRounds,
    completedRounds,
    status: candidate.status,
    ...(breakEndsAt ? { breakEndsAt } : {}),
    ...(candidate.endAfterBreak === true ? { endAfterBreak: true } : {}),
    ...(typeof candidate.currentSessionId === 'string' && candidate.currentSessionId.length > 0 ? { currentSessionId: candidate.currentSessionId } : {}),
    reportedSessionIds,
  };
}

export function reconcileRoundPlan(
  plan: RoundPlan | null,
  state: DomainState,
  activeProjectId: string,
  nowMs = Date.now(),
  habitBreakDurationMs = 0,
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
  if (plan.projectId !== activeProjectId) return null;
  if (plan.completedRounds >= plan.totalRounds) return null;

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
  if (pending) return plan;

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
    : [...state.focusHistory].reverse().find((session) => session.projectId === plan.projectId && session.subtaskId === plan.subtaskId);
  if (!latest) return null;
  if (latest.status === 'interrupted') return null;
  if (latest.status !== 'completed' && latest.status !== 'completed-early') return null;
  const alreadyRecorded = plan.reportedSessionIds.includes(latest.id);
  const nextCompletedRounds = alreadyRecorded
    ? Math.max(plan.completedRounds, plan.reportedSessionIds.length)
    : plan.completedRounds + 1;
  if (nextCompletedRounds >= plan.totalRounds) return null;
  const reportedSessionIds = alreadyRecorded ? plan.reportedSessionIds : [...plan.reportedSessionIds, latest.id];
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
    && left.reportedSessionIds.join('|') === right.reportedSessionIds.join('|');
}
