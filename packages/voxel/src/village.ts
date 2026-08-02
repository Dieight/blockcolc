import type { BlueprintV1 } from "./blueprint";

export interface VillageLayoutInput {
  settlementIndex: number;
  blueprint: BlueprintV1;
}

export interface VillagePlacement {
  settlementIndex: number;
  worldPosition: { x: number; y: number; z: number };
  rotationY: number;
  footprint: { width: number; depth: number };
  blueprintOffset: { x: number; z: number };
  entrance: { x: number; z: number };
}

export interface RoadCell { x: number; z: number }

export interface ImportedDecorationLayoutInput {
  rewardId: string;
  resourceId: string;
  date: string;
  projectId: string;
  blueprint: BlueprintV1;
  localPosition: { x: number; z: number };
  rotationQuarterTurns: 0 | 1 | 2 | 3;
}

export interface ImportedDecorationPlacement extends ImportedDecorationLayoutInput {
  worldPosition: { x: number; y: number; z: number };
  rotationY: number;
  footprint: { width: number; depth: number };
  blueprintOffset: { x: number; z: number };
}

interface OccupiedRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const CANDIDATE_STEP = 4;
const BUILDING_GAP = 3;

export function layoutVillage(inputs: readonly VillageLayoutInput[]): VillagePlacement[] {
  const byIndex = new Map<number, VillageLayoutInput>();
  for (const input of inputs) {
    if (!Number.isSafeInteger(input.settlementIndex) || input.settlementIndex < 0) {
      throw new RangeError(`Invalid settlementIndex ${input.settlementIndex}`);
    }
    if (byIndex.has(input.settlementIndex)) throw new RangeError(`Duplicate settlementIndex ${input.settlementIndex}`);
    byIndex.set(input.settlementIndex, input);
  }
  if (inputs.length === 0) return [];

  const placements = new Map<number, VillagePlacement>();
  const occupied: OccupiedRect[] = [];
  const maxIndex = Math.max(...byIndex.keys());
  for (let settlementIndex = 0; settlementIndex <= maxIndex; settlementIndex += 1) {
    const input = byIndex.get(settlementIndex);
    // Retained history normally keeps indices contiguous. A modest virtual plot
    // prevents an absent/deleted built-in project from collapsing the village.
    const sourceBounds = input?.blueprint.bounds;
    const sourceWidth = sourceBounds ? sourceBounds.maxX - sourceBounds.minX + 1 : 13;
    const sourceDepth = sourceBounds ? sourceBounds.maxZ - sourceBounds.minZ + 1 : 13;
    const blueprintOffset = sourceBounds
      ? { x: -(sourceBounds.minX + sourceBounds.maxX) / 2, z: -(sourceBounds.minZ + sourceBounds.maxZ) / 2 }
      : { x: 0, z: 0 };
    let chosen: VillagePlacement | null = null;
    for (let candidateIndex = 0; chosen === null; candidateIndex += 1) {
      const candidate = spiralCandidate(candidateIndex);
      const rotationY = rotationTowardCenter(candidate.x, candidate.z);
      const quarterTurn = Math.abs(Math.sin(rotationY)) > 0.5;
      const width = quarterTurn ? sourceDepth : sourceWidth;
      const depth = quarterTurn ? sourceWidth : sourceDepth;
      const rect = rectFor(candidate.x, candidate.z, width, depth);
      if (occupied.some((other) => overlapsWithGap(rect, other, BUILDING_GAP))) continue;
      occupied.push(rect);
      const groundLevel = terrainHeightAt(candidate.x, candidate.z);
      const localEntranceDistance = depth / 2 + 2;
      const entranceDirection = newDirection(rotationY);
      chosen = {
        settlementIndex,
        worldPosition: { x: candidate.x, y: groundLevel, z: candidate.z },
        rotationY,
        footprint: { width, depth },
        blueprintOffset,
        entrance: {
          x: Math.round(candidate.x + entranceDirection.x * localEntranceDistance),
          z: Math.round(candidate.z + entranceDirection.z * localEntranceDistance),
        },
      };
    }
    if (input) placements.set(settlementIndex, chosen);
  }
  return inputs.map((input) => placements.get(input.settlementIndex)!);
}

export function roadCellsForVillage(placements: readonly VillagePlacement[]): RoadCell[] {
  const cells = new Map<string, RoadCell>();
  const add = (x: number, z: number): void => { cells.set(`${x}:${z}`, { x, z }); };
  const plaza = villagePlazaFor(placements);
  for (let x = plaza.x - 2; x <= plaza.x + 2; x += 1) for (let z = plaza.z - 2; z <= plaza.z + 2; z += 1) add(x, z);
  const blocked = occupiedRoadCells(placements);

  for (const placement of placements) {
    const { x: startX, z: startZ } = placement.entrance;
    const points = findRoadPath({ x: startX, z: startZ }, plaza, blocked, placement.settlementIndex);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!;
      add(point.x, point.z);
      const previous = points[Math.max(0, index - 1)]!;
      const next = points[Math.min(points.length - 1, index + 1)]!;
      if (previous.x !== next.x) {
        add(point.x, point.z - 1);
        add(point.x, point.z + 1);
      } else {
        add(point.x - 1, point.z);
        add(point.x + 1, point.z);
      }
    }
  }
  return [...cells.values()].sort((left, right) => left.x - right.x || left.z - right.z);
}

export function villagePlazaFor(placements: readonly VillagePlacement[]): RoadCell {
  if (placements.length === 0) return { x: 0, z: 0 };
  const core = [...placements].sort((left, right) => left.settlementIndex - right.settlementIndex)[0]!;
  const dx = Math.sign(core.entrance.x - core.worldPosition.x);
  const dz = Math.sign(core.entrance.z - core.worldPosition.z);
  return { x: core.entrance.x + dx * 3, z: core.entrance.z + dz * 3 };
}

export function placeImportedDecorations(
  inputs: readonly ImportedDecorationLayoutInput[],
  hosts: readonly (VillagePlacement & { projectId: string })[],
  roads: readonly RoadCell[],
): ImportedDecorationPlacement[] {
  const hostByProject = new Map(hosts.map((host) => [host.projectId, host]));
  const occupied = hosts.map((host) => rectFor(
    host.worldPosition.x,
    host.worldPosition.z,
    host.footprint.width + 2,
    host.footprint.depth + 2,
  ));
  const roadKeys = new Set(roads.map((road) => `${road.x}:${road.z}`));
  const result: ImportedDecorationPlacement[] = [];
  for (const input of [...inputs].sort((left, right) => left.rewardId.localeCompare(right.rewardId))) {
    const host = hostByProject.get(input.projectId);
    if (!host) continue;
    const local = rotate2d(input.localPosition.x, input.localPosition.z, host.rotationY);
    const intended = { x: host.worldPosition.x + local.x, z: host.worldPosition.z + local.z };
    const rotationY = host.rotationY + input.rotationQuarterTurns * Math.PI / 2;
    const sourceWidth = input.blueprint.bounds.maxX - input.blueprint.bounds.minX + 1;
    const sourceDepth = input.blueprint.bounds.maxZ - input.blueprint.bounds.minZ + 1;
    const quarterTurn = Math.abs(Math.sin(rotationY)) > 0.5;
    const footprint = { width: quarterTurn ? sourceDepth : sourceWidth, depth: quarterTurn ? sourceWidth : sourceDepth };
    let position: { x: number; z: number } | null = null;
    for (let candidateIndex = 0; position === null; candidateIndex += 1) {
      const offset = candidateIndex === 0 ? { x: 0, z: 0 } : spiralCandidate(candidateIndex);
      const candidate = { x: intended.x + offset.x, z: intended.z + offset.z };
      const rect = rectFor(candidate.x, candidate.z, footprint.width, footprint.depth);
      const hitsBuilding = occupied.some((other) => overlapsWithGap(rect, other, 1));
      const hitsRoad = roadIntersects(rect, roadKeys, 1);
      if (hitsBuilding || hitsRoad) continue;
      occupied.push(rect);
      position = candidate;
    }
    result.push({
      ...input,
      worldPosition: { x: position.x, y: terrainHeightAt(position.x, position.z), z: position.z },
      rotationY,
      footprint,
      blueprintOffset: {
        x: -(input.blueprint.bounds.minX + input.blueprint.bounds.maxX) / 2,
        z: -(input.blueprint.bounds.minZ + input.blueprint.bounds.maxZ) / 2,
      },
    });
  }
  return result;
}

export function terrainHeightAt(x: number, z: number): number {
  const distance = Math.hypot(x * 0.92, z);
  const broadHill = Math.sin(x * 0.075 + z * 0.032) * 1.25 + Math.cos(z * 0.09 - x * 0.022) * 0.9;
  const localHill = ((stableHash(`hill:${Math.round(x / 7)}:${Math.round(z / 7)}`) % 7) - 3) * 0.22;
  const riverAxis = Math.sin(x * 0.065) * 5.5 + Math.cos(x * 0.018) * 2.5;
  const riverCut = Math.abs(z - riverAxis) < 1.15 && distance > 13 ? 1.35 : 0;
  const adjusted = distance + broadHill + localHill - riverCut;
  return adjusted < 10 ? 3 : adjusted < 20 ? 2 : adjusted < 34 ? 1 : 0;
}

function spiralCandidate(index: number): { x: number; z: number } {
  if (index === 0) return { x: 0, z: 0 };
  const ring = Math.ceil((Math.sqrt(index + 1) - 1) / 2);
  const sideLength = ring * 2;
  const first = (sideLength - 1) ** 2;
  const offset = index - first;
  let gridX: number;
  let gridZ: number;
  if (offset < sideLength) {
    gridX = -ring + offset;
    gridZ = -ring;
  } else if (offset < sideLength * 2) {
    gridX = ring;
    gridZ = -ring + (offset - sideLength);
  } else if (offset < sideLength * 3) {
    gridX = ring - (offset - sideLength * 2);
    gridZ = ring;
  } else {
    gridX = -ring;
    gridZ = ring - (offset - sideLength * 3);
  }
  return { x: gridX * CANDIDATE_STEP, z: gridZ * CANDIDATE_STEP };
}

function rotationTowardCenter(x: number, z: number): number {
  if (x === 0 && z === 0) return 0;
  if (Math.abs(x) > Math.abs(z)) return x > 0 ? -Math.PI / 2 : Math.PI / 2;
  return z > 0 ? Math.PI : 0;
}

function newDirection(rotationY: number): { x: number; z: number } {
  return { x: Math.sin(rotationY), z: Math.cos(rotationY) };
}

function rectFor(x: number, z: number, width: number, depth: number): OccupiedRect {
  return { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
}

function overlapsWithGap(left: OccupiedRect, right: OccupiedRect, gap: number): boolean {
  return left.minX < right.maxX + gap && left.maxX + gap > right.minX
    && left.minZ < right.maxZ + gap && left.maxZ + gap > right.minZ;
}

function occupiedRoadCells(placements: readonly VillagePlacement[]): Set<string> {
  const blocked = new Set<string>();
  for (const placement of placements) {
    const rect = rectFor(placement.worldPosition.x, placement.worldPosition.z, placement.footprint.width, placement.footprint.depth);
    for (let x = Math.floor(rect.minX - 1); x <= Math.ceil(rect.maxX + 1); x += 1) {
      for (let z = Math.floor(rect.minZ - 1); z <= Math.ceil(rect.maxZ + 1); z += 1) blocked.add(`${x}:${z}`);
    }
  }
  return blocked;
}

function findRoadPath(start: RoadCell, goal: RoadCell, blocked: ReadonlySet<string>, seed: number): RoadCell[] {
  const margin = 18;
  const limit = Math.max(Math.abs(start.x), Math.abs(start.z), Math.abs(goal.x), Math.abs(goal.z)) + margin;
  const queue = [start];
  const startKey = `${start.x}:${start.z}`;
  const parent = new Map<string, string | null>([[startKey, null]]);
  const horizontalFirst = stableHash(`road:${seed}`) % 2 === 0;
  const directions = horizontalFirst
    ? [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]
    : [{ x: 0, z: 1 }, { x: 0, z: -1 }, { x: 1, z: 0 }, { x: -1, z: 0 }];
  const goalKey = `${goal.x}:${goal.z}`;
  while (queue.length > 0 && !parent.has(goalKey)) {
    const current = queue.shift()!;
    for (const direction of directions) {
      const next = { x: current.x + direction.x, z: current.z + direction.z };
      const key = `${next.x}:${next.z}`;
      if (Math.abs(next.x) > limit || Math.abs(next.z) > limit || parent.has(key)) continue;
      if (blocked.has(key) && key !== startKey && key !== goalKey) continue;
      parent.set(key, `${current.x}:${current.z}`);
      queue.push(next);
    }
  }
  if (!parent.has(goalKey)) return [start];
  const path: RoadCell[] = [];
  let key: string | null = goalKey;
  while (key !== null) {
    const [x, z] = key.split(":").map(Number);
    path.push({ x: x!, z: z! });
    key = parent.get(key) ?? null;
  }
  return path.reverse();
}

function rotate2d(x: number, z: number, rotationY: number): { x: number; z: number } {
  const cos = Math.cos(rotationY); const sin = Math.sin(rotationY);
  return { x: x * cos + z * sin, z: -x * sin + z * cos };
}

function roadIntersects(rect: OccupiedRect, roads: ReadonlySet<string>, gap: number): boolean {
  for (let x = Math.floor(rect.minX - gap); x <= Math.ceil(rect.maxX + gap); x += 1) {
    for (let z = Math.floor(rect.minZ - gap); z <= Math.ceil(rect.maxZ + gap); z += 1) {
      if (roads.has(`${x}:${z}`)) return true;
    }
  }
  return false;
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
