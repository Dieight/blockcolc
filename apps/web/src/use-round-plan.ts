import { useEffect, useState } from 'react';
import { createRoundPlanController, createRoundPlanStore, type RoundPlanSnapshot } from './round-plan-store';

export function useRoundPlan(projectId: string) {
  const [snapshot, setSnapshot] = useState<RoundPlanSnapshot | null>(null);
  const [controller] = useState(() => createRoundPlanController(
    createRoundPlanStore(() => window.localStorage), projectId, setSnapshot,
  ));
  useEffect(() => { controller.selectHost(projectId); }, [controller, projectId]);
  const current = snapshot ?? controller.snapshot();
  return { plan: current.plan, planStorageError: current.error,
    setPlan: controller.write, readPlan: controller.readPlan, reconcilePlan: controller.reconcile };
}
