/** Review-only choreography. It never mounts, resizes, or replaces the world. */
export type ReviewMotion = 'clock' | 'hinge' | 'weave';
export const REVIEW_MOTIONS = [
  { id: 'clock', label: '时钟迁移', duration: 1400 },
  { id: 'hinge', label: '玻璃折页', duration: 1600 },
  { id: 'weave', label: '层片重组', duration: 1550 },
] as const;
type Mode = 'normal' | 'minimal';
const ease = 'cubic-bezier(.22,.72,.18,1)';

export function createModeMotion(root: HTMLElement, style: ReviewMotion = 'clock', duration = 1400) {
  const pick = (selector: string) => {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing motion element: ${selector}`);
    return element;
  };
  const glass = pick('.motion-glass'), clock = pick('.motion-clock');
  const toggle = pick('.motion-toggle'), topbar = pick('.motion-topbar');
  const nav = [...root.querySelectorAll<HTMLElement>('.motion-nav-item')];
  const normal = [...root.querySelectorAll<HTMLElement>('.motion-normal-part')];
  const minimal = [...root.querySelectorAll<HTMLElement>('.motion-minimal-part')];
  const normalLabel = pick('.motion-normal-label'), minimalLabel = pick('.motion-minimal-label');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let mode: Mode = root.dataset.mode === 'minimal' ? 'minimal' : 'normal';
  let desired = mode, active = false, disposed = false, generation = 0;
  let animations: Animation[] = [], timers: ReturnType<typeof setTimeout>[] = [], layers: HTMLElement[] = [];
  const announce = () => root.dispatchEvent(new CustomEvent('motion:state', { detail: { mode, active, desired } }));
  function clean() {
    animations.forEach(animation => animation.cancel()); animations = [];
    timers.forEach(timer => clearTimeout(timer)); timers = [];
    layers.forEach(layer => layer.remove()); layers = [];
  }
  function settle(next: Mode) {
    mode = next; root.dataset.mode = next;
    root.dataset.motionActive = 'false'; root.dataset.motionPhase = 'idle';
    topbar.inert = next === 'minimal';
    pick('.motion-nav').inert = next === 'minimal';
    normal.forEach(part => { part.inert = next === 'minimal'; });
    minimal.forEach(part => { part.inert = next === 'normal'; });
    toggle.setAttribute('aria-label', next === 'minimal' ? '返回完整模式' : '进入极简模式');
    active = false; announce();
  }
  function animate(element: HTMLElement, frames: Keyframe[]) {
    // Ease each leg, not the whole timeline: otherwise a 1.6 s sequence reaches
    // its final layout halfway through and spends the rest looking stationary.
    const animation = element.animate(frames.map(frame => ({ ...frame, easing: frame.easing ?? ease })),
      { duration, easing: 'linear', fill: 'both' });
    animations.push(animation); return animation;
  }
  function fadePart(element: HTMLElement, incoming: boolean, index: number, sign: number) {
    const sideways = style === 'weave' ? (index % 2 === 0 ? -22 : 22) : 0;
    const move = `translate(${sideways}px, ${sign * (style === 'hinge' ? 22 : 16)}px)`;
    if (incoming) {
      const start = .58 + index * .055;
      animate(element, [
        { opacity: 0, transform: move, offset: 0 },
        { opacity: 0, transform: move, offset: start },
        { opacity: 1, transform: 'translate(0, -2px)', offset: Math.min(.92, start + .22) },
        { opacity: 1, transform: 'none', offset: 1 },
      ]);
    } else animate(element, [
      { opacity: 1, transform: 'none', offset: 0 },
      { opacity: 1, transform: 'none', offset: index * .035 },
      { opacity: 0, transform: move, offset: .23 + index * .035 },
      { opacity: 0, transform: move, offset: 1 },
    ]);
  }
  function sheet(className: string, left: number, top: number, width: number, height: number) {
    const layer = document.createElement('div'); layer.className = `motion-sheet ${className}`;
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    root.append(layer); layers.push(layer); return layer;
  }
  async function move(next: Mode) {
    if (disposed || active || next === mode) return;
    if (reduced.matches) { settle(next); return; }
    const token = ++generation, from = mode, toMinimal = next === 'minimal', sign = toMinimal ? 1 : -1;
    const beforeClock = clock.getBoundingClientRect(), beforeGlass = glass.getBoundingClientRect();
    const beforeAction = toggle.getBoundingClientRect();
    active = true; mode = next; root.dataset.mode = next;
    root.dataset.motionActive = 'true'; root.dataset.motionPhase = 'gather';
    toggle.setAttribute('aria-label', toMinimal ? '返回完整模式' : '进入极简模式');
    // Keep both sets mounted. Outgoing layers finish before incoming layers arrive.
    const afterClock = clock.getBoundingClientRect(), afterGlass = glass.getBoundingClientRect();
    const afterAction = toggle.getBoundingClientRect(), host = root.getBoundingClientRect();
    const dx = beforeClock.left + beforeClock.width / 2 - afterClock.left - afterClock.width / 2;
    const dy = beforeClock.top + beforeClock.height / 2 - afterClock.top - afterClock.height / 2;
    const scale = beforeClock.width / afterClock.width;
    const pose = (x: number, y: number, s: number, rotation = 0) =>
      `translate(calc(-50% + ${x}px), ${y}px) scale(${s}) rotate(${rotation}deg)`;
    const clockFrames: Keyframe[] = style === 'clock' ? [
      { transform: pose(dx, dy, scale), offset: 0 },
      { transform: pose(dx, dy - 8, scale), offset: .15 },
      { transform: pose(dx - 18 * sign, dy * .55 - 24, scale + (1 - scale) * .42, -1.2 * sign), offset: .43 },
      { transform: pose(3 * sign, -7, 1.035), offset: .77 },
      { transform: pose(0, 2, .996), offset: .9 },
      { transform: pose(0, 0, 1), offset: 1 },
    ] : [
      { transform: pose(dx, dy, scale), offset: 0 },
      { transform: pose(dx, dy - 18, scale * .97), offset: .27 },
      { transform: pose(dx / 2, dy / 2 - 20, (scale + 1) / 2), offset: .53 },
      { transform: pose(0, -4, 1.02), offset: .8 },
      { transform: pose(0, 0, 1), offset: 1 },
    ];
    animate(clock, clockFrames);
    const glassDy = beforeGlass.top - afterGlass.top, glassScale = beforeGlass.height / afterGlass.height;
    const oldGlass = `translateY(${glassDy}px) scaleY(${glassScale})`;
    const newGlass = 'translateY(0) scaleY(1)';
    if (style === 'clock') {
      animate(glass, [
        { transform: oldGlass, offset: 0 }, { transform: oldGlass, offset: .16 },
        { transform: `translateY(${glassDy * .36}px) scaleY(${1 + (glassScale - 1) * .36})`, offset: .61 },
        { transform: 'translateY(-3px) scaleY(1.012)', offset: .85 }, { transform: newGlass, offset: 1 },
      ]);
      const glint = sheet('motion-glint', 0, afterGlass.top - host.top, host.width, afterGlass.height);
      animate(glint, [
        { opacity: 0, clipPath: 'inset(100% 0 0)', offset: 0 },
        { opacity: 0, clipPath: 'inset(100% 0 0)', offset: .24 },
        { opacity: .3, clipPath: 'inset(62% 0 26%)', offset: .46 },
        { opacity: .18, clipPath: 'inset(18% 0 70%)', offset: .68 },
        { opacity: 0, clipPath: 'inset(0 0 100%)', offset: .82 }, { opacity: 0, offset: 1 },
      ]);
    } else {
      // Only the glass footprint is segmented; the scene is never masked or transformed.
      animate(glass, [
        { transform: oldGlass, opacity: 1, offset: 0 },
        { transform: oldGlass, opacity: 1, offset: .18 },
        { transform: oldGlass, opacity: 0, offset: .26 },
        { transform: newGlass, opacity: 0, offset: .76 },
        { transform: newGlass, opacity: 1, offset: .9 },
        { transform: newGlass, opacity: 1, offset: 1 },
      ]);
      const rows = style === 'hinge' ? 2 : 4;
      for (let index = 0; index < rows; index++) {
        const newHeight = afterGlass.height / rows, oldHeight = beforeGlass.height / rows;
        const layerTop = afterGlass.top - host.top + newHeight * index;
        const layer = sheet(style === 'hinge' ? `motion-hinge motion-hinge-${index}` : 'motion-ribbon', 0, layerTop, host.width, newHeight + 1);
        const y = beforeGlass.top - host.top + oldHeight * index - layerTop;
        const start = `translateY(${y}px) scaleY(${oldHeight / newHeight})`;
        const stagger = index * .02;
        const middle = style === 'hinge'
          ? `perspective(950px) translateY(${y * .4}px) rotateX(${index === 0 ? -68 * sign : 68 * sign}deg)`
          : `translate(${(index % 2 === 0 ? -1 : 1) * (20 + index * 4) * sign}px, ${y * .4 + (index - 1.5) * 14}px) rotate(${(index % 2 === 0 ? -1 : 1) * 2.4 * sign}deg) scale(.91, .82)`;
        animate(layer, [
          { opacity: 0, transform: start, offset: 0 },
          { opacity: 0, transform: start, offset: .18 },
          { opacity: 1, transform: start, offset: .26 },
          { opacity: 1, transform: middle, offset: .43 + stagger },
          { opacity: 1, transform: middle, offset: .53 + stagger },
          { opacity: 1, transform: `translateY(-2px) scaleY(1.01)`, offset: .74 + stagger },
          { opacity: 0, transform: 'none', offset: .9 },
          { opacity: 0, transform: 'none', offset: 1 },
        ]);
      }
    }
    (from === 'normal' ? normal : minimal).forEach((part, index) => fadePart(part, false, index, -sign));
    (next === 'normal' ? normal : minimal).forEach((part, index) => fadePart(part, true, index, sign));
    fadePart(toMinimal ? normalLabel : minimalLabel, false, 0, -sign);
    fadePart(toMinimal ? minimalLabel : normalLabel, true, 1, sign);
    animate(toggle, [
      { transform: `translate(-50%, ${beforeAction.top - afterAction.top}px)`, opacity: 1, offset: 0 },
      { transform: `translate(-50%, ${beforeAction.top - afterAction.top}px)`, opacity: 0, offset: .23 },
      { transform: 'translate(-50%, -8px)', opacity: 0, offset: .58 },
      { transform: 'translate(-50%, -3px)', opacity: 1, offset: .79 },
      { transform: 'translate(-50%, 0)', opacity: 1, offset: 1 },
    ]);
    const chrome = [topbar, ...nav];
    chrome.forEach((part, index) => {
      const transform = index === 0 ? 'translateY(-58px)' : 'translateY(44px) scale(.88)';
      const gap = index * .022;
      animate(part, toMinimal ? [
        { opacity: 1, transform: 'none', offset: 0 }, { opacity: 1, transform: 'none', offset: gap },
        { opacity: 0, transform, offset: .25 + gap }, { opacity: 0, transform, offset: 1 },
      ] : [
        { opacity: 0, transform, offset: 0 }, { opacity: 0, transform, offset: .59 + gap },
        { opacity: 1, transform: 'translateY(-2px)', offset: .89 + gap },
        { opacity: 1, transform: 'none', offset: 1 },
      ]);
    });
    const footer = pick('.motion-nav');
    animate(footer, [
      { opacity: toMinimal ? 1 : 0, offset: 0 },
      { opacity: toMinimal ? 0 : 0, offset: toMinimal ? .28 : .59 },
      { opacity: toMinimal ? 0 : 1, offset: 1 },
    ]);
    timers.push(setTimeout(() => { if (generation === token) root.dataset.motionPhase = 'reshape'; }, duration * .28));
    timers.push(setTimeout(() => { if (generation === token) root.dataset.motionPhase = 'arrive'; }, duration * .61));
    announce();
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
    if (disposed || generation !== token) return;
    clean(); settle(next);
    if (desired !== next) void move(desired);
  }
  function request(next: Mode) { if (disposed) return; desired = next; void move(next); }
  function onToggle() { request(desired === 'normal' ? 'minimal' : 'normal'); }
  function onReduction() {
    if (!reduced.matches) return;
    generation++; clean(); settle(desired);
  }
  toggle.addEventListener('click', onToggle); reduced.addEventListener('change', onReduction); settle(mode);
  return {
    request, toggle: onToggle,
    configure(nextStyle: ReviewMotion, nextDuration: number) { style = nextStyle; duration = nextDuration; },
    dispose() { disposed = true; generation++; clean(); toggle.removeEventListener('click', onToggle); reduced.removeEventListener('change', onReduction); },
  };
}
