import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { createModeTransition, type ModeDirection } from './mode-transition';

export function useModePortal(shell: RefObject<HTMLDivElement | null>, commit: (minimal: boolean) => void, onFailure: () => void) {
  const callbacks = useRef({ commit, onFailure }); callbacks.current = { commit, onFailure };
  const portal = useRef<ReturnType<typeof createModeTransition> | null>(null);
  useLayoutEffect(() => {
    if (!shell.current) return;
    const motion = createModeTransition(shell.current, minimal => callbacks.current.commit(minimal), () => callbacks.current.onFailure());
    portal.current = motion;
    return () => { motion.dispose(); if (portal.current === motion) portal.current = null; };
  }, [shell]);
  return useCallback((direction: ModeDirection) => { void portal.current?.travel(direction); }, []);
}
