import { describe, expect, it, vi } from "vitest";
import { attemptQualityProjection, resolveCappedQualityTier } from "../src/quality-projection";

const strongDevice = { devicePixelRatio: 1, hardwareConcurrency: 8, deviceMemoryGb: 8, maxTextureSize: 8192 };

describe("quality projection request semantics", () => {
  it("keeps the selected preference separate from an adaptive ceiling", () => {
    expect(resolveCappedQualityTier(strongDevice, "cinematic", "balanced")).toBe("balanced");
    expect(resolveCappedQualityTier(strongDevice, "performance", "high")).toBe("low");
    expect(resolveCappedQualityTier(strongDevice, "auto", "high")).toBe("high");
  });

  it("does not consume a failed request and retries that same preference", () => {
    const initial = { preference: "balanced" as const, tier: "balanced" as const };
    const apply = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const failed = attemptQualityProjection(initial, "cinematic", "high", apply);
    expect(failed).toEqual({ state: initial, succeeded: false, noOp: false });
    const retried = attemptQualityProjection(failed.state, "cinematic", "high", apply);
    expect(retried).toEqual({ state: { preference: "cinematic", tier: "high" }, succeeded: true, noOp: false });
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("treats an accepted repeated request and preference-only capped change as no-ops", () => {
    const current = { preference: "balanced" as const, tier: "balanced" as const };
    const apply = vi.fn(() => true);
    expect(attemptQualityProjection(current, "balanced", "balanced", apply)).toMatchObject({ succeeded: true, noOp: true });
    expect(attemptQualityProjection(current, "cinematic", "balanced", apply)).toEqual({
      state: { preference: "cinematic", tier: "balanced" }, succeeded: true, noOp: true,
    });
    expect(apply).not.toHaveBeenCalled();
  });
});
