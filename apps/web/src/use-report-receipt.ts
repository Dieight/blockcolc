import { useCallback, useEffect, useRef, useState } from 'react';

export const REPORT_RECEIPT_MS = 2000;

/** One receipt lifetime, started after a painted acknowledgement, not before persistence. */
export function useReportReceipt() {
  const [delivered, setDelivered] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const acknowledge = useCallback(() => new Promise<void>(resolve => {
    cleanup.current?.();
    setDelivered(true);
    let frame = 0, timer = 0, settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.cancelAnimationFrame(frame); window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      cleanup.current = null; resolve();
    };
    const onVisibility = () => { if (document.hidden) finish(); };
    // Two frames put the deadline after a paint opportunity, even if the first
    // frame also adopts/rebuilds the world and blocks the main thread briefly.
    // A hidden page cannot paint, so complete presentation without blocking a saved command.
    if (document.hidden) { finish(); return; }
    document.addEventListener('visibilitychange', onVisibility);
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        timer = window.setTimeout(finish, REPORT_RECEIPT_MS);
      });
    });
    cleanup.current = finish;
  }), []);
  return { delivered, acknowledge };
}
