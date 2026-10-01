import type { DomainState } from '@blockcolc/domain';
import type { RoundPlan } from './round-plan';

/** Ordinary work/reporting keeps its identity; deferred reporting stays in the
 * same opted-in minimal glass surface as the focus rounds that produced it. */
export function canPresentMinimalFocus(state: DomainState, plan: RoundPlan | null, wanted: boolean, hasPendingReport: boolean): boolean {
  if (!wanted || !state.activeProjectId || hasPendingReport) return false;
  if (state.activeFocusSession && state.activeFocusSession.deferredSettlement !== true) return false;
  return !plan || plan.deferredSettlement === true;
}
