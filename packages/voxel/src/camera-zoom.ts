export type CameraZoomMode = "settlement" | "focused" | "preview";

export interface CameraZoomBounds {
  minimum: number;
  maximum: number;
}

export const CAMERA_ZOOM_DISTANCE_RATIOS = {
  settlementMinimum: 0.45,
  previewMinimum: 0.65,
  focusedMinimum: 0.9,
  settlementMaximum: 1.14,
  closeViewMaximum: 1.35,
} as const;

export function cameraZoomBounds(fittedDistance: number, mode: CameraZoomMode): CameraZoomBounds {
  const minimumRatio = mode === "focused"
    ? CAMERA_ZOOM_DISTANCE_RATIOS.focusedMinimum
    : mode === "preview"
      ? CAMERA_ZOOM_DISTANCE_RATIOS.previewMinimum
      : CAMERA_ZOOM_DISTANCE_RATIOS.settlementMinimum;
  const maximumRatio = mode === "settlement"
    ? CAMERA_ZOOM_DISTANCE_RATIOS.settlementMaximum
    : CAMERA_ZOOM_DISTANCE_RATIOS.closeViewMaximum;
  return {
    minimum: fittedDistance * minimumRatio,
    maximum: fittedDistance * maximumRatio,
  };
}

export function clampCameraDistance(distance: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, distance));
}
