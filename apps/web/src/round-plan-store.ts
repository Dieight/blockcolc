import { parseRoundPlan, roundPlansEqual, type RoundPlan } from './round-plan';
import { markFocusPerformance } from './focus-performance';

export const ROUND_PLAN_KEY = 'blockcolc-round-plan-v1';
export const PLAN_STORAGE_ERROR = '轮次界面未能保存；已保存的计时和专注记录不受影响。';
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const savedListeners = new Set<() => void>();
/** Integrations observe successful saves only; observers never block plan persistence. */
export function subscribeSavedRoundPlan(listener: () => void): () => void {
  savedListeners.add(listener);
  return () => { savedListeners.delete(listener); };
}

/** Reading is best effort; writing must never claim success after a storage failure. */
export function createRoundPlanStore(storage: () => StoragePort) {
  return {
    read(projectId: string): RoundPlan | null {
      try { return parseRoundPlan(JSON.parse(storage().getItem(ROUND_PLAN_KEY) ?? 'null'), projectId); }
      catch { return null; }
    },
    write(next: RoundPlan | null): void {
      if (next) storage().setItem(ROUND_PLAN_KEY, JSON.stringify(next));
      else storage().removeItem(ROUND_PLAN_KEY);
      for (const listener of savedListeners) {
        try { listener(); } catch { /* An optional integration cannot fail a saved plan. */ }
      }
    },
  };
}

export interface RoundPlanSnapshot {
  plan: RoundPlan | null;
  savedPlan: RoundPlan | null;
  error: string | null;
}

/** Single synchronous owner, including between an async command and React's next render. */
export function createRoundPlanController(
  store: ReturnType<typeof createRoundPlanStore>,
  projectId: string,
  publish: (snapshot: RoundPlanSnapshot) => void,
) {
  const initial = store.read(projectId);
  let current: RoundPlanSnapshot = { plan: initial, savedPlan: initial, error: null };
  const adopt = (next: RoundPlanSnapshot) => { current = next; publish(next); };
  const write = (next: RoundPlan | null) => {
    try { store.write(next); }
    catch (error) { adopt({ ...current, error: PLAN_STORAGE_ERROR }); throw error; }
    markFocusPerformance('plan-persisted');
    adopt({ plan: next, savedPlan: next, error: null });
  };
  return {
    snapshot: () => current,
    readPlan: () => current.plan,
    write,
    selectHost(nextProjectId: string) {
      if (current.plan?.mode === 'marathon') return;
      const loaded = store.read(nextProjectId);
      adopt({ ...current, plan: loaded, savedPlan: loaded });
    },
    reconcile(next: RoundPlan | null) {
      if (roundPlansEqual(current.plan, next)) return;
      try { write(next); }
      catch {
        // Recovery is display context, not evidence that persistence succeeded.
        adopt({ ...current, plan: next });
      }
    },
  };
}
