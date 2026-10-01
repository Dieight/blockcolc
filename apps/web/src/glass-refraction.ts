/** A curved edge bends the sampled background outwards then returns smoothly to the flat center. */
export function glassEdgeOffset(distance: number, width: number): number {
  if (width <= 0 || distance < 0 || distance >= width) return 0;
  const t = distance / width;
  return width * .7 * Math.sin(Math.PI * t) * (1 - t) ** 2;
}

// A presentation subscription, not a second render loop or a persistent screenshot cache.
const listeners = new Set<(canvas: HTMLCanvasElement, now: number) => void>();
export function subscribeGlassWorldFrames(listener: (canvas: HTMLCanvasElement, now: number) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function publishGlassWorldFrame(canvas: HTMLCanvasElement): void {
  if (!listeners.size) return;
  const now = performance.now();
  for (const listener of listeners) {
    try { listener(canvas, now); }
    catch {
      // A presentation-only consumer must never interrupt the main world's
      // frame scheduling. Drop a broken subscriber; CSS glass remains usable.
      listeners.delete(listener);
    }
  }
}
