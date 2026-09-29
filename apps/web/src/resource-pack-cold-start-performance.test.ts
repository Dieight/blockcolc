import { describe, expect, it, vi } from 'vitest';
import type { ResourcePackRepository } from '@blockcolc/resource-pack-indexeddb';
import { installResourcePackColdStartProbe, observeResourcePackRepositoryColdStart, RESOURCE_PACK_COLD_START_LIMITS, type ColdStartRepositoryProbe } from './resource-pack-cold-start-performance';

function repository(overrides: Partial<ResourcePackRepository> = {}): ResourcePackRepository {
  return {
    save: vi.fn(), list: vi.fn(async () => []), get: vi.fn(), select: vi.fn(), selectBase: vi.fn(),
    getActive: vi.fn(async () => undefined), getBase: vi.fn(async () => undefined),
    getSelectionMetadata: vi.fn(async () => ({ revision: 'rev', activeId: null, baseId: null })),
    delete: vi.fn(), clear: vi.fn(), close: vi.fn(), ...overrides,
  } as unknown as ResourcePackRepository;
}

describe('resource-pack cold-start repository observer', () => {
  it('labels concurrent calls by method, preserves this/arguments/result, and records native intervals', async () => {
    let now = 10;
    let releaseList!: (value: []) => void;
    const listResult = new Promise<[]>(resolve => { releaseList = resolve; });
    const original = repository({
      list: vi.fn(function (this: unknown) { expect(this).toBe(original); return listResult; }),
      getBase: vi.fn(async () => { now = 35; return undefined; }),
    });
    const { repository: observed, probe } = observeResourcePackRepositoryColdStart(original, 10, () => now);
    const first = observed.list();
    const second = observed.getBase();
    expect(first).toBe(listResult);
    await second;
    now = 55;
    releaseList([]);
    await first;
    expect(probe.read()).toMatchObject({
      status: 'recording',
      requests: [
        { requestId: 1, caller: 'list', result: 'returned', phases: [{ stage: 'start', offsetMs: 0 }, { stage: 'return', offsetMs: 45, result: 'returned' }] },
        { requestId: 2, caller: 'getBase', result: 'returned', phases: [{ stage: 'start', offsetMs: 0 }, { stage: 'return', offsetMs: 25, result: 'returned' }] },
      ],
    });
    expect(original.list).toHaveBeenCalledTimes(1);
    expect(original.getBase).toHaveBeenCalledTimes(1);
  });

  it('records synchronous throws and rejected promises without changing their failures', async () => {
    let now = 5;
    const failure = new Error('fixture');
    const original = repository({
      list: vi.fn(() => { throw failure; }),
      getBase: vi.fn(async () => { throw failure; }),
    });
    const { repository: observed, probe } = observeResourcePackRepositoryColdStart(original, 5, () => now);
    expect(() => observed.list()).toThrow(failure);
    await expect(observed.getBase()).rejects.toBe(failure);
    await Promise.resolve();
    expect(probe.read().requests.map(request => request.result)).toEqual(['threw', 'rejected']);
    expect(probe.read().requests.every(request => request.phases.length === 2)).toBe(true);
  });

  it('keeps request, phase, and deadline limits explicit while calls remain transparent', async () => {
    let now = 0;
    const original = repository();
    const { repository: observed, probe } = observeResourcePackRepositoryColdStart(original, 0, () => now);
    for (let index = 0; index < RESOURCE_PACK_COLD_START_LIMITS.maxRequests + 2; index += 1) await observed.list();
    now = RESOURCE_PACK_COLD_START_LIMITS.deadlineMs;
    await observed.getBase();
    const snapshot = probe.read();
    expect(snapshot.status).toBe('timed-out');
    expect(snapshot.requests).toHaveLength(RESOURCE_PACK_COLD_START_LIMITS.maxRequests);
    expect(snapshot.overflowCount).toMatchObject({ requests: 2, afterDeadline: 1 });
    expect(original.list).toHaveBeenCalledTimes(RESOURCE_PACK_COLD_START_LIMITS.maxRequests + 2);
    expect(original.getBase).toHaveBeenCalledTimes(1);
  });

  it('does not instrument unrelated methods and dispose leaves repository behavior intact', async () => {
    let now = 2;
    const original = repository();
    const { repository: observed, probe } = observeResourcePackRepositoryColdStart(original, 2, () => now);
    await observed.get('fixture-id');
    expect(probe.read().requests).toEqual([]);
    probe.dispose();
    await observed.list();
    expect(probe.read().status).toBe('disposed');
    expect(probe.read().requests).toEqual([]);
    expect(original.list).toHaveBeenCalledTimes(1);
  });

  it('does not record pending resolve or reject completions after disposal', async () => {
    let releaseList!: (value: []) => void;
    let rejectBase!: (reason: Error) => void;
    const listResult = new Promise<[]>(resolve => { releaseList = resolve; });
    const baseResult = new Promise<undefined>((_resolve, reject) => { rejectBase = reject; });
    const original = repository({ list: vi.fn(() => listResult), getBase: vi.fn(() => baseResult) });
    const { repository: observed, probe } = observeResourcePackRepositoryColdStart(original, 0, () => 20);
    const list = observed.list();
    const base = observed.getBase();
    const before = probe.read();
    probe.dispose();
    probe.dispose();
    releaseList([]);
    rejectBase(new Error('late rejection'));
    await list;
    await expect(base).rejects.toThrow('late rejection');
    await Promise.resolve();
    expect(probe.read()).toEqual({ ...before, status: 'disposed' });
  });

  it('disposes on repository close without changing its return or throwing behavior', () => {
    const closeFailure = new Error('close failed');
    let releaseList!: (value: []) => void;
    const pendingList = new Promise<[]>(resolve => { releaseList = resolve; });
    const original = repository({ list: vi.fn(() => pendingList), close: vi.fn(() => { throw closeFailure; }) });
    const { repository: observed, probe } = observeResourcePackRepositoryColdStart(original, 0, () => 1);
    const observedList = observed.list();
    expect(() => observed.close()).toThrow(closeFailure);
    const disposedSnapshot = probe.read();
    expect(probe.read().status).toBe('disposed');
    expect(() => observed.close()).toThrow(closeFailure);
    expect(original.close).toHaveBeenCalledTimes(2);
    releaseList([]);
    return observedList.then(() => expect(probe.read()).toEqual(disposedSnapshot));
  });

  it('keeps installation gated and makes pagehide, repeated cleanup, and replaced entries safe', async () => {
    const listeners = new Map<string, Set<() => void>>();
    const fakeWindow = {
      location: { search: '?__resourcePackColdStartProbe=1' },
      addEventListener: vi.fn((type: string, listener: () => void) => {
        const current = listeners.get(type) ?? new Set(); current.add(listener); listeners.set(type, current);
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => listeners.get(type)?.delete(listener)),
      __blockcolcResourcePackColdStartProbe: undefined as ColdStartRepositoryProbe | undefined,
    };
    const original = repository();
    vi.stubEnv('MODE', 'production');
    vi.stubGlobal('window', fakeWindow);
    expect(installResourcePackColdStartProbe(original)).toBe(original);
    expect(fakeWindow.__blockcolcResourcePackColdStartProbe).toBeUndefined();

    vi.stubEnv('MODE', 'test');
    fakeWindow.location.search = '';
    expect(installResourcePackColdStartProbe(original)).toBe(original);
    expect(fakeWindow.__blockcolcResourcePackColdStartProbe).toBeUndefined();

    fakeWindow.location.search = '?__resourcePackColdStartProbe=1';
    const firstRepository = repository();
    const firstWrapped = installResourcePackColdStartProbe(firstRepository);
    const firstEntry = fakeWindow.__blockcolcResourcePackColdStartProbe!;
    expect(firstWrapped).not.toBe(firstRepository);
    expect(listeners.get('pagehide')?.size).toBe(1);

    const secondRepository = repository();
    let releaseList!: (value: []) => void;
    const pendingList = new Promise<[]>(resolve => { releaseList = resolve; });
    secondRepository.list = vi.fn(() => pendingList);
    const secondWrappedRepository = installResourcePackColdStartProbe(secondRepository);
    const secondEntry = fakeWindow.__blockcolcResourcePackColdStartProbe!;
    const observedList = secondWrappedRepository.list();
    const pendingBeforePagehide = secondEntry.read();
    expect(pendingBeforePagehide.requests).toHaveLength(1);
    expect(pendingBeforePagehide.requests[0]).toMatchObject({
      caller: 'list', result: 'pending', phases: [{ stage: 'start' }],
    });
    firstEntry.dispose();
    firstEntry.dispose();
    expect(fakeWindow.__blockcolcResourcePackColdStartProbe).toBe(secondEntry);
    expect(listeners.get('pagehide')?.size).toBe(1);
    for (const listener of [...(listeners.get('pagehide') ?? [])]) listener();
    expect(fakeWindow.__blockcolcResourcePackColdStartProbe).toBeUndefined();
    const disposedAfterPagehide = secondEntry.read();
    releaseList([]);
    await observedList;
    expect(secondEntry.read()).toMatchObject({
      status: 'disposed',
      overflowCount: disposedAfterPagehide.overflowCount,
      requests: disposedAfterPagehide.requests,
    });
    secondEntry.dispose();
    expect(listeners.get('pagehide')?.size).toBe(0);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
