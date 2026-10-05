import type { DomainState } from '@blockcolc/domain';
import { canPresentMinimalFocus } from './minimal-presentation';
import { reconcileRoundPlan, type RoundPlan } from './round-plan';

export interface FocusViewInput {
  state: DomainState;
  plan: RoundPlan | null;
  nowMs: number;
  breakMinutes: number;
  minimalWanted: boolean;
  fullDeferredPresentation: boolean;
  hasPendingReport: boolean;
}

/** Render-only projection. Neither the clock nor recovery is a persistence operation. */
export function deriveFocusViewState(input: FocusViewInput) {
  const { state, nowMs, breakMinutes, minimalWanted, fullDeferredPresentation } = input;
  const active = state.projects.find(project => project.id === state.activeProjectId);
  const plan = reconcileRoundPlan(input.plan, state, state.activeProjectId ?? '', nowMs, breakMinutes * 60_000, breakMinutes * 60_000);
  const session = state.activeFocusSession;
  const marathonPlan = plan?.mode === 'marathon';
  const planHostProject = marathonPlan ? state.projects.find(project => project.id === plan.projectId) : active;
  const planHostIsHabit = planHostProject?.kind === 'habit' && plan?.deferredSettlement !== true;
  const activePendingBlocksWorkbench = !session && input.hasPendingReport && !marathonPlan;
  const marathonReportPhase = !session && plan?.status === 'report' && !planHostIsHabit;
  const isBreak = plan?.status === 'break' && !!plan.breakEndsAt;
  const minimal = canPresentMinimalFocus(state, plan, minimalWanted, activePendingBlocksWorkbench);
  const lastFocus = state.focusHistory[state.focusHistory.length - 1];
  // An authoritative running session is never discarded to display stale report context.
  const phase: 'setup' | 'idle' | 'focus' | 'break' | 'ready' | 'report' = session ? 'focus'
    : marathonReportPhase || activePendingBlocksWorkbench ? 'report'
      : isBreak ? 'break' : plan?.status === 'ready' ? 'ready' : active ? 'idle' : 'setup';
  return {
    phase, plan, session, planHostProject, planHostIsHabit, marathonPlan, marathonReportPhase,
    isBreak, minimal, minimalBreak: minimal && isBreak,
    minimalIdle: minimal && !session && !plan,
    // A confirmed marathon waits on the normal workbench until explicit Start.
    // Once begun, even a paused first round stays on the shared immersive face.
    isImmersiveLayout: minimal || phase === 'focus' || phase === 'break' || phase === 'report'
      || phase === 'ready' && (plan?.hasStarted === true || (plan?.completedRounds ?? 0) > 0),
    endsAt: session?.endsAt ?? (isBreak ? plan?.breakEndsAt : undefined),
    activePendingBlocksWorkbench,
    activeHabitAwaitingBlocksWorkbench: active?.kind === 'habit' && active.habit?.awaitingNextBuilding === true && !marathonPlan && !minimal,
    integrityFailure: !session && lastFocus?.status === 'interrupted' && lastFocus.interruptionReason === 'app-switch-limit',
  };
}
