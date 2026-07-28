import type { AtlasAnimationLookup } from "./resource-textures";
import { writeLookupBlend, writeLookupFrames } from "./resource-textures";

export const MINECRAFT_TICK_MS = 50;

export interface AtlasAnimationDiagnostics {
  availableSequenceCount: number;
  sequenceCount: number;
  interpolatedSequenceCount: number;
  frameUpdateCount: number;
  scheduled: boolean;
  reducedMotion: boolean;
  visible: boolean;
}

export interface AtlasAnimationController {
  setActiveTextureIndices(values: Iterable<number>): void;
  setReducedMotion(value: boolean): void;
  setVisible(value: boolean): void;
  getDiagnostics(): AtlasAnimationDiagnostics;
  dispose(): void;
}

export interface AtlasAnimationClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserClock: AtlasAnimationClock = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

/**
 * Updates only the compact tile-remap texture. The large color atlas and all
 * instance attributes stay resident and unchanged between animation frames.
 */
export function sampleAtlasAnimation(
  lookup: AtlasAnimationLookup,
  elapsedMs: number,
  freezeFirstFrame = false,
  activeTextureIndices?: ReadonlySet<number>,
): boolean {
  let changed = false;
  const elapsedTicks = Math.max(0, elapsedMs) / MINECRAFT_TICK_MS;
  let framesChanged = false;
  let blendsChanged = false;
  for (const sequence of lookup.sequences) {
    if (activeTextureIndices && !activeTextureIndices.has(sequence.textureIndex)) continue;
    const sample = freezeFirstFrame ? firstFrameSample(sequence) : frameSampleAtTick(sequence, elapsedTicks);
    const offset = sequence.textureIndex * 4;
    const previousCurrent = lookup.pixels[offset]! + lookup.pixels[offset + 1]! * 256;
    const previousNext = lookup.pixels[offset + 2]! + lookup.pixels[offset + 3]! * 256;
    const blendByte = Math.max(0, Math.min(255, Math.round(sample.mix * 255)));
    if (previousCurrent !== sample.currentTextureIndex || previousNext !== sample.nextTextureIndex) {
      writeLookupFrames(lookup.pixels, sequence.textureIndex, sample.currentTextureIndex, sample.nextTextureIndex);
      framesChanged = true;
    }
    if (lookup.blendPixels[offset] !== blendByte) {
      writeLookupBlend(lookup.blendPixels, sequence.textureIndex, sample.mix);
      blendsChanged = true;
    }
  }
  if (framesChanged) lookup.texture.needsUpdate = true;
  if (blendsChanged) lookup.blendTexture.needsUpdate = true;
  changed = framesChanged || blendsChanged;
  return changed;
}

export function millisecondsUntilNextAtlasFrame(
  lookup: AtlasAnimationLookup,
  elapsedMs: number,
  activeTextureIndices?: ReadonlySet<number>,
): number | undefined {
  if (lookup.sequences.length === 0 || activeTextureIndices?.size === 0) return undefined;
  const safeElapsed = Math.max(0, elapsedMs);
  const elapsedTicks = Math.floor(safeElapsed / MINECRAFT_TICK_MS);
  const withinTickMs = safeElapsed % MINECRAFT_TICK_MS;
  let minimum = Number.POSITIVE_INFINITY;
  for (const sequence of lookup.sequences) {
    if (activeTextureIndices && !activeTextureIndices.has(sequence.textureIndex)) continue;
    if (sequence.interpolate) {
      minimum = Math.min(minimum, MINECRAFT_TICK_MS - withinTickMs);
      continue;
    }
    const phase = sequence.totalTicks > 0 ? elapsedTicks % sequence.totalTicks : 0;
    let start = 0;
    for (const frame of sequence.frames) {
      const end = start + frame.time;
      if (phase < end) {
        minimum = Math.min(minimum, (end - phase) * MINECRAFT_TICK_MS - withinTickMs);
        break;
      }
      start = end;
    }
  }
  return Number.isFinite(minimum) ? Math.max(1, Math.ceil(minimum)) : undefined;
}

export function createAtlasAnimationController(
  lookup: AtlasAnimationLookup,
  requestRender: () => void,
  options: {
    reducedMotion?: boolean;
    visible?: boolean;
    activeTextureIndices?: Iterable<number>;
    clock?: AtlasAnimationClock;
    startedAtMs?: number;
  } = {},
): AtlasAnimationController {
  const clock = options.clock ?? browserClock;
  const startedAt = options.startedAtMs ?? clock.now();
  let reducedMotion = options.reducedMotion ?? false;
  let visible = options.visible ?? true;
  let disposed = false;
  let timer: unknown;
  let frameUpdateCount = 0;
  const availableTextureIndices = new Set(lookup.sequences.map((sequence) => sequence.textureIndex));
  let activeTextureIndices = options.activeTextureIndices === undefined
    ? new Set(availableTextureIndices)
    : new Set([...options.activeTextureIndices].filter((value) => availableTextureIndices.has(value)));

  const clear = (): void => {
    if (timer === undefined) return;
    clock.clearTimeout(timer);
    timer = undefined;
  };

  const update = (elapsedMs: number, freeze: boolean): void => {
    if (!sampleAtlasAnimation(lookup, elapsedMs, freeze, activeTextureIndices)) return;
    frameUpdateCount += 1;
    requestRender();
  };

  const schedule = (): void => {
    clear();
    if (disposed || reducedMotion || !visible || activeTextureIndices.size === 0) return;
    const elapsedMs = clock.now() - startedAt;
    const delay = millisecondsUntilNextAtlasFrame(lookup, elapsedMs, activeTextureIndices);
    if (delay === undefined) return;
    timer = clock.setTimeout(() => {
      timer = undefined;
      if (disposed || reducedMotion || !visible) return;
      update(clock.now() - startedAt, false);
      schedule();
    }, delay);
  };

  if (reducedMotion) update(0, true);
  else if (visible) {
    update(clock.now() - startedAt, false);
    schedule();
  }

  return {
    setActiveTextureIndices(values) {
      if (disposed) return;
      const next = new Set([...values].filter((value) => availableTextureIndices.has(value)));
      if (next.size === activeTextureIndices.size && [...next].every((value) => activeTextureIndices.has(value))) return;
      clear();
      activeTextureIndices = next;
      if (activeTextureIndices.size === 0) return;
      if (!visible && !reducedMotion) return;
      update(reducedMotion ? 0 : clock.now() - startedAt, reducedMotion);
      if (!reducedMotion && visible) schedule();
    },
    setReducedMotion(value) {
      if (disposed || reducedMotion === value) return;
      reducedMotion = value;
      if (value) {
        clear();
        update(0, true);
      } else if (visible) {
        update(clock.now() - startedAt, false);
        schedule();
      }
    },
    setVisible(value) {
      if (disposed || visible === value) return;
      visible = value;
      if (!value) clear();
      else if (!reducedMotion) {
        update(clock.now() - startedAt, false);
        schedule();
      }
    },
    getDiagnostics() {
      return {
        availableSequenceCount: lookup.sequences.length,
        sequenceCount: activeTextureIndices.size,
        interpolatedSequenceCount: lookup.sequences.filter((sequence) => (
          activeTextureIndices.has(sequence.textureIndex) && sequence.interpolate
        )).length,
        frameUpdateCount,
        scheduled: timer !== undefined,
        reducedMotion,
        visible,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
    },
  };
}

function firstFrameSample(sequence: AtlasAnimationLookup["sequences"][number]): AnimationFrameSample {
  const textureIndex = sequence.frames[0]!.textureIndex;
  return { currentTextureIndex: textureIndex, nextTextureIndex: textureIndex, mix: 0 };
}

function frameSampleAtTick(sequence: AtlasAnimationLookup["sequences"][number], elapsedTicks: number): AnimationFrameSample {
  const phase = sequence.totalTicks > 0 ? elapsedTicks % sequence.totalTicks : 0;
  let start = 0;
  for (let index = 0; index < sequence.frames.length; index += 1) {
    const frame = sequence.frames[index]!;
    const end = start + frame.time;
    if (phase < end) {
      const next = sequence.frames[(index + 1) % sequence.frames.length]!;
      return {
        currentTextureIndex: frame.textureIndex,
        nextTextureIndex: sequence.interpolate ? next.textureIndex : frame.textureIndex,
        mix: sequence.interpolate ? Math.max(0, Math.min(1, (phase - start) / frame.time)) : 0,
      };
    }
    start = end;
  }
  return firstFrameSample(sequence);
}

interface AnimationFrameSample {
  currentTextureIndex: number;
  nextTextureIndex: number;
  mix: number;
}
