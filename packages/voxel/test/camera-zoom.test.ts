import { describe, expect, it } from "vitest";
import { cameraZoomBounds, clampCameraDistance, openingZoomDistance } from "../src/camera-zoom";

describe("renderer camera zoom bounds", () => {
  it('keeps the whole valley fitted while no longer zooming beyond its overview, without changing close inspection', () => {
    expect(cameraZoomBounds(100, 'settlement', 'natural-valley')).toEqual({ minimum: 45, maximum: 90 });
    expect(cameraZoomBounds(100, 'settlement', 'ocean-island').maximum).toBeCloseTo(114);
    expect(cameraZoomBounds(100, 'preview', 'natural-valley').maximum).toBeCloseTo(135);
    expect(cameraZoomBounds(100, 'focused', 'natural-valley').minimum).toBe(90);
  });
  it("moves through the full opening range with even projected scale changes", () => {
    expect(openingZoomDistance(120, 30, 0)).toBe(120);
    expect(openingZoomDistance(120, 30, .5)).toBeCloseTo(60);
    expect(openingZoomDistance(120, 30, 1)).toBe(30);
    const distances = Array.from({ length: 11 }, (_, i) => openingZoomDistance(120, 30, i / 10));
    for (let i = 1; i < distances.length - 1; i++) {
      expect(distances[i]! / distances[i - 1]!).toBeCloseTo(distances[i + 1]! / distances[i]!);
    }
  });
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
