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
// These 48 neighbour offsets are identical for every block. Building vectors
// and nested temporary arrays per face was a large part of forest preparation.
const FACE_SAMPLES = FACE_OFFSETS.map((normal, face) => {
  const [first, second] = FACE_TANGENTS[face]!;
  return { normal, edges: [-1, 1].flatMap(sign => [add(normal, scale(first, sign)), add(normal, scale(second, sign))]),
    corners: [-1, 1].flatMap(a => [-1, 1].map(b => add(normal, add(scale(first, a), scale(second, b))))) };
});
const TINT_WORD_RANGE = 4 ** 6;
const MAX_VISUAL_WORD = 4 ** 12;

export interface LocalOcclusionField {
  readonly minimumY: number;
  readonly occupied: ReadonlySet<string>;
  /** Fast equivalent membership for renderer-created fields; hand-built fields remain supported. */
  readonly has?: (x: number, y: number, z: number) => boolean;
}

export function createLocalOcclusionField(voxels: readonly BlueprintVoxel[]): LocalOcclusionField {
  let minimumY = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let integerCoordinates = true;
  for (const [index, voxel] of voxels.entries()) {
    if (index === 0 || voxel.y < minimumY) minimumY = voxel.y;
    integerCoordinates &&= Number.isSafeInteger(voxel.x) && Number.isSafeInteger(voxel.y) && Number.isSafeInteger(voxel.z);
    minX = Math.min(minX, voxel.x); minY = Math.min(minY, voxel.y); minZ = Math.min(minZ, voxel.z);
    maxX = Math.max(maxX, voxel.x); maxY = Math.max(maxY, voxel.y); maxZ = Math.max(maxZ, voxel.z);
  }
  const spanY = maxY - minY + 1, spanZ = maxZ - minZ + 1, strideX = spanY * spanZ;
  const volume = (maxX - minX + 1) * strideX;
  if (!integerCoordinates || !Number.isSafeInteger(volume) || volume <= 0) {
    const occupied = new Set(voxels.filter(isFullOccluder).map(voxelKey));
    return { minimumY, occupied };
  }
  const cells = new Set<number>();
  for (const voxel of voxels) if (isFullOccluder(voxel)) cells.add((voxel.x - minX) * strideX + (voxel.y - minY) * spanZ + voxel.z - minZ);
  let strings: Set<string> | null = null;
  return { minimumY,
    has(x, y, z) {
      if (x < minX || x > maxX || y < minY || y > maxY || z < minZ || z > maxZ
        || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return false;
      return cells.has((x - minX) * strideX + (y - minY) * spanZ + z - minZ);
    },
    get occupied() {
      // Keep the public string-set contract without allocating all coordinate
      // strings when only the renderer's numeric sampler uses this field.
      if (!strings) strings = new Set([...cells].map(cell => {
        const x = Math.floor(cell / strideX), remainder = cell - x * strideX;
        const y = Math.floor(remainder / spanZ), z = remainder - y * spanZ;
        return `${x + minX}:${y + minY}:${z + minZ}`;
      }));
      return strings;
    },
  };
}

function occupiedAt(field: LocalOcclusionField, voxel: BlueprintVoxel, offset: readonly number[]): boolean {
  return field.has ? field.has(voxel.x + offset[0]!, voxel.y + offset[1]!, voxel.z + offset[2]!) : field.occupied.has(offsetKey(voxel, offset));
}

export function faceOcclusionLevelsFor(voxel: BlueprintVoxel, field: LocalOcclusionField): FaceOcclusionLevels {
  return FACE_SAMPLES.map(({ normal }, face) => occupiedAt(field, voxel, normal) ? 0
    : exposedFaceLevel(voxel, field, face)) as unknown as FaceOcclusionLevels;
}

function exposedFaceLevel(voxel: BlueprintVoxel, field: LocalOcclusionField, face: number): number {
  const { edges, corners } = FACE_SAMPLES[face]!;
  let score = 0;
  for (const offset of edges) if (occupiedAt(field, voxel, offset)) score += 1;
  for (const offset of corners) if (occupiedAt(field, voxel, offset)) score += .5;
  let level = score === 0 ? 0 : score <= 1.5 ? 1 : score <= 3.5 ? 2 : 3;
  if (voxel.y === field.minimumY && face >= 2) level = Math.max(level, 1);
  if (voxel.y === field.minimumY && face === 0) level = Math.max(level, 2);
  return level;
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
  // Keep the exposed-face sum and arithmetic order, without allocating face
  // and filtered arrays or looking up each normal twice for every instance.
  let count = 0, sum = 0, max = 0;
  for (let face = 0; face < FACE_OFFSETS.length; face++) {
    if (occupiedAt(field, voxel, FACE_OFFSETS[face]!)) continue;
    const level = exposedFaceLevel(voxel, field, face);
    sum += level; max = Math.max(max, level); count++;
  }
  if (count === 0) return 0;
  const average = sum / count / 3;
  const maximum = max / 3;
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
