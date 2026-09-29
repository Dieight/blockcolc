/** Test-build-only, bounded lifecycle observations. This module never stores product text. */
export const QUALITY_LIFECYCLE_LIMITS = Object.freeze({
  maxOperations: 8,
  maxActionsPerOperation: 2,
  maxPhasesPerOperation: 16,
  runDeadlineMs: 60_000,
});

export type QualityLifecycleOperationKind = 'boot' | 'quality-pair';
export type QualityLifecyclePreference = 'auto' | 'performance' | 'balanced' | 'cinematic';
export type QualityLifecycleTier = 'low' | 'balanced' | 'high';
export type QualityLifecycleStage =
  | 'page-start'
  | 'renderer-created'
  | 'renderer-released'
  | 'selection-read-start'
  | 'selection-read-end'
  | 'selection-metadata-read-end'
  | 'manifest-layer-start'
  | 'manifest-layer-end'
  | 'resource-read-complete'
  | 'manifest-layer-complete'
  | 'atlas-build-start'
  | 'atlas-build-end'
  | 'atlas-build-complete'
  | 'atlas-disposed'
  | 'quality-apply-start'
  | 'quality-apply-end'
  | 'quality-projection-complete'
  | 'world-rebuild-start'
  | 'world-rebuild-end'
  | 'world-rebuild-complete'
  | 'visible-world-frame'
  | 'first-nonempty-frame'
  | 'initial-reveal-complete';
export type QualityLifecycleResult = 'pending' | 'completed' | 'failed' | 'timed-out' | 'cancelled';

export interface QualityLifecycleMetrics {
  durationMs?: number;
  rendererGeneration?: number;
  worldRebuildCount?: number;
  renderedWorldRebuildCount?: number;
  renderedTriangleCount?: number;
  worldIdentityFingerprint?: number;
  atlasInstance?: number;
  atlasPageCount?: number;
  atlasTextureCount?: number;
  devicePixelRatio?: number;
  pixelRatio?: number;
  shadowMapSize?: number;
  localLightCount?: number;
  localLightCreatedCount?: number;
  glowSpriteCount?: number;
  glowSpriteCreatedCount?: number;
  naturalTreeCount?: number;
  ambientDecorationCount?: number;
  weatherParticleCount?: number;
  starCount?: number;
  requestedPreference?: QualityLifecyclePreference;
  effectiveTier?: QualityLifecycleTier;
  status?: 'ok' | 'failed' | 'stale' | 'fallback';
}

export interface QualityLifecyclePhase extends QualityLifecycleMetrics {
  stage: QualityLifecycleStage;
  offsetMs: number;
  actionIndex: number | null;
}

export interface QualityLifecycleAction {
  requestedPreference: QualityLifecyclePreference;
  startedAtOffsetMs: number;
  endedAtOffsetMs: number | null;
  result: QualityLifecycleResult;
}

export interface QualityLifecycleOperation {
  kind: QualityLifecycleOperationKind;
  startedAtOffsetMs: number;
  endedAtOffsetMs: number | null;
  result: QualityLifecycleResult;
  actions: QualityLifecycleAction[];
  phases: QualityLifecyclePhase[];
  /** Explicitly counted identity/frame phases omitted because complete phases carry their values. */
  omittedRedundantPhaseCount: number;
}

export interface QualityLifecycleOverflow {
  operations: number;
  actions: number;
  phases: number;
}

export interface QualityLifecycleSnapshot {
  status: 'recording' | 'completed' | 'timed-out';
  elapsedMs: number;
  deadlineMs: number;
  overflowCount: QualityLifecycleOverflow;
  operations: QualityLifecycleOperation[];
}

export interface QualityLifecycleTracker {
  beginOperation(kind: QualityLifecycleOperationKind): number | null;
  beginAction(requestedPreference: QualityLifecyclePreference): number | null;
  endAction(result: Exclude<QualityLifecycleResult, 'pending'>): void;
  record(stage: QualityLifecycleStage, metrics?: QualityLifecycleMetrics): void;
  endOperation(result: Exclude<QualityLifecycleResult, 'pending'>): void;
  finish(): void;
  read(): QualityLifecycleSnapshot;
}

const operationKinds = new Set<QualityLifecycleOperationKind>(['boot', 'quality-pair']);
const preferences = new Set<QualityLifecyclePreference>(['auto', 'performance', 'balanced', 'cinematic']);
const results = new Set<QualityLifecycleResult>(['pending', 'completed', 'failed', 'timed-out', 'cancelled']);
const stages = new Set<QualityLifecycleStage>([
  'page-start', 'renderer-created', 'renderer-released', 'selection-read-start', 'selection-read-end', 'selection-metadata-read-end',
  'manifest-layer-start', 'manifest-layer-end', 'resource-read-complete', 'manifest-layer-complete',
  'atlas-build-start', 'atlas-build-end', 'atlas-build-complete', 'atlas-disposed', 'quality-apply-start',
  'quality-apply-end', 'quality-projection-complete', 'world-rebuild-start', 'world-rebuild-end',
  'world-rebuild-complete', 'visible-world-frame', 'first-nonempty-frame', 'initial-reveal-complete',
]);
const numericMetricKeys = new Set<keyof QualityLifecycleMetrics>([
  'durationMs', 'rendererGeneration', 'worldRebuildCount', 'renderedWorldRebuildCount',
  'renderedTriangleCount', 'atlasInstance', 'atlasPageCount', 'atlasTextureCount',
  'worldIdentityFingerprint',
  'devicePixelRatio', 'pixelRatio', 'shadowMapSize', 'localLightCount', 'localLightCreatedCount', 'glowSpriteCount', 'glowSpriteCreatedCount',
  'naturalTreeCount', 'ambientDecorationCount', 'weatherParticleCount', 'starCount',
]);
const enumMetricKeys = new Set<keyof QualityLifecycleMetrics>(['requestedPreference', 'effectiveTier', 'status']);
const redundantQualityPairStages = new Set<QualityLifecycleStage>([
  'renderer-created', 'renderer-released', 'first-nonempty-frame',
]);

export function createQualityLifecycleTracker(
  startedAtMs: number,
  now: () => number,
): QualityLifecycleTracker {
  if (!Number.isFinite(startedAtMs) || startedAtMs < 0) throw new RangeError('startedAtMs must be a non-negative finite number');
  const operations: QualityLifecycleOperation[] = [];
  const overflowCount: QualityLifecycleOverflow = { operations: 0, actions: 0, phases: 0 };
  let activeOperationIndex: number | null = null;
  let activeActionIndex: number | null = null;
  let status: QualityLifecycleSnapshot['status'] = 'recording';

  const elapsed = (): number => Math.max(0, now() - startedAtMs);
  const observeDeadline = (): boolean => {
    if (status === 'recording' && elapsed() >= QUALITY_LIFECYCLE_LIMITS.runDeadlineMs) {
      status = 'timed-out';
      if (activeActionIndex !== null && activeOperationIndex !== null) {
        const action = operations[activeOperationIndex]?.actions[activeActionIndex];
        if (action?.result === 'pending') {
          action.endedAtOffsetMs = QUALITY_LIFECYCLE_LIMITS.runDeadlineMs;
          action.result = 'timed-out';
        }
      }
      if (activeOperationIndex !== null) {
        const operation = operations[activeOperationIndex];
        if (operation?.result === 'pending') {
          operation.endedAtOffsetMs = QUALITY_LIFECYCLE_LIMITS.runDeadlineMs;
          operation.result = 'timed-out';
        }
      }
      activeOperationIndex = null;
      activeActionIndex = null;
    }
    return status !== 'recording';
  };

  const finishActiveOperation = (result: Exclude<QualityLifecycleResult, 'pending'>): void => {
    if (activeOperationIndex === null) return;
    const operation = operations[activeOperationIndex];
    if (operation?.result === 'pending') {
      const at = Math.min(elapsed(), QUALITY_LIFECYCLE_LIMITS.runDeadlineMs);
      operation.endedAtOffsetMs = at;
      operation.result = result;
      if (activeActionIndex !== null) {
        const action = operation.actions[activeActionIndex];
        if (action?.result === 'pending') {
          action.endedAtOffsetMs = at;
          action.result = result;
        }
      }
    }
    activeOperationIndex = null;
    activeActionIndex = null;
  };

  return {
    beginOperation(kind): number | null {
      if (observeDeadline()) return null;
      if (!operationKinds.has(kind)) return null;
      if (activeOperationIndex !== null) finishActiveOperation('cancelled');
      if (operations.length >= QUALITY_LIFECYCLE_LIMITS.maxOperations) {
        overflowCount.operations += 1;
        return null;
      }
      const index = operations.length;
      operations.push({
        kind,
        startedAtOffsetMs: elapsed(),
        endedAtOffsetMs: null,
        result: 'pending',
        actions: [],
        phases: [],
        omittedRedundantPhaseCount: 0,
      });
      activeOperationIndex = index;
      activeActionIndex = null;
      return index;
    },
    beginAction(requestedPreference): number | null {
      if (observeDeadline() || activeOperationIndex === null) return null;
      if (!preferences.has(requestedPreference)) return null;
      const operation = operations[activeOperationIndex];
      if (!operation) return null;
      if (activeActionIndex !== null) {
        const previous = operation.actions[activeActionIndex];
        if (previous?.result === 'pending') {
          previous.endedAtOffsetMs = elapsed();
          previous.result = 'cancelled';
        }
      }
      if (operation.actions.length >= QUALITY_LIFECYCLE_LIMITS.maxActionsPerOperation) {
        overflowCount.actions += 1;
        activeActionIndex = null;
        return null;
      }
      const index = operation.actions.length;
      operation.actions.push({
        requestedPreference,
        startedAtOffsetMs: elapsed(),
        endedAtOffsetMs: null,
        result: 'pending',
      });
      activeActionIndex = index;
      return index;
    },
    endAction(result): void {
      if (observeDeadline() || activeOperationIndex === null || activeActionIndex === null) return;
      const terminal = result as QualityLifecycleResult;
      if (!results.has(terminal) || terminal === 'pending') return;
      const action = operations[activeOperationIndex]?.actions[activeActionIndex];
      if (!action || action.result !== 'pending') return;
      action.endedAtOffsetMs = elapsed();
      action.result = result;
      activeActionIndex = null;
    },
    record(stage, metrics = {}): void {
      if (observeDeadline() || activeOperationIndex === null) return;
      if (!stages.has(stage)) return;
      const operation = operations[activeOperationIndex];
      if (!operation || operation.result !== 'pending') return;
      if (operation.kind === 'quality-pair' && redundantQualityPairStages.has(stage)) {
        operation.omittedRedundantPhaseCount += 1;
        return;
      }
      if (operation.phases.length >= QUALITY_LIFECYCLE_LIMITS.maxPhasesPerOperation) {
        overflowCount.phases += 1;
        return;
      }
      const safeMetrics: QualityLifecycleMetrics = {};
      for (const [key, value] of Object.entries(metrics)) {
        const metricKey = key as keyof QualityLifecycleMetrics;
        if (numericMetricKeys.has(metricKey) && typeof value === 'number') {
          if (Number.isFinite(value) && value >= 0) safeMetrics[key as keyof QualityLifecycleMetrics] = value as never;
        } else if (enumMetricKeys.has(metricKey) && typeof value === 'string'
          && key === 'requestedPreference' && ['auto', 'performance', 'balanced', 'cinematic'].includes(value)) {
          safeMetrics.requestedPreference = value as QualityLifecyclePreference;
        } else if (enumMetricKeys.has(metricKey) && typeof value === 'string'
          && key === 'effectiveTier' && ['low', 'balanced', 'high'].includes(value)) {
          safeMetrics.effectiveTier = value as QualityLifecycleTier;
        } else if (enumMetricKeys.has(metricKey) && typeof value === 'string'
          && key === 'status' && ['ok', 'failed', 'stale', 'fallback'].includes(value)) {
          safeMetrics.status = value as QualityLifecycleMetrics['status'];
        }
      }
      operation.phases.push({ stage, offsetMs: elapsed(), actionIndex: activeActionIndex, ...safeMetrics });
    },
    endOperation(result): void {
      if (observeDeadline()) return;
      const terminal = result as QualityLifecycleResult;
      if (!results.has(terminal) || terminal === 'pending') return;
      finishActiveOperation(terminal as Exclude<QualityLifecycleResult, 'pending'>);
    },
    finish(): void {
      if (observeDeadline()) return;
      finishActiveOperation('completed');
      status = 'completed';
    },
    read(): QualityLifecycleSnapshot {
      observeDeadline();
      return {
        status,
        elapsedMs: Math.min(elapsed(), QUALITY_LIFECYCLE_LIMITS.runDeadlineMs),
        deadlineMs: QUALITY_LIFECYCLE_LIMITS.runDeadlineMs,
        overflowCount: { ...overflowCount },
        operations: operations.map(operation => ({
          ...operation,
          actions: operation.actions.map(action => ({ ...action })),
          phases: operation.phases.map(phase => ({ ...phase })),
        })),
      };
    },
  };
}

const TEST_MODE = import.meta.env.MODE === 'test';
let browserTracker: QualityLifecycleTracker | null = null;
let browserStartAtMs: number | null = null;

function startForCurrentDocument(): void {
  if (!TEST_MODE || typeof window === 'undefined') return;
  const startAt = window.__blockcolcQualityLifecyclePageStartAt;
  if (typeof startAt !== 'number' || !Number.isFinite(startAt) || browserStartAtMs === startAt) return;
  browserStartAtMs = startAt;
  browserTracker = createQualityLifecycleTracker(startAt, () => performance.now());
  browserTracker.beginOperation('boot');
  browserTracker.record('page-start');
  const tracker = browserTracker;
  Object.defineProperty(window, '__blockcolcQualityLifecycle', {
    configurable: true,
    value: {
      beginOperation: (kind: QualityLifecycleOperationKind) => tracker.beginOperation(kind),
      beginAction: (quality: QualityLifecyclePreference) => tracker.beginAction(quality),
      endAction: (result: Exclude<QualityLifecycleResult, 'pending'>) => tracker.endAction(result),
      record: (stage: QualityLifecycleStage, metrics?: QualityLifecycleMetrics) => tracker.record(stage, metrics),
      endOperation: (result: Exclude<QualityLifecycleResult, 'pending'>) => tracker.endOperation(result),
      finish: () => tracker.finish(),
      read: () => tracker.read(),
    } satisfies QualityLifecycleBrowserApi,
  });
}

export function qualityLifecycleProbeEnabled(): boolean {
  return TEST_MODE;
}

export function recordQualityLifecyclePhase(stage: QualityLifecycleStage, metrics?: QualityLifecycleMetrics): void {
  startForCurrentDocument();
  browserTracker?.record(stage, metrics);
}

export function finishQualityLifecycleBoot(result: Exclude<QualityLifecycleResult, 'pending'> = 'completed'): void {
  startForCurrentDocument();
  browserTracker?.endOperation(result);
}

export interface QualityLifecycleBrowserApi extends QualityLifecycleTracker {}

declare global {
  interface Window {
    __blockcolcQualityLifecyclePageStartAt?: number;
    __blockcolcQualityLifecycle?: QualityLifecycleBrowserApi;
  }
}

startForCurrentDocument();
