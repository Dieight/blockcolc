import { describe, expect, it, vi } from 'vitest';
import { ApplicationService, type ApplicationCommand, type NotificationCapability, type StateRepository } from '@tomato-clock/application';
import type { DomainState } from '@tomato-clock/domain';
import { createFocusFlow } from './focus-flow';
import { defaultFocusPreferences } from './focus-preferences';
import type { RoundPlan } from './round-plan';
import { unsettledMarathonSessions } from './marathon-settlement';

async function fixture(kind: 'finite' | 'habit' = 'finite') {
  let now = new Date('2026-09-08T00:00:00Z').getTime();
  let persisted: DomainState | null = null;
  let revision = 0;
  let failSave = false;
  const repository: StateRepository = {
    load: async () => ({ state: persisted, revision }),
    save: async (next, expected) => {
      if (failSave) throw Error('disk full');
      if (expected !== revision) throw Error('conflict');
      persisted = structuredClone(next); return ++revision;
    },
  };
  const capability: NotificationCapability = { permission: 'granted', precision: 'exact', canSchedule: true };
  let id = 0;
  const service = await ApplicationService.initialize({ repository, clock: { now: () => new Date(now) }, ids: { next: type => `${type}-${++id}` }, initialTimeZone: 'UTC', notifications: {
    requestPermission: async () => capability, refreshCapability: async () => capability,
    scheduleFocusCompletion: async () => {}, cancelFocusCompletion: async () => {},
    scheduleBreakCompletion: async () => {}, cancelBreakCompletion: async () => {},
  } });
  const created = await service.dispatch(kind === 'habit'
    ? { type: 'CreateHabitProject', title: 'Habit', blueprintId: 'cottage', targetRounds: 10 }
    : { type: 'CreateProject', title: 'Work', blueprintId: 'cottage', subtasks: [{ title: 'Task' }] });
  if (!created.ok) throw Error(created.message);
  const project = service.activeProjectProjection()!.project;
  let plan: RoundPlan | null = null;
  const preferences = { ...defaultFocusPreferences(), focusMinutes: 1, habitFocusMinutes: 2, breakMinutes: 5 };
  const draft = { rounds: 2, mode: 'rounds' as 'rounds' | 'marathon', endAt: '12:00', selectedId: project.subtasks[0]?.id ?? null };
  const dispatch = vi.fn((command: ApplicationCommand) => service.dispatch(command));
  const writePlan = vi.fn((next: RoundPlan | null) => { plan = next; });
  const resume = vi.fn(async () => { await service.resume(); });
  const closePlan = vi.fn();
  const flow = createFocusFlow({ snapshot: () => service.snapshot(), dispatch, resume, readPlan: () => plan, writePlan,
    preferences: () => preferences, draft: () => draft, nowMs: () => now,
    closeEnding: vi.fn(), closePlan, resetDraftMode: () => { draft.mode = 'rounds'; }, constructionFeedback: vi.fn() });
  const schedule = (deferred = false, rounds = 2) => { plan = { projectId: project.id, subtaskId: deferred ? null : project.subtasks[0]?.id ?? null, mode: 'marathon', ...(deferred ? { deferredSettlement: true as const } : {}), status: 'ready', totalRounds: rounds, completedRounds: 0, reportedSessionIds: [] }; };
  return { service, project, preferences, draft, flow, dispatch, writePlan, resume, closePlan, schedule,
    plan: () => plan, advance: (ms: number) => { now += ms; }, failSave: () => { failSave = true; } };
}

describe('focus flow orchestration', () => {
  it('continues a deferred break directly and ignores a repeated confirmation', async () => {
    const f = await fixture(); f.schedule(true);
    await f.flow.startFocus(); f.advance(1000); await f.flow.completeEarly();
    f.dispatch.mockClear();
    await Promise.all([f.flow.continueFromBreak(),f.flow.continueFromBreak()]);
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.plan()).toMatchObject({status:'focus',completedRounds:1,deferredSettlement:true});
    expect(f.service.snapshot().activeFocusSession).toMatchObject({subtaskId:null,deferredSettlement:true});
  });
  it('continues a break with one final plan write instead of ready-then-focus writes', async () => {
    const f = await fixture(); f.schedule(true);
    await f.flow.startFocus(); f.advance(1000); await f.flow.completeEarly();
    f.dispatch.mockClear(); f.writePlan.mockClear();
    await f.flow.continueFromBreak();
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.writePlan).toHaveBeenCalledTimes(1);
    expect(f.plan()).toMatchObject({ status: 'focus', completedRounds: 1 });
  });
  it('keeps a committed focus recoverable when its final plan write fails', async () => {
    const f = await fixture(); f.schedule(true);
    await f.flow.startFocus(); f.advance(1000); await f.flow.completeEarly();
    f.dispatch.mockClear(); f.writePlan.mockImplementation(() => { throw Error('quota'); });
    await expect(f.flow.continueFromBreak()).rejects.toThrow('quota');
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.service.snapshot().activeFocusSession).not.toBeNull();
    expect(f.plan()?.status).toBe('break');
  });
  it('does not create another round after the final break or from a report', async () => {
    const f = await fixture();
    await f.service.dispatch({type:'AddSubtask',title:'Next task'});
    await f.flow.startFocus(); f.advance(1000); await f.flow.completeEarly();
    expect(f.plan()).toMatchObject({status:'break',endAfterBreak:true});
    f.dispatch.mockClear(); await f.flow.continueFromBreak();
    expect(f.plan()).toBeNull(); expect(f.dispatch).not.toHaveBeenCalled();
    f.schedule(true,1); await f.flow.startFocus(); f.advance(1000); await f.flow.completeEarly();
    expect(f.plan()?.status).toBe('report');
    f.dispatch.mockClear(); await f.flow.continueFromBreak(); expect(f.dispatch).not.toHaveBeenCalled();
  });
  it.each(['finite', 'habit'] as const)('uses normal minutes for a %s marathon, and keeps fixed habit minutes separate', async kind => {
    const f = await fixture(kind);
    await f.flow.startFocus();
    expect(f.service.snapshot().activeFocusSession!.plannedDurationMs).toBe(kind === 'habit' ? 120000 : 60000);
    await f.flow.interruptFocus(null);
    f.schedule();
    await f.flow.startFocus();
    expect(f.service.snapshot().activeFocusSession!.plannedDurationMs).toBe(60000);
  });
  it.each(['finite', 'habit'] as const)('keeps deferred %s completion unallocated, then cancellation opens one report', async kind => {
    const f = await fixture(kind);
    f.schedule(true);
    await f.flow.startFocus(); f.advance(1000);
    await f.flow.completeEarly();
    expect(f.plan()).toMatchObject({ status: 'break', completedRounds: 1, deferredSettlement: true });
    expect(f.service.snapshot().projects[0]!.habit?.completedFocusSessionIds.length ?? 0).toBe(0);
    await f.flow.cancelPlan();
    expect(f.plan()?.status).toBe('report');
    expect(unsettledMarathonSessions(f.service.snapshot())).toHaveLength(1);
  });
  it('ordinary habit marathon completion advances the building and never opens a final report', async () => {
    const f = await fixture('habit'); f.schedule(false, 1);
    await f.flow.startFocus(); f.advance(1000); await f.flow.completeEarly();
    expect(f.service.snapshot().projects[0]!.habit!.completedFocusSessionIds).toHaveLength(1);
    expect(f.plan()).toBeNull();
  });
  it('interruption preserves the marathon round without fabricating a completed pool', async () => {
    const f = await fixture(); f.schedule(true);
    await f.flow.startFocus(); f.advance(1000); await f.flow.interruptFocus(null);
    expect(f.plan()).toMatchObject({ status: 'ready', completedRounds: 0 });
    await f.flow.cancelPlan();
    expect(f.plan()).toBeNull();
    expect(unsettledMarathonSessions(f.service.snapshot())).toHaveLength(0);
  });
  it('does not continue a manually early-completed round, including with no break', async () => {
    const f = await fixture();
    f.preferences.autoContinueFocus = true;
    f.preferences.breakMinutes = 0;
    f.schedule(false, 3);
    await f.flow.startFocus();
    f.advance(1000);
    await f.flow.completeEarly();
    expect(f.plan()).toMatchObject({ status: 'ready', completedRounds: 1 });
    expect(f.plan()?.automaticContinuation).toBeUndefined();
  });
  it.each(['completeEarly', 'interruptFocus'] as const)('%s at the deadline reconciles natural completion first', async method => {
    const f = await fixture(); await f.flow.startFocus(); f.advance(60000);
    if (method === 'completeEarly') await f.flow.completeEarly(); else await f.flow.interruptFocus(null);
    expect(f.resume).toHaveBeenCalledTimes(1);
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.service.snapshot().focusHistory[0]!.status).toBe('completed');
  });
  it('does not retry or cancel committed domain focus after an auxiliary plan write failure', async () => {
    const f = await fixture(); f.writePlan.mockImplementation(() => { throw Error('quota'); });
    await expect(f.flow.startFocus()).rejects.toThrow('quota');
    expect(f.service.snapshot().activeFocusSession).not.toBeNull();
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.flow.busy).toBe(false);
  });
  it('leaves ready context intact when domain persistence fails', async () => {
    const f = await fixture(); f.schedule(true); const before = f.plan(); f.failSave();
    await expect(f.flow.startFocus()).rejects.toThrow();
    expect(f.plan()).toBe(before);
    expect(f.service.snapshot().activeFocusSession).toBeNull();
    expect(f.flow.busy).toBe(false);
  });
  it('ignores double submission while dispatch is pending, without another queue', async () => {
    const f = await fixture();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    f.dispatch.mockImplementation(async command => { await pending; return f.service.dispatch(command); });
    const first = f.flow.startFocus();
    await f.flow.startFocus();
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    release(); await first;
    expect(f.service.snapshot().activeFocusSession).not.toBeNull();
  });
  it('confirmation persists a locked draft without starting, and storage failure does not close it', async () => {
    const f = await fixture(); f.draft.mode = 'marathon';
    f.writePlan.mockImplementationOnce(() => { throw Error('quota'); });
    await expect(f.flow.confirmPlan()).rejects.toThrow('quota');
    expect(f.closePlan).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
    await f.flow.confirmPlan();
    expect(f.plan()).toMatchObject({ mode: 'marathon', status: 'ready' });
    expect(f.service.snapshot().activeFocusSession).toBeNull();
  });
  it.each([0, 5])('advances a pre-submit ordinary plan once with %s minutes break', async breakMinutes => {
    const f = await fixture(); f.preferences.breakMinutes = breakMinutes;
    await f.flow.startFocus(); const before = f.plan()!; f.advance(60000); await f.service.resume();
    const sessionId = f.service.snapshot().focusHistory[0]!.id;
    f.flow.afterReport(before, sessionId);
    expect(f.plan()).toMatchObject({ completedRounds: 1, status: breakMinutes ? 'break' : 'ready', reportedSessionIds: [sessionId] });
    if (breakMinutes) {
      expect(f.plan()?.breakStartedAt).toBe('2026-09-08T00:01:00.000Z');
      expect(f.plan()?.breakEndsAt).toBe('2026-09-08T00:06:00.000Z');
      f.preferences.breakMinutes = 1;
      expect(f.plan()?.breakStartedAt).toBe('2026-09-08T00:01:00.000Z');
      f.flow.finishBreak(); expect(f.plan()?.status).toBe('break');
      f.flow.skipBreak(); expect(f.plan()?.status).toBe('ready');
      expect(f.plan()?.breakStartedAt).toBeUndefined();
    }
    expect(f.service.snapshot().activeFocusSession).toBeNull();
  });
  it('freezes opt-in focus and break durations and persists skip/report instants', async () => {
    const f = await fixture();
    f.preferences.autoContinueFocus = true;
    await f.flow.startFocus(3);
    const firstPlan = f.plan()!;
    expect(firstPlan.automaticContinuation).toMatchObject({ focusDurationMs: 60_000, breakDurationMs: 5 * 60_000 });

    f.advance(60_000);
    await f.service.resume();
    const sessionId = f.service.snapshot().focusHistory[0]!.id;
    const report = await f.service.dispatch({ type: 'ReportSubtaskProgress', subtaskId: f.project.subtasks[0]!.id,
      focusSessionIds: [sessionId], progressBasisPoints: 5_000 });
    expect(report.ok).toBe(true);
    f.flow.afterReport(firstPlan, sessionId);
    const reportedAt = f.service.snapshot().progressReports[0]!.reportedAt;
    expect(f.plan()).toMatchObject({
      status: 'break', breakStartedAt: reportedAt,
      breakEndsAt: new Date(Date.parse(reportedAt) + 5 * 60_000).toISOString(),
      automaticContinuation: { breakDurationMs: 5 * 60_000 },
    });

    f.preferences.focusMinutes = 2;
    f.preferences.breakMinutes = 1;
    f.flow.skipBreak();
    expect(f.plan()?.automaticContinuation?.nextRoundStartsAt).toBe(new Date(f.service.snapshot().progressReports[0]!.reportedAt).toISOString());
    await f.flow.continueFromBreak();
    expect(f.service.snapshot().activeFocusSession?.plannedDurationMs).toBe(60_000);
    expect(f.plan()?.automaticContinuation).toMatchObject({ focusDurationMs: 60_000, breakDurationMs: 5 * 60_000 });
  });
});
