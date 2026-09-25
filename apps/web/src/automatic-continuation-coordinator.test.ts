import { describe, expect, it, vi } from 'vitest';
import { ApplicationService, type NotificationCapability, type StateRepository } from '@tomato-clock/application';
import type { DomainState } from '@tomato-clock/domain';
import {
  type AutomaticContinuationDeadlineEvent,
  type AutomaticContinuationDeadlinePort,
  createAutomaticContinuationCoordinator,
} from './automatic-continuation';
import { automaticContinuationEventId, automaticContinuationSessionId, type RoundPlan } from './round-plan';

const BASE = Date.parse('2026-09-23T09:00:00.000Z');
const AUTH = 'authorization-coordinator-test';

function deadlinePort(now: () => number) {
  const pending: AutomaticContinuationDeadlineEvent[] = [];
  const scheduled: AutomaticContinuationDeadlineEvent[] = [];
  const acknowledgements: string[] = [];
  const cancelled: string[] = [];
  const listeners = new Set<(event: AutomaticContinuationDeadlineEvent) => void>();
  let scheduleBehavior: AutomaticContinuationDeadlinePort['schedule'] = async event => {
    const previous = scheduled.findIndex(candidate => candidate.eventId === event.eventId);
    if (previous >= 0) scheduled.splice(previous, 1);
    scheduled.push(event);
    return { scheduled: true, exact: true, due: event.scheduledAtEpochMs <= now() };
  };
  const port: AutomaticContinuationDeadlinePort = {
    schedule: event => scheduleBehavior(event),
    cancel: async eventId => { cancelled.push(eventId); },
    cancelAuthorization: async authorizationId => { cancelled.push(`authorization:${authorizationId}`); },
    pending: async () => [...pending],
    acknowledge: async eventId => {
      acknowledgements.push(eventId);
      const index = pending.findIndex(event => event.eventId === eventId);
      if (index >= 0) pending.splice(index, 1);
    },
    listen: async listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return {
    port, pending, scheduled, acknowledgements, cancelled, listeners,
    setScheduleBehavior: (behavior: typeof scheduleBehavior) => { scheduleBehavior = behavior; },
  };
}

async function harness(initialMarathon = true) {
  let now = BASE;
  let persisted: DomainState | null = null;
  let revision = 0;
  let failNextSave = false;
  let id = 0;
  const repository: StateRepository = {
    load: async () => ({ state: persisted ? structuredClone(persisted) : null, revision }),
    save: async (next, expectedRevision) => {
      if (failNextSave) { failNextSave = false; throw new Error('disk full'); }
      if (expectedRevision !== revision) throw new Error('revision conflict');
      persisted = structuredClone(next);
      return ++revision;
    },
  };
  const capability: NotificationCapability = { permission: 'granted', precision: 'exact', canSchedule: true };
  const service = await ApplicationService.initialize({
    repository, clock: { now: () => new Date(now) }, ids: { next: kind => `${kind}-${++id}` }, initialTimeZone: 'UTC',
    notifications: {
      requestPermission: async () => capability,
      refreshCapability: async () => capability,
      scheduleFocusCompletion: async () => undefined,
      cancelFocusCompletion: async () => undefined,
      scheduleBreakCompletion: async () => undefined,
      cancelBreakCompletion: async () => undefined,
    },
  });
  const created = await service.dispatch({ type: 'CreateProject', title: 'Work', blueprintId: 'cottage', subtasks: [{ title: 'Task' }] });
  if (!created.ok) throw new Error(created.message);
  const project = service.activeProjectProjection()!.project;
  const subtaskId = project.subtasks[0]!.id;
  const firstResult = await service.dispatch({
    type: 'StartFocus', projectId: project.id, subtaskId, plannedDurationMs: 60_000,
    ...(initialMarathon ? { marathon: true } : {}),
  });
  if (!firstResult.ok || !firstResult.state.activeFocusSession) throw new Error('initial focus failed');
  const firstSession = firstResult.state.activeFocusSession;
  now += 60_000;
  const completion = await service.resume();
  if (!completion.ok || completion.state.focusHistory.length !== 1) throw new Error('initial focus did not complete');

  let plan: RoundPlan | null = {
    projectId: project.id,
    subtaskId,
    totalRounds: 3,
    completedRounds: 1,
    status: 'ready',
    currentSessionId: undefined,
    reportedSessionIds: [firstSession.id],
    ...(initialMarathon ? { mode: 'marathon' as const, endAt: new Date(BASE + 20 * 60_000).toISOString() } : { mode: 'rounds' as const }),
    automaticContinuation: {
      authorizationId: AUTH,
      focusDurationMs: 60_000,
      breakDurationMs: 2 * 60_000,
      nextRoundStartsAt: new Date(BASE + 3 * 60_000).toISOString(),
    },
  };
  let autoEnabled = true;
  const deadlines = deadlinePort(() => now);
  const writePlan = vi.fn((next: RoundPlan | null) => { plan = next; });
  const coordinator = createAutomaticContinuationCoordinator({
    service,
    deadlines: deadlines.port,
    readPlan: () => plan,
    writePlan,
    preferences: () => ({ autoContinueFocus: autoEnabled, focusMinutes: 1, habitFocusMinutes: 1, breakMinutes: 2 }),
    nowMs: () => now,
    setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => undefined,
  });
  return {
    service, project, subtaskId, firstSession, deadlines, coordinator, writePlan,
    plan: () => plan,
    setPlan: (next: RoundPlan | null) => { plan = next; },
    setAutoEnabled: (enabled: boolean) => { autoEnabled = enabled; },
    setNow: (value: number) => { now = value; },
    advance: (duration: number) => { now += duration; },
    failNextDomainSave: () => { failNextSave = true; },
  };
}

describe('automatic continuation coordinator', () => {
  it('catches up a locked marathon across multiple absolute focus and break intervals without duplicate sessions', async () => {
    const f = await harness();
    f.setNow(BASE + 7 * 60_000);
    const result = await f.coordinator.onResume();

    expect(result.startedSessionIds).toEqual([
      automaticContinuationSessionId(AUTH, 2),
      automaticContinuationSessionId(AUTH, 3),
    ]);
    expect(f.service.snapshot().activeFocusSession).toBeNull();
    expect(f.service.snapshot().focusHistory.map(session => session.id)).toEqual([
      f.firstSession.id,
      automaticContinuationSessionId(AUTH, 2),
      automaticContinuationSessionId(AUTH, 3),
    ]);
    expect(f.plan()).toMatchObject({ status: 'report', completedRounds: 3, reportedSessionIds: [
      f.firstSession.id,
      automaticContinuationSessionId(AUTH, 2),
      automaticContinuationSessionId(AUTH, 3),
    ] });
    expect(new Set(f.service.snapshot().focusHistory.map(session => session.id)).size).toBe(3);
    await f.coordinator.reconcile();
    expect(f.service.snapshot().focusHistory).toHaveLength(3);
  });

  it('fails closed when the reservation write fails and retries the same due event', async () => {
    const f = await harness();
    f.setNow(BASE + 5 * 60_000);
    const dueEvent = {
      eventId: automaticContinuationEventId(AUTH, 2), authorizationId: AUTH,
      scheduledAtEpochMs: BASE + 3 * 60_000,
    };
    f.deadlines.pending.push(dueEvent);
    const originalWrite = f.writePlan.getMockImplementation()!;
    f.writePlan.mockImplementation(next => {
      if (next?.automaticContinuation?.reservation) throw new Error('localStorage quota');
      originalWrite(next);
    });
    const start = vi.spyOn(f.service, 'startScheduledFocus');

    const failed = await f.coordinator.handleDeadline(dueEvent);
    expect(failed.retryable).toBe(true);
    expect(start).not.toHaveBeenCalled();
    expect(f.deadlines.acknowledgements).not.toContain(dueEvent.eventId);
    expect(f.deadlines.pending).toContainEqual(dueEvent);

    f.writePlan.mockImplementation(originalWrite);
    const retried = await f.coordinator.handleDeadline(dueEvent);
    expect(retried.startedSessionIds).toEqual([automaticContinuationSessionId(AUTH, 2)]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[1]).toEqual({
      sessionId: automaticContinuationSessionId(AUTH, 2),
      scheduledAt: new Date(BASE + 3 * 60_000).toISOString(),
    });
    expect(f.deadlines.acknowledgements).toContain(dueEvent.eventId);
  });

  it('never auto-assigns an ordinary finite round before its explicit progress report', async () => {
    const f = await harness(false);
    f.setNow(BASE + 5 * 60_000);
    const start = vi.spyOn(f.service, 'startScheduledFocus');

    const blocked = await f.coordinator.onResume();
    expect(blocked.blockedBy).toBe('manual-progress');
    expect(start).not.toHaveBeenCalled();

    const report = await f.service.dispatch({ type: 'ReportSubtaskProgress', subtaskId: f.subtaskId,
      focusSessionIds: [f.firstSession.id], progressBasisPoints: 5_000 });
    expect(report.ok).toBe(true);
    const reportAt = f.service.snapshot().progressReports[0]!.reportedAt;
    const continued = await f.coordinator.onResume();
    expect(continued.startedSessionIds).toEqual([automaticContinuationSessionId(AUTH, 2)]);
    expect(start.mock.calls[0]?.[1].scheduledAt).toBe(reportAt);
    expect(f.service.snapshot().activeFocusSession?.startedAt).toBe(reportAt);
  });

  it('keeps the write-ahead reservation after a domain save failure and retries its exact session ID', async () => {
    const f = await harness();
    f.setNow(BASE + 5 * 60_000);
    const dueEvent = {
      eventId: automaticContinuationEventId(AUTH, 2), authorizationId: AUTH,
      scheduledAtEpochMs: BASE + 3 * 60_000,
    };
    f.deadlines.pending.push(dueEvent);
    f.failNextDomainSave();
    const start = vi.spyOn(f.service, 'startScheduledFocus');

    const failed = await f.coordinator.handleDeadline(dueEvent);
    expect(failed.retryable).toBe(true);
    expect(f.plan()?.automaticContinuation?.reservation).toEqual({
      round: 2, sessionId: automaticContinuationSessionId(AUTH, 2), scheduledAt: new Date(BASE + 3 * 60_000).toISOString(),
    });
    expect(f.deadlines.acknowledgements).not.toContain(dueEvent.eventId);

    const retried = await f.coordinator.handleDeadline(dueEvent);
    expect(retried.startedSessionIds).toContain(automaticContinuationSessionId(AUTH, 2));
    expect(start.mock.calls.map(call => call[1].sessionId)).toEqual([
      automaticContinuationSessionId(AUTH, 2), automaticContinuationSessionId(AUTH, 2),
    ]);
    expect(f.deadlines.acknowledgements).toContain(dueEvent.eventId);
  });

  it('retries native deadline registration after a temporary scheduled:false result', async () => {
    const f = await harness();
    let attempts = 0;
    f.deadlines.setScheduleBehavior(async event => {
      attempts += 1;
      const previous = f.deadlines.scheduled.findIndex(candidate => candidate.eventId === event.eventId);
      if (previous >= 0) f.deadlines.scheduled.splice(previous, 1);
      f.deadlines.scheduled.push(event);
      return { scheduled: attempts > 1, exact: attempts > 1, due: event.scheduledAtEpochMs <= BASE + 60_000 };
    });

    await f.coordinator.reconcile();
    await f.coordinator.reconcile();
    expect(attempts).toBe(2);
    expect(f.deadlines.scheduled).toHaveLength(1);
  });

  it('cancels persisted authorization when opt-in is turned off', async () => {
    const f = await harness();
    f.setAutoEnabled(false);
    const result = await f.coordinator.onResume();
    expect(result.blockedBy).toBe('disabled');
    expect(f.plan()?.automaticContinuation).toBeUndefined();
    expect(f.deadlines.cancelled).toContain('authorization:' + AUTH);
  });

  it('does not recreate authorization for a manually waiting round', async () => {
    const f = await harness();
    const manualPlan = { ...f.plan()! };
    delete manualPlan.automaticContinuation;
    f.setPlan({ ...manualPlan, status: 'ready' });
    const start = vi.spyOn(f.service, 'startScheduledFocus');

    const result = await f.coordinator.onResume();

    expect(result.blockedBy).toBe('disabled');
    expect(start).not.toHaveBeenCalled();
    expect(f.plan()?.automaticContinuation).toBeUndefined();
  });

  it('cancels the prior native authorization when a saved plan is replaced', async () => {
    const f = await harness();
    await f.coordinator.reconcile();
    f.setPlan({
      ...f.plan()!,
      automaticContinuation: { ...f.plan()!.automaticContinuation!, authorizationId: 'authorization-replacement' },
    });
    await f.coordinator.reconcile();

    expect(f.deadlines.cancelled).toContain('authorization:' + AUTH);
    expect(f.deadlines.scheduled.at(-1)?.authorizationId).toBe('authorization-replacement');
  });

  it('removes a late native listener when stop races its asynchronous registration', async () => {
    const f = await harness();
    let resolveListener!: (remove: () => void) => void;
    const remove = vi.fn();
    f.deadlines.port.listen = () => new Promise(resolve => { resolveListener = resolve; });

    const starting = f.coordinator.start();
    await f.coordinator.stop();
    resolveListener(remove);
    await starting;
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
