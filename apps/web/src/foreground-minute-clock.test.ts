import { afterEach, describe, expect, it, vi } from 'vitest';
import { localMinuteText, subscribeForegroundMinuteClock, type MinuteClockHost } from './foreground-minute-clock';

describe('foreground-only local minute clock', () => {
  afterEach(() => vi.useRealTimers());
  function fixture(visible = true) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 6, 23, 59, 45));
    let changed: (() => void) | undefined;
    const host: MinuteClockHost = {
      now: () => Date.now(), visible: () => visible,
      schedule: (callback, delay) => setTimeout(callback, delay) as unknown as number,
      cancel: id => clearTimeout(id),
      subscribeVisibility: callback => { changed = callback; return () => { changed = undefined; }; },
    };
    const tick = vi.fn();
    const close = subscribeForegroundMinuteClock(host, tick);
    return { tick, close, change: (value: boolean) => { visible = value; changed?.(); } };
  }
  it('updates at the next real minute and rolls midnight without seconds', () => {
    const f = fixture();
    expect(localMinuteText(f.tick.mock.calls[0]![0])).toBe('23:59');
    vi.advanceTimersByTime(14_999);
    expect(f.tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(localMinuteText(f.tick.mock.calls[1]![0])).toBe('00:00');
    expect(vi.getTimerCount()).toBe(1);
    f.close();
  });
  it('cancels all scheduled display work while hidden and refreshes once on return', () => {
    const f = fixture();
    f.change(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5 * 60_000);
    expect(f.tick).toHaveBeenCalledTimes(1);
    f.change(true);
    expect(localMinuteText(f.tick.mock.calls[1]![0])).toBe('00:04');
    expect(vi.getTimerCount()).toBe(1);
    f.close();
  });
  it('does not schedule hidden initial pages and disposes listeners/timers', () => {
    const f = fixture(false);
    expect(f.tick).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    f.change(true);
    expect(f.tick).toHaveBeenCalledTimes(1);
    f.close();
    f.change(true);
    vi.advanceTimersByTime(120_000);
    expect(f.tick).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reads the authoritative wall clock after a system-time change without duplicate timers', () => {
    const f = fixture();
    vi.setSystemTime(new Date(2026, 8, 6, 10, 2));
    f.change(true);
    f.change(true);
    expect(localMinuteText(f.tick.mock.lastCall![0])).toBe('10:02');
    expect(vi.getTimerCount()).toBe(1);
    f.close();
  });
});
