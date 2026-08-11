import type { QualityTier } from "./quality";

export type Vector3Tuple = readonly [number, number, number];

export interface LightweightShadingFeatures {
  directionalShadow: boolean;
  faceAmbientOcclusion: boolean;
  warmCoolTint: boolean;
  cutoutShadows: boolean;
  halfResolutionBloom: boolean;
  simpleWaterHighlights: boolean;
}

export interface ShadowRefreshPolicy {
  minimumIntervalMs: number;
  maximumIntervalMs: number;
  timeSliceMs: number;
  angularThresholdRadians: number;
  cameraMovementThreshold: number;
}

export interface LightweightShadingProfile {
  tier: QualityTier;
  features: LightweightShadingFeatures;
  ambientStrength: number;
  directStrength: number;
  faceContrast: number;
  topFaceBoost: number;
  bottomFaceScale: number;
  ambientOcclusionStrength: number;
  shadowStrength: number;
  warmColor: number;
  coolColor: number;
  neutralColor: number;
  shadowRefresh: ShadowRefreshPolicy;
}

export const LIGHTWEIGHT_SHADING_PROFILES: Readonly<Record<QualityTier, LightweightShadingProfile>> = {
  low: Object.freeze({
    tier: "low",
    features: Object.freeze({
      directionalShadow: true,
      faceAmbientOcclusion: true,
      warmCoolTint: true,
      cutoutShadows: false,
      halfResolutionBloom: false,
      simpleWaterHighlights: false,
    }),
    ambientStrength: 0.58,
    directStrength: 0.56,
    faceContrast: 0.18,
    topFaceBoost: 0.08,
    bottomFaceScale: 0.72,
    ambientOcclusionStrength: 0.3,
    shadowStrength: 0.52,
    warmColor: 0xffd6a2,
    coolColor: 0x7890ac,
    neutralColor: 0xffffff,
    shadowRefresh: Object.freeze({
      minimumIntervalMs: 750,
      maximumIntervalMs: 600_000,
      timeSliceMs: 600_000,
      angularThresholdRadians: degreesToRadians(4),
      cameraMovementThreshold: 4,
    }),
  }),
  balanced: Object.freeze({
    tier: "balanced",
    features: Object.freeze({
      directionalShadow: true,
      faceAmbientOcclusion: true,
      warmCoolTint: true,
      cutoutShadows: true,
      halfResolutionBloom: false,
      simpleWaterHighlights: true,
    }),
    ambientStrength: 0.52,
    directStrength: 0.68,
    faceContrast: 0.22,
    topFaceBoost: 0.1,
    bottomFaceScale: 0.68,
    ambientOcclusionStrength: 0.38,
    shadowStrength: 0.6,
    warmColor: 0xffd19a,
    coolColor: 0x7088aa,
    neutralColor: 0xffffff,
    shadowRefresh: Object.freeze({
      minimumIntervalMs: 400,
      maximumIntervalMs: 450_000,
      timeSliceMs: 300_000,
      angularThresholdRadians: degreesToRadians(2),
      cameraMovementThreshold: 2,
    }),
  }),
  high: Object.freeze({
    tier: "high",
    features: Object.freeze({
      directionalShadow: true,
      faceAmbientOcclusion: true,
      warmCoolTint: true,
      cutoutShadows: true,
      halfResolutionBloom: true,
      simpleWaterHighlights: true,
    }),
    ambientStrength: 0.48,
    directStrength: 0.76,
    faceContrast: 0.25,
    topFaceBoost: 0.12,
    bottomFaceScale: 0.65,
    ambientOcclusionStrength: 0.44,
    shadowStrength: 0.66,
    warmColor: 0xffcb8f,
    coolColor: 0x6981a5,
    neutralColor: 0xffffff,
    shadowRefresh: Object.freeze({
      minimumIntervalMs: 250,
      maximumIntervalMs: 300_000,
      timeSliceMs: 300_000,
      angularThresholdRadians: degreesToRadians(1),
      cameraMovementThreshold: 1,
    }),
  }),
};

export interface FaceShadingInput {
  normal: Vector3Tuple;
  lightDirection: Vector3Tuple;
  /** 0 is fully lit, 1 is fully shadowed. */
  shadow: number;
  /** 0 is unoccluded, 1 is maximally occluded. */
  ambientOcclusion: number;
}

export interface FaceShadingResult {
  brightness: number;
  directFactor: number;
  orientationFactor: number;
  warmMix: number;
  coolMix: number;
  tintColor: number;
}

export function shadeVoxelFace(
  input: FaceShadingInput,
  profile: LightweightShadingProfile,
): FaceShadingResult {
  const normal = normalized(input.normal, "normal");
  const light = normalized(input.lightDirection, "lightDirection");
  const shadow = clamp01(input.shadow);
  const ambientOcclusion = clamp01(input.ambientOcclusion);
  const facing = Math.max(0, dot(normal, light));
  const top = Math.max(0, normal[1]);
  const bottom = Math.max(0, -normal[1]);
  const side = 1 - Math.abs(normal[1]);
  const orientationFactor = clamp(
    1 + top * profile.topFaceBoost - bottom * (1 - profile.bottomFaceScale) - side * profile.faceContrast * (1 - facing),
    0.2,
    1.4,
  );
  const directFactor = facing * (1 - shadow * profile.shadowStrength);
  const occlusionFactor = 1 - ambientOcclusion * profile.ambientOcclusionStrength;
  const brightness = clamp(
    (profile.ambientStrength + profile.directStrength * directFactor) * orientationFactor * occlusionFactor,
    0,
    1.5,
  );
  const warmMix = profile.features.warmCoolTint ? clamp01(directFactor * 0.7) : 0;
  const coolMix = profile.features.warmCoolTint ? clamp01((1 - directFactor) * 0.34 + shadow * 0.36) : 0;
  return {
    brightness,
    directFactor,
    orientationFactor,
    warmMix,
    coolMix,
    tintColor: warmCoolTint(profile.neutralColor, profile.warmColor, profile.coolColor, warmMix, coolMix),
  };
}

export function warmCoolTint(
  neutralColor: number,
  warmColor: number,
  coolColor: number,
  warmMix: number,
  coolMix: number,
): number {
  const warm = clamp01(warmMix);
  const cool = clamp01(coolMix) * (1 - warm);
  return mixColor(mixColor(neutralColor, warmColor, warm), coolColor, cool);
}

export interface ShadowRefreshSample {
  sampledAtMs: number;
  lightDirection: Vector3Tuple;
  cameraAnchor: Vector3Tuple;
  sceneRevision: number;
}

export interface ShadowRefreshCandidate extends ShadowRefreshSample {
  force?: boolean;
}

export type ShadowRefreshReason =
  | "initial"
  | "forced"
  | "scene-change"
  | "camera-movement"
  | "light-angle"
  | "maximum-interval"
  | "throttled"
  | "unchanged";

export interface ShadowRefreshDecision {
  refresh: boolean;
  reason: ShadowRefreshReason;
  elapsedMs: number;
  angularDeltaRadians: number;
  cameraMovement: number;
  timeSlice: number;
}

export function shadowTimeSlice(timestampMs: number, policy: ShadowRefreshPolicy): number {
  validateTimestamp(timestampMs, "timestampMs");
  validateShadowPolicy(policy);
  return Math.floor(timestampMs / policy.timeSliceMs);
}

export function shouldRefreshShadow(
  previous: ShadowRefreshSample | undefined,
  candidate: ShadowRefreshCandidate,
  policy: ShadowRefreshPolicy,
): ShadowRefreshDecision {
  validateShadowPolicy(policy);
  validateSample(candidate, "candidate");
  const timeSlice = shadowTimeSlice(candidate.sampledAtMs, policy);
  if (!previous) return decision(true, "initial", 0, 0, 0, timeSlice);
  validateSample(previous, "previous");
  const elapsedMs = Math.max(0, candidate.sampledAtMs - previous.sampledAtMs);
  const angularDeltaRadians = angleBetween(previous.lightDirection, candidate.lightDirection);
  const cameraMovement = distance(previous.cameraAnchor, candidate.cameraAnchor);
  if (candidate.force) return decision(true, "forced", elapsedMs, angularDeltaRadians, cameraMovement, timeSlice);
  if (candidate.sceneRevision !== previous.sceneRevision) {
    return decision(true, "scene-change", elapsedMs, angularDeltaRadians, cameraMovement, timeSlice);
  }
  if (elapsedMs < policy.minimumIntervalMs) {
    return decision(false, "throttled", elapsedMs, angularDeltaRadians, cameraMovement, timeSlice);
  }
  if (cameraMovement >= policy.cameraMovementThreshold) {
    return decision(true, "camera-movement", elapsedMs, angularDeltaRadians, cameraMovement, timeSlice);
  }
  const crossedTimeSlice = timeSlice !== shadowTimeSlice(previous.sampledAtMs, policy);
  if (crossedTimeSlice && angularDeltaRadians >= policy.angularThresholdRadians) {
    return decision(true, "light-angle", elapsedMs, angularDeltaRadians, cameraMovement, timeSlice);
  }
  if (elapsedMs >= policy.maximumIntervalMs) {
    return decision(true, "maximum-interval", elapsedMs, angularDeltaRadians, cameraMovement, timeSlice);
  }
  return decision(false, "unchanged", elapsedMs, angularDeltaRadians, cameraMovement, timeSlice);
}

export function angleBetween(left: Vector3Tuple, right: Vector3Tuple): number {
  const normalizedLeft = normalized(left, "left");
  const normalizedRight = normalized(right, "right");
  return Math.acos(clamp(dot(normalizedLeft, normalizedRight), -1, 1));
}

function decision(
  refresh: boolean,
  reason: ShadowRefreshReason,
  elapsedMs: number,
  angularDeltaRadians: number,
  cameraMovement: number,
  timeSlice: number,
): ShadowRefreshDecision {
  return { refresh, reason, elapsedMs, angularDeltaRadians, cameraMovement, timeSlice };
}

function validateShadowPolicy(policy: ShadowRefreshPolicy): void {
  if (!positiveFinite(policy.minimumIntervalMs) || !positiveFinite(policy.maximumIntervalMs)
    || !positiveFinite(policy.timeSliceMs) || !positiveFinite(policy.angularThresholdRadians)
    || !positiveFinite(policy.cameraMovementThreshold) || policy.maximumIntervalMs < policy.minimumIntervalMs) {
    throw new RangeError("Invalid shadow refresh policy");
  }
}

function validateSample(sample: ShadowRefreshSample, name: string): void {
  validateTimestamp(sample.sampledAtMs, `${name}.sampledAtMs`);
  normalized(sample.lightDirection, `${name}.lightDirection`);
  finiteVector(sample.cameraAnchor, `${name}.cameraAnchor`);
  if (!Number.isSafeInteger(sample.sceneRevision) || sample.sceneRevision < 0) throw new RangeError(`${name}.sceneRevision must be a non-negative safe integer`);
}

function validateTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number`);
}

function normalized(vector: Vector3Tuple, name: string): Vector3Tuple {
  finiteVector(vector, name);
  const length = Math.hypot(...vector);
  if (length <= 1e-9) throw new RangeError(`${name} must be non-zero`);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function finiteVector(vector: Vector3Tuple, name: string): void {
  if (vector.length !== 3 || vector.some((component) => !Number.isFinite(component))) throw new RangeError(`${name} must contain three finite components`);
}

function dot(left: Vector3Tuple, right: Vector3Tuple): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function distance(left: Vector3Tuple, right: Vector3Tuple): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function mixColor(from: number, to: number, amount: number): number {
  const clamped = clamp01(amount);
  const fromR = (from >> 16) & 0xff; const fromG = (from >> 8) & 0xff; const fromB = from & 0xff;
  const toR = (to >> 16) & 0xff; const toG = (to >> 8) & 0xff; const toB = to & 0xff;
  return (Math.round(mix(fromR, toR, clamped)) << 16)
    | (Math.round(mix(fromG, toG, clamped)) << 8)
    | Math.round(mix(fromB, toB, clamped));
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Shading factor must be finite");
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function degreesToRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}
