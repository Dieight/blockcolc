import type { BlueprintVoxel } from "./blueprint";

export type FaceOcclusionLevels = readonly [number, number, number, number, number, number];

const FACE_OFFSETS = [
  [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0],
] as const;
const FACE_TANGENTS = [
  [[1, 0, 0], [0, 0, 1]], [[1, 0, 0], [0, 0, 1]],
  [[1, 0, 0], [0, 1, 0]], [[1, 0, 0], [0, 1, 0]],
  [[0, 0, 1], [0, 1, 0]], [[0, 0, 1], [0, 1, 0]],
] as const;
const TINT_WORD_RANGE = 4 ** 6;
const MAX_VISUAL_WORD = 4 ** 12;

export interface LocalOcclusionField {
  readonly minimumY: number;
  readonly occupied: ReadonlySet<string>;
}

export function createLocalOcclusionField(voxels: readonly BlueprintVoxel[]): LocalOcclusionField {
  const occluders = voxels.filter(isFullOccluder);
  return {
    minimumY: voxels.length > 0 ? Math.min(...voxels.map((voxel) => voxel.y)) : 0,
    occupied: new Set(occluders.map(voxelKey)),
  };
}

export function faceOcclusionLevelsFor(voxel: BlueprintVoxel, field: LocalOcclusionField): FaceOcclusionLevels {
  return FACE_OFFSETS.map((normal, face) => {
    const direct = offsetKey(voxel, normal);
    if (field.occupied.has(direct)) return 0;
    const [first, second] = FACE_TANGENTS[face]!;
    let score = 0;
    for (const sign of [-1, 1] as const) {
      if (field.occupied.has(offsetKey(voxel, add(normal, scale(first, sign))))) score += 1;
      if (field.occupied.has(offsetKey(voxel, add(normal, scale(second, sign))))) score += 1;
    }
    for (const firstSign of [-1, 1] as const) {
      for (const secondSign of [-1, 1] as const) {
        if (field.occupied.has(offsetKey(voxel, add(normal, add(scale(first, firstSign), scale(second, secondSign)))))) score += 0.5;
      }
    }
    let level = score === 0 ? 0 : score <= 1.5 ? 1 : score <= 3.5 ? 2 : 3;
    if (voxel.y === field.minimumY && face >= 2) level = Math.max(level, 1);
    if (voxel.y === field.minimumY && face === 0) level = Math.max(level, 2);
    return level;
  }) as unknown as FaceOcclusionLevels;
}

export function packFaceOcclusionLevels(levels: FaceOcclusionLevels): number {
  return levels.reduce((word, level, face) => {
    if (!Number.isInteger(level) || level < 0 || level > 3) throw new RangeError("Face occlusion level must be within 0..3");
    return word + level * (4 ** face);
  }, 0);
}

export function unpackFaceOcclusionLevels(word: number): FaceOcclusionLevels {
  if (!Number.isSafeInteger(word) || word < 0 || word >= TINT_WORD_RANGE) throw new RangeError("Invalid packed face occlusion levels");
  return FACE_OFFSETS.map((_, face) => Math.floor(word / (4 ** face)) % 4) as unknown as FaceOcclusionLevels;
}

export function combineTintAndOcclusionWord(tintWord: number, levels: FaceOcclusionLevels): number {
  if (!Number.isSafeInteger(tintWord) || tintWord < 0 || tintWord >= TINT_WORD_RANGE) throw new RangeError("Invalid packed face tint kinds");
  const word = tintWord + packFaceOcclusionLevels(levels) * TINT_WORD_RANGE;
  if (word >= MAX_VISUAL_WORD) throw new RangeError("Packed face visual word exceeds exact Float32 integer range");
  return word;
}

export function blockOcclusionFor(voxel: BlueprintVoxel, field: LocalOcclusionField): number {
  const levels = faceOcclusionLevelsFor(voxel, field);
  const visible = levels.filter((_, face) => !field.occupied.has(offsetKey(voxel, FACE_OFFSETS[face]!)));
  if (visible.length === 0) return 0;
  const average = visible.reduce((sum, level) => sum + level, 0) / visible.length / 3;
  const maximum = Math.max(...visible) / 3;
  return maximum * 0.65 + average * 0.35;
}

export function isFullOccluder(voxel: BlueprintVoxel): boolean {
  const id = `${voxel.sourceBlockId ?? ""}|${voxel.materialId}`.toLowerCase();
  return !/(glass|pane|bars|fence|wall|leaves|leaf|water|lava|ice|vine|torch|lantern|door|trapdoor|flower|plant|short_grass|tall_grass|seagrass|sapling|cobweb)/.test(id);
}

function voxelKey(voxel: Pick<BlueprintVoxel, "x" | "y" | "z">): string {
  return `${voxel.x}:${voxel.y}:${voxel.z}`;
}

function offsetKey(voxel: Pick<BlueprintVoxel, "x" | "y" | "z">, offset: readonly number[]): string {
  return `${voxel.x + offset[0]!}:${voxel.y + offset[1]!}:${voxel.z + offset[2]!}`;
}

function add(left: readonly number[], right: readonly number[]): readonly [number, number, number] {
  return [left[0]! + right[0]!, left[1]! + right[1]!, left[2]! + right[2]!];
}

function scale(vector: readonly number[], amount: number): readonly [number, number, number] {
  return [vector[0]! * amount, vector[1]! * amount, vector[2]! * amount];
}
