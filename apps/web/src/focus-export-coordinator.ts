import { focusExportDate, projectFocusExportDays, projectFocusExportSnapshot, type ApplicationService, type FocusExportDay } from '@tomato-clock/application';
import { nativeFocusExport } from '@tomato-clock/platform-capacitor';
import { parseRoundPlan } from './round-plan';
import { ROUND_PLAN_KEY, subscribeSavedRoundPlan } from './round-plan-store';

type ExportService = Pick<ApplicationService, 'snapshot' | 'subscribeCommitted'>;
interface ExportPorts {
  native: typeof nativeFocusExport;
  now: () => string;
  savedPlan: () => unknown;
  subscribePlan: (listener: () => void) => () => void;
}
const defaults: ExportPorts = {
  native: nativeFocusExport,
  now: () => new Date().toISOString(),
  savedPlan: () => JSON.parse(localStorage.getItem(ROUND_PLAN_KEY) ?? 'null'),
  subscribePlan: subscribeSavedRoundPlan,
};

/** One in-flight publication plus a merged dirty flag, never a second command queue. */
export function attachFocusExport(service: ExportService, ports: ExportPorts = defaults): () => void {
  let stopped = false;
  let running = false;
  let dirty = false;
  let replacement = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 5000;
  let unsubscribePlan = () => {};
  let unsubscribeService = () => {};
  let enrolledDate: string | undefined;
  const drain = async () => {
    if (running || stopped || !enrolledDate) return;
    running = true;
    try {
      while (dirty && !stopped) {
        dirty = false;
        const replace = replacement;
        replacement = false;
        try {
          const capturedAt = ports.now();
          // No snapshot, clone or history scan occurs in the standard build.
          const state = service.snapshot();
          const plan = parseRoundPlan(ports.savedPlan(), state.activeProjectId ?? '');
          if (!replace && !state.activeFocusSession && plan?.status === 'break'
            && plan.breakEndsAt && Date.parse(plan.breakEndsAt) > Date.parse(capturedAt) && !plan.breakStartedAt) {
            // Legacy context cannot truthfully describe the current segment. Let the
            // viewer expire its old state rather than sending a fabricated idle/break.
            throw new Error('Exact saved break start is unavailable');
          }
          const interval = !replace && plan?.status === 'break' && plan.breakStartedAt && plan.breakEndsAt
            ? { startedAt: plan.breakStartedAt, endsAt: plan.breakEndsAt } : null;
          const today = focusExportDate(capturedAt);
          if (enrolledDate > today) throw new Error('Capture clock precedes enrollment');
          const days: FocusExportDay[] = [];
          for (let from = enrolledDate; from <= today;) {
            const pageEnd = new Date(Date.parse(`${from}T00:00:00Z`) + 365 * 86400000).toISOString().slice(0, 10);
            const through = pageEnd < today ? pageEnd : today;
            days.push(...projectFocusExportDays(state, from, through, capturedAt));
            from = new Date(Date.parse(`${through}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
          }
          await ports.native.publish({
            snapshot: { capturedAt, value: projectFocusExportSnapshot(state, capturedAt, { breakInterval: interval }) },
            days, replacement: replace,
          });
          retryMs = 5000;
        } catch {
          replacement ||= replace;
          dirty = true;
          retry = setTimeout(() => { retry = undefined; void drain(); }, retryMs);
          retryMs = Math.min(retryMs * 2, 300000);
          break;
        }
      }
    } finally { running = false; }
  };
  const request = (event: { replacement: boolean }) => {
    replacement ||= event.replacement;
    dirty = true;
    // A newly committed state may resolve an old projection/storage failure.
    if (retry) { clearTimeout(retry); retry = undefined; }
    void drain();
  };
  // Presence check precedes subscriptions and all domain projection.
  void ports.native.availability().then(available => {
    if (stopped || !available.available || !available.enrolledDate) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(available.enrolledDate)) return;
    enrolledDate = available.enrolledDate;
    unsubscribeService = service.subscribeCommitted(request);
    unsubscribePlan = ports.subscribePlan(() => request({ replacement: false }));
    request({ replacement: false });
  }).catch(() => { /* An unavailable optional integration leaves the app local-only. */ });
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    unsubscribeService(); unsubscribePlan();
  };
}
