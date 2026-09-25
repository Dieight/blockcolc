import { describe, expect, it, vi } from 'vitest';
import { createRoundPlanController, createRoundPlanStore, PLAN_STORAGE_ERROR, ROUND_PLAN_KEY, subscribeSavedRoundPlan } from './round-plan-store';
import type { RoundPlan } from './round-plan';

const plan: RoundPlan = { projectId: 'p', subtaskId: 's', totalRounds: 2, completedRounds: 0, status: 'ready', reportedSessionIds: [] };
function fixture() {
  let value: string | null = JSON.stringify(plan);
  const storage = { getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
    removeItem: vi.fn(() => { value = null; }) };
  const store = createRoundPlanStore(() => storage);
  const publish = vi.fn();
  const controller = createRoundPlanController(store, 'p', publish);
  return { storage, store, publish, controller };
}
describe('round-plan persistence owner', () => {
  it('notifies optional observers only after successful persistence and isolates their failures', () => {
    const { store, storage } = fixture();
    const seen = vi.fn(() => { expect(store.read('p')?.status).toBe('break'); throw Error('observer'); });
    const stop = subscribeSavedRoundPlan(seen);
    try {
      store.write({ ...plan, status: 'break', breakStartedAt: '2026-09-19T01:00:00Z', breakEndsAt: '2026-09-19T01:05:00Z' });
      expect(store.read('p')?.breakStartedAt).toBe('2026-09-19T01:00:00Z');
      expect(seen).toHaveBeenCalledTimes(1);
      storage.setItem.mockImplementation(() => { throw Error('quota'); });
      expect(() => store.write(plan)).toThrow('quota');
      expect(seen).toHaveBeenCalledTimes(1);
    } finally { stop(); }
  });
  it('reads the existing key and degrades invalid JSON and unavailable storage', () => {
    const { store, storage } = fixture();
    expect(store.read('p')).toMatchObject(plan);
    expect(storage.getItem).toHaveBeenCalledWith(ROUND_PLAN_KEY);
    storage.getItem.mockReturnValue('{');
    expect(store.read('p')).toBeNull();
    expect(createRoundPlanStore(() => { throw Error('denied'); }).read('p')).toBeNull();
  });
  it('persists before publishing and makes new context synchronously readable', () => {
    const { storage, controller, publish } = fixture();
    const next: RoundPlan = { ...plan, status: 'focus', currentSessionId: 'session' };
    storage.setItem.mockImplementation(() => {
      expect(controller.readPlan()?.status).toBe('ready');
      expect(publish).not.toHaveBeenCalled();
    });
    controller.write(next);
    expect(controller.readPlan()).toBe(next);
    expect(controller.snapshot().savedPlan).toBe(next);
  });
  it.each(['setItem', 'removeItem'] as const)('%s failures retain saved and visible context and rethrow', (method) => {
    const { storage, controller } = fixture();
    const before = controller.readPlan();
    const error = Error('quota');
    storage[method].mockImplementation(() => { throw error; });
    expect(() => controller.write(method === 'removeItem' ? null : { ...plan, status: 'focus' })).toThrow(error);
    expect(controller.snapshot()).toEqual({ plan: before, savedPlan: before, error: PLAN_STORAGE_ERROR });
  });
  it('keeps failed recovery distinct from persisted context and does not repeatedly write it', () => {
    const { storage, controller } = fixture();
    const saved = controller.readPlan();
    storage.setItem.mockImplementation(() => { throw Error('quota'); });
    const recovered: RoundPlan = { ...plan, status: 'focus', currentSessionId: 'committed' };
    controller.reconcile(recovered);
    expect(controller.snapshot()).toEqual({ plan: recovered, savedPlan: saved, error: PLAN_STORAGE_ERROR });
    controller.reconcile({ ...recovered });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    storage.setItem.mockImplementation(() => {});
    controller.write(recovered);
    expect(controller.snapshot().error).toBeNull();
    expect(controller.snapshot().savedPlan).toBe(recovered);
  });
  it('clears visible settled context after removal failure without claiming it was removed', () => {
    const { storage, controller } = fixture();
    storage.removeItem.mockImplementation(() => { throw Error('denied'); });
    controller.reconcile(null);
    expect(controller.readPlan()).toBeNull();
    expect(controller.snapshot().savedPlan).toMatchObject(plan);
    expect(controller.snapshot().error).toBe(PLAN_STORAGE_ERROR);
  });
  it('reloads classic hosts but retains the marathon lane across host selection', () => {
    const { controller, storage } = fixture();
    controller.selectHost('other');
    expect(controller.readPlan()).toBeNull();
    const marathon: RoundPlan = { ...plan, mode: 'marathon' };
    controller.write(marathon);
    storage.getItem.mockClear();
    controller.selectHost('third');
    expect(controller.readPlan()).toBe(marathon);
    expect(storage.getItem).not.toHaveBeenCalled();
  });
});
