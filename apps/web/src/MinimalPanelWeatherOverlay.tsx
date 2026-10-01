import { useEffect, useRef } from 'react';
import type { WeatherKind } from '@blockcolc/voxel';
import './styles/minimal-panel-weather.css';

export interface MinimalPanelWeather {
  kind: WeatherKind;
  precipitationIntensity?: number;
  /** Shared voxel projection; the overlay never remaps measured provider data. */
  visualPrecipitationIntensity: number;
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
  holdSeconds?: number;
}

export const MAX_GLASS_RAINDROPS = 24;
export const MAX_PANEL_SNOWFLAKES = 48;

const MAX_DELTA_SECONDS = 0.05;
const FRAME_INTERVAL_MS = 32;
const MAX_CANVAS_PIXELS = 1_000_000;
const DROP_LIFETIME_SECONDS = 32;

const boundedIntensity = (value: number | undefined): number =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value! : 0));

export interface PanelRainVisualProfile {
  maxDrops: number;
  staticDrops: number;
  spawnIntervalMs: number;
  opacity: number;
  radiusMin: number;
  radiusMax: number;
  holdSecondsMin: number;
  holdSecondsMax: number;
  terminalSpeed: number;
  trailScale: number;
}

export function panelRainVisualProfile(value: number): PanelRainVisualProfile {
  const intensity = boundedIntensity(value);
  const lerp = (a: number, b: number) => a + (b - a) * intensity;
  return {
    maxDrops: Math.min(MAX_GLASS_RAINDROPS, Math.max(5, Math.round(5 + intensity * 19))),
    staticDrops: Math.min(8, Math.max(3, Math.round(2 + intensity * 6))),
    spawnIntervalMs: Math.round(lerp(1_350, 380)),
    opacity: lerp(0.7, 0.92),
    radiusMin: lerp(1.4, 1.9),
    radiusMax: lerp(3, 4.2),
    holdSecondsMin: lerp(1.5, 0.35),
    holdSecondsMax: lerp(4.0, 1.5),
    terminalSpeed: lerp(12, 28),
    trailScale: lerp(0.42, 0.9),
  };
}

export type PanelSnowTier = 'thin' | 'low' | 'medium' | 'high';

/** Snowfall facts select a stepped, non-linear depth; the shared perceptual
 * intensity still owns particle visibility. This is not another weather remap. */
export function panelSnowAccumulationProfile(value: number): { tier: PanelSnowTier; depthCssPx: number } {
  const intensity = boundedIntensity(value);
  if (intensity < 0.12) return { tier: 'thin', depthCssPx: 3 };
  if (intensity < 0.34) return { tier: 'low', depthCssPx: 7 };
  if (intensity < 0.68) return { tier: 'medium', depthCssPx: 12 };
  return { tier: 'high', depthCssPx: 20 };
}

export function shouldRenderMinimalPanelWeather(active: boolean, weather: MinimalPanelWeather | null): boolean {
  return active && (weather?.kind === 'rain' || weather?.kind === 'snow')
    && boundedIntensity(weather.visualPrecipitationIntensity) > 0;
}

/** A damped gravity step: surface tension delays each new bead, then glass friction
 * brings it towards a slow terminal slide instead of letting it fall like a stone. */
export function advanceGlassRaindrops(
  drops: readonly GlassRaindrop[],
  deltaSeconds: number,
  panelHeight: number,
  terminalSpeed = 16,
): GlassRaindrop[] {
  const dt = Math.min(MAX_DELTA_SECONDS, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
  const height = Math.max(0, Number.isFinite(panelHeight) ? panelHeight : 0);
  const boundedTerminalSpeed = Math.min(34, Math.max(1, Number.isFinite(terminalSpeed) ? terminalSpeed : 16));
  return drops.slice(0, MAX_GLASS_RAINDROPS).flatMap(drop => {
    if (![drop.x, drop.y, drop.radius, drop.age].every(Number.isFinite)) return [];
    const vxStart = Number.isFinite(drop.vx) ? drop.vx : 0;
    const vyStart = Number.isFinite(drop.vy) ? drop.vy : 0;
    const radiusStart = Math.min(4.8, Math.max(0.1, drop.radius));
    const age = drop.age + dt;
    if (age > DROP_LIFETIME_SECONDS || drop.y > height + radiusStart * 2) return [];
    const sliding = age > (drop.holdSeconds ?? 0.8);
    const gravity = sliding ? 28 + drop.radius * 5 : 0;
    const vy = sliding
      ? Math.min(boundedTerminalSpeed, (vyStart + gravity * dt) * Math.exp(-1.18 * dt))
      : vyStart * Math.exp(-3.2 * dt);
    const vx = vxStart * Math.exp(-2.4 * dt);
    return [{ ...drop, x: drop.x + vx * dt, y: drop.y + vy * dt, vx, vy, age,
      radius: Math.min(4.8, radiusStart + dt * (sliding ? 0.018 : 0.006)) }];
  });
}

/** Adjacent beads coalesce on glass; the heavier bead breaks surface tension
 * sooner and its area, rather than diameter, is approximately conserved. */
export function mergeGlassRaindrops(drops: readonly GlassRaindrop[]): GlassRaindrop[] {
  const remaining = drops.slice(0, MAX_GLASS_RAINDROPS).map(drop => ({ ...drop }));
  for (let index = 0; index < remaining.length; index += 1) {
    let first = remaining[index]!;
    for (let other = index + 1; other < remaining.length;) {
      const second = remaining[other]!;
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (distance > (first.radius + second.radius) * 0.72) { other += 1; continue; }
      const firstArea = first.radius * first.radius;
      const secondArea = second.radius * second.radius;
      const totalArea = firstArea + secondArea;
      first = {
        ...first,
        x: (first.x * firstArea + second.x * secondArea) / totalArea,
        y: (first.y * firstArea + second.y * secondArea) / totalArea,
        radius: Math.min(4.8, Math.sqrt(totalArea)),
        vx: (first.vx * firstArea + second.vx * secondArea) / totalArea,
        vy: Math.max(first.vy, second.vy),
        age: Math.max(first.age, second.age),
        holdSeconds: Math.min(first.holdSeconds ?? 0.8, second.holdSeconds ?? 0.8, first.age + 0.12),
      };
      remaining[index] = first;
      remaining.splice(other, 1);
    }
  }
  return remaining;
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
  return (weather.seed ?? kindSeed) ^ Math.round(boundedIntensity(weather.visualPrecipitationIntensity) * 1_000_000);
}

function drawDrop(context: CanvasRenderingContext2D, drop: GlassRaindrop, alpha: number, still: boolean, trailScale: number): void {
  // Keep continuous physics, but rasterize the silhouette/highlight on a pixel
  // lattice. Smaller, softer beads sit behind the heavier foreground droplets.
  const grain = drop.radius > 3.2 ? 3 : 2;
  const x = Math.round(drop.x / grain) * grain;
  const y = Math.round(drop.y / grain) * grain;
  const width = drop.radius > 2.8 ? grain * 2 : grain;
  const trail = still ? 0 : Math.round(Math.min(18, drop.vy * 0.55 * trailScale) / grain) * grain;
  const lifetimeFade = Math.max(0, 1 - Math.max(0, drop.age - 14) / 8);
  const formationFade = still ? 1 : Math.min(1, drop.age / 0.34);
  context.save();
  context.globalAlpha *= alpha * lifetimeFade * formationFade * (drop.radius < 2 ? 0.58 : 1);
  context.fillStyle = 'rgba(66, 112, 128, .16)';
  if (trail > 0) context.fillRect(x, y - trail, grain, trail);
  context.fillStyle = 'rgba(53, 97, 117, .48)';
  context.fillRect(x - grain, y, width + grain, grain * 2);
  context.fillRect(x, y - grain, width, grain);
  context.fillStyle = 'rgba(203, 229, 241, .6)';
  context.fillRect(x, y, width, grain);
  context.fillRect(x + grain, y + grain, grain, grain);
  context.fillStyle = 'rgba(249, 253, 255, .88)';
  context.fillRect(x, y, grain, grain);
  if (!still && drop.age < 0.32) {
    const impact = 1 - drop.age / 0.32;
    const reach = grain * (1 + Math.floor((1 - impact) * 2));
    context.fillStyle = `rgba(226, 242, 250, ${0.45 * impact})`;
    context.fillRect(x - reach, y, grain, grain);
    context.fillRect(x + width + reach, y - grain, grain, grain);
  }
  context.restore();
}

interface LightningStrike {
  startedAt: number;
  x: number;
  endY: number;
  offsets: number[];
}

export const LIGHTNING_AFTERIMAGE_MS = 1_650;

export function panelLightningOpacity(ageMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > LIGHTNING_AFTERIMAGE_MS) return 0;
  if (ageMs < 45) return 0.8 * ageMs / 45;
  if (ageMs < 165) return 0.8;
  return 0.5 * Math.pow(1 - (ageMs - 165) / (LIGHTNING_AFTERIMAGE_MS - 165), 0.8);
}

function drawLightning(context: CanvasRenderingContext2D, width: number, strike: LightningStrike, ageMs: number): void {
  const alpha = panelLightningOpacity(ageMs);
  if (alpha <= 0) return;
  const steps = strike.offsets.length;
  const stepY = strike.endY / Math.max(1, steps - 1);
  const scaleX = Math.max(18, Math.min(width * 0.1, 40));

  const glow = context.createRadialGradient(strike.x, strike.endY, 1, strike.x, strike.endY, 62);
  glow.addColorStop(0, `rgba(207, 229, 255, ${alpha * 0.7})`);
  glow.addColorStop(1, 'rgba(207, 229, 255, 0)');
  context.fillStyle = glow;
  context.fillRect(strike.x - 62, strike.endY - 62, 124, 124);

  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = 'rgba(41, 76, 109, .76)';
  context.shadowColor = 'rgba(165, 207, 255, .82)';
  context.shadowBlur = ageMs < 165 ? 13 : 5;
  context.lineWidth = ageMs < 165 ? 5 : 3;
  context.beginPath();
  strike.offsets.forEach((offset, index) => {
    const x = strike.x + offset * scaleX;
    const y = stepY * index;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.shadowBlur = 0;
  context.lineWidth = ageMs < 165 ? 2.1 : 1.2;
  context.strokeStyle = 'rgba(247, 252, 255, .96)';
  context.stroke();
  context.restore();
}

interface PanelSnowflake {
  x: number;
  y: number;
  radius: number;
  speed: number;
  drift: number;
  phase: number;
}

function drawSnowflake(context: CanvasRenderingContext2D, flake: PanelSnowflake, opacity: number): void {
  const foreground = flake.radius > 1.5;
  const x = Math.round(flake.x), y = Math.round(flake.y);
  context.save();
  context.globalAlpha *= opacity * (foreground ? 0.94 : 0.48);
  context.fillStyle = 'rgba(248, 253, 255, .94)';
  if (!foreground) context.fillRect(x, y, 2, 2);
  else {
    // Fine pixels form readable flakes; depth comes from speed/opacity, not blur.
    context.fillRect(x - 2, y, 5, 1);
    context.fillRect(x, y - 2, 1, 5);
    if (flake.radius > 1.9) {
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) context.fillRect(x + dx, y + dy, 1, 1);
    }
  }
  context.restore();
}

function drawSnowbank(context: CanvasRenderingContext2D, width: number, height: number, intensity: number): void {
  // Scale all four tiers together on a short panel, rather than clipping only
  // the high tier until it becomes indistinguishable from medium.
  const depth = panelSnowAccumulationProfile(intensity).depthCssPx * Math.min(1, height * 0.075 / 20);
  const bottom = Math.floor(height);
  context.save();
  // Uneven pixel steps sit on the lower sill, bounded away from controls/text.
  for (let x = 0; x < width; x += 4) {
    const variation = (Math.sin(x * 0.037) + Math.cos(x * 0.079) + 2) / 4;
    const localDepth = Math.max(1, Math.round(depth * (0.78 + variation * 0.22)));
    context.fillStyle = 'rgba(242, 249, 252, .94)';
    context.fillRect(x, bottom - localDepth, Math.min(4, width - x), localDepth);
    context.fillStyle = 'rgba(138, 173, 190, .32)';
    context.fillRect(x, bottom - 1, Math.min(4, width - x), 1);
  }
  context.restore();
}

function staticRaindrops(width: number, height: number, seed: number, profile: PanelRainVisualProfile): GlassRaindrop[] {
  const random = seededRandom(seed);
  const count = Math.min(profile.staticDrops, MAX_GLASS_RAINDROPS);
  return Array.from({ length: count }, (_, index) => ({
    x: width * (0.1 + (index + 0.25 + random() * 0.5) / Math.max(1, count) * 0.8),
    y: height * (0.16 + random() * 0.66),
    vx: 0,
    vy: 0,
    radius: profile.radiusMin + random() * Math.max(0, profile.radiusMax - profile.radiusMin),
    age: 0,
    holdSeconds: Number.POSITIVE_INFINITY,
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
  const intensity = boundedIntensity(weather?.visualPrecipitationIntensity);
  const snowfall = boundedIntensity(weather?.precipitationIntensity ?? intensity);
  const rainProfile = panelRainVisualProfile(intensity);
  const showWeather = shouldRenderMinimalPanelWeather(active, weather);
  const isSnow = weather?.kind === 'snow';
  const thunderstorm = weather?.kind === 'rain' && weather.thunderstorm === true;
  const seed = weather ? seedFor(weather) : 0;

  useEffect(() => {
    if (!showWeather) return;
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
    let lightningStrikeCount = 0;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let drops: GlassRaindrop[] = [];
    let snowflakes: PanelSnowflake[] = [];
    const random = seededRandom(seed);
    const makeSnowflake = (initial: boolean): PanelSnowflake => ({
      x: width * (0.04 + random() * 0.92),
      y: initial ? height * (0.04 + random() * 0.86) : -4,
      radius: 0.8 + random() * 1.4,
      speed: 10 + random() * 20,
      drift: (random() - 0.5) * 7,
      phase: random() * Math.PI * 2,
    });

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      if (isSnow && snowflakes.length === 0 && width > 0 && height > 0) {
        snowflakes = Array.from({ length: Math.round(8 + intensity * 16) }, () => makeSnowflake(true));
      }
      // One canvas pixel per CSS pixel keeps the approved square highlights
      // crisp even on fractional-DPR WebViews. Backing storage stays bounded.
      pixelRatio = Math.min(1,
        Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height)));
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.imageSmoothingEnabled = false;
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
      if (isSnow) {
        drawSnowbank(context, width, height, snowfall);
        for (let index = 0; index < 9; index += 1) {
          drawSnowflake(context, { x: width * ((index * 0.113 + 0.08) % 1), y: height * ((index * 0.19 + 0.13) % 0.9),
            radius: 0.8 + (index % 3) * 0.4, speed: 0, drift: 0, phase: 0 }, 0.65);
        }
      } else {
        staticRaindrops(width, height, seed, rainProfile)
          .forEach(drop => drawDrop(context, drop, rainProfile.opacity * 0.8, true, rainProfile.trailScale));
      }
      context.globalAlpha = 1;
    };

    const beginStrike = (now: number) => {
      strike = {
        startedAt: now,
        x: width * (0.16 + random() * 0.68),
        endY: height * (0.38 + random() * 0.49),
        offsets: Array.from({ length: 9 }, (_, index) => index === 8 ? 0 : random() * 1.5 - 0.75),
      };
      lightningStrikeCount += 1;
      host.dataset.lightningStrikeCount = String(lightningStrikeCount);
      host.dataset.lightningTargetX = (strike.x / Math.max(1, width)).toFixed(3);
      host.dataset.lightningTargetY = (strike.endY / Math.max(1, height)).toFixed(3);
      nextLightningAt = now + 15_000 + random() * 16_000;
    };

    const tick = (now: number) => {
      raf = 0;
      if (hidden || !intersecting || reducedMotion || width <= 0 || height <= 0) return;
      const delta = lastFrame === 0 ? 0 : Math.min(MAX_DELTA_SECONDS, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;

      if (isSnow && now >= nextDropAt && snowflakes.length < Math.min(MAX_PANEL_SNOWFLAKES, 12 + Math.ceil(intensity * 36))) {
        snowflakes.push(makeSnowflake(false));
        nextDropAt = now + 110 + (1 - intensity) * 230 + random() * 130;
      } else if (!isSnow && now >= nextDropAt && drops.length < rainProfile.maxDrops) {
        const radius = rainProfile.radiusMin + random() * Math.max(0, rainProfile.radiusMax - rainProfile.radiusMin);
        drops.push({ x: width * (0.06 + random() * 0.88), y: height * (0.08 + random() * 0.66),
          vx: (random() - 0.5) * 0.55, vy: 0, radius, age: 0,
          holdSeconds: rainProfile.holdSecondsMin + random() * Math.max(0, rainProfile.holdSecondsMax - rainProfile.holdSecondsMin) });
        nextDropAt = now + rainProfile.spawnIntervalMs * (0.72 + random() * 0.56);
      }
      if (thunderstorm && now >= nextLightningAt) beginStrike(now);

      if (isSnow) {
        snowflakes = snowflakes.flatMap(flake => {
          const phase = flake.phase + delta * 1.4;
          const y = flake.y + flake.speed * (flake.radius > 1.5 ? 1 : 0.62) * delta;
          return y > height - 5 ? [] : [{ ...flake, x: flake.x + (flake.drift + Math.sin(phase) * 4) * delta, y, phase }];
        });
      } else {
        drops = mergeGlassRaindrops(advanceGlassRaindrops(drops, delta, height, rainProfile.terminalSpeed));
      }
      paintBase();
      if (isSnow) {
        snowflakes.forEach(flake => drawSnowflake(context, flake, 0.76));
        drawSnowbank(context, width, height, snowfall);
      } else {
        drops.forEach(drop => drawDrop(context, drop, rainProfile.opacity, false, rainProfile.trailScale));
      }
      if (strike) {
        drawLightning(context, width, strike, now - strike.startedAt);
        if (now - strike.startedAt > LIGHTNING_AFTERIMAGE_MS) strike = null;
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
      if (!hidden && thunderstorm) nextLightningAt = performance.now() + 1_600 + random() * 1_600;
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
    if (thunderstorm) nextLightningAt = performance.now() + 1_600 + random() * 1_600;
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
  }, [intensity, rainProfile.holdSecondsMax, rainProfile.holdSecondsMin, rainProfile.maxDrops, rainProfile.opacity,
    rainProfile.radiusMax, rainProfile.radiusMin, rainProfile.spawnIntervalMs, rainProfile.staticDrops,
    rainProfile.terminalSpeed, rainProfile.trailScale, seed, showWeather, thunderstorm, isSnow, snowfall]);

  if (!showWeather) return null;
  return <div className="minimal-panel-weather-overlay" aria-hidden="true" data-weather-kind={weather?.kind}
    data-weather-style="pixel-layered" data-snow-tier={isSnow ? panelSnowAccumulationProfile(snowfall).tier : undefined}
    data-rain-intensity={intensity.toFixed(3)}
    data-thunderstorm={thunderstorm ? 'true' : 'false'}>
    <canvas ref={canvasRef}/>
  </div>;
}
