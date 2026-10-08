import { pushBackLayer } from './back-layer';
import { capturePortalBackdrop } from './portal-backdrop';

export type PortalDirection = 'enter' | 'leave';
export const PORTAL_FRAME_MS = 1000;
export const PORTAL_REVEAL_MS = 500;

/** Square stones, starting at the lower left and proceeding clockwise. */
export function portalFrameLayout(width: number, height: number) {
  const size = Math.min(80, Math.max(40, Math.min(width, height) / 8));
  const columns = Math.max(3, Math.ceil(width / size));
  const rows = Math.max(3, Math.ceil(height / size));
  const xStep = (width - size) / (columns - 1);
  const yStep = (height - size) / (rows - 1);
  const stones: { x: number; y: number; size: number; side: string }[] = [];
  const add = (column: number, row: number, side: string) => stones.push({ x: column * xStep, y: row * yStep, size, side });
  for (let row = rows - 1; row >= 0; row--) add(0, row, 'left');
  for (let column = 1; column < columns; column++) add(column, 0, 'top');
  for (let row = 1; row < rows; row++) add(columns - 1, row, 'right');
  for (let column = columns - 2; column > 0; column--) add(column, rows - 1, 'bottom');
  return { size, stones };
}

const PORTAL_EDGE_SAMPLES = 128;
const portalPoint = (x: number, y: number) => `${x.toFixed(3)}px ${y.toFixed(3)}px`;

function burningEdge(width: number, height: number, radius: number, progress: number, rim = false): string[] {
  // Deterministic tongues drift between a handful of precomputed keyframes.
  // No per-frame JS/filter pass competes with the resident WebGL scene.
  const envelope = Math.sin(Math.PI * Math.max(0, Math.min(1, progress)));
  const amplitude = Math.min(24, radius * .085) * envelope;
  return Array.from({ length: PORTAL_EDGE_SAMPLES + 1 }, (_, index) => {
    const angle = index % PORTAL_EDGE_SAMPLES / PORTAL_EDGE_SAMPLES * Math.PI * 2;
    const tongue = Math.pow(Math.max(0, Math.sin(angle * 17 - progress * 11)), 4);
    const flutter = Math.sin(angle * 31 + progress * 17) * .22 + Math.sin(angle * 7 - progress * 5) * .2;
    const thickness = rim ? envelope * (5 + Math.pow(Math.max(0, Math.sin(angle * 13 + progress * 19)), 3) * 10) : 0;
    const reach = Math.max(0, radius + amplitude * (tongue + flutter - .25) + thickness);
    const snap = (value: number) => Math.round(value / 2) * 2;
    return portalPoint(width / 2 + snap(Math.cos(angle) * reach), height / 2 + snap(Math.sin(angle) * reach));
  });
}

/** An expanding fire-bitten hole; equal point counts allow native interpolation. */
export function portalOpeningClip(width: number, height: number, radius: number, progress = 0): string {
  const point = portalPoint;
  const outer = [point(0, 0), point(width, 0), point(width, height), point(0, height), point(0, 0)];
  return `polygon(evenodd, ${[...outer, ...burningEdge(width, height, radius, progress), outer[0]].join(', ')})`;
}

export function portalBurnRingClip(width: number, height: number, radius: number, progress: number): string {
  const outer = burningEdge(width, height, radius, progress, true);
  const inner = burningEdge(width, height, radius, progress);
  return `polygon(evenodd, ${[...outer, ...inner, outer[0]].join(', ')})`;
}

export function portalBurnRevealFrames(width: number, height: number) {
  const radius = Math.hypot(width, height) / 2 + 12;
  return [0, .12, .25, .4, .55, .7, .85, .96, 1].map(progress => ({
    offset: progress,
    clipPath: portalOpeningClip(width, height, radius * progress, progress),
    rimClipPath: portalBurnRingClip(width, height, radius * progress, progress),
    rimOpacity: progress === 0 || progress === 1 ? 0 : 1,
  }));
}

export function createModePortal(root: HTMLElement, commit: (minimal: boolean) => void, onFailure: () => void) {
  let controller: AbortController | null = null;
  let disposed = false;

  async function travel(direction: PortalDirection) {
    if (controller || disposed || document.hidden) return;
    const owner = new AbortController(); controller = owner;
    const motions: Animation[] = [];
    let backdrop: ReturnType<typeof capturePortalBackdrop> | null = null;
    const oldInert = root.inert;
    const width = innerWidth, height = innerHeight;
    const geometry = portalFrameLayout(width, height);
    const radius = Math.hypot(width, height) / 2 + 2;
    const layer = document.createElement('div');
    layer.className = 'mode-portal'; layer.dataset.direction = direction;
    layer.style.setProperty('--portal-block', `${geometry.size}px`);
    layer.setAttribute('aria-hidden', 'true');
    const door = document.createElement('div'); door.className = 'mode-portal__door';
    const field = document.createElement('div'); field.className = 'mode-portal__field';
    const vortex = document.createElement('div'); vortex.className = 'mode-portal__vortex'; field.append(vortex);
    const frame = document.createElement('div'); frame.className = 'mode-portal__frame';
    const stones = geometry.stones.map((position, index) => {
      const stone = document.createElement('div'); stone.className = 'mode-portal__stone';
      stone.dataset.side = position.side; stone.dataset.order = String(index);
      Object.assign(stone.style, { left: `${position.x}px`, top: `${position.y}px`, width: `${position.size}px`, height: `${position.size}px` });
      frame.append(stone); return stone;
    });
    const flame = document.createElement('div'); flame.className = 'mode-portal__flame';
    const flameBody = document.createElement('div'); flameBody.className = 'mode-portal__flame-body'; flame.append(flameBody);
    for (const side of ['left', 'center', 'right']) {
      const tongue = document.createElement('div'); tongue.className = `mode-portal__flame-tongue mode-portal__flame-tongue--${side}`; flame.append(tongue);
    }
    const burnRim = document.createElement('div'); burnRim.className = 'mode-portal__burn-rim'; burnRim.hidden = true;
    door.append(field, frame); layer.append(door, burnRim, flame);
    const phase = (name: string) => {
      layer.dataset.phase = name; root.dataset.modePortalPhase = name; document.body.dataset.modePortalPhase = name;
    };
    const cancel = () => owner.abort();
    const onHidden = () => { if (document.hidden) cancel(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
    const removeBack = pushBackLayer(() => { cancel(); return true; });
    const check = () => { if (owner.signal.aborted || disposed) throw new DOMException('Cancelled', 'AbortError'); };
    const animate = async (element: HTMLElement, keyframes: Keyframe[], duration: number,
      easing = 'cubic-bezier(.2,.7,.2,1)', delay = 0) => {
      check();
      const motion = element.animate(keyframes, { duration, easing, delay, fill: 'both' }); motions.push(motion);
      await motion.finished; check();
    };
    const frameCount = () => Number(root.querySelector<HTMLCanvasElement>('canvas[aria-label="项目建筑世界"]')?.dataset.renderFrameCount ?? 0);
    const untilReady = (minimal: boolean, frames: number) => new Promise<void>((resolve, reject) => {
      let raf = 0, stable = 0, previousSize = '', finished = false;
      const finish = (error?: Error) => {
        if (finished) return; finished = true;
        cancelAnimationFrame(raf); clearTimeout(timeout); owner.signal.removeEventListener('abort', aborted);
        error ? reject(error) : resolve();
      };
      const aborted = () => finish(new DOMException('Cancelled', 'AbortError'));
      const timeout = window.setTimeout(() => finish(new Error('World reframe timed out')), 10_000);
      const tick = () => {
        const screen = root.querySelector<HTMLElement>('.world-screen');
        const canvas = screen?.querySelector<HTMLCanvasElement>('canvas[aria-label="项目建筑世界"]');
        const world = screen?.querySelector<HTMLElement>('.world-stage')?.getBoundingClientRect();
        const size = `${world?.width}:${world?.height}:${innerWidth}:${innerHeight}`;
        const ready = screen?.dataset.worldReady === 'true' && screen.dataset.minimalMode === String(minimal)
          && world && world.width > 0 && world.height > 0 && canvas
          && Number(canvas.dataset.renderFrameCount ?? 0) > frames
          && (!root.dataset.presentationTransition || root.dataset.presentationTransition === 'complete');
        stable = ready && size === previousSize ? stable + 1 : 0; previousSize = size;
        if (stable >= 3) finish(); else raf = requestAnimationFrame(tick);
      };
      owner.signal.addEventListener('abort', aborted, { once: true }); raf = requestAnimationFrame(tick);
    });
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', cancel);
    owner.signal.addEventListener('abort', () => motions.forEach(motion => motion.cancel()), { once: true });
    try {
      phase('starting'); root.inert = true; root.dataset.modePortalActive = 'true';
      if (matchMedia('(prefers-reduced-motion: reduce)').matches || !door.animate) {
        commit(direction === 'enter'); return;
      }
      document.body.append(layer);
      if (direction === 'enter') {
        phase('building-frame'); field.hidden = true; flame.hidden = true;
        // The old UI remains inside the empty frame. Neither the button nor
        // the world scales while the stones appear around the perimeter.
        await Promise.all(stones.map((stone, index) => animate(stone,
          [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }],
          70, 'steps(2,end)', index / (stones.length - 1) * (PORTAL_FRAME_MS - 70))));
        // Settle every block before igniting: no final delayed animation or
        // late background replacement can flash the right/bottom perimeter.
        for (const stone of stones) {
          stone.style.opacity = '1'; stone.style.transform = 'none';
          stone.getAnimations().forEach(animation => animation.cancel());
        }
        phase('igniting-portal'); field.hidden = false; flame.hidden = false;
        field.append(flame); // Ignition stays behind the completed stone ring.
        flame.style.left = `${geometry.size * .6}px`; flame.style.top = `calc(100% - ${geometry.size * .8}px)`;
        const origin = `${geometry.size * .6}px calc(100% - ${geometry.size * .8}px)`;
        await Promise.all([
          animate(field, [
            { clipPath: `circle(0px at ${origin})`, opacity: .45 },
            { clipPath: `circle(${radius * .18}px at ${origin})`, opacity: .85, offset: .3 },
            { clipPath: `circle(${radius * 2}px at ${origin})`, opacity: 1 },
          ], 420, 'cubic-bezier(.42,0,.24,1)'),
          animate(flame, [
            { opacity: 0, transform: 'translate(-50%, -50%) scale(.3)' },
            { opacity: 1, transform: 'translate(-50%, -60%) scale(.8)', offset: .3 },
            { opacity: 0, transform: 'translate(-50%, -80%) scale(1.1)' },
          ], 420),
        ]);
        flame.hidden = true;
        field.style.clipPath = 'none'; field.style.opacity = '1';
        field.getAnimations().forEach(animation => animation.cancel());
        phase('loading-vortex'); const frames = frameCount(); commit(true);
        await untilReady(true, frames);
      } else {
        phase('igniting');
        door.style.opacity = '0';
        await animate(flame, [
            { opacity: 0, transform: 'translate(-50%, -15%) scale(.35)', offset: 0 },
            { opacity: 1, transform: 'translate(-50%, -78%) scale(1.35)', offset: .6 },
            { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 1 },
          ], 300);
        // Only fire overlays the minimal view. Freeze its last fully rendered
        // frame while the *same* world prepares the ordinary layout behind it.
        backdrop = capturePortalBackdrop(root); layer.prepend(backdrop.element);
        phase('loading-flame'); const frames = frameCount(); commit(false);
        await untilReady(false, frames);
        phase('expanding');
        stones.forEach(stone => { stone.style.opacity = '1'; });
        // Reveal the full-resolution door material, never magnify the flame's
        // pixels. The frozen minimal view stays visible outside the opening.
        door.style.opacity = '1';
        await Promise.all([
          animate(field, [
            { clipPath: 'circle(0px at 50% 50%)' },
            { clipPath: `circle(${radius}px at 50% 50%)` },
          ], 280, 'cubic-bezier(.42,0,.24,1)'),
          animate(frame, [{ opacity: 0 }, { opacity: 0, offset: .35 }, { opacity: 1 }], 280),
          animate(flame, [{ opacity: 1 }, { opacity: 0, offset: .45 }, { opacity: 0 }], 280),
        ]);
        field.style.clipPath = 'none';
        door.style.background = 'var(--portal-frame)';
        flame.hidden = true; backdrop.dispose(); backdrop = null;
      }
      phase('revealing');
      if (direction === 'enter') {
        await Promise.all([
          animate(door, [{ clipPath: `circle(${radius}px at 50% 50%)` }, { clipPath: 'circle(0px at 50% 50%)' }], PORTAL_REVEAL_MS, 'cubic-bezier(.55,.03,.7,.4)'),
          animate(vortex, [{ transform: 'translate(-50%, -50%) scale(1)' }, { transform: 'translate(-50%, -50%) scale(0)' }], PORTAL_REVEAL_MS, 'cubic-bezier(.55,.03,.7,.4)'),
        ]);
      }
      else {
        // The boundary burns outward while the real UI stays at its final size.
        burnRim.hidden = false;
        const frames = portalBurnRevealFrames(width, height);
        await Promise.all([
          animate(door, frames.map(({offset,clipPath})=>({offset,clipPath})), PORTAL_REVEAL_MS, 'cubic-bezier(.55,.03,.7,.4)'),
          animate(burnRim, frames.map(({offset,rimClipPath,rimOpacity})=>({offset,clipPath:rimClipPath,opacity:rimOpacity})), PORTAL_REVEAL_MS, 'cubic-bezier(.55,.03,.7,.4)'),
        ]);
      }
    } catch (error) {
      if (!owner.signal.aborted && !disposed) onFailure();
    } finally {
      motions.forEach(motion => motion.cancel()); backdrop?.dispose(); layer.remove(); removeBack();
      root.inert = oldInert; root.dataset.modePortalActive = 'false'; phase('idle');
      document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', cancel);
      if (controller === owner) controller = null;
    }
  }
  return { travel, dispose() { disposed = true; controller?.abort(); } };
}
