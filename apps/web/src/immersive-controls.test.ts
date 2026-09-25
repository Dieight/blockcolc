import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImmersiveControls } from './immersive-controls';

function fixture() {
  const changed = vi.fn();
  const controls = createImmersiveControls({
    now: () => Date.now(),
    schedule: (callback, delay) => Number(setTimeout(callback, delay)),
    cancel: timer => clearTimeout(timer),
    changed,
  });
  const tap = (overrides = {}) => controls.tap({ x: 10, y: 10, onButton: false, minimalIdle: false, minimalBreak: false, ...overrides });
  const doubleTap = (overrides = {}) => { tap(overrides); vi.advanceTimersByTime(100); tap(overrides); };
  return { controls, changed, tap, doubleTap };
}

describe('immersive presentation controls', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });
  it('shows a session hint for 3800 ms without revealing the end button', () => {
    const f = fixture(); f.controls.resetSession('a');
    expect(f.controls.state.hintVisible).toBe(true);
    vi.advanceTimersByTime(3800);
    expect(f.controls.state.hintVisible).toBe(false);
    expect(f.controls.state.controlsVisible).toBe(false);
  });
  it('delays reveal past the trailing click, then auto-hides with a 180 ms fade', () => {
    const f = fixture(); f.controls.resetSession('a'); f.doubleTap();
    vi.advanceTimersByTime(249); expect(f.controls.state.controlsVisible).toBe(false);
    vi.advanceTimersByTime(1); expect(f.controls.state.controlsVisible).toBe(true);
    vi.advanceTimersByTime(4999); expect(f.controls.state.controlsLeaving).toBe(false);
    vi.advanceTimersByTime(1); expect(f.controls.state.controlsLeaving).toBe(true);
    vi.advanceTimersByTime(180); expect(f.controls.state.controlsVisible).toBe(false);
  });
  it('ignores buttons, slow pairs and distant pairs', () => {
    const f = fixture(); f.controls.resetSession('a');
    f.doubleTap({ onButton: true }); vi.advanceTimersByTime(300);
    expect(f.controls.state.controlsVisible).toBe(false);
    f.tap(); vi.advanceTimersByTime(450); f.tap(); vi.advanceTimersByTime(500);
    expect(f.controls.state.controlsVisible).toBe(false);
    f.tap(); vi.advanceTimersByTime(100); f.tap({ x: 58 }); vi.advanceTimersByTime(300);
    expect(f.controls.state.controlsVisible).toBe(false);
  });
  it('toggles idle exit and break controls without creating a focus end control', () => {
    const f = fixture();
    f.doubleTap({ minimalIdle: true }); expect(f.controls.state.idleExitRevealed).toBe(true);
    f.controls.resetIdleExit(); expect(f.controls.state.idleExitRevealed).toBe(false);
    f.doubleTap({ minimalBreak: true, minimalIdle: true });
    expect(f.controls.state.breakControlsRevealed).toBe(true);
    expect(f.controls.state.idleExitRevealed).toBe(false);
    f.doubleTap({ minimalBreak: true }); expect(f.controls.state.breakControlsRevealed).toBe(false);
    vi.advanceTimersByTime(6000); expect(f.controls.state.controlsVisible).toBe(false);
  });
  it('cancels a pending reveal when a new session replaces the old one', () => {
    const f = fixture(); f.controls.resetSession('a'); f.doubleTap();
    f.controls.resetSession('b'); vi.advanceTimersByTime(300);
    expect(f.controls.state.controlsVisible).toBe(false);
    expect(f.controls.state.hintVisible).toBe(true);
    f.controls.resetSession(null); expect(f.controls.state.hintVisible).toBe(false);
  });
  it('a previous-session fade cannot hide newly revealed controls', () => {
    const f = fixture(); f.controls.resetSession('a'); f.doubleTap(); vi.advanceTimersByTime(250);
    f.controls.hideControls(); f.controls.resetSession('b');
    f.doubleTap(); vi.advanceTimersByTime(250);
    expect(f.controls.state.controlsVisible).toBe(true);
    expect(f.controls.state.controlsLeaving).toBe(false);
  });
  it('back-layer hiding cancels pending reveal and completes one fade', () => {
    const f = fixture(); f.controls.resetSession('a'); f.doubleTap();
    f.controls.hideControls(); vi.advanceTimersByTime(6000);
    expect(f.controls.state.controlsVisible).toBe(false);
    expect(f.controls.state.controlsLeaving).toBe(false);
  });
  it('disposes all timers and supports a fresh effect setup without stale work', () => {
    const f = fixture(); f.controls.resetSession('a'); f.doubleTap();
    f.controls.dispose(); const count = f.changed.mock.calls.length;
    vi.advanceTimersByTime(10000);
    expect(f.changed).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
    f.controls.activate(); f.controls.resetSession('b'); f.doubleTap(); vi.advanceTimersByTime(250);
    expect(f.controls.state.controlsVisible).toBe(true);
    f.controls.dispose();
  });
});
