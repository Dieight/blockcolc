import { useRef, useState } from 'react';
import { FocusTimer } from '../FocusTimer';
import { minimalRoundThresholdCrossings } from '../minimal-focus';

/** A whole round adds a distinct, bounded drag detent, shared by all time pickers. */
export function minimalRoundDetentOffsetPx(crossedThresholdCount: number): number {
  return Math.min(12, Math.max(0, Math.floor(crossedThresholdCount))) * 18;
}

/** Resistance may stop a drag, but must never reverse its direction. */
export function clockDragSteps(deltaPx: number, detentPx: number): number {
  return Math.sign(deltaPx) * Math.round(Math.max(0, Math.abs(deltaPx) - detentPx) / 12);
}

/** Five-minute steps, minute-aligned, bounded to the next 24 hours. No persistence. */
export function shiftClockSelection(current: number | null, steps: number, now: number): number | null {
  const base = current ?? Math.floor(now / 60_000) * 60_000;
  const candidate = base + steps * 5 * 60_000;
  // Returning to now leaves the draft entirely; it is not a one-minute plan.
  return candidate <= now ? null : Math.min(Math.floor((now + 24 * 60 * 60_000) / 60_000) * 60_000, candidate);
}

export function MinimalClockGesture({ clockText, busy, focusMinutes = 25, breakMinutes = 5, onConfirm, value, onChange, confirmation = 'double-tap', clockOnly = false, ariaLabel }: {
  clockText: string; busy: boolean; focusMinutes?: number; breakMinutes?: number; onConfirm?: (endMs: number) => void;
  value?: number | null; onChange?: (endMs: number | null) => void; confirmation?: 'double-tap' | 'button';
  clockOnly?: boolean; ariaLabel?: string;
}) {
  const [localSelection, setLocalSelection] = useState<number | null>(null);
  const selection = value === undefined ? localSelection : value;
  const setSelection = (next: number | null | ((previous: number | null) => number | null)) => {
    const resolved = typeof next === 'function' ? next(selection) : next;
    if (value === undefined) setLocalSelection(resolved);
    onChange?.(resolved);
  };
  const drag = useRef<{ id: number; x:number; y: number; lastY: number; base: number | null; lastSelection: number | null; feedbackRounds: Set<number>; detentRounds: Set<number>; detentPx: number; direction: -1 | 0 | 1; moved: boolean; axis: 'horizontal' | 'vertical' | null } | null>(null);
  const tap = useRef<{ at: number; x: number; y: number } | null>(null);
  const selected = selection === null ? null : new Date(selection);
  const text = selected ? `${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}` : clockText;
  const day = !selected || selected.toDateString() === new Date().toDateString() ? '今天' : '明天';
  const shift = (base:number|null,steps:number,now:number) => {
    if(!clockOnly)return shiftClockSelection(base,steps,now);
    const date=new Date(base??now);const minutes=((date.getHours()*60+date.getMinutes()+steps*5)%1440+1440)%1440;
    date.setHours(Math.floor(minutes/60),minutes%60,0,0);return date.getTime();
  };
  return <div className="minimal-clock-gesture" role={confirmation === 'button' ? 'slider' : 'button'} tabIndex={busy ? -1 : 0} aria-disabled={busy}
    aria-valuemin={confirmation === 'button' ? 0 : undefined} aria-valuemax={confirmation === 'button' ? clockOnly ? 1439 : 288 : undefined}
    aria-valuenow={confirmation === 'button' ? clockOnly ? (selected?.getHours()??0)*60+(selected?.getMinutes()??0) : Math.max(0, Math.min(288, Math.round(((selection ?? Date.now()) - Date.now()) / 300_000))) : undefined}
    aria-valuetext={confirmation === 'button' ? selected ? `${day} ${text}` : '未选择结束时间' : undefined}
    aria-label={ariaLabel ?? (confirmation === 'button' ? '结束时间，上下滑动或按方向键调整' : selected ? `专注到${day} ${text}，双击或按 Enter 开始专注` : `当前时间 ${text}，上下滑动或按方向键选择结束时间`)}
    onBlur={event => { delete event.currentTarget.dataset.pointerFocus; }}
    onPointerDown={event => {
      event.stopPropagation();
      if (busy || !event.isPrimary || event.button !== 0) return;
      event.currentTarget.dataset.pointerFocus = 'true';
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id:event.pointerId, x:event.clientX, y:event.clientY, lastY:event.clientY, base:selection, lastSelection:selection, feedbackRounds:new Set(), detentRounds:new Set(), detentPx:0, direction:0, moved:false, axis:null };
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (!start || start.id !== event.pointerId || busy) return;
      let delta = start.y - event.clientY;
      const dx = event.clientX - start.x;
      if (start.axis === null && Math.max(Math.abs(dx), Math.abs(delta)) >= 12)
        start.axis = Math.abs(dx) > Math.abs(delta) * 1.25 ? 'horizontal' : 'vertical';
      if (start.axis === 'horizontal') { start.moved = true; tap.current = null; return; }
      if (start.axis !== 'vertical') return;
      start.moved = true; tap.current = null;
      const nowMs = Date.now();
      const previousY = start.lastY;
      const direction = Math.sign(previousY - event.clientY) as -1 | 0 | 1;
      start.lastY = event.clientY;
      if (direction === 0) return;
      if (start.direction !== 0 && direction !== start.direction) {
        // A direction change releases the old detent immediately; reversing
        // never leaves the selection trapped behind accumulated resistance.
        start.detentRounds.clear(); start.detentPx = 0;
        // Rebase on the already displayed selection. Removing resistance must
        // not turn a reverse movement into a jump further forward in time.
        start.base = start.lastSelection;
        start.y = previousY;
        delta = start.y - event.clientY;
      }
      start.direction = direction;
      let next = shift(start.base, clockDragSteps(delta, start.detentPx), nowMs);
      const crossed = clockOnly ? [] : minimalRoundThresholdCrossings(start.lastSelection ?? nowMs, next ?? nowMs, nowMs, focusMinutes, breakMinutes);
      let shouldVibrate = false;
      for (const round of crossed) {
        start.detentRounds.add(round);
        if (!start.feedbackRounds.has(round)) { start.feedbackRounds.add(round); shouldVibrate = true; }
      }
      if (crossed.length > 0) {
        // A five-minute clock tick can cross several sub-five-minute rounds
        // at once. Let that tick feel like one detent, not a wall of stacked
        // resistance that prevents short plans from being selected at all.
        start.detentPx = minimalRoundDetentOffsetPx(focusMinutes < 5
          ? Math.min(1, start.detentRounds.size) : start.detentRounds.size);
        // Re-evaluate after adding resistance: the selection pauses for a
        // short bounded pointer distance instead of jumping through a boundary.
        next = shift(start.base, clockDragSteps(delta, start.detentPx), nowMs);
      }
      if (shouldVibrate) lightRoundFeedback();
      start.lastSelection = next;
      setSelection(next);
    }}
    onPointerCancel={() => { drag.current = null; tap.current = null; }}
    onPointerUp={event => {
      event.stopPropagation();
      const start = drag.current; drag.current = null;
      if (!start || start.id !== event.pointerId || start.moved || busy) return;
      if (confirmation === 'button') return;
      const now = performance.now(); const previous = tap.current;
      tap.current = { at:now, x:event.clientX, y:event.clientY };
      if (previous && now - previous.at < 450 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 48) {
        tap.current = null;
        if (selection !== null) onConfirm?.(selection);
      }
    }}
    onKeyDown={event => {
      delete event.currentTarget.dataset.pointerFocus;
      if (busy) return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); setSelection(value => {
          const nowMs = Date.now();
          const next = shift(value, event.key === 'ArrowUp' ? 1 : -1, nowMs);
          if (!clockOnly && minimalRoundThresholdCrossings(value ?? nowMs, next ?? nowMs, nowMs, focusMinutes, breakMinutes).length > 0) lightRoundFeedback();
          return next;
        });
      } else if (event.key === 'Escape') { event.preventDefault(); setSelection(null); tap.current = null; }
      else if (confirmation === 'double-tap' && (event.key === 'Enter' || event.key === ' ') && selection !== null) { event.preventDefault(); if (!event.repeat) onConfirm?.(selection); }
    }}>
    {confirmation === 'button' ? <strong className="timer-value" aria-hidden="true">{text}</strong>
      : <FocusTimer mode="clock" clockText={text} fallbackMs={0} onElapsed={() => {}}/>}
    {(selected || confirmation === 'button') && <span className="minimal-clock-selection" aria-hidden="true">{clockOnly ? '上下滑动调整' : confirmation === 'button' ? `${selected ? `${day}结束 · ` : ''}上下滑动调整` : `${day}结束 · 双击确认`}</span>}
  </div>;
}

function lightRoundFeedback(): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(16); } catch { /* Drag resistance remains when WebView haptics are denied. */ }
  }
}
