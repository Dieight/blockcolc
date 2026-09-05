import { describe, expect, it } from 'vitest';
import { FrameRequestScheduler, PointerOwnership } from '../src/input-frame-scheduler';

describe('PointerOwnership', () => {
  it('releases pointercancel/lost-capture ownership without touching another pointer', () => {
    const pointers = new PointerOwnership();
    pointers.begin(7, { x: 10, y: 20 }, 0);
    pointers.begin(9, { x: 30, y: 40 }, 10);

    const released = pointers.release(7);

    expect(released).toMatchObject({ start: { x: 10, y: 20 }, wasOnlyPointer: false });
    expect(pointers.count).toBe(1);
    expect(pointers.points()).toEqual([{ x: 30, y: 40 }]);
  });

  it('does not let an unrelated pointer id extend the stale deadline', () => {
    const pointers = new PointerOwnership(2_500);
    pointers.begin(7, { x: 0, y: 0 }, 0);

    expect(pointers.move(99, { x: 4, y: 5 }, 2_400)).toBeNull();
    expect(pointers.releaseIfStale(2_501)).toBe(true);
    expect(pointers.active).toBe(false);
  });

  it('survives a long frame when owned movement refreshed the deadline', () => {
    const pointers = new PointerOwnership(2_500);
    pointers.begin(7, { x: 0, y: 0 }, 0);
    expect(pointers.move(7, { x: 12, y: 8 }, 2_400)).toMatchObject({ previous: { x: 0, y: 0 } });

    expect(pointers.releaseIfStale(4_800)).toBe(false);
    expect(pointers.releaseIfStale(4_901)).toBe(true);
  });
});

describe('FrameRequestScheduler', () => {
  it('coalesces requests and schedules a follow-up only after the current frame', () => {
    let now = 10;
    let nextId = 1;
    const callbacks = new Map<number, (nowMs: number) => void>();
    const renderTimes: number[] = [];
    const scheduler = new FrameRequestScheduler({
      requestFrame: (callback) => { const id = nextId++; callbacks.set(id, callback); return id; },
      cancelFrame: (id) => { callbacks.delete(id); },
      now: () => now,
      canRender: () => true,
      render: (time) => { renderTimes.push(time); return renderTimes.length === 1; },
    });

    expect(scheduler.request()).toBe(true);
    expect(scheduler.request()).toBe(false);
    callbacks.get(1)?.(999);
    expect(renderTimes).toEqual([10]);
    expect(callbacks.has(2)).toBe(true);
    now = 25;
    callbacks.get(2)?.(999);
    expect(renderTimes).toEqual([10, 25]);
    expect(scheduler.pending).toBe(false);
  });

  it('does not queue while hidden and cancels an owned frame on dispose', () => {
    let visible = false;
    const callbacks = new Map<number, (nowMs: number) => void>();
    const scheduler = new FrameRequestScheduler({
      requestFrame: (callback) => { callbacks.set(1, callback); return 1; },
      cancelFrame: (id) => { callbacks.delete(id); },
      now: () => 0,
      canRender: () => visible,
      render: () => false,
    });

    expect(scheduler.request()).toBe(false);
    visible = true;
    expect(scheduler.request()).toBe(true);
    scheduler.dispose();
    expect(callbacks.size).toBe(0);
    expect(scheduler.request()).toBe(false);
  });
});
