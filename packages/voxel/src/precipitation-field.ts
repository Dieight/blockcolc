export interface PrecipitationVector3 {
  x: number;
  y: number;
  z: number;
}

export interface PrecipitationFieldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PrecipitationFieldInput {
  cameraPosition: PrecipitationVector3;
  cameraDirection: PrecipitationVector3;
  cameraUp: PrecipitationVector3;
  fovDegrees: number;
  aspect: number;
  near: number;
  far: number;
  rootRotationY: number;
  precipitationMinY: number;
  precipitationMaxY: number;
  target: PrecipitationVector3;
  bounds: PrecipitationFieldBounds;
  minSpanX: number;
  minSpanZ: number;
  maxSpanX: number;
  maxSpanZ: number;
  edgeMargin: number;
}

export interface PrecipitationField {
  centerX: number;
  centerZ: number;
  spanX: number;
  spanZ: number;
  usedFallback: boolean;
}

export interface RainCrossSectionScaleInput {
  baseCrossSection: number;
  cameraDistance: number;
  fovDegrees: number;
  viewportHeightCss: number;
  targetProjectedCssPx: number;
  maximumScale: number;
}

export interface RainCrossSectionScale {
  scale: number;
  projectedCssPx: number;
}

export interface PrecipitationClockState {
  elapsedMs: number;
  lastUpdateMs: number;
  paused: boolean;
}

export interface PrecipitationClockStep extends PrecipitationClockState {
  advanced: boolean;
  resumed: boolean;
}

const EPSILON = 1e-7;
const FALLBACK_MAX_SPAN = 96;
const FALLBACK_MIN_SPAN = 16;
const ABSOLUTE_MAX_SPAN = 4096;
const CORNER_COORDINATES = [-1, 1] as const;

/** Camera coverage may expand to the visible landscape, never stop at the task footprint. */
export function precipitationFieldLimits(input: {
  previewMode: boolean; visibleSpanX: number; visibleSpanZ: number; framingSpanX: number; framingSpanZ: number;
}): { minSpanX: number; minSpanZ: number; maxSpanX: number; maxSpanZ: number } {
  const axis = (visible: number, framing: number) => {
    const extent = isFinitePositive(visible) ? Math.min(ABSOLUTE_MAX_SPAN, visible) : FALLBACK_MAX_SPAN;
    const frame = isFinitePositive(framing) ? framing : FALLBACK_MIN_SPAN;
    const maximum = input.previewMode ? Math.min(extent, Math.max(12, frame * 1.45 + 6)) : extent;
    const minimum = Math.min(maximum, Math.max(input.previewMode ? 8 : 24, frame * .65));
    return [minimum, maximum] as const;
  };
  const [minSpanX, maxSpanX] = axis(input.visibleSpanX, input.framingSpanX);
  const [minSpanZ, maxSpanZ] = axis(input.visibleSpanZ, input.framingSpanZ);
  return { minSpanX, minSpanZ, maxSpanX, maxSpanZ };
}

/**
 * Produces a bounded root-local x/z field covering the camera frustum where it
 * crosses the precipitation height slab. No Three.js types are needed, so the
 * geometry stays cheap to exercise with deterministic unit tests.
 */
export function precipitationFieldForView(input: PrecipitationFieldInput): PrecipitationField {
  const bounds = input.bounds;
  const yaw = Number.isFinite(input.rootRotationY) ? input.rootRotationY : 0;
  const toLocal = (point: PrecipitationVector3): PrecipitationVector3 => ({
    x: Math.cos(yaw) * point.x - Math.sin(yaw) * point.z,
    y: point.y,
    z: Math.sin(yaw) * point.x + Math.cos(yaw) * point.z,
  });
  const fallback = (): PrecipitationField => {
    if (!isUsableBounds(bounds)) return { centerX: 0, centerZ: 0, spanX: 0, spanZ: 0, usedFallback: true };
    const boundSpanX = safeSpanBetween(bounds.minX, bounds.maxX);
    const boundSpanZ = safeSpanBetween(bounds.minZ, bounds.maxZ);
    const maxSpanX = safeFallbackMaximum(input.maxSpanX, boundSpanX);
    const maxSpanZ = safeFallbackMaximum(input.maxSpanZ, boundSpanZ);
    const safeInput: PrecipitationFieldInput = {
      ...input,
      rootRotationY: yaw,
      minSpanX: Math.min(safeFallbackMinimum(input.minSpanX), maxSpanX),
      minSpanZ: Math.min(safeFallbackMinimum(input.minSpanZ), maxSpanZ),
      maxSpanX,
      maxSpanZ,
      edgeMargin: Number.isFinite(input.edgeMargin) && input.edgeMargin >= 0 ? input.edgeMargin : 0,
    };
    const safeTarget = isFiniteVector(input.target) ? toLocal(input.target) : {
      x: safeMidpoint(bounds.minX, bounds.maxX),
      y: 0,
      z: safeMidpoint(bounds.minZ, bounds.maxZ),
    };
    return fitField(safeTarget.x, safeTarget.z, safeInput.minSpanX, safeInput.minSpanZ,
      safeInput, true, safeTarget);
  };

  if (!isFiniteVector(input.cameraPosition) || !isFiniteVector(input.cameraDirection) || !isFiniteVector(input.cameraUp)
    || !isFiniteVector(input.target) || !isUsableBounds(bounds)
    || !Number.isFinite(input.fovDegrees) || input.fovDegrees <= 0 || input.fovDegrees >= 179
    || !Number.isFinite(input.aspect) || input.aspect <= 0
    || !Number.isFinite(input.near) || input.near < 0
    || !Number.isFinite(input.far) || input.far <= input.near
    || !Number.isFinite(input.rootRotationY)
    || !Number.isFinite(input.precipitationMinY) || !Number.isFinite(input.precipitationMaxY)
    || input.precipitationMaxY < input.precipitationMinY
    || !isFinitePositive(input.minSpanX) || !isFinitePositive(input.minSpanZ)
    || !isFinitePositive(input.maxSpanX) || !isFinitePositive(input.maxSpanZ)
    || input.maxSpanX < input.minSpanX || input.maxSpanZ < input.minSpanZ
    || !Number.isFinite(input.edgeMargin) || input.edgeMargin < 0) return fallback();

  const cameraPosition = toLocal(input.cameraPosition);
  const direction = normalize(toLocal(input.cameraDirection));
  const upHint = normalize(toLocal(input.cameraUp));
  if (!direction || !upHint) return fallback();
  const right = normalize(cross(direction, upHint));
  if (!right) return fallback();
  const up = normalize(cross(right, direction));
  if (!up) return fallback();

  const tanHalfFov = Math.tan((input.fovDegrees * Math.PI) / 360);
  const points: Array<{ x: number; z: number }> = [];
  for (const ndcY of CORNER_COORDINATES) {
    for (const ndcX of CORNER_COORDINATES) {
      const rayDirection = normalize({
        x: direction.x + right.x * ndcX * tanHalfFov * input.aspect + up.x * ndcY * tanHalfFov,
        y: direction.y + right.y * ndcX * tanHalfFov * input.aspect + up.y * ndcY * tanHalfFov,
        z: direction.z + right.z * ndcX * tanHalfFov * input.aspect + up.z * ndcY * tanHalfFov,
      });
      if (!rayDirection) continue;
      const interval = rayIntervalInHeightSlab(cameraPosition.y, rayDirection.y,
        input.precipitationMinY, input.precipitationMaxY, input.near, input.far);
      if (!interval) continue;
      for (const distance of [interval.near, interval.far]) {
        const point = {
          x: cameraPosition.x + rayDirection.x * distance,
          z: cameraPosition.z + rayDirection.z * distance,
        };
        if (Number.isFinite(point.x) && Number.isFinite(point.z)) points.push(point);
      }
    }
  }
  if (points.length < 2) return fallback();

  let minX = Math.min(...points.map(point => point.x));
  let maxX = Math.max(...points.map(point => point.x));
  let minZ = Math.min(...points.map(point => point.z));
  let maxZ = Math.max(...points.map(point => point.z));
  minX -= input.edgeMargin;
  maxX += input.edgeMargin;
  minZ -= input.edgeMargin;
  maxZ += input.edgeMargin;
  const target = toLocal(input.target);
  return fitField((minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX, maxZ - minZ, input, false, target);
}

/** Maps stable normalized particle offsets into the latest field without resampling its seed. */
export function precipitationPositionForOffset(
  field: PrecipitationField,
  offsetX: number,
  offsetZ: number,
): { x: number; z: number } {
  return {
    x: field.centerX + clampFinite(offsetX, -0.5, 0.5) * field.spanX,
    z: field.centerZ + clampFinite(offsetZ, -0.5, 0.5) * field.spanZ,
  };
}

/** Bounded world-space widening for thin rain that otherwise projects subpixel at distance. */
export function rainCrossSectionScaleForView(input: RainCrossSectionScaleInput): RainCrossSectionScale {
  const baseWidth = isFinitePositive(input.baseCrossSection) ? input.baseCrossSection : 0.022;
  const distance = isFinitePositive(input.cameraDistance) ? input.cameraDistance : 1;
  const height = isFinitePositive(input.viewportHeightCss) ? input.viewportHeightCss : 1;
  const fov = Number.isFinite(input.fovDegrees) && input.fovDegrees > 0 && input.fovDegrees < 179
    ? input.fovDegrees : 34;
  const targetPx = isFinitePositive(input.targetProjectedCssPx) ? input.targetProjectedCssPx : 1;
  const maxScale = isFinitePositive(input.maximumScale) ? Math.max(1, input.maximumScale) : 1;
  const pixelsPerWorldUnit = height / (2 * Math.tan((fov * Math.PI) / 360) * distance);
  const scale = clampFinite(targetPx / Math.max(0.01, baseWidth * pixelsPerWorldUnit), 1, maxScale);
  return { scale, projectedCssPx: baseWidth * scale * pixelsPerWorldUnit };
}

/** Freezes hidden/reduced time and resumes without a large catch-up delta. Dragging is not a pause. */
export function stepPrecipitationClock(
  state: PrecipitationClockState,
  nowMs: number,
  shouldPause: boolean,
  minimumIntervalMs: number,
): PrecipitationClockStep {
  const now = Number.isFinite(nowMs) ? nowMs : Number.isFinite(state.lastUpdateMs) ? state.lastUpdateMs : 0;
  const elapsedMs = Number.isFinite(state.elapsedMs) && state.elapsedMs >= 0 ? state.elapsedMs : 0;
  const lastUpdateMs = Number.isFinite(state.lastUpdateMs) ? state.lastUpdateMs : now;
  if (shouldPause) return { elapsedMs, lastUpdateMs: now, paused: true, advanced: false, resumed: false };
  if (state.paused) return { elapsedMs, lastUpdateMs: now, paused: false, advanced: false, resumed: true };
  const interval = Number.isFinite(minimumIntervalMs) && minimumIntervalMs >= 0 ? minimumIntervalMs : 0;
  const delta = now - lastUpdateMs;
  if (!Number.isFinite(delta) || delta < interval || delta <= 0) {
    return { elapsedMs, lastUpdateMs, paused: false, advanced: false, resumed: false };
  }
  return { elapsedMs: elapsedMs + delta, lastUpdateMs: now, paused: false, advanced: true, resumed: false };
}

function fitField(
  centerX: number,
  centerZ: number,
  requestedSpanX: number,
  requestedSpanZ: number,
  input: PrecipitationFieldInput,
  usedFallback: boolean,
  target = input.target,
): PrecipitationField {
  const bounds = input.bounds;
  const boundSpanX = Math.max(0.01, safeSpanBetween(bounds.minX, bounds.maxX));
  const boundSpanZ = Math.max(0.01, safeSpanBetween(bounds.minZ, bounds.maxZ));
  const maxSpanX = Math.min(input.maxSpanX, boundSpanX);
  const maxSpanZ = Math.min(input.maxSpanZ, boundSpanZ);
  const minSpanX = Math.min(input.minSpanX, maxSpanX);
  const minSpanZ = Math.min(input.minSpanZ, maxSpanZ);
  const spanX = clampFinite(requestedSpanX, minSpanX, maxSpanX);
  const spanZ = clampFinite(requestedSpanZ, minSpanZ, maxSpanZ);
  const safeTargetX = Number.isFinite(target.x) ? target.x : safeMidpoint(bounds.minX, bounds.maxX);
  const safeTargetZ = Number.isFinite(target.z) ? target.z : safeMidpoint(bounds.minZ, bounds.maxZ);
  const safeCenterX = !Number.isFinite(requestedSpanX) || requestedSpanX > maxSpanX
    ? safeTargetX : Number.isFinite(centerX) ? centerX : safeTargetX;
  const safeCenterZ = !Number.isFinite(requestedSpanZ) || requestedSpanZ > maxSpanZ
    ? safeTargetZ : Number.isFinite(centerZ) ? centerZ : safeTargetZ;
  return {
    centerX: clampFinite(safeCenterX, bounds.minX + spanX / 2, bounds.maxX - spanX / 2),
    centerZ: clampFinite(safeCenterZ, bounds.minZ + spanZ / 2, bounds.maxZ - spanZ / 2),
    spanX,
    spanZ,
    usedFallback,
  };
}

function rayIntervalInHeightSlab(
  originY: number,
  directionY: number,
  minY: number,
  maxY: number,
  near: number,
  far: number,
): { near: number; far: number } | null {
  if (Math.abs(directionY) <= EPSILON) {
    return originY < minY || originY > maxY ? null : { near, far };
  }
  const first = (minY - originY) / directionY;
  const second = (maxY - originY) / directionY;
  const slabNear = Math.max(near, Math.min(first, second));
  const slabFar = Math.min(far, Math.max(first, second));
  return slabFar >= slabNear ? { near: slabNear, far: slabFar } : null;
}

function normalize(vector: PrecipitationVector3): PrecipitationVector3 | null {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= EPSILON) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function cross(left: PrecipitationVector3, right: PrecipitationVector3): PrecipitationVector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function isFiniteVector(vector: PrecipitationVector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function isValidBounds(bounds: PrecipitationFieldBounds): boolean {
  return Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX) && bounds.maxX > bounds.minX
    && Number.isFinite(bounds.minZ) && Number.isFinite(bounds.maxZ) && bounds.maxZ > bounds.minZ;
}

function isUsableBounds(bounds: PrecipitationFieldBounds): boolean {
  return isValidBounds(bounds) && safeSpanBetween(bounds.minX, bounds.maxX) >= 0.01
    && safeSpanBetween(bounds.minZ, bounds.maxZ) >= 0.01;
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function safeFallbackMaximum(value: number, boundsSpan: number): number {
  const boundedSpan = Math.min(ABSOLUTE_MAX_SPAN, Math.max(0.01, boundsSpan));
  const requested = isFinitePositive(value) ? value : FALLBACK_MAX_SPAN;
  return Math.min(boundedSpan, ABSOLUTE_MAX_SPAN, Math.max(0.01, requested));
}

function safeSpanBetween(minimum: number, maximum: number): number {
  const span = maximum - minimum;
  return Number.isFinite(span) ? Math.max(0, span) : ABSOLUTE_MAX_SPAN;
}

function safeMidpoint(minimum: number, maximum: number): number {
  return minimum / 2 + maximum / 2;
}

function safeFallbackMinimum(value: number): number {
  return isFinitePositive(value) ? Math.min(ABSOLUTE_MAX_SPAN, value) : FALLBACK_MIN_SPAN;
}

function clampFinite(value: number, minimum: number, maximum: number): number {
  const finiteValue = Number.isFinite(value) ? value : (minimum + maximum) / 2;
  return Math.max(minimum, Math.min(maximum, finiteValue));
}
