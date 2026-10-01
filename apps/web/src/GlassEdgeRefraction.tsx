import { useEffect, useRef } from 'react';
import { glassEdgeOffset, subscribeGlassWorldFrames } from './glass-refraction';

/** Capture four narrow edge bands while the source back buffer is valid, then bend
 * their 2D copies. No full-frame readback, extra WebGL context or independent rAF. */
export function GlassEdgeRefraction({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!active || !canvas) return;
    const ctx = canvas.getContext('2d');
    const panel = canvas.parentElement;
    if (!ctx || !panel) { canvas.dataset.glassFallback = 'true'; return; }
    const transparency = matchMedia('(prefers-reduced-transparency: reduce)');
    const vertical = document.createElement('canvas'), horizontal = document.createElement('canvas');
    const vc = vertical.getContext('2d'), hc = horizontal.getContext('2d');
    if (!vc || !hc) { canvas.dataset.glassFallback = 'true'; return; }
    let lastPaint = -Infinity;
    let failed = false;
    const clear = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); lastPaint = -Infinity; };
    transparency.addEventListener('change', clear);
    const unsubscribe = subscribeGlassWorldFrames((source, now) => {
      if (failed || transparency.matches || document.hidden || now - lastPaint < 32
        || !source.closest('.world-screen')?.contains(canvas)) return;
      const rect = panel.getBoundingClientRect(), world = source.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || world.width <= 0 || world.height <= 0) return;
      const width = Math.ceil(rect.width), height = Math.ceil(rect.height), edge = Math.min(24, width / 8, height / 8);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      ctx.clearRect(0, 0, width, height);
      const sx = source.width / world.width, sy = source.height / world.height;
      const padding = Math.ceil(edge * .7) + 1, band = Math.ceil(edge + padding * 2);
      if (vertical.width !== band * 2 || vertical.height !== height) { vertical.width = band * 2; vertical.height = height; }
      if (horizontal.width !== width || horizontal.height !== band * 2) { horizontal.width = width; horizontal.height = band * 2; }
      vc.clearRect(0, 0, vertical.width, vertical.height); hc.clearRect(0, 0, horizontal.width, horizontal.height);
      // Clipped bands also handle safe-area offsets and a partially off-screen panel.
      const capture = (target: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tx: number, ty: number) => {
        const ax = rect.left - world.left + x, ay = rect.top - world.top + y;
        const left = Math.max(0, ax), top = Math.max(0, ay);
        const right = Math.min(world.width, ax + w), bottom = Math.min(world.height, ay + h);
        if (right <= left || bottom <= top) return;
        target.drawImage(source, left * sx, top * sy, (right - left) * sx, (bottom - top) * sy,
          tx + left - ax, ty + top - ay, right - left, bottom - top);
      };
      try {
        const started = performance.now();
        // Four GPU→2D copies per presentation sample, not one readback per pixel strip.
        capture(vc, -padding, 0, band, height, 0, 0);
        capture(vc, width - edge - padding, 0, band, height, band, 0);
        capture(hc, 0, -padding, width, band, 0, 0);
        capture(hc, 0, height - edge - padding, width, band, 0, band);
        // The overlay samples the world only. Foreground UI remains in the original DOM.
        for (let d = 0; d < edge; d++) {
          const bend = glassEdgeOffset(d, edge);
          ctx.globalAlpha = .85 * (1 - d / edge) ** 1.5;
          const middle = Math.max(1, height - edge * 2);
          ctx.drawImage(vertical, padding + d - bend, edge, 1, middle, d, edge, 1, middle);
          ctx.drawImage(vertical, band + edge + padding - d - 1 + bend, edge, 1, middle, width - d - 1, edge, 1, middle);
          ctx.drawImage(horizontal, 0, padding + d - bend, width, 1, 0, d, width, 1);
          ctx.drawImage(horizontal, 0, band + edge + padding - d - 1 + bend, width, 1, 0, height - d - 1, width, 1);
        }
        ctx.globalAlpha = 1;
        canvas.dataset.glassFrame = String(Number(canvas.dataset.glassFrame ?? 0) + 1);
        canvas.dataset.glassSourceFrame = source.dataset.renderFrameCount ?? '';
        canvas.dataset.glassPaintMs = (performance.now() - started).toFixed(2);
        canvas.dataset.glassCapturePixels = String(vertical.width * vertical.height + horizontal.width * horizontal.height);
        lastPaint = now;
      } catch {
        // Unsupported/tainted drawImage retains the original readable CSS glass.
        failed = true; clear(); canvas.dataset.glassFallback = 'true';
      }
    });
    return () => { unsubscribe(); transparency.removeEventListener('change', clear); clear(); vertical.width = horizontal.width = 0; };
  }, [active]);
  return active ? <canvas ref={ref} className="glass-edge-refraction" aria-hidden="true"/> : null;
}
