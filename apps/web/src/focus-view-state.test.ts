import { describe, expect, it } from 'vitest';
import { createInitialState, execute, type DomainCommand, type DomainState } from '@tomato-clock/domain';
import { deriveFocusViewState, type FocusViewInput } from './focus-view-state';
import type { RoundPlan } from './round-plan';

const nowMs = Date.parse('2026-09-08T00:00:00Z');
function apply(state: DomainState, command: DomainCommand, at = nowMs) {
  const result = execute(state, command, { now: () => new Date(at) });
  if (!result.ok) throw Error(result.message);
  return result.state;
}
const state = apply(createInitialState('UTC'), { type: 'CreateProject', projectId: 'p', title: 'Work', blueprintId: 'cottage', subtasks: [{ id: 's', title: 'Task' }] });
const plan: RoundPlan = { projectId: 'p', subtaskId: null, mode: 'marathon', deferredSettlement: true, status: 'ready', completedRounds: 0, totalRounds: 2, reportedSessionIds: [] };
const input: FocusViewInput = { state, plan: null, nowMs, breakMinutes: 5, minimalWanted: true, fullDeferredPresentation: false, hasPendingReport: false };
const deferred = apply(state, { type: 'StartFocus', sessionId: 'r', subtaskId: null, marathon: true, deferredSettlement: true, plannedDurationMs: 60_000 });
describe('focus view ownership', () => {
  it('distinguishes setup and opt-in idle without creating a plan', () => {
    expect(deriveFocusViewState({ ...input, state: createInitialState('UTC') })).toMatchObject({ phase: 'setup', minimal: false, plan: null });
    expect(deriveFocusViewState(input)).toMatchObject({ phase: 'idle', minimal: true, minimalIdle: true });
    expect(deriveFocusViewState({ ...input, minimalWanted: false }).minimal).toBe(false);
  });
  it('does not let minimal preference relabel an ordinary session', () => {
    const ordinary = apply(state, { type: 'StartFocus', sessionId: 'r', subtaskId: 's', plannedDurationMs: 60_000 });
    expect(deriveFocusViewState({ ...input, state: ordinary })).toMatchObject({ phase: 'focus', minimal: false, endsAt: ordinary.activeFocusSession!.endsAt });
  });
  it('temporary presentation exit never changes session identity or authoritative end time', () => {
    const view = deriveFocusViewState({ ...input, state: deferred, plan });
    const full = deriveFocusViewState({ ...input, state: deferred, plan, minimalWanted: false, fullDeferredPresentation: true });
    expect(view).toMatchObject({ phase: 'focus', minimal: true, isImmersiveLayout: true });
    expect(full).toMatchObject({ phase: 'focus', minimal: false, isImmersiveLayout: true, endsAt: view.endsAt });
    expect(full.session).toBe(view.session);
  });
  it('keeps ready and break separate and expires a break using the supplied time', () => {
    const rest: RoundPlan = { ...plan, status: 'break', breakEndsAt: new Date(nowMs + 1000).toISOString() };
    expect(deriveFocusViewState({ ...input, plan })).toMatchObject({ phase: 'ready', minimal: true });
    expect(deriveFocusViewState({ ...input, plan: rest })).toMatchObject({ phase: 'break', minimalBreak: true, endsAt: rest.breakEndsAt });
    expect(deriveFocusViewState({ ...input, plan: rest, nowMs: nowMs + 1000 })).toMatchObject({ phase: 'ready', isBreak: false, endsAt: undefined });
  });
  it('uses the shared immersive surface for ordinary and marathon ready/break states', () => {
    const ordinary: RoundPlan = { projectId: 'p', subtaskId: 's', status: 'ready', completedRounds: 1, totalRounds: 3, reportedSessionIds: [] };
    const rest: RoundPlan = { ...ordinary, status: 'break', breakEndsAt: new Date(nowMs + 1000).toISOString() };
    const marathon: RoundPlan = { projectId: 'p', subtaskId: null, mode: 'marathon', status: 'ready', completedRounds: 1, totalRounds: 3, reportedSessionIds: [] };
    const marathonRest: RoundPlan = { ...marathon, status: 'break', breakEndsAt: new Date(nowMs + 1000).toISOString() };
    expect(deriveFocusViewState({ ...input, minimalWanted: false, plan: ordinary })).toMatchObject({ phase: 'ready', minimal: false, isImmersiveLayout: true });
    expect(deriveFocusViewState({ ...input, minimalWanted: false, plan: rest })).toMatchObject({ phase: 'break', minimal: false, isImmersiveLayout: true });
    expect(deriveFocusViewState({ ...input, minimalWanted: false, plan: marathon })).toMatchObject({ phase: 'ready', minimal: false, isImmersiveLayout: true });
    expect(deriveFocusViewState({ ...input, minimalWanted: false, plan: marathonRest })).toMatchObject({ phase: 'break', minimal: false, isImmersiveLayout: true });
  });
  it('keeps ordinary pending reporting ahead of minimal idle', () => {
    expect(deriveFocusViewState({ ...input, hasPendingReport: true })).toMatchObject({ phase: 'report', minimal: false, activePendingBlocksWorkbench: true });
  });
  it('recovers retained rounds into report even after their host was deleted', () => {
    const finished = apply(deferred, { type: 'CompleteFocus' }, nowMs + 60000);
    const deleted = apply(finished, { type: 'DeleteActiveProject', projectId: 'p' }, nowMs + 61000);
    expect(deriveFocusViewState({ ...input, state: deleted, nowMs: nowMs + 61000 })).toMatchObject({ phase: 'report', minimal: false, marathonReportPhase: true, plan: { projectId: 'p', totalRounds: 1 } });
  });
  it('uses the active session instead of an inconsistent cached report', () => {
    expect(deriveFocusViewState({ ...input, state: deferred, plan: { ...plan, status: 'report' } })).toMatchObject({ phase: 'focus', marathonReportPhase: false, plan: { currentSessionId: 'r', totalRounds: 1 } });
  });
  it('is deterministic and leaves frozen inputs untouched', () => {
    function freeze(value: unknown): void {
      if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
      Object.freeze(value);
      for (const item of Object.values(value)) freeze(item);
    }
    const frozen = structuredClone({ ...input, state: deferred, plan });
    freeze(frozen);
    const before = JSON.stringify(frozen);
    expect(deriveFocusViewState(frozen)).toEqual(deriveFocusViewState(frozen));
    expect(JSON.stringify(frozen)).toBe(before);
  });
});
