import { useEffect, useState } from 'react';
import { localMinuteText, subscribeForegroundMinuteClock } from './foreground-minute-clock';

/** Enable only for the visible minimal idle surface, never a running countdown. */
export function useLocalMinuteClock(enabled: boolean): string {
  const [text, setText] = useState(() => localMinuteText(Date.now()));
  useEffect(() => {
    if (!enabled) return;
    return subscribeForegroundMinuteClock({
      now: () => Date.now(),
      visible: () => !document.hidden,
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: handle => window.clearTimeout(handle),
      subscribeVisibility: callback => {
        document.addEventListener('visibilitychange', callback);
        window.addEventListener('focus', callback);
        return () => {
          document.removeEventListener('visibilitychange', callback);
          window.removeEventListener('focus', callback);
        };
      },
    }, now => setText(localMinuteText(now)));
  }, [enabled]);
  return text;
}
