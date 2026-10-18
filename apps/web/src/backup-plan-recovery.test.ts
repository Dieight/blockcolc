import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationService } from '@blockcolc/application';
import { IndexedDbStateRepository } from '@blockcolc/storage-indexeddb';
import { projectState } from '../../../packages/storage-indexeddb/test/fixture';
import { createAutomaticContinuationCoordinator } from './automatic-continuation';
import { parseRoundPlan } from './round-plan';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); });

async function fixture() {
  let now = new Date('2026-07-23T09:00:00.000Z'), sequence = 0;
  const repository = new IndexedDbStateRepository({ databaseName: `plan-restore-${crypto.randomUUID()}`, now: () => new Date('2026-07-26T00:00:00.000Z') });
  cleanup.push(() => repository.close());
  await repository.save(projectState(), 0);
  await repository.createDailyBackup('2026-07-23');
  const backup = await repository.exportBackup();
  const rollback = await repository.replaceFromImport(backup, 1);
  const capability = { permission: 'granted' as const, canSchedule: true, precision: 'exact' as const };
  const dependencies = { repository, backupRepository: repository, dailyBackupRepository: repository,
    clock: { now: () => now }, ids: { next: () => `restore-session-${++sequence}` },
    notifications: { requestPermission: async () => capability, refreshCapability: async () => capability,
      scheduleFocusCompletion: async () => {}, cancelFocusCompletion: async () => {}, scheduleBreakCompletion: async () => {}, cancelBreakCompletion: async () => {} } };
  const service = await ApplicationService.initialize(dependencies);
  const first = await service.dispatch({ type: 'StartFocus', subtaskId: 'subtask-1', plannedDurationMs: 60_000, marathon: true });
  if (!first.ok || !first.state.activeFocusSession) throw Error('setup failed');
  const firstId = first.state.activeFocusSession.id;
  now = new Date('2026-07-23T09:01:00.000Z'); await service.dispatch({ type: 'CompleteFocus' });
  let plan = parseRoundPlan({ projectId: 'project-1', subtaskId: 'subtask-1', mode: 'marathon', totalRounds: 3, completedRounds: 1,
    hasStarted: true, status: 'break', breakStartedAt: now.toISOString(), breakEndsAt: '2026-07-23T09:06:00.000Z',
    endAt: '2026-07-23T09:13:00.000Z', reportedSessionIds: [firstId],
    automaticContinuation: { authorizationId: 'old-authorization', replacementRevision: service.stateReplacementRevision(), focusDurationMs: 60_000, breakDurationMs: 300_000 } }, 'project-1');
  const writePlan = vi.fn((next: typeof plan) => { plan = next; });
  const cancelAuthorization = vi.fn(async () => {});
  const schedule = vi.fn(async () => ({ scheduled: true, exact: true, due: false }));
  const makeCoordinator = (currentService: ApplicationService) => createAutomaticContinuationCoordinator({ service: currentService, readPlan: () => plan, writePlan,
    preferences: () => ({ autoContinueFocus: true, focusMinutes: 1, habitFocusMinutes: 1, breakMinutes: 5 }), nowMs: () => now.getTime(),
    setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimer: () => {},
    deadlines: { schedule, cancel: async () => {}, cancelAuthorization, pending: async () => [], acknowledge: async () => {}, listen: async () => () => {} } });
  const coordinator = makeCoordinator(service);
  cleanup.unshift(() => coordinator.stop());
  return { service, repository, coordinator, backup, rollback, firstId, writePlan, cancelAuthorization, schedule, plan: () => plan,
    restart: async () => { const restarted = await ApplicationService.initialize(dependencies), next = makeCoordinator(restarted); cleanup.unshift(() => next.stop()); return { service: restarted, coordinator: next }; },
    expire: () => { now = new Date('2026-07-23T09:20:00.000Z'); } };
}

describe('domain replacement and local automatic plans', () => {
  it.each(['import', 'rollback', 'daily'] as const)('retires a live authorization after successful %s', async kind => {
    const f = await fixture(); await f.coordinator.start(); await f.coordinator.reconcile(); f.expire();
    if (kind === 'import') await f.service.replaceFromImport(f.backup);
    else if (kind === 'rollback') await f.service.restoreRollback(f.rollback.rollbackBackupId);
    else await f.service.restoreDailyBackup('2026-07-23');
    await f.coordinator.reconcile();
    expect(f.service.snapshot().focusHistory).toEqual([]);
    expect(f.service.snapshot().activeFocusSession).toBeNull();
    expect(f.plan()).toBeNull();
    expect(f.cancelAuthorization).toHaveBeenCalledWith('old-authorization');
  });
  it('rejects the old plan after a crash between replacement and UI cleanup', async () => {
    const f = await fixture(); f.expire(); await f.service.replaceFromImport(f.backup);
    await f.coordinator.onResume();
    expect(f.service.snapshot().focusHistory).toEqual([]); expect(f.plan()).toBeNull();
  });
  it('keeps failed UI cleanup inert and retries without creating a focus', async () => {
    const f = await fixture(); await f.coordinator.start(); await f.coordinator.reconcile();
    f.writePlan.mockImplementation(() => { throw Error('local storage unavailable'); });
    f.expire(); await f.service.replaceFromImport(f.backup); await f.coordinator.reconcile();
    expect(f.service.snapshot().focusHistory).toEqual([]);
    expect(f.cancelAuthorization).toHaveBeenCalledWith('old-authorization');
  });
  it.each(['restart', 'other-tab'] as const)('retires an old authorization even when all prior session IDs survive (%s)', async path => {
    const f = await fixture();
    if (path === 'other-tab') { await f.coordinator.start(); await f.coordinator.reconcile(); }
    const sameHistory = await f.repository.exportBackup();
    await f.repository.replaceFromImport(sameHistory, f.service.stateRevision());
    f.expire();
    const active = path === 'restart' ? await f.restart() : f;
    await active.coordinator.onResume();
    expect(active.service.snapshot().focusHistory.map(item => item.id)).toEqual([f.firstId]);
    expect(active.service.snapshot().activeFocusSession).toBeNull();
    expect(f.plan()?.automaticContinuation).toBeUndefined();
    expect(f.cancelAuthorization).toHaveBeenCalledWith('old-authorization');
  });
  it('cancels restored native authorization even if cleanup fails after restart', async () => {
    const f = await fixture();
    await f.repository.replaceFromImport(await f.repository.exportBackup(), f.service.stateRevision());
    f.writePlan.mockImplementation(() => { throw Error('storage unavailable'); });
    f.expire(); const restarted = await f.restart();
    await restarted.coordinator.onResume();
    expect(f.cancelAuthorization).toHaveBeenCalledWith('old-authorization');
    expect(restarted.service.snapshot().activeFocusSession).toBeNull();
    expect(restarted.service.snapshot().focusHistory.map(session => session.id)).toEqual([f.firstId]);
  });
  it('preserves the authorized plan when replacement fails', async () => {
    const f = await fixture(); await f.coordinator.start(); await f.coordinator.reconcile();
    await expect(f.service.replaceFromImport('invalid')).rejects.toThrow();
    expect(f.plan()?.automaticContinuation?.authorizationId).toBe('old-authorization');
    expect(f.service.snapshot().focusHistory).toHaveLength(1);
  });
  it('retires native registration that completes after the replacement', async () => {
    const f = await fixture();
    let release!: (value: { scheduled: boolean; exact: boolean; due: boolean }) => void;
    let entered!: () => void;
    const registration = new Promise<void>(resolve => { entered = resolve; });
    f.schedule.mockImplementationOnce(() => new Promise(resolve => { release = resolve; entered(); }));
    await f.coordinator.start(); await registration;
    await f.service.replaceFromImport(f.backup);
    release({ scheduled: true, exact: true, due: false });
    await f.coordinator.reconcile(); f.expire(); await f.coordinator.onResume();
    expect(f.cancelAuthorization).toHaveBeenCalledWith('old-authorization');
    expect(f.service.snapshot().focusHistory).toEqual([]); expect(f.plan()).toBeNull();
  });
  it('rejects an automatic start already queued behind a replacement', async () => {
    const f = await fixture(); f.expire();
    const restoring = f.service.replaceFromImport(f.backup);
    const starting = f.service.startScheduledFocus({ type: 'StartFocus', projectId: 'project-1', subtaskId: 'subtask-1', plannedDurationMs: 60_000, marathon: true },
      { sessionId: 'obsolete-reservation', scheduledAt: '2026-07-23T09:06:00.000Z', previousSessionIds: [f.firstId] });
    await restoring; expect((await starting).ok).toBe(false); expect(f.service.snapshot().focusHistory).toEqual([]);
  });
});
