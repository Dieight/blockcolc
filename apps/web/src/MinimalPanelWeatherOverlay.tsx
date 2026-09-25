import { useEffect, useRef } from 'react';
import type { WeatherKind } from '@tomato-clock/voxel';
import './styles/minimal-panel-weather.css';

export interface MinimalPanelWeather {
  kind: WeatherKind;
  precipitationIntensity?: number;
  /** Set only when the weather presentation already identifies a thunderstorm. */
  thunderstorm?: boolean;
  /** Optional stable seed from the local weather projection. */
  seed?: number;
}

export interface GlassRaindrop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  age: number;
}

export const MAX_GLASS_RAINDROPS = 8;

const DEFAULT_INTENSITY = 0.3;
const MAX_DELTA_SECONDS = 0.05;
const FRAME_INTERVAL_MS = 48;
const MAX_CANVAS_PIXELS = 1_000_000;
const TERMINAL_SPEED = 22;
const DROP_LIFETIME_SECONDS = 22;

const boundedIntensity = (value: number | undefined): number =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value! : DEFAULT_INTENSITY));

export function shouldRenderMinimalPanelWeather(active: boolean, weather: MinimalPanelWeather | null): boolean {
  return active && weather?.kind === 'rain' && boundedIntensity(weather.precipitationIntensity) > 0;
}

/** A damped gravity step: surface tension delays each new bead, then glass friction
 * brings it towards a slow terminal slide instead of letting it fall like a stone. */
export function advanceGlassRaindrops(
  drops: readonly GlassRaindrop[],
  deltaSeconds: number,
  panelHeight: number,
): GlassRaindrop[] {
  const dt = Math.min(MAX_DELTA_SECONDS, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
  const height = Math.max(0, panelHeight);
  return drops.slice(0, MAX_GLASS_RAINDROPS).flatMap(drop => {
    const age = drop.age + dt;
    if (age > DROP_LIFETIME_SECONDS || drop.y > height + drop.radius * 2) return [];
    const settling = age > 0.12;
    const gravity = settling ? 46 : 0;
    const vy = Math.min(TERMINAL_SPEED, (drop.vy + gravity * dt) * Math.exp(-1.05 * dt));
    const vx = drop.vx * Math.exp(-1.9 * dt);
    return [{ ...drop, x: drop.x + vx * dt, y: drop.y + vy * dt, vx, vy, age,
      radius: Math.min(4.2, drop.radius + dt * 0.018) }];
  });
}

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x26c0ffee;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function seedFor(weather: MinimalPanelWeather): number {
  const kindSeed = weather.kind.split('').reduce((seed, letter) => (seed * 31 + letter.charCodeAt(0)) | 0, 17);
  return (weather.seed ?? kindSeed) ^ Math.round(boundedIntensity(weather.precipitationIntensity) * 1_000_000);
}

function drawDrop(context: CanvasRenderingContext2D, drop: GlassRaindrop, alpha: number, still: boolean): void {
  const trail = still ? 0 : Math.min(7, drop.vy * 0.22);
  context.save();
  context.globalAlpha = alpha * Math.max(0, 1 - Math.max(0, drop.age - 14) / 8);
  context.lineCap = 'round';
  if (trail > 0.4) {
    context.strokeStyle = 'rgba(191, 218, 232, .2)';
    context.lineWidth = Math.max(0.8, drop.radius * 0.38);
    context.beginPath();
    context.moveTo(drop.x, drop.y - trail - drop.radius * 0.55);
    context.lineTo(drop.x, drop.y - drop.radius * 0.35);
    context.stroke();
  }

  const width = drop.radius * 0.82;
  const height = drop.radius * 1.2;
  const gradient = context.createRadialGradient(
    drop.x - width * 0.35, drop.y - height * 0.38, 0.2,
    drop.x, drop.y, Math.max(width, height),
  );
  gradient.addColorStop(0, 'rgba(255, 255, 255, .82)');
  gradient.addColorStop(0.28, 'rgba(216, 235, 244, .44)');
  gradient.addColorStop(1, 'rgba(129, 170, 190, .16)');
  context.fillStyle = gradient;
  context.beginPath();
  context.ellipse(drop.x, drop.y, width, height, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

interface LightningStrike {
  startedAt: number;
  x: number;
  endY: number;
  offsets: number[];
}

function drawLightning(context: CanvasRenderingContext2D, width: number, strike: LightningStrike, ageMs: number): void {
  const duration = 170;
  if (ageMs < 0 || ageMs > duration) return;
  const fade = ageMs < 35 ? ageMs / 35 : Math.max(0, 1 - (ageMs - 35) / (duration - 35));
  const alpha = fade * 0.52;
  const steps = strike.offsets.length;
  const stepY = strike.endY / Math.max(1, steps - 1);
  const scaleX = Math.max(26, Math.min(width * 0.12, 48));

  // Keep the flash local to the strike; do not create a full-screen white flash.
  const glow = context.createRadialGradient(strike.x, strike.endY, 1, strike.x, strike.endY, 46);
  glow.addColorStop(0, `rgba(207, 229, 255, ${alpha * 0.34})`);
  glow.addColorStop(1, 'rgba(207, 229, 255, 0)');
  context.fillStyle = glow;
  context.fillRect(strike.x - 46, strike.endY - 46, 92, 92);

  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = 'rgba(239, 247, 255, .92)';
  context.shadowColor = 'rgba(165, 207, 255, .82)';
  context.shadowBlur = 7;
  context.lineWidth = 1.35;
  context.beginPath();
  strike.offsets.forEach((offset, index) => {
    const x = strike.x + offset * scaleX;
    const y = stepY * index;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.restore();
}

function staticRaindrops(width: number, height: number, seed: number): GlassRaindrop[] {
  const random = seededRandom(seed);
  const count = Math.min(4, MAX_GLASS_RAINDROPS);
  return Array.from({ length: count }, (_, index) => ({
    x: width * (0.12 + (index + random() * 0.6) / count),
    y: height * (0.18 + random() * 0.62),
    vx: 0,
    vy: 0,
    radius: 1.9 + random() * 1.3,
    age: 0,
  }));
}

/**
 * Optional decorative weather layer for the immersive minimal-mode glass panel.
 * Mount as a direct child of `.focus-panel`; it is absolute, inert and does not
 * take part in layout. The caller passes the already-selected weather facts.
 */
export function MinimalPanelWeatherOverlay({
  active,
  weather,
}: {
  active: boolean;
  weather: MinimalPanelWeather | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intensity = boundedIntensity(weather?.precipitationIntensity);
  const showRain = shouldRenderMinimalPanelWeather(active, weather);
  const thunderstorm = weather?.kind === 'rain' && weather.thunderstorm === true;
  const seed = weather ? seedFor(weather) : 0;

  useEffect(() => {
    if (!showRain) return;
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !host || !context) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const transparencyQuery = window.matchMedia('(prefers-reduced-transparency: reduce)');
    let hidden = document.visibilityState !== 'visible';
    let intersecting = true;
    let reducedMotion = motionQuery.matches;
    let reducedTransparency = transparencyQuery.matches;
    let raf = 0;
    let wakeTimer = 0;
    let lastFrame = 0;
    let nextDropAt = 0;
    let nextLightningAt = Number.POSITIVE_INFINITY;
    let strike: LightningStrike | null = null;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let drops: GlassRaindrop[] = [];
    const random = seededRandom(seed);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      pixelRatio = Math.min(1.5, window.devicePixelRatio || 1,
        Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height)));
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      paintStatic();
    };

    const paintBase = () => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.globalAlpha = reducedTransparency ? 0.42 : 0.78;
    };

    const paintStatic = () => {
      if (width <= 0 || height <= 0) return;
      paintBase();
      staticRaindrops(width, height, seed).forEach(drop => drawDrop(context, drop, 0.5, true));
      context.globalAlpha = 1;
    };

    const beginStrike = (now: number) => {
      strike = {
        startedAt: now,
        x: width * (0.24 + random() * 0.52),
        endY: Math.max(36, Math.min(height * 0.36, 108)),
        offsets: Array.from({ length: 6 }, (_, index) => index === 0 ? 0 : random() * 1.5 - 0.75),
      };
      nextLightningAt = now + 35_000 + random() * 45_000;
    };

    const tick = (now: number) => {
      raf = 0;
      if (hidden || !intersecting || reducedMotion || width <= 0 || height <= 0) return;
      const delta = lastFrame === 0 ? 0 : Math.min(MAX_DELTA_SECONDS, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;

      if (now >= nextDropAt && drops.length < MAX_GLASS_RAINDROPS) {
        const radius = 1.7 + random() * 2.2;
        drops.push({ x: width * (0.04 + random() * 0.92), y: -radius,
          vx: (random() - 0.5) * 1.5, vy: 0, radius, age: 0 });
        nextDropAt = now + 850 + (1 - intensity) * 1_050 + random() * 650;
      }
      if (thunderstorm && now >= nextLightningAt) beginStrike(now);

      drops = advanceGlassRaindrops(drops, delta, height);
      paintBase();
      drops.forEach(drop => drawDrop(context, drop, 0.62, false));
      if (strike) {
        drawLightning(context, width, strike, now - strike.startedAt);
        if (now - strike.startedAt > 170) strike = null;
      }
      context.globalAlpha = 1;
      wakeTimer = window.setTimeout(() => {
        wakeTimer = 0;
        if (!hidden && intersecting && !reducedMotion && raf === 0) raf = window.requestAnimationFrame(tick);
      }, FRAME_INTERVAL_MS);
    };

    const stop = () => {
      if (raf !== 0) window.cancelAnimationFrame(raf);
      if (wakeTimer !== 0) window.clearTimeout(wakeTimer);
      raf = 0;
      wakeTimer = 0;
    };

    const schedule = () => {
      if (!hidden && intersecting && !reducedMotion && width > 0 && height > 0 && raf === 0 && wakeTimer === 0) {
        raf = window.requestAnimationFrame(tick);
      } else if (hidden || !intersecting || reducedMotion) {
        stop();
        paintStatic();
      }
    };

    const onVisibilityChange = () => {
      hidden = document.visibilityState !== 'visible';
      if (!hidden && thunderstorm) nextLightningAt = performance.now() + 35_000 + random() * 45_000;
      schedule();
    };
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      if (reducedMotion) { stop(); paintStatic(); }
      else schedule();
    };
    const onTransparencyChange = (event: MediaQueryListEvent) => {
      reducedTransparency = event.matches;
      if (reducedMotion || hidden || !intersecting) paintStatic();
    };

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    resizeObserver?.observe(host);
    if (!resizeObserver) window.addEventListener('resize', resize);
    const intersectionObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      intersecting = entries.some(entry => entry.isIntersecting);
      schedule();
    });
    intersectionObserver?.observe(host);
    motionQuery.addEventListener('change', onMotionChange);
    transparencyQuery.addEventListener('change', onTransparencyChange);
    document.addEventListener('visibilitychange', onVisibilityChange);

    resize();
    if (thunderstorm) nextLightningAt = performance.now() + 35_000 + random() * 45_000;
    if (!reducedMotion && !hidden) schedule();

    return () => {
      stop();
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', resize);
      intersectionObserver?.disconnect();
      motionQuery.removeEventListener('change', onMotionChange);
      transparencyQuery.removeEventListener('change', onTransparencyChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      context.clearRect(0, 0, width, height);
    };
  }, [intensity, seed, showRain, thunderstorm]);

  if (!showRain) return null;
  return <div className="minimal-panel-weather-overlay" aria-hidden="true" data-weather-kind="rain"
    data-thunderstorm={thunderstorm ? 'true' : 'false'}>
    <canvas ref={canvasRef}/>
  </div>;
}
