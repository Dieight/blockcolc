export const APPLICATION_STATE_CHANGED_EVENT = 'blockcolc:application-state-changed';

export interface ApplicationStateChangedDetail {
  lifecycleType: 'background' | 'foreground';
  sessionId: string | null;
  excursionRecorded: boolean;
  effectiveExcursions: number | null;
  maxEffectiveExcursions: number;
}

export interface RecordedIntegrityNotice { sessionId: string; count: number; max: number; sequence: number }

/**
 * A recovery result with no domain events can still adopt a newer persisted
 * revision. Keep that refresh visible even when the active session facts are
 * unchanged; only an unchanged revision and unchanged active facts are a
 * renderer no-op.
 */
export function shouldPublishLifecycleRefresh(input: {
  lifecycleType: 'background' | 'foreground';
  ok: boolean;
  events: readonly unknown[];
  activeFactsChanged: boolean;
  revisionChanged: boolean;
}): boolean {
  // Background integrity is already durably saved by bootstrap. The page is
  // covered by Android UI while this transition is processed, and foreground
  // reconciliation publishes the only user-visible result (including any
  // counted excursion). Avoid rendering the world for this transient receipt.
  if (input.ok && input.lifecycleType === 'background'
    && input.events.length === 1 && eventType(input.events[0]) === 'FocusBackgrounded') return false;
  return !(input.ok && input.events.length === 0 && !input.activeFactsChanged && !input.revisionChanged);
}

function eventType(event: unknown): string | null {
  if (!event || typeof event !== 'object' || !('type' in event)) return null;
  return typeof event.type === 'string' ? event.type : null;
}

/** Consumes processed receipts only. Platform subscription and domain reconciliation remain in bootstrap. */
export function bindApplicationLifecycle(target: EventTarget, ports: {
  resume: () => Promise<unknown>;
  refresh: () => void;
  record: (notice: Omit<RecordedIntegrityNotice, 'sequence'>) => void;
}) {
  let disposed = false;
  const pageShow = (event: Event) => {
    if (!(event as PageTransitionEvent).persisted) return;
    void ports.resume().then(() => { if (!disposed) ports.refresh(); });
  };
  const changed = (event: Event) => {
    const detail = (event as CustomEvent<ApplicationStateChangedDetail>).detail;
    if (detail?.excursionRecorded && detail.effectiveExcursions !== null && detail.sessionId) {
      // Record before refresh so a closing/replaced subtree cannot swallow the signal.
      ports.record({ sessionId: detail.sessionId, count: detail.effectiveExcursions, max: detail.maxEffectiveExcursions });
    }
    ports.refresh();
  };
  target.addEventListener('pageshow', pageShow);
  target.addEventListener(APPLICATION_STATE_CHANGED_EVENT, changed);
  return () => {
    disposed = true;
    target.removeEventListener('pageshow', pageShow);
    target.removeEventListener(APPLICATION_STATE_CHANGED_EVENT, changed);
  };
}
