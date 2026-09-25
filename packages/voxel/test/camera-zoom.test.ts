import { describe, expect, it } from "vitest";
import { cameraZoomBounds, clampCameraDistance } from "../src/camera-zoom";

describe("renderer camera zoom bounds", () => {
  it("lets the settlement camera zoom closer than blueprint previews", () => {
    const fittedDistance = 100;
    const settlement = cameraZoomBounds(fittedDistance, "settlement");
    const preview = cameraZoomBounds(fittedDistance, "preview");

    expect(settlement.minimum).toBe(45);
    expect(preview.minimum).toBe(65);
    expect(settlement.minimum).toBeLessThan(preview.minimum);
    expect(settlement.maximum).toBeCloseTo(114);
    expect(preview.maximum).toBeCloseTo(135);
  });

  it("keeps focused-building bounds and clamps shared zoom input at both ends", () => {
    const bounds = cameraZoomBounds(80, "focused");

    expect(bounds.minimum).toBe(72);
    expect(bounds.maximum).toBe(108);
    expect(clampCameraDistance(1, bounds.minimum, bounds.maximum)).toBe(72);
    expect(clampCameraDistance(90, bounds.minimum, bounds.maximum)).toBe(90);
    expect(clampCameraDistance(200, bounds.minimum, bounds.maximum)).toBe(108);
  });
});
