import { useEffect, useRef, useState } from 'react';
import { formatClockDuration } from './focus-format';

type FocusTimerMode = 'plan' | 'focus' | 'break' | 'ready' | 'marathon' | 'clock';

export function FocusTimer({ mode, endsAt, fallbackMs, marathonRemainingMs, clockText, timerClassName, onElapsed }: { mode?: FocusTimerMode; endsAt?: string; fallbackMs: number; marathonRemainingMs?: number; clockText?: string; timerClassName?: string; onElapsed: () => void }) {
  const [now, setNow] = useState(Date.now());
  const elapsed = useRef(false);
  useEffect(() => {
    if (!endsAt) return;
    elapsed.current = false;
    const tick = () => {
      const next = Date.now();
      setNow(next);
      if (next >= Date.parse(endsAt) && !elapsed.current) {
        elapsed.current = true;
        onElapsed();
      }
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [endsAt, onElapsed]);
  const remaining = endsAt ? Math.max(0, Date.parse(endsAt) - now) : fallbackMs;
  const timerMode = mode ?? (endsAt ? 'focus' : 'ready');
  const displayMs = timerMode === 'marathon' && marathonRemainingMs !== undefined ? marathonRemainingMs : remaining;
  const label = timerMode === 'clock' ? '当前时间' : timerMode === 'plan' ? '每轮时长' : timerMode === 'break' ? '休息中' : timerMode === 'ready' ? '剩余专注总时间' : timerMode === 'marathon' ? (marathonRemainingMs !== undefined ? '剩余总时长' : '距结束') : '本轮剩余';
  const clock = timerMode === 'clock' && clockText ? clockText : formatClockDuration(displayMs);
  return <div className={`timer timer-${timerMode}${timerClassName ? ` ${timerClassName}` : ''}`} role={endsAt ? 'timer' : undefined} aria-label={`${label} ${clock}`}>
    <span className="timer-label">{label}</span>
    <strong className="timer-value" aria-hidden="true">{clock}</strong>
  </div>;
}
