import type { DomainState } from '@tomato-clock/domain';
import type { RoundPlan } from './round-plan';

/** Existing ordinary work/reporting always wins over the optional idle shell. */
export function canPresentMinimalFocus(state: DomainState, plan: RoundPlan | null, wanted: boolean, hasPendingReport: boolean): boolean {
  if (!wanted || !state.activeProjectId || hasPendingReport || plan?.status === 'report') return false;
  if (state.activeFocusSession && state.activeFocusSession.deferredSettlement !== true) return false;
  return !plan || plan.deferredSettlement === true;
}
