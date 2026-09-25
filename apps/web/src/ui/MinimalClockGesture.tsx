import { useRef, useState } from 'react';
import { FocusTimer } from '../FocusTimer';

/** Five-minute steps, minute-aligned, bounded to the next 24 hours. No persistence. */
export function shiftClockSelection(current: number | null, steps: number, now: number): number | null {
  const base = current ?? Math.floor(now / 60_000) * 60_000;
  const candidate = base + steps * 5 * 60_000;
  // Returning to now leaves the draft entirely; it is not a one-minute plan.
  return candidate <= now ? null : Math.min(Math.floor((now + 24 * 60 * 60_000) / 60_000) * 60_000, candidate);
}

export function MinimalClockGesture({ clockText, busy, onConfirm }: {
  clockText: string; busy: boolean; onConfirm: (endMs: number) => void;
}) {
  const [selection, setSelection] = useState<number | null>(null);
  const drag = useRef<{ id: number; x:number; y: number; base: number | null; moved: boolean; axis: 'horizontal' | 'vertical' | null } | null>(null);
  const tap = useRef<{ at: number; x: number; y: number } | null>(null);
  const selected = selection === null ? null : new Date(selection);
  const text = selected ? `${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}` : clockText;
  const day = selected?.toDateString() === new Date().toDateString() ? '今天' : '明天';
  return <div className="minimal-clock-gesture" role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy}
    aria-label={selected ? `专注到${day} ${text}，双击或按 Enter 开始专注` : `当前时间 ${text}，上下滑动或按方向键选择结束时间`}
    onPointerDown={event => {
      event.stopPropagation();
      if (busy || !event.isPrimary || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id:event.pointerId, x:event.clientX, y:event.clientY, base:selection, moved:false, axis:null };
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (!start || start.id !== event.pointerId || busy) return;
      const delta = start.y - event.clientY;
      const dx = event.clientX - start.x;
      if (start.axis === null && Math.max(Math.abs(dx), Math.abs(delta)) >= 12)
        start.axis = Math.abs(dx) > Math.abs(delta) * 1.25 ? 'horizontal' : 'vertical';
      if (start.axis === 'horizontal') { start.moved = true; tap.current = null; return; }
      if (start.axis !== 'vertical') return;
      start.moved = true; tap.current = null;
      setSelection(shiftClockSelection(start.base, Math.round(delta / 12), Date.now()));
    }}
    onPointerCancel={() => { drag.current = null; tap.current = null; }}
    onPointerUp={event => {
      event.stopPropagation();
      const start = drag.current; drag.current = null;
      if (!start || start.id !== event.pointerId || start.moved || busy) return;
      const now = performance.now(); const previous = tap.current;
      tap.current = { at:now, x:event.clientX, y:event.clientY };
      if (previous && now - previous.at < 450 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 48) {
        tap.current = null;
        if (selection !== null) onConfirm(selection);
      }
    }}
    onKeyDown={event => {
      if (busy) return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); setSelection(value => shiftClockSelection(value, event.key === 'ArrowUp' ? 1 : -1, Date.now()));
      } else if (event.key === 'Escape') { event.preventDefault(); setSelection(null); tap.current = null; }
      else if ((event.key === 'Enter' || event.key === ' ') && selection !== null) { event.preventDefault(); if (!event.repeat) onConfirm(selection); }
    }}>
    <FocusTimer mode="clock" clockText={text} fallbackMs={0} onElapsed={() => {}}/>
    {selected && <span className="minimal-clock-selection" aria-hidden="true">{day}结束 · 双击确认</span>}
  </div>;
}
