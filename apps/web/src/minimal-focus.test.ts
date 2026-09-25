import { describe, expect, it, vi } from 'vitest';
import type { ApplicationCommand, ApplicationResult } from '@tomato-clock/application';
import { createInitialState, execute, type DomainState } from '@tomato-clock/domain';
import { createMinimalFocusStarter, prepareMinimalFocus, type MinimalFocusStartDependencies } from './minimal-focus';
import { marathonEndInstant } from './marathon-end-time';
import { reconcileRoundPlan, type RoundPlan } from './round-plan';

const now = new Date(2026, 8, 6, 14, 0, 0).getTime();
const draft = { hourDraft: '15', minuteDraft: '35', day: 'today' as const };
const preferences = { focusMinutes: 45, breakMinutes: 5 };
function fixture(kind: 'finite' | 'habit' = 'finite') {
  const result = execute(createInitialState('UTC'), kind === 'finite'
    ? { type: 'CreateProject', projectId: 'p', title: 'Work', blueprintId: 'cottage', subtasks: [{ id: 's', title: 'Task' }] }
    : { type: 'CreateHabitProject', projectId: 'p', title: 'Habit', blueprintId: 'cottage', targetRounds: 10 }, { now: () => new Date(now) });
  if (!result.ok) throw new Error(result.message);
  return result.state;
}

describe('minimal focus preparation', () => {
  it('honors the exact gesture instant and refuses an expired selection instead of rolling to tomorrow', () => {
    const endMs = now + 60 * 60_000;
    expect(prepareMinimalFocus(fixture(),null,{...draft,endMs},preferences,now)).toMatchObject({ok:true,plan:{endAt:new Date(endMs).toISOString()}});
    expect(prepareMinimalFocus(fixture(),null,{...draft,endMs},preferences,endMs)).toMatchObject({ok:false});
    expect(prepareMinimalFocus(fixture(),null,{...draft,endMs:Number.NaN},preferences,now)).toMatchObject({ok:false});
  });
  it.each(['finite', 'habit'] as const)('starts %s hosts without choosing a subtask or changing progress', kind => {
    const state = fixture(kind);
    const before = structuredClone(state);
    const prepared = prepareMinimalFocus(state, null, draft, preferences, now);
    expect(prepared).toMatchObject({ ok: true, plan: { subtaskId: null, totalRounds: 2, mode: 'marathon', deferredSettlement: true },
      command: { type: 'StartFocus', projectId: 'p', subtaskId: null, marathon: true, deferredSettlement: true, plannedDurationMs: 2_700_000 } });
    expect(state).toEqual(before);
  });
  it('keeps minimal rounds unbound when the caller still has a selected subtask', () => {
    const state = fixture();
    // The full workbench carries its selected subtask separately. Minimal
    // submission must not inherit that selection into ordinary settlement.
    const selectedDraft = { ...draft, selectedId: 's' };
    const prepared = prepareMinimalFocus(state, null, selectedDraft, preferences, now);
    expect(prepared).toMatchObject({
      ok: true,
      plan: { subtaskId: null, mode: 'marathon', deferredSettlement: true },
      command: { subtaskId: null, marathon: true, deferredSettlement: true },
    });
  });
  it.each(['', ' ', '1e1', '-1', '24', '1.5'])('rejects malformed hour %j, including empty instead of midnight', hourDraft => {
    expect(prepareMinimalFocus(fixture(), null, { ...draft, hourDraft }, preferences, now).ok).toBe(false);
  });
  it.each(['', ' ', '60', '-1', '1.5'])('rejects malformed minute %j', minuteDraft => {
    expect(prepareMinimalFocus(fixture(), null, { ...draft, minuteDraft }, preferences, now).ok).toBe(false);
  });
  it('回滚日期切换后：过去时刻自动落到明天（与马拉松一致）并保留零输入', () => {
    // 00:00 零值过去（now=14:00）→ 落到明天 00:00（10h，≤24 轮有效）。
    const zero = prepareMinimalFocus(fixture(), null, { hourDraft: '0', minuteDraft: '0', day: 'today' }, preferences, now);
    expect(zero).toMatchObject({ ok: true, plan: { endAt: new Date(2026, 8, 7, 0, 0).toISOString() } });
    // 过去时刻滚动到明天（与马拉松一致），由 marathonEndInstant 直接保证：
    expect(marathonEndInstant('13:00', now)).toBe(new Date(2026, 8, 7, 13, 0).getTime());
    // 未来时刻（16:00 > 14:00）→ 今天 16:00。
    const future = prepareMinimalFocus(fixture(), null, { hourDraft: '16', minuteDraft: '0', day: 'today' }, preferences, now);
    expect(future).toMatchObject({ ok: true, plan: { endAt: new Date(2026, 8, 6, 16, 0).toISOString() } });
  });
  it('rejects too-short, too-many-round and invalid-setting schedules', () => {
    expect(prepareMinimalFocus(fixture(), null, { ...draft, hourDraft: '14', minuteDraft: '44' }, preferences, now)).toMatchObject({ ok: false, message: expect.stringContaining('过近') });
    expect(prepareMinimalFocus(fixture(), null, draft, { focusMinutes: 1, breakMinutes: 0 }, now)).toMatchObject({ ok: false, message: expect.stringContaining('24') });
    expect(prepareMinimalFocus(fixture(), null, draft, { ...preferences, focusMinutes: 0 }, now)).toMatchObject({ ok: false, message: expect.stringContaining('时长无效') });
  });
  it('does not override a plan, active focus, unreported work or first-run setup', () => {
    const state = fixture();
    const ready = prepareMinimalFocus(state, null, draft, preferences, now);
    if (!ready.ok) throw new Error(ready.message);
    expect(prepareMinimalFocus(state, ready.plan, draft, preferences, now).ok).toBe(false);
    const started = execute(state, { ...ready.command, sessionId: 'r' }, { now: () => new Date(now) });
    if (!started.ok) throw new Error(started.message);
    expect(prepareMinimalFocus(started.state, null, draft, preferences, now).ok).toBe(false);
    const ended = execute(started.state, { type: 'CompleteFocus' }, { now: () => new Date(now + 2_700_000) });
    if (!ended.ok) throw new Error(ended.message);
    expect(prepareMinimalFocus(ended.state, null, draft, preferences, now)).toMatchObject({ ok: false, message: expect.stringContaining('等待汇报') });
    expect(prepareMinimalFocus(createInitialState('UTC'), null, draft, preferences, now).ok).toBe(false);
  });
});

describe('minimal submission lane and two-store failure boundaries', () => {
  function setup() {
    let state: DomainState = fixture();
    let plan: RoundPlan | null = null;
    const dispatch = vi.fn(async (command: Extract<ApplicationCommand, { type: 'StartFocus' }>): Promise<ApplicationResult> => {
      const result = execute(state, { ...command, sessionId: 'r' }, { now: () => new Date(now) });
      if (result.ok) state = result.state;
      return { ...result, warnings: [] };
    });
    const writePlan = vi.fn((next: RoundPlan | null) => { plan = next; });
    const dependencies: MinimalFocusStartDependencies = { snapshot: () => state, readPlan: () => plan, writePlan, dispatch, now: () => now };
    return { dependencies, dispatch, writePlan };
  }
  it('persists the ready plan before dispatch and attaches the committed session after', async () => {
    const f = setup();
    const starter = createMinimalFocusStarter(f.dependencies);
    expect(await starter.start(draft, preferences)).toMatchObject({ ok: true, plan: { status: 'focus', currentSessionId: 'r' } });
    expect(f.dependencies.readPlan()?.automaticContinuation).toBeUndefined();
    expect(f.writePlan.mock.calls.map(([plan]) => plan?.status)).toEqual(['ready', 'focus']);
    expect(f.writePlan.mock.invocationCallOrder[0]).toBeLessThan(f.dispatch.mock.invocationCallOrder[0]!);
    expect(starter.busy).toBe(false);
  });
  it('ignores duplicate submission while dispatch is pending', async () => {
    const f = setup();
    const original = f.dependencies.dispatch;
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    f.dependencies.dispatch = vi.fn(async command => { await wait; return original(command); });
    const starter = createMinimalFocusStarter(f.dependencies);
    const first = starter.start(draft, preferences);
    expect(starter.busy).toBe(true);
    expect(await starter.start(draft, preferences)).toMatchObject({ ok: false, message: expect.stringContaining('重复') });
    release();
    expect((await first).ok).toBe(true);
    expect(original).toHaveBeenCalledTimes(1);
  });
  it('persists an explicit opt-in authorization before the minimal first focus', async () => {
    const f = setup();
    f.dependencies.newAuthorizationId = () => 'minimal-authorization';
    const starter = createMinimalFocusStarter(f.dependencies);
    const result = await starter.start(draft, { ...preferences, autoContinueFocus: true });
    expect(result).toMatchObject({ ok: true, plan: { automaticContinuation: {
      authorizationId: 'minimal-authorization', focusDurationMs: 45 * 60_000, breakDurationMs: 5 * 60_000,
    } } });
    expect(f.writePlan.mock.calls[0]?.[0]).toMatchObject({ status: 'ready', automaticContinuation: { authorizationId: 'minimal-authorization' } });
    expect(f.writePlan.mock.invocationCallOrder[0]).toBeLessThan(f.dispatch.mock.invocationCallOrder[0]!);
  });
  it('does not start if writing the initial plan fails', async () => {
    const f = setup();
    f.writePlan.mockImplementation(() => { throw new Error('quota'); });
    expect(await createMinimalFocusStarter(f.dependencies).start(draft, preferences)).toEqual({ ok: false, message: 'quota' });
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.dependencies.snapshot().activeFocusSession).toBeNull();
  });
  it('clears its ready draft after command persistence failure and allows retry', async () => {
    const f = setup();
    f.dispatch.mockRejectedValueOnce(new Error('disk full'));
    const starter = createMinimalFocusStarter(f.dependencies);
    expect(await starter.start(draft, preferences)).toEqual({ ok: false, message: 'disk full' });
    expect(f.dependencies.readPlan()).toBeNull();
    expect((await starter.start(draft, preferences)).ok).toBe(true);
  });
  it('retains the ready schedule when the post-commit UI write fails, never cancelling focus', async () => {
    const f = setup();
    const write = f.writePlan.getMockImplementation()!;
    f.writePlan.mockImplementation(plan => { if (plan?.status === 'focus') throw new Error('quota'); write(plan); });
    const result = await createMinimalFocusStarter(f.dependencies).start(draft, preferences);
    expect(result).toMatchObject({ ok: true, warning: expect.stringContaining('已保存') });
    expect(f.dependencies.readPlan()?.status).toBe('ready');
    expect(reconcileRoundPlan(f.dependencies.readPlan(), f.dependencies.snapshot(), 'p', now)).toMatchObject({ status: 'focus', currentSessionId: 'r', totalRounds: 2 });
  });
});
