import { useCallback, useEffect, useMemo, useState } from 'react';
import { createImmersiveControls, initialImmersiveControls } from './immersive-controls';

export function useImmersiveControls(sessionId: string | null, minimalIdle: boolean, minimalBreak: boolean) {
  const [state, setState] = useState(initialImmersiveControls);
  const controls = useMemo(() => createImmersiveControls({
    now: () => performance.now(),
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: timer => window.clearTimeout(timer),
    changed: setState,
  }), []);
  useEffect(() => { controls.activate(); return () => controls.dispose(); }, [controls]);
  useEffect(() => { controls.resetSession(sessionId); }, [controls, sessionId]);
  useEffect(() => { if (minimalIdle) controls.resetIdleExit(); }, [controls, minimalIdle]);
  useEffect(() => { if (minimalBreak) controls.resetBreakExit(); }, [controls, minimalBreak]);
  const handlePanelTap = useCallback((event: { target: EventTarget | null; clientX: number; clientY: number }) => {
    controls.tap({
      x: event.clientX, y: event.clientY,
      onButton: event.target instanceof Element && event.target.closest('button') !== null,
      minimalIdle, minimalBreak,
    });
  }, [controls, minimalIdle, minimalBreak]);
  return { ...state, handlePanelTap, hideControls: controls.hideControls };
}
