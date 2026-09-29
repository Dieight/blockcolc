import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  boundedSceneSampleCount,
  LightingPostProcessor,
  POSTPROCESS_TERMINAL_TONE_MAPPED,
  terminalCompositeFragmentShader,
} from "../src/lighting-postprocess";

describe("cinematic scene antialiasing", () => {
  it("uses a bounded mobile-safe sample count and degrades when unsupported", () => {
    expect(boundedSceneSampleCount(8)).toBe(2);
    expect(boundedSceneSampleCount(4)).toBe(2);
    expect(boundedSceneSampleCount(2)).toBe(2);
    expect(boundedSceneSampleCount(1)).toBe(0);
    expect(boundedSceneSampleCount(Number.NaN)).toBe(0);
  });

  it("applies ACES before the single terminal sRGB encoding", () => {
    const aces = terminalCompositeFragmentShader.indexOf("#include <tonemapping_fragment>");
    const srgb = terminalCompositeFragmentShader.indexOf("#include <colorspace_fragment>");
    expect(POSTPROCESS_TERMINAL_TONE_MAPPED).toBe(true);
    expect(aces).toBeGreaterThanOrEqual(0);
    expect(srgb).toBeGreaterThan(aces);
    expect(terminalCompositeFragmentShader.match(/#include <tonemapping_fragment>/g)).toHaveLength(1);
    expect(terminalCompositeFragmentShader.match(/#include <colorspace_fragment>/g)).toHaveLength(1);
  });
});

describe("transactional post-process targets", () => {
  it("keeps old targets available through commit, supports rollback, and only releases them on finalize", () => {
    const renderer = {
      capabilities: { maxSamples: 4 },
      setRenderTarget: vi.fn(), clear: vi.fn(), render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    const post = new LightingPostProcessor(renderer);
    const dispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, "dispose");

    const failedAttempt = post.prepareConfiguration(true, 0.32, 80, 60, 1);
    expect(post.getDiagnostics().enabled).toBe(false);
    failedAttempt.discard();
    expect(post.getDiagnostics().enabled).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(4);
    dispose.mockClear();

    const firstCommit = post.prepareConfiguration(true, 0.32, 80, 60, 1);
    firstCommit.commit();
    expect(post.getDiagnostics().enabled).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
    firstCommit.rollback();
    expect(post.getDiagnostics().enabled).toBe(false);
    firstCommit.discard();
    expect(dispose).toHaveBeenCalledTimes(4);
    dispose.mockClear();

    const successfulCommit = post.prepareConfiguration(true, 0.2, 80, 60, 1);
    successfulCommit.commit();
    expect(dispose).not.toHaveBeenCalled();
    successfulCommit.finalize();
    expect(dispose).toHaveBeenCalledTimes(4);
    dispose.mockClear();

    const unchanged = post.prepareConfiguration(true, 0.2, 80, 60, 1);
    unchanged.commit();
    unchanged.rollback();
    expect(post.getDiagnostics().enabled).toBe(true);
    unchanged.discard();

    const failedDowngrade = post.prepareConfiguration(false, 0, 80, 60, 1);
    failedDowngrade.discard();
    expect(post.getDiagnostics().enabled).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(4);
    dispose.mockRestore();
  });
});
