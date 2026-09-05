export interface PointerPoint {
  x: number;
  y: number;
}

export interface OwnedPointerMove {
  previous: PointerPoint;
  current: PointerPoint;
}

export interface ReleasedPointer {
  start: PointerPoint;
  current: PointerPoint;
  wasOnlyPointer: boolean;
}

/**
 * Pure ownership and stale-release state for renderer pointers. DOM capture is
 * deliberately outside this class, so system cancellation and long-frame
 * recovery can be tested without WebGL or browser timing.
 */
export class PointerOwnership {
  readonly #owned = new Map<number, { start: PointerPoint; current: PointerPoint }>();
  #staleAtMs: number | null = null;

  constructor(readonly staleWindowMs = 2_500) {}

  get count(): number { return this.#owned.size; }
  get active(): boolean { return this.#owned.size > 0; }
  get staleAtMs(): number | null { return this.#staleAtMs; }

  begin(pointerId: number, point: PointerPoint, nowMs: number): boolean {
    const wasEmpty = this.#owned.size === 0;
    this.#owned.set(pointerId, { start: { ...point }, current: { ...point } });
    this.#staleAtMs = nowMs + this.staleWindowMs;
    return wasEmpty;
  }

  move(pointerId: number, point: PointerPoint, nowMs: number): OwnedPointerMove | null {
    const owned = this.#owned.get(pointerId);
    if (!owned) return null;
    const previous = { ...owned.current };
    owned.current = { ...point };
    this.#staleAtMs = nowMs + this.staleWindowMs;
    return { previous, current: { ...owned.current } };
  }

  release(pointerId: number): ReleasedPointer | null {
    const owned = this.#owned.get(pointerId);
    if (!owned) return null;
    const wasOnlyPointer = this.#owned.size === 1;
    this.#owned.delete(pointerId);
    if (this.#owned.size === 0) this.#staleAtMs = null;
    return { start: { ...owned.start }, current: { ...owned.current }, wasOnlyPointer };
  }

  clear(): boolean {
    const hadPointers = this.#owned.size > 0;
    this.#owned.clear();
    this.#staleAtMs = null;
    return hadPointers;
  }

  releaseIfStale(nowMs: number): boolean {
    if (this.#staleAtMs === null || nowMs <= this.#staleAtMs) return false;
    return this.clear();
  }

  points(): readonly PointerPoint[] {
    return [...this.#owned.values()].map((entry) => ({ ...entry.current }));
  }
}

export interface FrameRequestSchedulerOptions {
  requestFrame: (callback: (nowMs: number) => void) => number;
  cancelFrame: (frameId: number) => void;
  now: () => number;
  canRender: () => boolean;
  render: (frameStartedAtMs: number) => boolean;
}

/** One-slot frame pump. `render` returns true only when another frame is due. */
export class FrameRequestScheduler {
  #frameId: number | null = null;
  #disposed = false;

  constructor(readonly options: FrameRequestSchedulerOptions) {}

  get pending(): boolean { return this.#frameId !== null; }

  request(): boolean {
    if (this.#disposed || this.#frameId !== null || !this.options.canRender()) return false;
    this.#frameId = this.options.requestFrame(() => {
      this.#frameId = null;
      if (this.#disposed || !this.options.canRender()) return;
      if (this.options.render(this.options.now())) this.request();
    });
    return true;
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#frameId !== null) this.options.cancelFrame(this.#frameId);
    this.#frameId = null;
  }
}
