/**
 * Bounded, test-mode-only diagnostics for one user initiated focus report.
 * The payload contains stage names and timings only; product data never enters
 * this module. It is deliberately not a retry queue or a persistence owner.
 */
export type FocusSubmissionCategory = 'progress' | 'marathon';
export type FocusSubmissionStage =
  | 'submitted'
  | 'dispatch-started'
  | 'dispatch-completed'
  | 'dispatch-rejected'
  | 'dispatch-threw'
  | 'projection-completed'
  | 'projection-failed'
  | 'renderer-rebuild-requested'
  | 'renderer-frame-committed'
  | 'terminal-unchanged'
  | 'terminal-hidden'
  | 'terminal-disposed'
  | 'terminal-superseded'
  | 'terminal-timeout';

export type FocusSubmissionFailurePhase = 'dispatch' | 'projection' | 'renderer' | 'observation';
export type FocusSubmissionTerminal =
  | 'pending'
  | 'unchanged'
  | 'frame-committed'
  | 'failed'
  | 'hidden'
  | 'disposed'
  | 'superseded'
  | 'timeout';

export interface FocusSubmissionPhase {
  stage: FocusSubmissionStage;
  atMs: number;
  elapsedMs?: number;
  worldKeyChanged?: boolean;
  rebuildCount?: number;
  frameCommittedAtMs?: number;
  persistenceCommitted?: boolean;
}

export interface FocusSubmissionDiagnostic {
  token: number;
  category: FocusSubmissionCategory;
  submittedAtMs: number;
  phases: FocusSubmissionPhase[];
  worldKeyChanged: boolean | null;
  terminal: FocusSubmissionTerminal;
  failedPhase: FocusSubmissionFailurePhase | null;
}

const MAX_RECORDS = 24;
const MAX_PHASES = 12;
const OBSERVATION_TIMEOUT_MS = 15_000;
const TEST_MODE = import.meta.env.MODE === 'test';
const records: FocusSubmissionDiagnostic[] = [];
const byToken = new Map<number, FocusSubmissionDiagnostic>();
const pendingProjectionTokens: number[] = [];
const recordTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
const observationCleanups = new Map<number, Set<() => void>>();
let nextToken = 1;

export function isFocusSubmissionDiagnosticsEnabled(): boolean {
  return TEST_MODE;
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function diagnostic(token: number | null | undefined): FocusSubmissionDiagnostic | null {
  return token == null ? null : byToken.get(token) ?? null;
}

function pushPhase(record: FocusSubmissionDiagnostic, phase: FocusSubmissionPhase): void {
  if (record.phases.length >= MAX_PHASES) record.phases.shift();
  record.phases.push(phase);
}

function settle(
  record: FocusSubmissionDiagnostic,
  terminal: FocusSubmissionTerminal,
  failedPhase: FocusSubmissionFailurePhase | null = null,
): void {
  if (record.terminal === 'pending') {
    record.terminal = terminal;
    record.failedPhase = failedPhase;
  }
  const timeout = recordTimeouts.get(record.token);
  if (timeout !== undefined) clearTimeout(timeout);
  recordTimeouts.delete(record.token);
  const cleanups = observationCleanups.get(record.token);
  observationCleanups.delete(record.token);
  for (const cleanup of cleanups ?? []) cleanup();
}

function removePendingProjectionToken(token: number): void {
  for (let index = pendingProjectionTokens.indexOf(token); index >= 0; index = pendingProjectionTokens.indexOf(token)) {
    pendingProjectionTokens.splice(index, 1);
  }
}

export function beginFocusSubmission(category: FocusSubmissionCategory): number | null {
  if (!TEST_MODE) return null;
  const token = nextToken++;
  const submittedAtMs = now();
  const record: FocusSubmissionDiagnostic = {
    token,
    category,
    submittedAtMs,
    phases: [],
    worldKeyChanged: null,
    terminal: 'pending',
    failedPhase: null,
  };
  records.push(record);
  byToken.set(token, record);
  if (records.length > MAX_RECORDS) {
    const removed = records.shift()!;
    settle(removed, 'disposed');
    removePendingProjectionToken(removed.token);
    byToken.delete(removed.token);
  }
  pushPhase(record, { stage: 'submitted', atMs: submittedAtMs });
  const timeout = setTimeout(() => {
    recordTimeouts.delete(token);
    if (record.terminal === 'pending') {
      pushPhase(record, { stage: 'terminal-timeout', atMs: now() });
      settle(record, 'timeout', 'observation');
    }
  }, OBSERVATION_TIMEOUT_MS);
  recordTimeouts.set(token, timeout);
  // Settled records should not keep a Node test process alive. In browsers this
  // is harmless and remains bounded to the active diagnostic record lifetime.
  (timeout as unknown as { unref?: () => void }).unref?.();
  return token;
}

export function markFocusSubmissionStage(
  token: number | null | undefined,
  stage: FocusSubmissionStage,
  details: Omit<FocusSubmissionPhase, 'stage' | 'atMs'> = {},
): void {
  if (!TEST_MODE) return;
  const record = diagnostic(token);
  if (!record || record.terminal !== 'pending') return;
  pushPhase(record, { stage, atMs: now(), ...details });
}

export function failFocusSubmission(
  token: number | null | undefined,
  stage: 'dispatch-rejected' | 'dispatch-threw',
): void {
  if (!TEST_MODE) return;
  const record = diagnostic(token);
  if (!record || record.terminal !== 'pending') return;
  pushPhase(record, { stage, atMs: now() });
  settle(record, 'failed', 'dispatch');
}

export function failFocusSubmissionProjection(token: number | null | undefined): void {
  if (!TEST_MODE) return;
  const record = diagnostic(token);
  if (!record || record.terminal !== 'pending') return;
  removePendingProjectionToken(record.token);
  pushPhase(record, { stage: 'projection-failed', atMs: now() });
  settle(record, 'failed', 'projection');
}

export function closeFocusSubmissionObservation(
  token: number | null | undefined,
  terminal: 'hidden' | 'disposed' | 'superseded',
): void {
  if (!TEST_MODE) return;
  const record = diagnostic(token);
  if (!record || record.terminal !== 'pending') return;
  const stage: FocusSubmissionStage = terminal === 'hidden' ? 'terminal-hidden'
    : terminal === 'disposed' ? 'terminal-disposed' : 'terminal-superseded';
  pushPhase(record, { stage, atMs: now() });
  settle(record, terminal, terminal === 'superseded' ? 'renderer' : null);
}

export function requestFocusSubmissionProjection(token: number | null | undefined): void {
  if (!TEST_MODE) return;
  const record = diagnostic(token);
  if (!record || record.terminal !== 'pending') return;
  pendingProjectionTokens.push(record.token);
  if (pendingProjectionTokens.length > MAX_RECORDS) pendingProjectionTokens.shift();
}

export function peekFocusSubmissionProjection(): number | null {
  if (!TEST_MODE) return null;
  for (let index = 0; index < pendingProjectionTokens.length;) {
    const token = pendingProjectionTokens[index]!;
    const record = diagnostic(token);
    if (record?.terminal === 'pending') return token;
    pendingProjectionTokens.splice(index, 1);
  }
  return null;
}

export function consumeFocusSubmissionProjection(token: number | null | undefined): void {
  if (!TEST_MODE || token == null) return;
  removePendingProjectionToken(token);
}

export function commitFocusSubmissionProjection(input: {
  token: number | null | undefined;
  snapshotKey: string;
  previousCommittedKey: string | null;
  elapsedMs: number;
  preservedFrame?: WorldFrameDiagnostics | null;
}): { adopted: boolean; worldKeyChanged: boolean } {
  const worldKeyChanged = input.previousCommittedKey !== null && input.previousCommittedKey !== input.snapshotKey;
  if (!TEST_MODE || input.token == null) return { adopted: false, worldKeyChanged };
  const record = diagnostic(input.token);
  if (!record || record.terminal !== 'pending') {
    removePendingProjectionToken(input.token);
    return { adopted: false, worldKeyChanged };
  }
  const queueIndex = pendingProjectionTokens.indexOf(input.token);
  if (queueIndex < 0) return { adopted: false, worldKeyChanged };
  consumeFocusSubmissionProjection(input.token);
  recordFocusSubmissionProjection(input.token, input.elapsedMs, worldKeyChanged, input.preservedFrame);
  return { adopted: true, worldKeyChanged };
}

export function recordFocusSubmissionProjection(
  token: number | null | undefined,
  elapsedMs: number,
  worldKeyChanged: boolean,
  preservedFrame?: WorldFrameDiagnostics | null,
): void {
  if (!TEST_MODE) return;
  const record = diagnostic(token);
  if (!record || record.terminal !== 'pending') return;
  if (record.phases.some(phase => phase.stage === 'projection-completed')) return;
  record.worldKeyChanged = worldKeyChanged;
  pushPhase(record, { stage: 'projection-completed', atMs: now(), elapsedMs, worldKeyChanged });
  if (!worldKeyChanged) {
    pushPhase(record, {
      stage: 'terminal-unchanged',
      atMs: now(),
      worldKeyChanged: false,
      rebuildCount: preservedFrame?.renderedWorldRebuildCount,
      frameCommittedAtMs: preservedFrame?.lastWorldFrameCommittedAtMs ?? undefined,
    });
    settle(record, 'unchanged');
  }
}

export interface WorldFrameDiagnostics {
  renderedWorldRebuildCount: number;
  lastWorldFrameCommittedAtMs: number | null;
}

export interface ObserveFocusSubmissionFrameOptions {
  token: number;
  baselineRebuildCount: number;
  requestedAtMs: number;
  readDiagnostics: () => WorldFrameDiagnostics;
  isCurrentGeneration: () => boolean;
  isVisible: () => boolean;
  subscribeHidden?: (callback: () => void) => () => void;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * Poll renderer diagnostics at a bounded interval. Success comes exclusively
 * from the renderer's committed-frame diagnostics for the captured generation.
 */
export function observeFocusSubmissionFrame(options: ObserveFocusSubmissionFrameOptions): () => void {
  if (!TEST_MODE) return () => undefined;
  const record = diagnostic(options.token);
  if (!record || record.terminal !== 'pending') return () => undefined;
  pushPhase(record, { stage: 'renderer-rebuild-requested', atMs: options.requestedAtMs, rebuildCount: options.baselineRebuildCount });
  let pollHandle: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeHidden: (() => void) | null = null;

  const stop = (terminal?: FocusSubmissionTerminal, failedPhase: FocusSubmissionFailurePhase | null = null): void => {
    if (stopped) return;
    stopped = true;
    if (pollHandle !== null) options.clearTimer(pollHandle);
    if (timeoutHandle !== null) options.clearTimer(timeoutHandle);
    unsubscribeHidden?.();
    unsubscribeHidden = null;
    if (terminal && record.terminal === 'pending') {
      const stage = terminal === 'hidden' ? 'terminal-hidden'
        : terminal === 'disposed' ? 'terminal-disposed'
          : terminal === 'superseded' ? 'terminal-superseded'
            : terminal === 'timeout' ? 'terminal-timeout' : null;
      if (stage) pushPhase(record, { stage, atMs: now() });
      settle(record, terminal, failedPhase);
    }
  };

  const inspect = (): void => {
    pollHandle = null;
    if (stopped || record.terminal !== 'pending') return;
    if (!options.isCurrentGeneration()) { stop('superseded', 'renderer'); return; }
    if (!options.isVisible()) { stop('hidden'); return; }
    try {
      const snapshot = options.readDiagnostics();
      if (snapshot.renderedWorldRebuildCount > options.baselineRebuildCount
        && snapshot.lastWorldFrameCommittedAtMs !== null
        && snapshot.lastWorldFrameCommittedAtMs > options.requestedAtMs) {
        pushPhase(record, {
          stage: 'renderer-frame-committed',
          atMs: now(),
          rebuildCount: snapshot.renderedWorldRebuildCount,
          frameCommittedAtMs: snapshot.lastWorldFrameCommittedAtMs,
        });
        settle(record, 'frame-committed');
        stop();
        return;
      }
    } catch {
      stop('failed', 'renderer');
      return;
    }
    pollHandle = options.setTimer(inspect, 50);
  };

  timeoutHandle = options.setTimer(() => stop('timeout', 'observation'), OBSERVATION_TIMEOUT_MS);
  unsubscribeHidden = options.subscribeHidden?.(() => {
    if (!options.isVisible()) stop('hidden');
  }) ?? null;
  // Inspect now as well. Periodic timers observe diagnostics; neither a timer
  // nor an animation frame is treated as evidence of a committed scene frame.
  inspect();
  if (!stopped) {
    const cleanups = observationCleanups.get(record.token) ?? new Set<() => void>();
    const cancel = () => stop();
    cleanups.add(cancel);
    observationCleanups.set(record.token, cleanups);
  }
  return () => stop('disposed');
}

export function readFocusSubmissionDiagnosticsForTest(): FocusSubmissionDiagnostic[] {
  if (!TEST_MODE) return [];
  return records.map(record => ({ ...record, phases: record.phases.map(phase => ({ ...phase })) }));
}

export function resetFocusSubmissionDiagnosticsForTest(): void {
  if (!TEST_MODE) return;
  for (const record of records) settle(record, 'disposed');
  records.splice(0, records.length);
  byToken.clear();
  for (const timeout of recordTimeouts.values()) clearTimeout(timeout);
  recordTimeouts.clear();
  pendingProjectionTokens.splice(0, pendingProjectionTokens.length);
}

if (TEST_MODE && typeof window !== 'undefined') {
  Object.defineProperty(window, '__blockcolcSubmissionPerformance', {
    configurable: true,
    value: {
      read: readFocusSubmissionDiagnosticsForTest,
      reset: resetFocusSubmissionDiagnosticsForTest,
    },
  });
}

declare global {
  interface Window {
    __blockcolcSubmissionPerformance?: {
      read: typeof readFocusSubmissionDiagnosticsForTest;
      reset: typeof resetFocusSubmissionDiagnosticsForTest;
    };
  }
}
