import { useRef, type ReactNode } from 'react';
import { markFocusPerformance } from '../focus-performance';

export function MinimalBreakClock({ children, busy, phase = 'break', onContinue }: {
  children: ReactNode; busy: boolean; phase?: 'break' | 'ready'; onContinue: () => void;
}) {
  const down = useRef<{ id:number; x:number; y:number; moved:boolean } | null>(null);
  const tap = useRef<{ time:number; x:number; y:number } | null>(null);
  return <div className={`minimal-break-clock${phase === 'ready' ? ' minimal-ready-clock' : ''}`} role="button" tabIndex={0} aria-disabled={busy}
    aria-label={phase === 'ready' ? '计划待继续：双击剩余专注总时间或按 Enter 开始下一轮' : '双击休息中计时或按 Enter 跳过休息并继续专注'}
    onPointerDown={event => {
      event.stopPropagation();
      if (!busy && event.isPrimary && event.button === 0) down.current = { id:event.pointerId, x:event.clientX, y:event.clientY, moved:false };
    }}
    onPointerMove={event => {
      if (down.current && Math.hypot(event.clientX - down.current.x, event.clientY - down.current.y) >= 12) down.current.moved = true;
    }}
    onPointerCancel={() => { down.current = null; tap.current = null; }}
    onPointerUp={event => {
      event.stopPropagation(); const start = down.current; down.current = null;
      if (!start || start.id !== event.pointerId || start.moved || busy) { tap.current = null; return; }
      const now = performance.now(); const previous = tap.current;
      tap.current = { time:now, x:event.clientX, y:event.clientY };
      if (previous && now - previous.time < 450 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 48) {
        tap.current = null; markFocusPerformance('gesture-confirmed'); onContinue();
      }
    }}
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!busy && !event.repeat) onContinue(); }
    }}>{children}</div>;
}
