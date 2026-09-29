import type { ResourcePackRepository } from '@blockcolc/resource-pack-indexeddb';

export const RESOURCE_PACK_COLD_START_LIMITS = Object.freeze({
  maxRequests: 8,
  maxPhasesPerRequest: 4,
  deadlineMs: 60_000,
});

export type ColdStartRepositoryCall = 'list' | 'getActive' | 'getBase' | 'getSelectionMetadata';
export type ColdStartCallResult = 'pending' | 'returned' | 'rejected' | 'threw';

export interface ColdStartRepositoryPhase {
  stage: 'start' | 'return';
  offsetMs: number;
  result?: Exclude<ColdStartCallResult, 'pending'>;
}

export interface ColdStartRepositoryRequest {
  requestId: number;
  caller: ColdStartRepositoryCall;
  result: ColdStartCallResult;
  phases: ColdStartRepositoryPhase[];
}

export interface ColdStartRepositorySnapshot {
  status: 'recording' | 'timed-out' | 'disposed';
  elapsedMs: number;
  deadlineMs: number;
  overflowCount: { requests: number; phases: number; afterDeadline: number };
  requests: ColdStartRepositoryRequest[];
}

export interface ColdStartRepositoryProbe {
  read(): ColdStartRepositorySnapshot;
  dispose(): void;
}

const observedCalls = new Set<ColdStartRepositoryCall>(['list', 'getActive', 'getBase', 'getSelectionMetadata']);

/**
 * Observes only whole repository method wall time. The original method's `this`
 * and exact return value are preserved; no repository reads are added.
 */
export function observeResourcePackRepositoryColdStart(
  repository: ResourcePackRepository,
  startedAtMs: number,
  now: () => number,
  onDispose?: () => void,
): { repository: ResourcePackRepository; probe: ColdStartRepositoryProbe } {
  if (!Number.isFinite(startedAtMs) || startedAtMs < 0) throw new RangeError('startedAtMs must be a non-negative finite number');
  const requests: ColdStartRepositoryRequest[] = [];
  const overflowCount = { requests: 0, phases: 0, afterDeadline: 0 };
  let disposed = false;

  const elapsed = () => Math.max(0, now() - startedAtMs);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    onDispose?.();
  };
  const finish = (request: ColdStartRepositoryRequest, result: Exclude<ColdStartCallResult, 'pending'>) => {
    if (disposed) return;
    if (request.result !== 'pending') return;
    const at = elapsed();
    if (at >= RESOURCE_PACK_COLD_START_LIMITS.deadlineMs) {
      overflowCount.afterDeadline += 1;
      request.result = 'pending';
      return;
    }
    if (request.phases.length >= RESOURCE_PACK_COLD_START_LIMITS.maxPhasesPerRequest) {
      overflowCount.phases += 1;
      return;
    }
    request.phases.push({ stage: 'return', offsetMs: at, result });
    request.result = result;
  };

  const wrapped = new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property === 'close' && typeof value === 'function') {
        return function closeObservedRepository(this: unknown, ...args: unknown[]) {
          try {
            return Reflect.apply(value, target, args);
          } finally {
            dispose();
          }
        };
      }
      if (typeof property !== 'string' || !observedCalls.has(property as ColdStartRepositoryCall) || typeof value !== 'function') return value;
      return function observedRepositoryCall(this: unknown, ...args: unknown[]) {
        const caller = property as ColdStartRepositoryCall;
        const at = elapsed();
        if (disposed) return Reflect.apply(value, target, args);
        if (at >= RESOURCE_PACK_COLD_START_LIMITS.deadlineMs) {
          overflowCount.afterDeadline += 1;
          return Reflect.apply(value, target, args);
        }
        if (requests.length >= RESOURCE_PACK_COLD_START_LIMITS.maxRequests) {
          overflowCount.requests += 1;
          return Reflect.apply(value, target, args);
        }
        const request: ColdStartRepositoryRequest = {
          requestId: requests.length + 1,
          caller,
          result: 'pending',
          phases: [{ stage: 'start', offsetMs: at }],
        };
        requests.push(request);
        let result: unknown;
        try {
          result = Reflect.apply(value, target, args);
        } catch (error) {
          finish(request, 'threw');
          throw error;
        }
        if (result instanceof Promise) {
          void result.then(
            () => finish(request, 'returned'),
            () => finish(request, 'rejected'),
          );
        } else {
          finish(request, 'returned');
        }
        return result;
      };
    },
  });

  const probe: ColdStartRepositoryProbe = {
    read() {
      const at = elapsed();
      return {
        status: disposed ? 'disposed' : at >= RESOURCE_PACK_COLD_START_LIMITS.deadlineMs ? 'timed-out' : 'recording',
        elapsedMs: Math.min(at, RESOURCE_PACK_COLD_START_LIMITS.deadlineMs),
        deadlineMs: RESOURCE_PACK_COLD_START_LIMITS.deadlineMs,
        overflowCount: { ...overflowCount },
        requests: requests.map(request => ({ ...request, phases: request.phases.map(phase => ({ ...phase })) })),
      };
    },
    dispose,
  };
  return { repository: wrapped, probe };
}

export function installResourcePackColdStartProbe(repository: ResourcePackRepository): ResourcePackRepository {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined'
    || !new URLSearchParams(window.location.search).has('__resourcePackColdStartProbe')) return repository;
  const lifecycleStartedAt = window.__blockcolcQualityLifecyclePageStartAt;
  const startedAt = typeof lifecycleStartedAt === 'number' && Number.isFinite(lifecycleStartedAt)
    ? lifecycleStartedAt : performance.now();
  let entry: ColdStartRepositoryProbe | undefined;
  let pageHideHandler: (() => void) | undefined;
  const observed = observeResourcePackRepositoryColdStart(repository, startedAt, () => performance.now(), () => {
    if (pageHideHandler) window.removeEventListener('pagehide', pageHideHandler);
    if (entry && window.__blockcolcResourcePackColdStartProbe === entry) {
      delete window.__blockcolcResourcePackColdStartProbe;
    }
  });
  entry = {
    read: () => observed.probe.read(),
    dispose: () => observed.probe.dispose(),
  };
  Object.defineProperty(window, '__blockcolcResourcePackColdStartProbe', {
    configurable: true,
    value: entry,
  });
  pageHideHandler = () => observed.probe.dispose();
  window.addEventListener('pagehide', pageHideHandler, { once: true });
  return observed.repository;
}

declare global {
  interface Window { __blockcolcResourcePackColdStartProbe?: ColdStartRepositoryProbe }
}
