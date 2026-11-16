export type CameraZoomMode = "settlement" | "focused" | "preview";

export interface CameraZoomBounds {
  minimum: number;
  maximum: number;
}

export const CAMERA_ZOOM_DISTANCE_RATIOS = {
  settlementMinimum: 0.1,
  previewMinimum: 0.65,
  focusedMinimum: 0.9,
  settlementMaximum: 0.9,
  closeViewMaximum: 1.35,
} as const;

export function cameraZoomBounds(fittedDistance: number, mode: CameraZoomMode, environment?: 'natural-valley' | 'classic-island' | 'ocean-island' | 'mosaic-coast'): CameraZoomBounds {
  const minimumRatio = mode === "focused"
    ? CAMERA_ZOOM_DISTANCE_RATIOS.focusedMinimum
    : mode === "preview"
      ? CAMERA_ZOOM_DISTANCE_RATIOS.previewMinimum
      : CAMERA_ZOOM_DISTANCE_RATIOS.settlementMinimum;
  const maximumRatio = mode === "settlement"
    ? environment === 'natural-valley' ? 0.9 : CAMERA_ZOOM_DISTANCE_RATIOS.settlementMaximum
    : CAMERA_ZOOM_DISTANCE_RATIOS.closeViewMaximum;
  return {
    // A one-building settlement must not place its camera inside the roof.
    minimum: mode==='settlement'?Math.min(fittedDistance*maximumRatio,Math.max(12,fittedDistance*minimumRatio)):fittedDistance*minimumRatio,
    maximum: fittedDistance * maximumRatio,
  };
}

/** Keep launch composition separate from the additional close-inspection range. */
export function settlementOpeningDistance(fittedDistance:number,minimum:number,maximum:number):number{
  return clampCameraDistance(fittedDistance*.45,minimum,maximum);
}

export function clampCameraDistance(distance: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, distance));
}

/** Equal progress changes projected scale evenly, rather than rushing the final close-up. */
export function openingZoomDistance(from: number, to: number, progress: number): number {
  const eased = Math.max(0, Math.min(1, progress));
  if (eased === 0) return from;
  if (eased === 1) return to;
  return Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * eased);
}
