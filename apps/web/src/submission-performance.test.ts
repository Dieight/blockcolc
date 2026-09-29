import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginFocusSubmission,
  closeFocusSubmissionObservation,
  commitFocusSubmissionProjection,
  consumeFocusSubmissionProjection,
  failFocusSubmission,
  markFocusSubmissionStage,
  observeFocusSubmissionFrame,
  peekFocusSubmissionProjection,
  readFocusSubmissionDiagnosticsForTest,
  recordFocusSubmissionProjection,
  requestFocusSubmissionProjection,
  resetFocusSubmissionDiagnosticsForTest,
} from './submission-performance';

afterEach(() => {
  vi.useRealTimers();
  resetFocusSubmissionDiagnosticsForTest();
});

function observerHarness() {
  const diagnostics = { renderedWorldRebuildCount: 4, lastWorldFrameCommittedAtMs: 20 };
  let current = true;
  let visible = true;
  let hiddenCallback: (() => void) | null = null;
  let readCount=0;
  return {
    diagnostics,
    get readCount(){return readCount;},
    get hasHiddenSubscription(){return hiddenCallback!==null;},
    setCurrent(value: boolean) { current = value; },
    setVisible(value: boolean) { visible = value; hiddenCallback?.(); },
    observe(token: number, baselineRebuildCount = 4, requestedAtMs = 100) {
      return observeFocusSubmissionFrame({
        token,
        baselineRebuildCount,
        requestedAtMs,
        readDiagnostics: () => {readCount+=1;return diagnostics;},
        isCurrentGeneration: () => current,
        isVisible: () => visible,
        subscribeHidden: callback => { hiddenCallback = callback; return () => { hiddenCallback = null; }; },
        setTimer: (callback, delay) => setTimeout(callback, delay),
        clearTimer: handle => clearTimeout(handle),
      });
    },
  };
}

describe('bounded focus submission diagnostics', () => {
  it('adopts a projection token and key baseline only at commit, once', () => {
    const token=beginFocusSubmission('progress')!;
    requestFocusSubmissionProjection(token);
    // An abandoned render only peeks. Without its layout-commit seam, the
    // token and committed key baseline remain untouched.
    expect(peekFocusSubmissionProjection()).toBe(token);
    expect(readFocusSubmissionDiagnosticsForTest()[0]?.phases).toEqual([{stage:'submitted',atMs:expect.any(Number)}]);

    const adoption=commitFocusSubmissionProjection({token,snapshotKey:'committed-next',previousCommittedKey:'committed-current',elapsedMs:1});
    expect(adoption).toEqual({adopted:true,worldKeyChanged:true});
    expect(peekFocusSubmissionProjection()).toBeNull();
    const committedPhases=readFocusSubmissionDiagnosticsForTest()[0]!.phases;
    expect(committedPhases.map(phase=>phase.stage)).toEqual(['submitted','projection-completed']);

    expect(commitFocusSubmissionProjection({token,snapshotKey:'discarded-rerender',previousCommittedKey:'committed-next',elapsedMs:2})).toEqual({adopted:false,worldKeyChanged:true});
    expect(readFocusSubmissionDiagnosticsForTest()[0]!.phases).toEqual(committedPhases);
  });

  it('records changed and unchanged world keys, and only closes changed keys on a committed frame', () => {
    const changed = beginFocusSubmission('progress')!;
    markFocusSubmissionStage(changed, 'dispatch-started');
    markFocusSubmissionStage(changed, 'dispatch-completed');
    requestFocusSubmissionProjection(changed);
    expect(peekFocusSubmissionProjection()).toBe(changed);
    consumeFocusSubmissionProjection(changed);
    recordFocusSubmissionProjection(changed, 2.5, true);
    const harness = observerHarness();
    vi.useFakeTimers();
    harness.observe(changed,4,100);
    expect(readFocusSubmissionDiagnosticsForTest().at(-1)?.terminal).toBe('pending');
    harness.diagnostics.renderedWorldRebuildCount = 5;
    harness.diagnostics.lastWorldFrameCommittedAtMs = 100;
    vi.advanceTimersByTime(50);
    expect(readFocusSubmissionDiagnosticsForTest().at(-1)?.terminal).toBe('pending');
    harness.diagnostics.lastWorldFrameCommittedAtMs = 101;
    vi.advanceTimersByTime(50);
    const changedRecord = readFocusSubmissionDiagnosticsForTest().at(-1)!;
    expect(changedRecord.terminal).toBe('frame-committed');
    expect(changedRecord.phases.at(-1)).toMatchObject({ stage: 'renderer-frame-committed', rebuildCount: 5, frameCommittedAtMs: 101 });

    const unchanged = beginFocusSubmission('marathon')!;
    recordFocusSubmissionProjection(unchanged, 0.8, false, { renderedWorldRebuildCount: 8, lastWorldFrameCommittedAtMs: 40 });
    expect(readFocusSubmissionDiagnosticsForTest().at(-1)).toMatchObject({
      category: 'marathon', worldKeyChanged: false, terminal: 'unchanged', failedPhase: null,
      phases: [{ stage: 'submitted' }, { stage: 'projection-completed', worldKeyChanged: false }, { stage: 'terminal-unchanged', rebuildCount: 8, frameCommittedAtMs: 40 }],
    });
  });

  it.each(['dispatch-rejected', 'dispatch-threw'] as const)('marks %s as a retryable failed attempt without storing error text', stage => {
    const first = beginFocusSubmission('progress')!;
    failFocusSubmission(first, stage);
    const retry = beginFocusSubmission('progress')!;
    expect(retry).toBe(first + 1);
    expect(readFocusSubmissionDiagnosticsForTest()).toMatchObject([
      { terminal: 'failed', failedPhase: 'dispatch', phases: [{ stage: 'submitted' }, { stage }] },
      { terminal: 'pending', failedPhase: null },
    ]);
    expect(JSON.stringify(readFocusSubmissionDiagnosticsForTest())).not.toContain('error');
  });

  it('does not associate an old generation late frame with the active report', () => {
    const token = beginFocusSubmission('marathon')!;
    recordFocusSubmissionProjection(token, 1, true);
    const harness = observerHarness();
    vi.useFakeTimers();
    harness.observe(token);
    harness.setCurrent(false);
    harness.diagnostics.renderedWorldRebuildCount = 5;
    vi.advanceTimersByTime(50);
    expect(readFocusSubmissionDiagnosticsForTest().at(-1)?.terminal).toBe('superseded');
    expect(readFocusSubmissionDiagnosticsForTest().at(-1)?.phases.some(phase => phase.stage === 'renderer-frame-committed')).toBe(false);
  });

  it('bounds hidden, disposed and timeout observation without a permanent animation-frame loop', () => {
    const hiddenToken = beginFocusSubmission('progress')!;
    const hiddenHarness = observerHarness();
    vi.useFakeTimers();
    hiddenHarness.observe(hiddenToken);
    hiddenHarness.setVisible(false);
    expect(readFocusSubmissionDiagnosticsForTest().at(-1)?.terminal).toBe('hidden');

    const disposedToken = beginFocusSubmission('progress')!;
    const disposedHarness = observerHarness();
    vi.useFakeTimers();
    const dispose = disposedHarness.observe(disposedToken);
    dispose();
    expect(readFocusSubmissionDiagnosticsForTest().at(-1)?.terminal).toBe('disposed');

    const notYetObservedToken = beginFocusSubmission('marathon')!;
    closeFocusSubmissionObservation(notYetObservedToken, 'disposed');
    expect(readFocusSubmissionDiagnosticsForTest().at(-1)?.terminal).toBe('disposed');

    vi.useFakeTimers();
    const timeoutToken = beginFocusSubmission('progress')!;
    const timeoutHarness = observerHarness();
    timeoutHarness.observe(timeoutToken);
    vi.advanceTimersByTime(15_000);
    expect(readFocusSubmissionDiagnosticsForTest().at(-1)?.terminal).toBe('timeout');
    expect(timeoutHarness.hasHiddenSubscription).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases polling timers and hidden subscriptions when a record is externally settled', () => {
    vi.useFakeTimers();
    const token=beginFocusSubmission('progress')!;
    const harness=observerHarness();
    harness.observe(token);
    expect(harness.hasHiddenSubscription).toBe(true);
    expect(harness.readCount).toBe(1);
    failFocusSubmission(token,'dispatch-threw');
    expect(harness.hasHiddenSubscription).toBe(false);
    vi.advanceTimersByTime(500);
    expect(harness.readCount).toBe(1);
    expect(readFocusSubmissionDiagnosticsForTest()[0]?.terminal).toBe('failed');
  });

  it('releases observers on bounded eviction and reset without token reuse collisions', () => {
    vi.useFakeTimers();
    const evictedToken=beginFocusSubmission('progress')!;
    const evictedHarness=observerHarness();
    const disposeOld=evictedHarness.observe(evictedToken);
    expect(evictedHarness.hasHiddenSubscription).toBe(true);
    for(let index=0;index<24;index+=1)beginFocusSubmission('progress');
    expect(readFocusSubmissionDiagnosticsForTest()).toHaveLength(24);
    expect(readFocusSubmissionDiagnosticsForTest().some(record=>record.token===evictedToken)).toBe(false);
    expect(evictedHarness.hasHiddenSubscription).toBe(false);
    expect(vi.getTimerCount()).toBe(24);
    vi.advanceTimersByTime(100);
    expect(evictedHarness.readCount).toBe(1);

    const preResetToken=readFocusSubmissionDiagnosticsForTest().at(-1)!.token;
    const resetHarness=observerHarness();
    const disposeReset=resetHarness.observe(preResetToken);
    expect(resetHarness.hasHiddenSubscription).toBe(true);
    resetFocusSubmissionDiagnosticsForTest();
    expect(resetHarness.hasHiddenSubscription).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const nextToken=beginFocusSubmission('marathon')!;
    expect(nextToken).toBeGreaterThan(preResetToken);
    markFocusSubmissionStage(nextToken,'dispatch-started');
    disposeReset();
    disposeOld();
    expect(readFocusSubmissionDiagnosticsForTest()).toMatchObject([{token:nextToken,category:'marathon',terminal:'pending',phases:[{stage:'submitted'},{stage:'dispatch-started'}]}]);
  });

  it('keeps only bounded records and phases', () => {
    let token = 0;
    for (let index = 0; index < 40; index += 1) {
      token = beginFocusSubmission('progress')!;
      for (let phase = 0; phase < 20; phase += 1) markFocusSubmissionStage(token, 'dispatch-started');
    }
    const snapshot = readFocusSubmissionDiagnosticsForTest();
    expect(snapshot).toHaveLength(24);
    expect(snapshot.every(record => record.phases.length <= 12)).toBe(true);
    expect(snapshot.some(record => record.token === 1)).toBe(false);
  });
});
