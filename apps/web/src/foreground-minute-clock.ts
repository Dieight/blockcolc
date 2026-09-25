export interface MinuteClockHost {
  now: () => number;
  visible: () => boolean;
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (handle: number) => void;
  subscribeVisibility: (callback: () => void) => () => void;
}

export function localMinuteText(nowMs: number): string {
  const time = new Date(nowMs);
  return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
}

/** Display-only wall clock: no interval, no work while hidden, no timer truth. */
export function subscribeForegroundMinuteClock(host: MinuteClockHost, onMinute: (nowMs: number) => void): () => void {
  let disposed = false;
  let handle: number | undefined;
  const refresh = () => {
    if (handle !== undefined) host.cancel(handle);
    handle = undefined;
    if (disposed || !host.visible()) return;
    const now = host.now();
    onMinute(now);
    if (!disposed && host.visible()) handle = host.schedule(refresh, 60_000 - ((now % 60_000 + 60_000) % 60_000));
  };
  const unsubscribe = host.subscribeVisibility(refresh);
  refresh();
  return () => {
    disposed = true;
    unsubscribe();
    if (handle !== undefined) host.cancel(handle);
  };
}
