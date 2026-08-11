import { describe, expect, it } from "vitest";
import { boundedSceneSampleCount } from "../src/lighting-postprocess";

describe("cinematic scene antialiasing", () => {
  it("uses a bounded mobile-safe sample count and degrades when unsupported", () => {
    expect(boundedSceneSampleCount(8)).toBe(2);
    expect(boundedSceneSampleCount(4)).toBe(2);
    expect(boundedSceneSampleCount(2)).toBe(2);
    expect(boundedSceneSampleCount(1)).toBe(0);
    expect(boundedSceneSampleCount(Number.NaN)).toBe(0);
  });
});
