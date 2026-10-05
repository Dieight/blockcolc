import { useLayoutEffect, useRef } from 'react';

/** Reframe without scaling the canvas. Its pixels always retain their aspect ratio. */
export function usePresentationTransition(immersive: boolean) {
  const shell = useRef<HTMLDivElement>(null);
  const previous = useRef<{ immersive: boolean; rect: DOMRect } | null>(null);
  const animations = useRef<Animation[]>([]);
  const generation = useRef(0);
  const observed = useRef<{ world: HTMLElement; observer: ResizeObserver } | null>(null);
  useLayoutEffect(() => {
    const root = shell.current;
    const world = root?.querySelector<HTMLElement>('.world-stage');
    if (observed.current?.world !== world) {
      observed.current?.observer.disconnect();
      observed.current = null;
      previous.current = null;
      animations.current.forEach(animation => animation.cancel());
      if (world) {
        const observer = new ResizeObserver(() => {
          const rect = world.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && previous.current && !animations.current.some(animation => animation.playState === 'running')) {
            previous.current = { immersive: previous.current.immersive, rect };
          }
        });
        observer.observe(world);
        observed.current = { world, observer };
      }
    }
    if (!root || !world) return;
    const next = world.getBoundingClientRect();
    // Inactive routes keep the world mounted but have no layout. Do not let a
    // settings visit replace the last visible frame with a zero-sized rectangle.
    if (next.width <= 0 || next.height <= 0) return;
    const old = previous.current;
    previous.current = { immersive, rect: next };
    if (!old || old.immersive === immersive) return;
    animations.current.forEach(animation => animation.cancel());
    const owner = ++generation.current;
    root.dataset.presentationTransition = immersive ? 'to-immersive' : 'to-standard';
    root.dataset.presentationTransitionCount = String(Number(root.dataset.presentationTransitionCount ?? 0) + 1);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !world.animate) {
      root.dataset.presentationTransition = 'complete'; return;
    }
    const options: KeyframeAnimationOptions = { duration: 340, easing: 'cubic-bezier(.2,.7,.2,1)' };
    const panel = root.querySelector<HTMLElement>('.focus-panel');
    // Only the workbench face changes. No travelling sheen, clipping or motion
    // is applied to the resident world, and its exposure/opacity stay intact.
    const enter = panel?.animate([{ opacity: .15, transform: `translateY(${immersive ? 12 : -10}px)` }, { opacity: 1, transform: 'none' }], options);
    animations.current = enter ? [enter] : [];
    void Promise.all(animations.current.map(animation => animation.finished.catch(() => {}))).then(() => {
      if (generation.current === owner) root.dataset.presentationTransition = 'complete';
    });
    // A first task or restored workspace can mount the world without changing
    // mode. Sample every commit so its first ordinary frame is available later.
  });
  useLayoutEffect(() => {
    const cancel = () => animations.current.forEach(animation => animation.cancel());
    const root = shell.current;
    root?.addEventListener('pointerdown', cancel, { passive: true });
    return () => { root?.removeEventListener('pointerdown', cancel); observed.current?.observer.disconnect(); observed.current = null; cancel(); };
  }, []);
  return shell;
}
