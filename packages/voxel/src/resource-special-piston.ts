import type { BlueprintVoxel } from "./blueprint";

const MOVING_PISTON_BLOCK_ID = "minecraft:moving_piston";
type MovingPistonPose = NonNullable<BlueprintVoxel["movingPistonPose"]>;
const MOVING_PISTON_FACING_STEPS: Record<MovingPistonPose["facing"], readonly [number, number, number]> = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};
const AIR_BLOCK_IDS = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
]);
const VANILLA_BLOCK_ID_PATTERN = /^minecraft:[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*$/;
const BLOCK_STATE_KEY_PATTERN = /^[a-z0-9_.-]+$/;
const BLOCK_STATE_VALUE_PATTERN = /^[a-z0-9_./-]+$/;
const UNSAFE_BLOCK_STATE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_BLOCK_STATE_PROPERTIES = 32;
const MAX_BLOCK_STATE_KEY_LENGTH = 64;
const MAX_BLOCK_STATE_VALUE_LENGTH = 128;
const PISTON_HEAD_BLOCK_ID = "minecraft:piston_head";
const PISTON_BLOCK_IDS = new Set(["minecraft:piston", "minecraft:sticky_piston"]);

type MovingBlockState = { blockId: string; properties?: Record<string, string> };
type MovingPistonFacing = MovingPistonPose["facing"];
type PistonHeadProperties = {
  facing: MovingPistonFacing;
  type: "default" | "sticky";
  short?: "true" | "false";
};
type PistonBaseProperties = {
  facing: MovingPistonFacing;
  extended?: "true" | "false";
};

export type MovingPistonUnresolvedReason =
  | "missing_moved_state"
  | "invalid_moved_state"
  | "air_moved_state"
  | "nested_moving_piston";

export interface MovingPistonRenderPlan {
  /**
   * A render-only view. Valid moving-piston entries are replaced by fresh
   * display voxels; unresolved entries are omitted so they cannot draw or
   * occlude nearby blocks.
   */
  displayVoxels: BlueprintVoxel[];
  resolved: Array<{ sourceVoxel: BlueprintVoxel; displayVoxel: BlueprintVoxel }>;
  unresolved: Array<{ sourceVoxel: BlueprintVoxel; reason: MovingPistonUnresolvedReason }>;
}

/**
 * Prepares static display voxels for moving_piston entries without modifying
 * the imported blueprint. Resource-pack routing remains the caller's job, so
 * the display voxel is resolved only against the user's active manifest/atlas.
 *
 * Renderer consumers use these coordinates for mesh placement, exact-key
 * occlusion, and deterministic condition decoration. Fractional positions do
 * not occlude integer-neighbor keys, so movement keeps extra faces where a
 * full-face culler cannot describe partial overlap. The two verified client
 * piston-head render cases are modeled with strict state-property allowlists;
 * other source-specific rendering behavior is outside this static planner.
 */
export function planMovingPistonRenderVoxels(voxels: readonly BlueprintVoxel[]): MovingPistonRenderPlan {
  const displayVoxels: BlueprintVoxel[] = [];
  const resolved: MovingPistonRenderPlan["resolved"] = [];
  const unresolved: MovingPistonRenderPlan["unresolved"] = [];

  for (const sourceVoxel of voxels) {
    if (sourceVoxel.sourceBlockId !== MOVING_PISTON_BLOCK_ID) {
      displayVoxels.push(sourceVoxel);
      continue;
    }

    const parsed = parseMovedState(sourceVoxel.movingPistonMovedState);
    if (parsed.status !== "resolved") {
      unresolved.push({ sourceVoxel, reason: parsed.reason });
      continue;
    }

    const pose = parseMovingPistonPose(sourceVoxel.movingPistonPose);
    const renderState = renderStateForMovedBlock(sourceVoxel, parsed.state, pose);
    const displayVoxel: BlueprintVoxel = {
      ...sourceVoxel,
      sourceBlockId: renderState.blockId,
    };
    if (pose !== undefined) {
      const [stepX, stepY, stepZ] = MOVING_PISTON_FACING_STEPS[pose.facing];
      const distance = pose.extending ? pose.progress - 1 : 1 - pose.progress;
      displayVoxel.x += stepX * distance;
      displayVoxel.y += stepY * distance;
      displayVoxel.z += stepZ * distance;
    }
    delete displayVoxel.movingPistonMovedState;
    delete displayVoxel.movingPistonPose;
    delete displayVoxel.sourceBlockState;
    if (renderState.properties !== undefined) {
      displayVoxel.sourceBlockState = renderState.properties;
    }

    displayVoxels.push(displayVoxel);
    if (renderState.additionalDisplayVoxel !== undefined) {
      displayVoxels.push(renderState.additionalDisplayVoxel);
    }
    resolved.push({ sourceVoxel, displayVoxel });
  }

  return { displayVoxels, resolved, unresolved };
}

interface MovingBlockRenderState extends MovingBlockState {
  additionalDisplayVoxel?: BlueprintVoxel;
}

function renderStateForMovedBlock(
  sourceVoxel: BlueprintVoxel,
  movedState: MovingBlockState,
  pose: MovingPistonPose | undefined,
): MovingBlockRenderState {
  if (pose === undefined) return movedState;

  if (movedState.blockId === PISTON_HEAD_BLOCK_ID) {
    const properties = whitelistedPistonHeadProperties(movedState.properties);
    if (properties !== undefined) {
      return {
        blockId: PISTON_HEAD_BLOCK_ID,
        properties: { ...properties, short: String(pose.progress <= 0.5) },
      };
    }
  }

  if (pose.source && !pose.extending && PISTON_BLOCK_IDS.has(movedState.blockId)) {
    const properties = whitelistedPistonBaseProperties(movedState.properties);
    if (properties !== undefined) {
      const additionalDisplayVoxel: BlueprintVoxel = {
        ...sourceVoxel,
        sourceBlockId: movedState.blockId,
        sourceBlockState: { ...properties, extended: "true" },
      };
      delete additionalDisplayVoxel.movingPistonMovedState;
      delete additionalDisplayVoxel.movingPistonPose;

      return {
        blockId: PISTON_HEAD_BLOCK_ID,
        properties: {
          facing: properties.facing,
          type: movedState.blockId === "minecraft:sticky_piston" ? "sticky" : "default",
          short: String(pose.progress >= 0.5),
        },
        additionalDisplayVoxel,
      };
    }
  }

  return movedState;
}

function whitelistedPistonHeadProperties(
  properties: Record<string, string> | undefined,
): PistonHeadProperties | undefined {
  const facing = properties?.facing;
  const type = properties?.type;
  const short = properties?.short;
  if (properties === undefined
    || !isMovingPistonFacing(facing)
    || (type !== "default" && type !== "sticky")
    || (short !== undefined && !isBooleanState(short))
    || Reflect.ownKeys(properties).some((key) => key !== "facing" && key !== "type" && key !== "short")) {
    return undefined;
  }
  return { facing, type, ...(short === undefined ? {} : { short }) };
}

function whitelistedPistonBaseProperties(
  properties: Record<string, string> | undefined,
): PistonBaseProperties | undefined {
  const facing = properties?.facing;
  const extended = properties?.extended;
  if (properties === undefined
    || !isMovingPistonFacing(facing)
    || (extended !== undefined && !isBooleanState(extended))
    || Reflect.ownKeys(properties).some((key) => key !== "facing" && key !== "extended")) {
    return undefined;
  }
  return { facing, ...(extended === undefined ? {} : { extended }) };
}

function isMovingPistonFacing(value: string | undefined): value is MovingPistonPose["facing"] {
  return value !== undefined && Object.prototype.hasOwnProperty.call(MOVING_PISTON_FACING_STEPS, value);
}

function isBooleanState(value: string | undefined): value is "true" | "false" {
  return value === "true" || value === "false";
}

function parseMovingPistonPose(raw: unknown): MovingPistonPose | undefined {
  if (raw === undefined) return undefined;

  try {
    const keys = ["facing", "progress", "extending", "source"] as const;
    if (!isPlainRecord(raw)
      || Reflect.ownKeys(raw).length !== keys.length
      || Reflect.ownKeys(raw).some((key) => typeof key !== "string" || !keys.includes(key as typeof keys[number]))) {
      return undefined;
    }

    const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(raw, key));
    if (descriptors.some((descriptor) => descriptor === undefined || !descriptor.enumerable
      || descriptor.get !== undefined || descriptor.set !== undefined)) {
      return undefined;
    }

    const [facing, progress, extending, source] = descriptors.map((descriptor) => descriptor!.value);
    if (typeof facing !== "string" || !Object.prototype.hasOwnProperty.call(MOVING_PISTON_FACING_STEPS, facing)
      || typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 1
      || typeof extending !== "boolean" || typeof source !== "boolean") {
      return undefined;
    }

    return { facing: facing as MovingPistonPose["facing"], progress, extending, source };
  } catch {
    // Malformed direct callers fall back to the prior centered display safely.
    return undefined;
  }
}

type ParsedMovedState =
  | { status: "resolved"; state: { blockId: string; properties?: Record<string, string> } }
  | { status: "unresolved"; reason: MovingPistonUnresolvedReason };

function parseMovedState(raw: unknown): ParsedMovedState {
  if (raw === undefined) return { status: "unresolved", reason: "missing_moved_state" };

  try {
    if (!isPlainRecord(raw)
      || Reflect.ownKeys(raw).some((key) => key !== "blockId" && key !== "properties")) {
      return { status: "unresolved", reason: "invalid_moved_state" };
    }

    const blockIdDescriptor = Object.getOwnPropertyDescriptor(raw, "blockId");
    if (blockIdDescriptor === undefined || !blockIdDescriptor.enumerable
      || blockIdDescriptor.get !== undefined || blockIdDescriptor.set !== undefined
      || typeof blockIdDescriptor.value !== "string"
      || blockIdDescriptor.value.length > 256
      || !VANILLA_BLOCK_ID_PATTERN.test(blockIdDescriptor.value)) {
      return { status: "unresolved", reason: "invalid_moved_state" };
    }

    const blockId = blockIdDescriptor.value;
    if (AIR_BLOCK_IDS.has(blockId)) return { status: "unresolved", reason: "air_moved_state" };
    if (blockId === MOVING_PISTON_BLOCK_ID) {
      return { status: "unresolved", reason: "nested_moving_piston" };
    }

    const propertiesDescriptor = Object.getOwnPropertyDescriptor(raw, "properties");
    if (propertiesDescriptor === undefined) return { status: "resolved", state: { blockId } };
    if (!propertiesDescriptor.enumerable || propertiesDescriptor.get !== undefined || propertiesDescriptor.set !== undefined) {
      return { status: "unresolved", reason: "invalid_moved_state" };
    }

    const rawProperties = propertiesDescriptor.value;
    if (rawProperties === undefined) return { status: "resolved", state: { blockId } };
    if (!isPlainRecord(rawProperties)) return { status: "unresolved", reason: "invalid_moved_state" };
    const keys = Reflect.ownKeys(rawProperties);
    if (keys.length > MAX_BLOCK_STATE_PROPERTIES) return { status: "unresolved", reason: "invalid_moved_state" };

    const properties: Record<string, string> = {};
    for (const key of keys) {
      if (typeof key !== "string" || key.length > MAX_BLOCK_STATE_KEY_LENGTH
        || !BLOCK_STATE_KEY_PATTERN.test(key) || UNSAFE_BLOCK_STATE_KEYS.has(key)) {
        return { status: "unresolved", reason: "invalid_moved_state" };
      }
      const descriptor = Object.getOwnPropertyDescriptor(rawProperties, key);
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined
        || typeof descriptor.value !== "string" || descriptor.value.length === 0
        || descriptor.value.length > MAX_BLOCK_STATE_VALUE_LENGTH
        || !BLOCK_STATE_VALUE_PATTERN.test(descriptor.value)) {
        return { status: "unresolved", reason: "invalid_moved_state" };
      }
      properties[key] = descriptor.value;
    }

    const orderedProperties = Object.fromEntries(Object.entries(properties).sort(([left], [right]) => compareText(left, right)));
    return Object.keys(orderedProperties).length === 0
      ? { status: "resolved", state: { blockId } }
      : { status: "resolved", state: { blockId, properties: orderedProperties } };
  } catch {
    // Malformed direct callers must not interrupt world rendering.
    return { status: "unresolved", reason: "invalid_moved_state" };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
