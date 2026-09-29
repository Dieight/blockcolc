import { describe, expect, it } from 'vitest';
import { createQualityLifecycleTracker, QUALITY_LIFECYCLE_LIMITS } from './quality-lifecycle-performance';

describe('bounded quality lifecycle observations', () => {
  it('records only bounded enum/numeric phases and action associations', () => {
    let now = 10;
    const tracker = createQualityLifecycleTracker(10, () => now);
    const operation = tracker.beginOperation('quality-pair');
    expect(operation).toBe(0);
    tracker.beginAction('performance');
    now += 12;
    tracker.record('quality-projection-complete', {
      effectiveTier: 'low', durationMs: 12, requestedPreference: 'performance',
      status: 'ok', atlasPageCount: Number.NaN,
    });
    tracker.endAction('completed');
    tracker.endOperation('completed');
    const snapshot = tracker.read();
    expect(snapshot.operations[0]).toMatchObject({ kind: 'quality-pair', result: 'completed' });
    expect(snapshot.operations[0]?.actions[0]).toMatchObject({ requestedPreference: 'performance', result: 'completed' });
    expect(snapshot.operations[0]?.phases[0]).toMatchObject({ stage: 'quality-projection-complete', actionIndex: 0, durationMs: 12 });
    expect(snapshot.operations[0]?.phases[0]).not.toHaveProperty('atlasPageCount');
    expect(snapshot.overflowCount).toEqual({ operations: 0, actions: 0, phases: 0 });
  });

  it('caps operation, action, and phase storage while exposing every overflow', () => {
    const tracker = createQualityLifecycleTracker(0, () => 1);
    for (let index = 0; index < QUALITY_LIFECYCLE_LIMITS.maxOperations; index += 1) {
      tracker.beginOperation('quality-pair');
      for (let action = 0; action < QUALITY_LIFECYCLE_LIMITS.maxActionsPerOperation + 1; action += 1) {
        tracker.beginAction('balanced');
      }
      for (let phase = 0; phase < QUALITY_LIFECYCLE_LIMITS.maxPhasesPerOperation + 1; phase += 1) {
        tracker.record('quality-projection-complete', { durationMs: phase });
      }
      tracker.endOperation('completed');
    }
    tracker.beginOperation('boot');
    const snapshot = tracker.read();
    expect(snapshot.operations).toHaveLength(QUALITY_LIFECYCLE_LIMITS.maxOperations);
    expect(snapshot.operations[0]?.actions).toHaveLength(QUALITY_LIFECYCLE_LIMITS.maxActionsPerOperation);
    expect(snapshot.operations[0]?.phases).toHaveLength(QUALITY_LIFECYCLE_LIMITS.maxPhasesPerOperation);
    expect(snapshot.overflowCount).toEqual({ operations: 1, actions: 8, phases: 8 });
  });

  it('fits the complete old-path two-action event budget without hiding selection reads', () => {
    let now = 0;
    const tracker = createQualityLifecycleTracker(0, () => now++);
    tracker.beginOperation('quality-pair');
    for (const preference of ['performance', 'balanced'] as const) {
      tracker.beginAction(preference);
      // Old path: teardown/dispose/create, bootstrap read/build/rebuild, then
      // a second actual repository read when the user returns to the world.
      tracker.record('renderer-released');
      tracker.record('atlas-disposed', { rendererGeneration: 4, atlasInstance: 2, atlasPageCount: 3 });
      tracker.record('renderer-created', { rendererGeneration: 5 });
      tracker.record('selection-read-end', { durationMs: 4, status: 'ok' });
      tracker.record('manifest-layer-end', { durationMs: 1, status: 'ok' });
      tracker.record('atlas-build-complete', { durationMs: 15, rendererGeneration: 5, atlasInstance: 3, atlasPageCount: 3 });
      tracker.record('quality-projection-complete', { durationMs: 2, rendererGeneration: 5, atlasInstance: 3, requestedPreference: preference, effectiveTier: 'balanced' });
      tracker.record('world-rebuild-complete', { durationMs: 45, worldRebuildCount: 2, renderedWorldRebuildCount: 1, rendererGeneration: 5, atlasInstance: 3 });
      tracker.record('first-nonempty-frame', { durationMs: 60 });
      tracker.record('selection-read-end', { durationMs: 3, status: 'ok' });
      tracker.record('visible-world-frame', { durationMs: 4, worldRebuildCount: 2, renderedWorldRebuildCount: 2, renderedTriangleCount: 100, rendererGeneration: 5, atlasInstance: 3 });
      tracker.endAction('completed');
    }
    tracker.endOperation('completed');
    const operation = tracker.read().operations[0];
    expect(operation?.phases).toHaveLength(QUALITY_LIFECYCLE_LIMITS.maxPhasesPerOperation);
    expect(operation?.phases.map(phase => phase.stage)).toEqual([
      'atlas-disposed', 'selection-read-end', 'manifest-layer-end', 'atlas-build-complete',
      'quality-projection-complete', 'world-rebuild-complete', 'selection-read-end', 'visible-world-frame',
      'atlas-disposed', 'selection-read-end', 'manifest-layer-end', 'atlas-build-complete',
      'quality-projection-complete', 'world-rebuild-complete', 'selection-read-end', 'visible-world-frame',
    ]);
    expect(operation?.phases.filter(phase => phase.stage === 'selection-read-end')).toHaveLength(4);
    expect(operation?.omittedRedundantPhaseCount).toBe(6);
    expect(tracker.read().overflowCount.phases).toBe(0);
  });

  it('freezes the active operation and action at the sixty-second deadline', () => {
    let now = 0;
    const tracker = createQualityLifecycleTracker(0, () => now);
    tracker.beginOperation('boot');
    tracker.beginAction('balanced');
    now = QUALITY_LIFECYCLE_LIMITS.runDeadlineMs + 5;
    tracker.record('first-nonempty-frame', { durationMs: now });
    const snapshot = tracker.read();
    expect(snapshot.status).toBe('timed-out');
    expect(snapshot.operations[0]).toMatchObject({ result: 'timed-out', endedAtOffsetMs: 60_000 });
    expect(snapshot.operations[0]?.actions[0]).toMatchObject({ result: 'timed-out', endedAtOffsetMs: 60_000 });
    expect(snapshot.operations[0]?.phases).toHaveLength(0);
  });

  it('rejects runtime text in enum slots instead of retaining it', () => {
    const tracker = createQualityLifecycleTracker(0, () => 1);
    expect(tracker.beginOperation('private title' as never)).toBeNull();
    tracker.beginOperation('boot');
    tracker.record('private path' as never, { requestedPreference: 'secret' as never, status: 'secret' as never });
    expect(tracker.read().operations[0]?.phases).toHaveLength(0);
  });

  it('white-lists metric keys and prevents shape-field injection', () => {
    const tracker = createQualityLifecycleTracker(10, () => 11);
    tracker.beginOperation('quality-pair');
    tracker.beginAction('performance');
    tracker.record('quality-projection-complete', {
      stage: 'page-start', offsetMs: 99_999, actionIndex: 99,
      injectedNumber: 123, injectedText: 'private content', durationMs: 5,
    } as never);
    const phase = tracker.read().operations[0]?.phases[0];
    expect(phase).toMatchObject({ stage: 'quality-projection-complete', offsetMs: 1, actionIndex: 0, durationMs: 5 });
    expect(phase).not.toHaveProperty('injectedNumber');
    expect(phase).not.toHaveProperty('injectedText');
    expect(tracker.read().operations[0]?.phases).toHaveLength(1);
  });

  it('rejects numbers in enum metrics and strings in numeric metrics at runtime', () => {
    const tracker = createQualityLifecycleTracker(0, () => 1);
    tracker.beginOperation('boot');
    tracker.record('quality-projection-complete', {
      requestedPreference: 1,
      effectiveTier: 2,
      status: 3,
      durationMs: '12',
      rendererGeneration: '4',
    } as never);
    const phase = tracker.read().operations[0]?.phases[0];
    expect(phase).toMatchObject({ stage: 'quality-projection-complete', offsetMs: 1, actionIndex: null });
    expect(phase).not.toHaveProperty('requestedPreference');
    expect(phase).not.toHaveProperty('effectiveTier');
    expect(phase).not.toHaveProperty('status');
    expect(phase).not.toHaveProperty('durationMs');
    expect(phase).not.toHaveProperty('rendererGeneration');
  });

  it('rejects pending as a runtime action or operation terminal', () => {
    const tracker = createQualityLifecycleTracker(0, () => 1);
    tracker.beginOperation('quality-pair');
    tracker.beginAction('balanced');
    tracker.endAction('pending' as never);
    tracker.endOperation('pending' as never);
    expect(tracker.read().operations[0]).toMatchObject({ result: 'pending', actions: [{ result: 'pending' }] });
    tracker.endAction('completed');
    tracker.endOperation('completed');
    expect(tracker.read().operations[0]).toMatchObject({ result: 'completed', actions: [{ result: 'completed' }] });
  });
});
