import type { DomainState } from '@blockcolc/domain';
import type { PlanCompletionNotification } from '@blockcolc/application';
import { exactPlanEndMs, type RoundPlan } from './round-plan';

/** A finite alarm for the whole batch, not a second timer or a domain write.
 * Per-round focus notices remain appropriate for ordinary report-each-round
 * plans. Minimal/marathon intermediate rounds never ask for a report. */
export function planCompletionNotification(plan: RoundPlan | null, state: DomainState): PlanCompletionNotification | null {
  if (!plan || plan.status === 'report' || plan.cancellationRequested || plan.mode !== 'marathon' && !plan.deferredSettlement) return null;
  const project = state.projects.find(item => item.id === plan.projectId);
  if (!project || !['active','paused'].includes(project.status)) return null;
  const session = state.activeFocusSession;
  const current = session && session.id === plan.currentSessionId && session.projectId === plan.projectId ? session : null;
  const first = plan.reportedSessionIds[0] ?? current?.id;
  if (!first) return null;
  const plannedRemaining = plan.totalRounds - plan.completedRounds;
  const remaining = project.kind === 'habit' && !plan.deferredSettlement && project.habit
    ? Math.min(plannedRemaining, project.habit.targetRounds - project.habit.completedFocusSessionIds.length) : plannedRemaining;
  if (remaining < 0) return null;
  const authorization = plan.automaticContinuation;
  let at: number;
  if (plan.status === 'focus' && current && (remaining === 1 || authorization)) {
    at = Date.parse(current.endsAt);
    if (remaining > 1) at += (remaining - 1) * (authorization!.focusDurationMs + authorization!.breakDurationMs);
  } else if (plan.status === 'break' && plan.breakEndsAt && (plan.endAfterBreak || authorization)) {
    at = Date.parse(plan.breakEndsAt);
    if (!plan.endAfterBreak && remaining > 0) at += remaining * authorization!.focusDurationMs + Math.max(0, remaining - 1) * authorization!.breakDurationMs;
  } else return null;
  const exact = exactPlanEndMs(plan);
  if (exact !== null) at = remaining === plannedRemaining ? exact : Math.min(at, exact);
  if (!Number.isFinite(at)) return null;
  return { planKey: `${plan.projectId}:${first}`, endsAt: new Date(at).toISOString(), requiresReport: project.kind !== 'habit' || plan.deferredSettlement === true };
}
