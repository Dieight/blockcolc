import type { ApplicationCommand, ApplicationResult, ApplicationService } from '@tomato-clock/application';
import type { DomainState } from '@tomato-clock/domain';
import { subscribeSavedRoundPlan as subscribeSavedPlan } from './round-plan-store';
import {
  automaticContinuationEventId,
  automaticContinuationSessionId,
  automaticContinuationStartAt,
  MAX_MARATHON_ROUNDS,
  reconcileRoundPlan,
  reserveAutomaticContinuation,
  roundPlansEqual,
  type RoundPlan,
} from './round-plan';

export interface AutomaticContinuationDeadlineEvent {
  eventId: string;
  authorizationId: string;
  scheduledAtEpochMs: number;
}

export interface AutomaticContinuationDeadlinePort {
  schedule(event: AutomaticContinuationDeadlineEvent): Promise<{ scheduled: boolean; exact: boolean; due: boolean }>;
  cancel(eventId: string): Promise<void>;
  cancelAuthorization(authorizationId: string): Promise<void>;
  pending(): Promise<AutomaticContinuationDeadlineEvent[]>;
  acknowledge(eventId: string): Promise<void>;
  listen(listener: (event: AutomaticContinuationDeadlineEvent) => void): Promise<() => Promise<void> | void>;
}

export interface AutomaticContinuationCoordinatorPorts {
  service: Pick<ApplicationService, 'snapshot' | 'resume' | 'startScheduledFocus' | 'subscribeCommitted'>;
  deadlines: AutomaticContinuationDeadlinePort;
  readPlan: () => RoundPlan | null;
  /** Must throw if the local round-plan write did not commit. */
  writePlan: (plan: RoundPlan | null) => void;
  preferences: () => Pick<import('./app-types').FocusPreferences,
    'autoContinueFocus' | 'focusMinutes' | 'habitFocusMinutes' | 'breakMinutes'>;
  refresh?: () => void;
  nowMs?: () => number;
  newAuthorizationId?: () => string;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  eventTarget?: EventTarget;
}

export interface AutomaticContinuationRunResult {
  startedSessionIds: string[];
  retryable: boolean;
  blockedBy?: 'disabled' | 'report' | 'manual-progress' | 'habit-boundary' | 'schedule' | 'active-focus' | 'round-limit';
  error?: unknown;
}

const MAX_CATCH_UP_ROUNDS = MAX_MARATHON_ROUNDS + 2;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const RETRY_DELAY_MS = 30_000;

/**
 * Serial Web orchestration shared by live deadline events, resume, and local
 * foreground timers. Native deadlines are a wake-up signal only: the JS/domain
 * service remains the sole authority that creates and settles focus sessions.
 */
export function createAutomaticContinuationCoordinator(ports: AutomaticContinuationCoordinatorPorts) {
  let tail: Promise<void> = Promise.resolve();
  let disposed = false;
  let lifecycleGeneration = 0;
  let startPromise: Promise<void> | null = null;
  let removeDeadlineListener: (() => Promise<void> | void) | null = null;
  let removeSavedPlanListener: (() => void) | null = null;
  let removeServiceListener: (() => void) | null = null;
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let localTimerKey: string | null = null;
  let nativeEventKey: string | null = null;
  let nativeScheduledKey: string | null = null;
  let observedAuthorizationId: string | null = null;
  let lastResult: AutomaticContinuationRunResult = { startedSessionIds: [], retryable: false };
  const timer = ports.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = ports.clearTimer ?? (handle => clearTimeout(handle));
  const nowMs = ports.nowMs ?? (() => Date.now());
  const getEventTarget = () => ports.eventTarget ?? (typeof window === 'undefined' ? undefined : window);
  const serial = (operation: () => Promise<AutomaticContinuationRunResult>) => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  async function start(): Promise<void> {
    if (startPromise) return startPromise;
    disposed = false;
    const generation = ++lifecycleGeneration;
    startPromise = (async () => {
      let removeListener: (() => Promise<void> | void) | undefined;
      try {
        removeListener = await ports.deadlines.listen(event => { void handleDeadline(event); });
      } catch {
        // Durable native scheduling may be unavailable. The local absolute-time
        // fallback remains useful while the WebView is alive; resume still
        // catches up from domain timestamps after a process restart.
      }
      if (disposed || generation !== lifecycleGeneration) {
        await removeListener?.();
        return;
      }
      removeDeadlineListener = removeListener ?? null;
      observedAuthorizationId ??= ports.readPlan()?.automaticContinuation?.authorizationId ?? null;
      removeSavedPlanListener = subscribeSavedPlan(() => { void reconcile(); });
      removeServiceListener = ports.service.subscribeCommitted(() => { void reconcile(); });
      const target = getEventTarget();
      if (target) {
        const resume = () => {
          if (typeof document === 'undefined' || !document.hidden) void onResume();
        };
        target.addEventListener('pageshow', resume);
        target.addEventListener('focus', resume);
        target.addEventListener('blockcolc:application-state-changed', onApplicationStateChanged as EventListener);
        eventCleanup = () => {
          target.removeEventListener('pageshow', resume);
          target.removeEventListener('focus', resume);
          target.removeEventListener('blockcolc:application-state-changed', onApplicationStateChanged as EventListener);
        };
      }
      if (typeof document !== 'undefined') {
        const resume = () => { if (!document.hidden) void onResume(); };
        document.addEventListener('visibilitychange', resume);
        documentCleanup = () => document.removeEventListener('visibilitychange', resume);
      }
      if (disposed || generation !== lifecycleGeneration) return;
      void drainPending();
      void onResume();
    })();
    return startPromise;
  }

  let eventCleanup: (() => void) | null = null;
  let documentCleanup: (() => void) | null = null;

  function onApplicationStateChanged(event: Event): void {
    const detail = (event as CustomEvent<{ lifecycleType?: string }>).detail;
    if (detail?.lifecycleType === 'foreground') void onResume();
  }

  async function stop(): Promise<void> {
    disposed = true;
    lifecycleGeneration += 1;
    if (localTimer !== null) clearTimer(localTimer);
    localTimer = null;
    localTimerKey = null;
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = null;
    eventCleanup?.();
    eventCleanup = null;
    documentCleanup?.();
    documentCleanup = null;
    removeSavedPlanListener?.();
    removeSavedPlanListener = null;
    removeServiceListener?.();
    removeServiceListener = null;
    const removeNativeListener = removeDeadlineListener;
    removeDeadlineListener = null;
    if (removeNativeListener) await removeNativeListener();
    startPromise = null;
  }

  function onResume(): Promise<AutomaticContinuationRunResult> {
    return serial(() => runCycle({ resume: true }));
  }

  function reconcile(): Promise<AutomaticContinuationRunResult> {
    return serial(() => runCycle({ resume: false }));
  }

  function retry(): Promise<AutomaticContinuationRunResult> {
    return onResume();
  }

  function handleDeadline(event: AutomaticContinuationDeadlineEvent): Promise<AutomaticContinuationRunResult> {
    return serial(() => runCycle({ resume: true, trigger: event }));
  }

  async function drainPending(): Promise<void> {
    if (disposed) return;
    try {
      const pending = await ports.deadlines.pending();
      if (pending.length > 0) await handleDeadline(pending[0]!);
    } catch {
      // A later native delivery or lifecycle resume retries the durable queue.
    }
  }

  async function runCycle(options: { resume: boolean; trigger?: AutomaticContinuationDeadlineEvent }): Promise<AutomaticContinuationRunResult> {
    const startedSessionIds: string[] = [];
    try {
      if (disposed) return remember({ startedSessionIds, retryable: false });
      observedAuthorizationId ??= ports.readPlan()?.automaticContinuation?.authorizationId ?? null;
      if (options.resume) {
        const resumed = await ports.service.resume();
        if (!resumed.ok) return remember({ startedSessionIds, retryable: true });
      }

      let state = ports.service.snapshot();
      let plan = reconcileAndPersist(state);
      const currentAuthorizationId = plan?.automaticContinuation?.authorizationId ?? null;
      if (observedAuthorizationId && observedAuthorizationId !== currentAuthorizationId) {
        await cancelAuthorization(observedAuthorizationId);
      }
      if (currentAuthorizationId) observedAuthorizationId = currentAuthorizationId;
      if (options.trigger && plan?.automaticContinuation?.authorizationId !== options.trigger.authorizationId) {
        await retireTrigger(options.trigger, state, plan?.automaticContinuation?.authorizationId ?? null);
      } else if (options.trigger && !deadlineMatchesPlan(options.trigger, plan, state)) {
        await retireTrigger(options.trigger, state, plan?.automaticContinuation?.authorizationId ?? null);
      }

      for (let iteration = 0; iteration < MAX_CATCH_UP_ROUNDS; iteration += 1) {
        if (disposed) break;
        const preferences = ports.preferences();
        state = ports.service.snapshot();
        plan = reconcileAndPersist(state);
        const loopAuthorizationId = plan?.automaticContinuation?.authorizationId ?? null;
        if (observedAuthorizationId && observedAuthorizationId !== loopAuthorizationId) {
          await cancelAuthorization(observedAuthorizationId);
        }
        if (loopAuthorizationId) observedAuthorizationId = loopAuthorizationId;
        if (!plan) {
          await cancelObservedAuthorization();
          await acknowledgeCommittedEvents(options.trigger, startedSessionIds, state);
          ports.refresh?.();
          return remember({ startedSessionIds, retryable: false });
        }

        plan = enforceAuthorizationPolicy(plan, state, preferences.autoContinueFocus);
        if (plan !== ports.readPlan()) persist(plan);
        const authorization = plan.automaticContinuation;
        if (!preferences.autoContinueFocus || !authorization) {
          await cancelObservedAuthorization();
          await acknowledgeCommittedEvents(options.trigger, startedSessionIds, state);
          return remember({ startedSessionIds, retryable: false, blockedBy: 'disabled' });
        }
        observedAuthorizationId = authorization.authorizationId;

        if (plan.status === 'report') {
          await cancelAuthorization(authorization.authorizationId);
          await acknowledgeCommittedEvents(options.trigger, startedSessionIds, state);
          return remember({ startedSessionIds, retryable: false, blockedBy: 'report' });
        }

        if (plan.status === 'focus') {
          const active = state.activeFocusSession;
          if (active) {
            const event = nextDeadlineForActiveFocus(plan, state, active);
            if (event) await scheduleDeadline(event);
            else await cancelScheduledDeadline();
            await acknowledgeCommittedEvents(options.trigger, startedSessionIds, state);
            ports.refresh?.();
            return remember({ startedSessionIds, retryable: false, blockedBy: 'active-focus' });
          }
          // A completed ordinary finite round remains in this phase until the
          // user makes its explicit progress report; it is never auto-assigned.
          await cancelScheduledDeadline();
          await acknowledgeCommittedEvents(options.trigger, startedSessionIds, state);
          return remember({ startedSessionIds, retryable: false, blockedBy: 'manual-progress' });
        }

        if (plan.status === 'break') {
          const event = nextDeadlineForBreak(plan, nowMs());
          if (event) {
            await scheduleDeadline(event);
            await acknowledgeCommittedEvents(options.trigger, startedSessionIds, state);
            return remember({ startedSessionIds, retryable: false });
          }
          // The reconciler should have converted an elapsed break to ready. If
          // wall-clock movement raced this pass, let the next loop re-read it.
          continue;
        }

        if (plan.status !== 'ready') {
          await cancelScheduledDeadline();
          await acknowledgeCommittedEvents(options.trigger, startedSessionIds, state);
          return remember({ startedSessionIds, retryable: false });
        }

        const reservation = reserveAutomaticContinuation(plan, state, nowMs());
        if (!reservation) {
          const event = nextDeadlineForReadyPlan(plan, state, nowMs());
          if (event) await scheduleDeadline(event);
          else {
            await cancelScheduledDeadline();
            const project = state.projects.find(candidate => candidate.id === plan!.projectId);
            await acknowledgeCommittedEvents(options.trigger, startedSessionIds, state);
            if (project?.kind === 'habit' && project.habit?.awaitingNextBuilding) {
              await cancelAuthorization(authorization.authorizationId);
              return remember({ startedSessionIds, retryable: false, blockedBy: 'habit-boundary' });
            }
            if (plan.completedRounds >= plan.totalRounds - 1) {
              return remember({ startedSessionIds, retryable: false, blockedBy: 'round-limit' });
            }
            return remember({ startedSessionIds, retryable: false, blockedBy: reservationBlockReason(plan, state) ?? 'schedule' });
          }
          return remember({ startedSessionIds, retryable: false, blockedBy: reservationBlockReason(plan, state) });
        }

        // This write-ahead reservation is the cross-store idempotency boundary.
        // Never call ApplicationService until localStorage confirms it.
        persist(reservation.plan);
        const command: Extract<ApplicationCommand, { type: 'StartFocus' }> = {
          type: 'StartFocus',
          projectId: plan.projectId,
          subtaskId: plan.subtaskId,
          plannedDurationMs: reservation.plannedDurationMs,
          ...(plan.mode === 'marathon' ? { marathon: true } : {}),
          ...(plan.deferredSettlement === true ? { deferredSettlement: true } : {}),
        };
        const started = await ports.service.startScheduledFocus(command, {
          sessionId: reservation.sessionId,
          scheduledAt: reservation.scheduledAt,
        });
        if (!started.ok) {
          return remember({ startedSessionIds, retryable: true, error: started });
        }
        startedSessionIds.push(reservation.sessionId);
        await ports.deadlines.acknowledge(automaticContinuationEventId(authorization.authorizationId, reservation.plan.completedRounds + 1));
        // startScheduledFocus either leaves the reserved focus active or, when
        // its absolute end already passed, settles it at endsAt. Re-run the
        // ordinary recovery path and catch up another due round if needed.
      }

      const stateAfter = ports.service.snapshot();
      await acknowledgeCommittedEvents(options.trigger, startedSessionIds, stateAfter);
      ports.refresh?.();
      return remember({ startedSessionIds, retryable: true, blockedBy: 'round-limit' });
    } catch (error) {
      // In particular, a failed plan reservation write leaves the native event
      // queued and prevents the domain start; a retry reuses its stable ID.
      return remember({ startedSessionIds, retryable: true, error });
    }
  }

  function reconcileAndPersist(state: DomainState): RoundPlan | null {
    const current = ports.readPlan();
    const activeProjectId = state.activeProjectId ?? current?.projectId ?? '';
    const next = reconcileRoundPlan(current, state, activeProjectId, nowMs(),
      ports.preferences().breakMinutes * 60_000, ports.preferences().breakMinutes * 60_000);
    if (!roundPlansEqual(current, next)) persist(next);
    return next;
  }

  function persist(plan: RoundPlan | null): void {
    if (roundPlansEqual(ports.readPlan(), plan)) return;
    ports.writePlan(plan);
  }

  function enforceAuthorizationPolicy(plan: RoundPlan, _state: DomainState, enabled: boolean): RoundPlan {
    const remainingAfterCurrent = plan.status === 'focus'
      ? plan.completedRounds + 1 < plan.totalRounds
      : plan.completedRounds < plan.totalRounds;
    const cannotContinue = !remainingAfterCurrent || plan.endAfterBreak || plan.status === 'report';
    if (!enabled || cannotContinue) {
      if (!plan.automaticContinuation) return plan;
      const { automaticContinuation: _automaticContinuation, ...withoutAuthorization } = plan;
      return withoutAuthorization;
    }
    // FocusFlow and minimal-focus persist authorization when the user starts a
    // chain. A plan without it is an explicit manual-wait state (including a
    // manually interrupted or early-completed round); recreating authorization
    // here would turn that user intervention back into an automatic start.
    return plan;
  }

  function nextDeadlineForBreak(plan: RoundPlan, now: number): AutomaticContinuationDeadlineEvent | null {
    const authorization = plan.automaticContinuation;
    const scheduledAtEpochMs = Date.parse(plan.breakEndsAt ?? '');
    if (!authorization || plan.endAfterBreak || plan.completedRounds >= plan.totalRounds
      || !Number.isFinite(scheduledAtEpochMs) || scheduledAtEpochMs <= now) return null;
    return {
      eventId: automaticContinuationEventId(authorization.authorizationId, plan.completedRounds + 1),
      authorizationId: authorization.authorizationId,
      scheduledAtEpochMs,
    };
  }

  function nextDeadlineForActiveFocus(
    plan: RoundPlan,
    state: DomainState,
    active: NonNullable<DomainState['activeFocusSession']>,
  ): AutomaticContinuationDeadlineEvent | null {
    const authorization = plan.automaticContinuation;
    const project = state.projects.find(candidate => candidate.id === plan.projectId);
    const nextRound = plan.completedRounds + 2;
    if (!authorization || nextRound > plan.totalRounds || !project) return null;
    const selfSettling = plan.mode === 'marathon' || plan.deferredSettlement === true || project.kind === 'habit';
    if (!selfSettling) return null;
    if (project.kind === 'habit') {
      if (project.habit?.awaitingNextBuilding) return null;
      const planDeferredRounds = plan.deferredSettlement === true
        ? plan.reportedSessionIds.filter(sessionId => state.focusHistory.some(session =>
            session.id === sessionId && session.projectId === plan.projectId && session.deferredSettlement === true,
          )).length
        : 0;
      const currentRounds = project.habit!.completedFocusSessionIds.length + planDeferredRounds + 1;
      if (currentRounds >= project.habit!.targetRounds) return null;
    }
    const scheduledAtEpochMs = Date.parse(active.endsAt) + authorization.breakDurationMs;
    if (!Number.isFinite(scheduledAtEpochMs)) return null;
    return {
      eventId: automaticContinuationEventId(authorization.authorizationId, nextRound),
      authorizationId: authorization.authorizationId,
      scheduledAtEpochMs,
    };
  }

  function nextDeadlineForReadyPlan(plan: RoundPlan, state: DomainState, now: number, includeDue = false): AutomaticContinuationDeadlineEvent | null {
    const authorization = plan.automaticContinuation;
    const round = plan.completedRounds + 1;
    if (!authorization || round > plan.totalRounds || plan.endAfterBreak) return null;
    const scheduledAt = automaticContinuationStartAt(plan, state);
    const scheduledAtEpochMs = Date.parse(scheduledAt ?? '');
    if (!Number.isFinite(scheduledAtEpochMs) || (!includeDue && scheduledAtEpochMs <= now)) return null;
    return {
      eventId: automaticContinuationEventId(authorization.authorizationId, round),
      authorizationId: authorization.authorizationId,
      scheduledAtEpochMs,
    };
  }

  async function scheduleDeadline(event: AutomaticContinuationDeadlineEvent): Promise<void> {
    const key = `${event.eventId}\u0000${event.scheduledAtEpochMs}`;
    if (localTimerKey !== key) {
      if (localTimer !== null) clearTimer(localTimer);
      localTimer = null;
      if (nativeEventKey && nativeEventKey !== key) {
        try { await ports.deadlines.cancel(nativeEventKey.split('\u0000')[0]!); }
        catch { /* Current plan validation makes the obsolete event inert. */ }
        nativeEventKey = null;
        nativeScheduledKey = null;
      }
      localTimerKey = key;
      const delay = Math.max(0, Math.min(MAX_TIMER_DELAY_MS, event.scheduledAtEpochMs - nowMs()));
      localTimer = timer(() => {
        localTimer = null;
        localTimerKey = null;
        void handleDeadline(event);
      }, delay);
    }
    // A foreground timeout and an OS alarm are independent wake paths. Keep
    // retrying a failed/inexactly-unavailable native registration on the next
    // reconcile, without resetting the already-correct local absolute timer.
    if (nativeScheduledKey === key) return;
    try {
      const result = await ports.deadlines.schedule(event);
      nativeEventKey = key;
      nativeScheduledKey = result.scheduled ? key : null;
    } catch {
      nativeEventKey = key;
      nativeScheduledKey = null;
    }
  }

  async function cancelScheduledDeadline(): Promise<void> {
    if (localTimer !== null) clearTimer(localTimer);
    localTimer = null;
    localTimerKey = null;
    const previous = nativeEventKey;
    nativeEventKey = null;
    nativeScheduledKey = null;
    if (previous) {
      try { await ports.deadlines.cancel(previous.split('\u0000')[0]!); }
      catch { /* A stale event is rejected again against the persisted plan. */ }
    }
  }

  async function cancelAuthorization(authorizationId: string): Promise<void> {
    await cancelScheduledDeadline();
    try { await ports.deadlines.cancelAuthorization(authorizationId); }
    catch { /* The due handler validates the current authorization before start. */ }
    if (observedAuthorizationId === authorizationId) observedAuthorizationId = null;
  }

  async function cancelObservedAuthorization(): Promise<void> {
    const authorizationId = observedAuthorizationId;
    await cancelScheduledDeadline();
    if (authorizationId) await cancelAuthorization(authorizationId);
  }

  async function retireTrigger(event: AutomaticContinuationDeadlineEvent, state: DomainState, currentAuthorizationId: string | null): Promise<void> {
    const sessionId = automaticContinuationSessionId(event.authorizationId, parseRoundFromEvent(event.eventId));
    const alreadyCommitted = state.activeFocusSession?.id === sessionId || state.focusHistory.some(session => session.id === sessionId);
    if (alreadyCommitted) {
      try { await ports.deadlines.acknowledge(event.eventId); } catch { /* replay remains idempotent */ }
    } else {
      try { await ports.deadlines.cancel(event.eventId); } catch { /* stale event is validated again before a start */ }
      if (currentAuthorizationId !== event.authorizationId) {
        try { await ports.deadlines.cancelAuthorization(event.authorizationId); } catch { /* stale authorization stays inert */ }
      }
      try { await ports.deadlines.acknowledge(event.eventId); } catch { /* cancelled authorization remains inert */ }
    }
  }

  function deadlineMatchesPlan(event: AutomaticContinuationDeadlineEvent, plan: RoundPlan | null, state: DomainState): boolean {
    if (!plan?.automaticContinuation || plan.automaticContinuation.authorizationId !== event.authorizationId) return false;
    let expected: AutomaticContinuationDeadlineEvent | null = null;
    if (plan.status === 'break') expected = nextDeadlineForBreak(plan, Number.NEGATIVE_INFINITY);
    else if (plan.status === 'ready') expected = nextDeadlineForReadyPlan(plan, state, nowMs(), true);
    else if (plan.status === 'focus' && state.activeFocusSession) expected = nextDeadlineForActiveFocus(plan, state, state.activeFocusSession);
    return expected?.eventId === event.eventId && expected.scheduledAtEpochMs === event.scheduledAtEpochMs;
  }

  async function acknowledgeCommittedEvents(
    trigger: AutomaticContinuationDeadlineEvent | undefined,
    startedIds: string[],
    state: DomainState,
  ): Promise<void> {
    let due = trigger ? [trigger] : [];
    try { due = [...due, ...await ports.deadlines.pending()]; } catch { /* leave unread events for a later drain */ }
    const unique = new Map(due.map(event => [event.eventId, event]));
    for (const event of unique.values()) {
      const round = parseRoundFromEvent(event.eventId);
      const sessionId = automaticContinuationSessionId(event.authorizationId, round);
      const committed = startedIds.includes(sessionId)
        || state.activeFocusSession?.id === sessionId
        || state.focusHistory.some(session => session.id === sessionId);
      if (committed) {
        try { await ports.deadlines.acknowledge(event.eventId); } catch { /* repeated event is idempotent */ }
      }
    }
  }

  function parseRoundFromEvent(eventId: string): number {
    const match = /:round:(\d+)$/.exec(eventId);
    return match ? Number(match[1]) : -1;
  }

  function reservationBlockReason(plan: RoundPlan, state: DomainState): AutomaticContinuationRunResult['blockedBy'] {
    if (state.activeFocusSession) return 'active-focus';
    const project = state.projects.find(candidate => candidate.id === plan.projectId);
    if (project?.kind === 'habit' && project.habit?.awaitingNextBuilding) return 'habit-boundary';
    if (plan.mode !== 'marathon' && plan.deferredSettlement !== true && project?.kind === 'finite') return 'manual-progress';
    return 'schedule';
  }

  function remember(result: AutomaticContinuationRunResult): AutomaticContinuationRunResult {
    lastResult = result;
    if (result.retryable) {
      if (retryTimer === null && !disposed) {
        retryTimer = timer(() => {
          retryTimer = null;
          void onResume();
        }, RETRY_DELAY_MS);
      }
    } else if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    return result;
  }

  return {
    start,
    stop,
    onResume,
    reconcile,
    retry,
    handleDeadline,
    drainPending,
    get lastResult() { return lastResult; },
  };
}
