export const ICON_MOTION_MS = 900;
export interface IconPartMotion { keyframes: Keyframe[]; delay: number; duration: number; origin: string }

/** Same rhythm as navigation, but only inside the clicked control. */
export function iconPartMotion(name: string, part = ''): IconPartMotion | null {
  const row = Number(/-(\d)$/.exec(part)?.[1] ?? 0), delay = row * 180;
  const motion = (keyframes: Keyframe[], origin = '6px 6px', stagger = false): IconPartMotion =>
    ({ keyframes, delay: stagger ? delay : 0, duration: ICON_MOTION_MS - (stagger ? delay : 0), origin });
  if (name === 'tasks') {
    if (part.startsWith('task-box')) return motion([{ opacity: .15 }, { opacity: 1 }], '6px 6px', true);
    if (part.startsWith('task-line')) return motion([{ transform: 'scaleX(.05)', opacity: .15 }, { transform: 'scaleX(1)', opacity: 1 }], '5px 0', true);
  }
  if (name === 'clock' && ['hour','minute'].includes(part))
    return motion([{ transform: 'rotate(0deg)' }, { transform: `rotate(${part === 'hour' ? 360 : 4320}deg)` }], '5.5px 5.5px');
  if (name === 'gear' && part === 'outer') return motion([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }]);
  if (name === 'chart' && part.startsWith('bar-')) return motion([{ transform: 'scaleY(.06)' }, { transform: 'scaleY(1)' }], '0 9px', true);
  if (part) return null;
  if (name === 'plus') return motion([{ transform: 'scale(.65) rotate(-90deg)' }, { transform: 'scale(1.12) rotate(0deg)', offset: .65 }, { transform: 'scale(1)' }]);
  if (name === 'edit') return motion([{ transform: 'rotate(0deg)' }, { transform: 'translate(1px,-1px) rotate(-12deg)', offset: .35 }, { transform: 'translate(-.5px,.5px) rotate(5deg)', offset: .7 }, { transform: 'none' }], '50% 50%');
  if (name === 'brand') return motion([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(2px) scale(1.16,.82)', offset: .15 }, { transform: 'translateY(-5px) scale(.86,1.12)', offset: .4 }, { transform: 'translateY(1px) scale(1.06,.94)', offset: .7 }, { transform: 'none' }], '50% 100%');
  if (name === 'play') return motion([{ transform: 'translateX(-2px) scale(.8)' }, { transform: 'translateX(1px) scale(1.05)', offset: .65 }, { transform: 'none' }]);
  if (name === 'flag') return motion([{ transform: 'skewX(0deg)' }, { transform: 'skewX(-12deg)', offset: .3 }, { transform: 'skewX(7deg)', offset: .6 }, { transform: 'none' }], '3px 10px');
  if (name === 'calendar' || name === 'map') return motion([{ transform: 'scaleX(.7)' }, { transform: 'scaleX(1.08)', offset: .6 }, { transform: 'scaleX(1)' }]);
  if (name === 'chest') return motion([{ transform: 'translateY(0px)' }, { transform: 'translateY(-2px)', offset: .35 }, { transform: 'translateY(0px)', offset: .7 }, { transform: 'none' }]);
  return null; // Refresh, destructive controls and busy indicators keep their own meaning.
}

export function installButtonIconMotion(host: Document): () => void {
  const active = new Map<SVGElement, Animation[]>();
  const stop = () => { active.forEach(list => list.forEach(animation => animation.cancel())); active.clear(); };
  const click = (event: Event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (!button || button.disabled || button.getAttribute('aria-busy') === 'true' || button.closest('.bottom-nav')
      || !button.closest('.app-shell,.dialog-backdrop') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const icon of button.querySelectorAll<SVGElement>('[data-pixel-icon]')) {
      active.get(icon)?.forEach(animation => animation.cancel());
      const parts = icon.dataset.pixelIcon === 'brand' ? [] : [...icon.querySelectorAll<SVGElement>('[data-icon-part]')];
      const motions: Animation[] = [];
      for (const target of parts.length ? parts : [icon]) {
        const spec = iconPartMotion(icon.dataset.pixelIcon ?? '', target === icon ? '' : target.dataset.iconPart);
        if (!spec || typeof target.animate !== 'function') continue;
        target.style.transformBox = 'view-box'; target.style.transformOrigin = spec.origin;
        motions.push(target.animate(spec.keyframes, { duration: spec.duration, delay: spec.delay, easing: 'cubic-bezier(.2,.7,.3,1)' }));
      }
      if (motions.length) {
        active.set(icon, motions);
        void Promise.allSettled(motions.map(animation => animation.finished)).then(() => { if (active.get(icon) === motions) active.delete(icon); });
      }
    }
  };
  const hidden = () => { if (host.hidden) stop(); };
  host.addEventListener('click', click, true); host.addEventListener('visibilitychange', hidden);
  return () => { host.removeEventListener('click', click, true); host.removeEventListener('visibilitychange', hidden); stop(); };
}
