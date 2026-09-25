export interface ImmersiveControlsState {
  controlsVisible: boolean;
  controlsLeaving: boolean;
  hintVisible: boolean;
  idleExitRevealed: boolean;
  breakControlsRevealed: boolean;
}
export const initialImmersiveControls = (): ImmersiveControlsState => ({
  controlsVisible: false, controlsLeaving: false, hintVisible: false,
  idleExitRevealed: false, breakControlsRevealed: false,
});

/** Presentation only: this controller cannot start, interrupt or settle a focus. */
export function createImmersiveControls(ports: {
  now(): number;
  schedule(callback: () => void, delay: number): number;
  cancel(timer: number): void;
  changed(state: ImmersiveControlsState): void;
}) {
  let state = initialImmersiveControls();
  let active = true;
  let sessionId: string | null = null;
  let lastTap: { time: number; x: number; y: number } | null = null;
  const timers = new Map<string, number>();
  const update = (next: Partial<ImmersiveControlsState>) => {
    if (!active) return;
    state = { ...state, ...next };
    ports.changed(state);
  };
  const clear = (key: string) => {
    const timer = timers.get(key);
    if (timer !== undefined) ports.cancel(timer);
    timers.delete(key);
  };
  const later = (key: string, delay: number, callback: () => void) => {
    clear(key);
    timers.set(key, ports.schedule(() => {
      timers.delete(key);
      if (active) callback();
    }, delay));
  };
  const clearAll = () => { for (const key of timers.keys()) clear(key); };
  const hideControls = () => {
    clear('reveal'); clear('hide');
    update({ controlsLeaving: true });
    later('fade', 180, () => update({ controlsVisible: false, controlsLeaving: false }));
  };
  return {
    get state() { return state; },
    activate() {
      clearAll(); active = true; sessionId = null; lastTap = null;
      update(initialImmersiveControls());
    },
    resetSession(next: string | null) {
      if (!active || sessionId === next) return;
      sessionId = next;
      clearAll();
      lastTap = null;
      update({ controlsVisible: false, controlsLeaving: false, hintVisible: next !== null });
      if (next) later('hint', 3800, () => update({ hintVisible: false }));
    },
    resetIdleExit() { lastTap = null; update({ idleExitRevealed: false }); },
    resetBreakExit() { lastTap = null; update({ breakControlsRevealed: false }); },
    hideControls,
    tap(input: { x: number; y: number; onButton: boolean; minimalIdle: boolean; minimalBreak: boolean }) {
      if (!active || input.onButton) return;
      const now = ports.now();
      const previous = lastTap;
      lastTap = { time: now, x: input.x, y: input.y };
      if (!previous || now - previous.time >= 450 || Math.hypot(input.x - previous.x, input.y - previous.y) >= 48) return;
      lastTap = null;
      if (input.minimalBreak) { update({ breakControlsRevealed: !state.breakControlsRevealed }); return; }
      if (!sessionId) {
        if (input.minimalIdle) update({ idleExitRevealed: !state.idleExitRevealed });
        return;
      }
      if (state.controlsVisible) hideControls();
      else later('reveal', 250, () => {
        clear('fade');
        update({ controlsVisible: true, controlsLeaving: false });
        later('hide', 5000, hideControls);
      });
    },
    dispose() { active = false; clearAll(); lastTap = null; },
  };
}
