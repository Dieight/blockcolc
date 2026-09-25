/** One effect owns one renderer. Async continuations must check isCurrent after every await. */
export function startRendererGeneration<M, R extends { dispose(): void }>(ports: {
  schedule(begin: () => void): () => void;
  load(): Promise<M>;
  create(module: M): R | null;
  initialize(renderer: R, isCurrent: () => boolean): Promise<void>;
  ready(): void;
  error(error: unknown): void;
  release(renderer: R): void;
}): () => void {
  let active = true;
  let current: R | null = null;
  const isCurrent = () => active;
  const cancel = ports.schedule(() => {
    if (!active) return;
    void ports.load().then(async module => {
      if (!active) return;
      current = ports.create(module);
      if (!current) return;
      await ports.initialize(current, isCurrent);
      if (active) ports.ready();
    }).catch(error => {
      if (!active) return;
      ports.error(error);
      ports.ready();
    });
  });
  return () => {
    if (!active) return;
    active = false;
    cancel();
    if (current) {
      try { current.dispose(); } finally { ports.release(current); }
    }
  };
}

/** Let the loading surface paint before beginning expensive renderer work. */
export function scheduleAfterPaint(begin: () => void): () => void {
  let timer = 0;
  const frame = requestAnimationFrame(() => { timer = window.setTimeout(begin, 0); });
  return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
}
