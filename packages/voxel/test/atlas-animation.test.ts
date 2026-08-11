import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  createAtlasAnimationController,
  millisecondsUntilNextAtlasFrame,
  sampleAtlasAnimation,
  type AtlasAnimationClock,
} from "../src/atlas-animation";
import type { AtlasAnimationLookup } from "../src/resource-textures";
import { writeLookupBlend, writeLookupTile } from "../src/resource-textures";

describe("request-on-demand atlas animation", () => {
  it("samples current, next, and per-tile interpolation mix on Minecraft ticks", () => {
    const lookup = animationLookup(true);
    const initialVersion = lookup.texture.version;
    const initialBlendVersion = lookup.blendTexture.version;

    expect(sampleAtlasAnimation(lookup, 0)).toBe(true);
    expect(readTile(lookup, 3)).toBe(3);
    expect(readNextTile(lookup, 3)).toBe(5);
    expect(readBlend(lookup, 3)).toBe(0);
    expect(sampleAtlasAnimation(lookup, 50)).toBe(true);
    expect(readBlend(lookup, 3)).toBeCloseTo(0.5, 2);
    expect(sampleAtlasAnimation(lookup, 99)).toBe(true);
    expect(readBlend(lookup, 3)).toBeGreaterThan(0.98);
    expect(sampleAtlasAnimation(lookup, 100)).toBe(true);
    expect(readTile(lookup, 3)).toBe(5);
    expect(readNextTile(lookup, 3)).toBe(3);
    expect(readBlend(lookup, 3)).toBe(0);
    expect(lookup.texture.version).toBe(initialVersion + 2);
    expect(lookup.blendTexture.version).toBeGreaterThan(initialBlendVersion);
    expect(millisecondsUntilNextAtlasFrame(lookup, 100)).toBe(50);

    lookup.texture.dispose();
    lookup.blendTexture.dispose();
  });

  it("keeps mix factors independent and leaves discrete sequences on frame boundaries", () => {
    const baseLookup = animationLookup(true);
    const lookup: AtlasAnimationLookup = { ...baseLookup, sequences: [...baseLookup.sequences, {
      textureIndex: 2,
      totalTicks: 8,
      interpolate: true,
      frames: [{ textureIndex: 2, time: 4 }, { textureIndex: 7, time: 4 }],
    }] };
    sampleAtlasAnimation(lookup, 50);
    expect(readBlend(lookup, 3)).toBeCloseTo(0.5, 2);
    expect(readBlend(lookup, 2)).toBeCloseTo(0.25, 2);

    lookup.sequences[0]!.interpolate = false;
    sampleAtlasAnimation(lookup, 100);
    expect(readTile(lookup, 3)).toBe(5);
    expect(readNextTile(lookup, 3)).toBe(5);
    expect(readBlend(lookup, 3)).toBe(0);
    expect(millisecondsUntilNextAtlasFrame(lookup, 100, new Set([3]))).toBe(150);
    lookup.texture.dispose();
    lookup.blendTexture.dispose();
  });

  it("uses frame-boundary timers, freezes on reduced motion, and stops while hidden", () => {
    const lookup = animationLookup(true);
    const clock = new FakeClock();
    const render = vi.fn();
    const controller = createAtlasAnimationController(lookup, render, { clock, activeTextureIndices: [] });

    expect(controller.getDiagnostics()).toMatchObject({
      availableSequenceCount: 1,
      sequenceCount: 0,
      interpolatedSequenceCount: 0,
      frameUpdateCount: 0,
      scheduled: false,
      reducedMotion: false,
      visible: true,
    });
    controller.setActiveTextureIndices([7]);
    expect(controller.getDiagnostics().scheduled).toBe(false);
    controller.setActiveTextureIndices([3]);
    expect(controller.getDiagnostics()).toMatchObject({
      sequenceCount: 1,
      interpolatedSequenceCount: 1,
      scheduled: true,
    });
    expect(render).toHaveBeenCalledTimes(1);
    clock.advance(50);
    expect(render).toHaveBeenCalledTimes(2);
    expect(readBlend(lookup, 3)).toBeCloseTo(0.5, 2);
    clock.advance(50);
    expect(render).toHaveBeenCalledTimes(3);
    expect(readTile(lookup, 3)).toBe(5);

    controller.setReducedMotion(true);
    expect(readTile(lookup, 3)).toBe(3);
    expect(readNextTile(lookup, 3)).toBe(3);
    expect(readBlend(lookup, 3)).toBe(0);
    expect(render).toHaveBeenCalledTimes(4);
    expect(controller.getDiagnostics().scheduled).toBe(false);
    clock.advance(1_000);
    expect(render).toHaveBeenCalledTimes(4);

    controller.setReducedMotion(false);
    expect(controller.getDiagnostics().scheduled).toBe(true);
    expect(render).toHaveBeenCalledTimes(5);
    controller.setVisible(false);
    expect(controller.getDiagnostics().scheduled).toBe(false);
    clock.advance(1_000);
    expect(render).toHaveBeenCalledTimes(5);

    controller.setVisible(true);
    expect(clock.pendingCount).toBe(1);
    controller.dispose();
    expect(clock.pendingCount).toBe(0);
    lookup.texture.dispose();
    lookup.blendTexture.dispose();
  });

  it("keeps page-local controllers and active tile sets independent", () => {
    const first = animationLookup(true, 3, 5);
    const second = animationLookup(true, 1, 6);
    const clock = new FakeClock();
    const firstRender = vi.fn();
    const secondRender = vi.fn();
    const firstController = createAtlasAnimationController(first, firstRender, { clock, activeTextureIndices: [3], startedAtMs: 0 });
    const secondController = createAtlasAnimationController(second, secondRender, { clock, activeTextureIndices: [], startedAtMs: 0 });

    clock.advance(50);
    expect(readBlend(first, 3)).toBeCloseTo(0.5, 2);
    expect(readBlend(second, 1)).toBe(0);
    expect(firstRender).toHaveBeenCalled();
    expect(secondRender).not.toHaveBeenCalled();
    secondController.setActiveTextureIndices([1]);
    clock.advance(50);
    expect(readTile(first, 3)).toBe(5);
    expect(readTile(second, 1)).toBe(6);

    firstController.dispose();
    secondController.dispose();
    first.texture.dispose();
    first.blendTexture.dispose();
    second.texture.dispose();
    second.blendTexture.dispose();
  });
});

function animationLookup(interpolate: boolean, textureIndex = 3, nextTextureIndex = 5): AtlasAnimationLookup {
  const width = 8;
  const height = 1;
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < width; index += 1) writeLookupTile(pixels, index, index);
  const blendPixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < width; index += 1) writeLookupBlend(blendPixels, index, 0);
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  const blendTexture = new THREE.DataTexture(blendPixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.needsUpdate = true;
  blendTexture.needsUpdate = true;
  return {
    texture,
    pixels,
    blendTexture,
    blendPixels,
    width,
    height,
    tileCount: width,
    sequences: [{
      textureIndex,
      totalTicks: 5,
      interpolate,
      frames: [{ textureIndex, time: 2 }, { textureIndex: nextTextureIndex, time: 3 }],
    }],
  };
}

function readNextTile(lookup: AtlasAnimationLookup, index: number): number {
  return lookup.pixels[index * 4 + 2]! + lookup.pixels[index * 4 + 3]! * 256;
}

function readBlend(lookup: AtlasAnimationLookup, index: number): number {
  return lookup.blendPixels[index * 4]! / 255;
}

function readTile(lookup: AtlasAnimationLookup, index: number): number {
  return lookup.pixels[index * 4]! + lookup.pixels[index * 4 + 1]! * 256;
}

class FakeClock implements AtlasAnimationClock {
  private nowMs = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  get pendingCount(): number { return this.timers.size; }

  now(): number { return this.nowMs; }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowMs + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(durationMs: number): void {
    const target = this.nowMs + durationMs;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      this.nowMs = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.nowMs = target;
  }
}
