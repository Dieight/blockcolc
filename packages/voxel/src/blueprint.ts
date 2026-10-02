/// <reference types="vite/client" />

export * from "./blueprint-model";
import {
  BlueprintValidationError, CONSTRUCTION_STAGES, validateBlueprint,
  type BlueprintBounds, type BlueprintCatalogEntry, type BlueprintComplexity,
  type BlueprintV1, type BlueprintVoxel, type ConstructionStageId, type MaterialId,
} from "./blueprint-model";
import { LOCAL_BUILTIN_SOURCES, type LocalBuiltinCategory } from "./local-blueprint-sources";

interface StagedVoxel {
  x: number;
  y: number;
  z: number;
  materialId: MaterialId;
  stage: ConstructionStageId;
  sourceBlockId?: string;
  emissiveKind?: string;
  emissiveLevel?: number;
}

class BlueprintBuilder {
  readonly #voxels = new Map<string, StagedVoxel>();

  add(x: number, y: number, z: number, materialId: MaterialId, stage: ConstructionStageId): void {
    const key = coordinateKey(x, y, z);
    if (this.#voxels.has(key)) throw new BlueprintValidationError(`Duplicate generated voxel coordinate ${key}`);
    this.#voxels.set(key, { x, y, z, materialId, stage });
  }

  addLight(x: number, y: number, z: number, stage: ConstructionStageId = "details"): void {
    const key = coordinateKey(x, y, z);
    if (this.#voxels.has(key)) throw new BlueprintValidationError(`Duplicate generated voxel coordinate ${key}`);
    this.#voxels.set(key, {
      x, y, z, materialId: "accent", stage,
      sourceBlockId: "minecraft:torch", emissiveKind: "torch", emissiveLevel: 14,
    });
  }

  build(id: string, title: string): BlueprintV1 {
    const staged = [...this.#voxels.values()];
    const voxels: BlueprintVoxel[] = [];
    for (const stage of CONSTRUCTION_STAGES) {
      const members = staged
        .filter((voxel) => voxel.stage === stage.id)
        .sort((left, right) => left.y - right.y || left.x - right.x || left.z - right.z || left.materialId.localeCompare(right.materialId));
      if (members.length === 0) throw new BlueprintValidationError(`Generated blueprint ${id} has empty ${stage.id} stage`);
      const divisor = Math.max(1, members.length - 1);
      members.forEach(({ stage: _stage, ...voxel }, index) => {
        const progress = members.length === 1 ? stage.endBasisPoints : Math.round(
          stage.startBasisPoints + (index / divisor) * (stage.endBasisPoints - stage.startBasisPoints),
        );
        voxels.push({ ...voxel, buildOrder: progress });
      });
    }
    const bounds = boundsFor(voxels);
    return validateBlueprint({ schemaVersion: 1, id, title, bounds, voxels });
  }
}

function coordinateKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function boundsFor(voxels: ReadonlyArray<Pick<BlueprintVoxel, "x" | "y" | "z">>): BlueprintBounds {
  const first = voxels[0];
  if (!first) throw new BlueprintValidationError("Cannot calculate bounds for an empty blueprint");
  const bounds: BlueprintBounds = {
    minX: first.x, maxX: first.x,
    minY: first.y, maxY: first.y,
    minZ: first.z, maxZ: first.z,
  };
  for (let index = 1; index < voxels.length; index += 1) {
    const voxel = voxels[index]!;
    bounds.minX = Math.min(bounds.minX, voxel.x);
    bounds.maxX = Math.max(bounds.maxX, voxel.x);
    bounds.minY = Math.min(bounds.minY, voxel.y);
    bounds.maxY = Math.max(bounds.maxY, voxel.y);
    bounds.minZ = Math.min(bounds.minZ, voxel.z);
    bounds.maxZ = Math.max(bounds.maxZ, voxel.z);
  }
  return bounds;
}

function buildSmallWorkshop(): BlueprintV1 {
  const builder = new BlueprintBuilder();
  for (let x = -5; x <= 5; x += 1) for (let z = -4; z <= 4; z += 1) builder.add(x, 0, z, "stone", "foundation");
  for (let x = -4; x <= 4; x += 1) for (let z = -3; z <= 3; z += 1) builder.add(x, 1, z, "plank", "frame");
  for (let y = 2; y <= 5; y += 1) {
    for (let x = -5; x <= 5; x += 1) {
      const frontUpperWindow = y === 4 && Math.abs(x) === 2;
      const rearUpperWindow = y === 4 && Math.abs(x) === 2;
      if (!(zOpening(x, y, 4)) && !frontUpperWindow) builder.add(x, y, 4, cornerMaterial(x, 5), "walls");
      if (!(-2 <= x && x <= 2 && y === 3) && !rearUpperWindow) builder.add(x, y, -4, cornerMaterial(x, 5), "walls");
    }
    for (let z = -3; z <= 3; z += 1) {
      if (!(y === 3 && z === 0)) builder.add(-5, y, z, cornerMaterial(z, 4), "walls");
      if (!(y === 3 && z === 0)) builder.add(5, y, z, cornerMaterial(z, 4), "walls");
    }
  }
  for (const x of [-5, 5]) {
    for (let z = -5; z <= 5; z += 1) {
      const roofY = 11 - Math.abs(z);
      for (let y = 6; y < roofY; y += 1) {
        const smallGableWindow = z === 0 && (y === 8 || y === 9);
        const timberFrame = Math.abs(z) === 5 || y === 6;
        builder.add(x, y, z, smallGableWindow ? "glass" : timberFrame ? "wood" : "plank", "walls");
      }
    }
  }
  for (let z = -5; z <= 5; z += 1) {
    const y = 11 - Math.abs(z);
    for (let x = -5; x <= 5; x += 1) builder.add(x, y, z, "roof", "roof");
  }
  for (let x = -2; x <= 2; x += 1) builder.add(x, 3, -4, "glass", "details");
  for (const x of [-2, 2]) {
    builder.add(x, 4, 4, "glass", "details");
    builder.add(x, 4, -4, "glass", "details");
  }
  builder.add(-5, 3, 0, "glass", "details"); builder.add(5, 3, 0, "glass", "details");
  builder.addLight(-3, 3, 5); builder.addLight(3, 3, 5);
  builder.addLight(-3, 3, 3); builder.addLight(3, 3, 3);
  for (let x = -3; x <= -1; x += 1) builder.add(x, 2, -2, "wood", "details");
  return builder.build("builtin-small-workshop", "Small Workshop");
}

function zOpening(x: number, y: number, z: number): boolean {
  return z === 4 && x === 0 && (y === 2 || y === 3);
}

function cornerMaterial(coordinate: number, extent: number): MaterialId {
  return Math.abs(coordinate) === extent ? "wood" : "plank";
}

function buildTimberHouse(): BlueprintV1 {
  const builder = new BlueprintBuilder();
  for (let x = -6; x <= 6; x += 1) for (let z = -4; z <= 4; z += 1) builder.add(x, 0, z, "stone", "foundation");
  for (let x = -5; x <= 5; x += 1) for (let z = -3; z <= 3; z += 1) builder.add(x, 1, z, "plank", "frame");
  for (let y = 2; y <= 4; y += 1) addHousePerimeter(builder, -5, 5, -3, 3, y, false);
  for (let x = -6; x <= 6; x += 1) for (let z = -4; z <= 4; z += 1) builder.add(x, 5, z, "plank", "frame");
  for (let y = 6; y <= 8; y += 1) addHousePerimeter(builder, -6, 6, -4, 4, y, true);
  for (const x of [-6, 6]) {
    for (let z = -5; z <= 5; z += 1) {
      const roofY = 14 - Math.abs(z);
      for (let y = 9; y < roofY; y += 1) {
        const smallGableWindow = z === 0 && (y === 11 || y === 12);
        const timberFrame = Math.abs(z) === 5 || y === 9;
        builder.add(x, y, z, smallGableWindow ? "glass" : timberFrame ? "wood" : "plank", "walls");
      }
    }
  }
  for (let z = -5; z <= 5; z += 1) {
    const y = 14 - Math.abs(z);
    for (let x = -6; x <= 6; x += 1) builder.add(x, y, z, "roof", "roof");
  }
  for (const x of [-3, 3]) builder.add(x, 3, -3, "glass", "details");
  for (const x of [-3, 3]) builder.add(x, 7, -4, "glass", "details");
  for (const x of [-5, 5]) builder.add(x, 3, 0, "glass", "details");
  for (const x of [-6, 6]) for (const z of [-2, 0, 2]) builder.add(x, 7, z, "glass", "details");
  for (const x of [-3, 3]) builder.add(x, 7, 4, "glass", "details");
  for (let y = 9; y <= 13; y += 1) builder.add(4, y, 0, "stone", "details");
  builder.addLight(-3, 3, 4); builder.addLight(3, 3, 4);
  builder.addLight(-3, 3, 2); builder.addLight(3, 3, 2);
  builder.add(-3, 2, -1, "accent", "details"); builder.add(-2, 2, -1, "plank", "details");
  builder.add(3, 6, -2, "accent", "details");
  return builder.build("builtin-timber-house", "Timber House");
}

function addHousePerimeter(
  builder: BlueprintBuilder,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  y: number,
  upper: boolean,
): void {
  for (let x = minX; x <= maxX; x += 1) {
    const frontOpening = !upper && x === 0 && y <= 3;
    const upperFrontWindow = upper && y === 7 && (x === -3 || x === 3);
    const rearWindow = (x === -3 || x === 3) && y === (upper ? 7 : 3);
    if (!frontOpening && !upperFrontWindow) builder.add(x, y, maxZ, Math.abs(x) === maxX ? "wood" : "plank", "walls");
    if (!rearWindow) builder.add(x, y, minZ, Math.abs(x) === maxX ? "wood" : "plank", "walls");
  }
  for (let z = minZ + 1; z < maxZ; z += 1) {
    const sideWindow = (upper ? [-2, 0, 2].includes(z) && y === 7 : z === 0 && y === 3);
    if (!sideWindow) builder.add(minX, y, z, "wood", "walls");
    if (!sideWindow) builder.add(maxX, y, z, "wood", "walls");
  }
}

function buildVillageChapel(): BlueprintV1 {
  const builder = new BlueprintBuilder();
  for (let x = -5; x <= 5; x += 1) for (let z = -8; z <= 10; z += 1) builder.add(x, 0, z, "stone", "foundation");
  for (let x = -4; x <= 4; x += 1) for (let z = -7; z <= 3; z += 1) builder.add(x, 1, z, "plank", "frame");
  for (let x = -2; x <= 2; x += 1) for (let z = 4; z <= 9; z += 1) builder.add(x, 1, z, "stone", "frame");
  for (const x of [-5, 5]) for (const z of [-6, -2, 2]) for (let y = 1; y <= 5; y += 1) builder.add(x, y, z, "stone", "frame");
  for (let y = 2; y <= 7; y += 1) addChapelNaveWalls(builder, y);
  for (let y = 2; y <= 13; y += 1) addTowerWalls(builder, y);
  for (const z of [-8, 2]) {
    for (let x = -5; x <= 5; x += 1) {
      const roofY = 12 - Math.abs(x);
      for (let y = 8; y < roofY; y += 1) {
        const smallGableWindow = x === 0 && (y === 10 || y === 11);
        const stoneFrame = Math.abs(x) === 5 || y === 8;
        builder.add(x, y, z, smallGableWindow ? "glass" : stoneFrame ? "stone" : "plank", "walls");
      }
    }
  }
  for (let x = -5; x <= 5; x += 1) {
    const y = 12 - Math.abs(x);
    for (let z = -8; z <= 2; z += 1) builder.add(x, y, z, "roof", "roof");
  }
  for (let inset = 0; inset <= 3; inset += 1) {
    const y = 14 + inset;
    for (let x = -3 + inset; x <= 3 - inset; x += 1) {
      for (let z = 3 + inset; z <= 10 - inset; z += 1) builder.add(x, y, z, "roof", "roof");
    }
  }
  builder.add(0, 18, 6, "accent", "details");
  for (const z of [-5, -1, 3]) {
    builder.add(-4, 4, z, "glass", "details"); builder.add(-4, 5, z, "glass", "details");
    builder.add(4, 4, z, "glass", "details"); builder.add(4, 5, z, "glass", "details");
  }
  for (const x of [-3, 3]) builder.add(x, 9, 6, "glass", "details");
  for (const x of [-2, 2]) {
    builder.add(x, 9, 3, "glass", "details");
    builder.add(x, 9, 10, "glass", "details");
  }
  builder.addLight(-2, 5, 11); builder.addLight(2, 5, 11);
  builder.addLight(-2, 2, 8); builder.addLight(2, 2, 8);
  builder.addLight(-3, 2, 0); builder.addLight(3, 2, 0);
  for (const z of [-6, -4, -2, 0]) {
    builder.add(-2, 2, z, "plank", "details");
    builder.add(2, 2, z, "plank", "details");
  }
  builder.add(-1, 2, -7, "stone", "details");
  builder.add(0, 2, -7, "accent", "details");
  builder.add(1, 2, -7, "stone", "details");
  return builder.build("builtin-village-chapel", "Village Chapel");
}

function addChapelNaveWalls(builder: BlueprintBuilder, y: number): void {
  for (let z = -8; z <= 3; z += 1) {
    const window = (z === -5 || z === -1 || z === 3) && (y === 4 || y === 5);
    if (!window) builder.add(-4, y, z, "stone", "walls");
    if (!window) builder.add(4, y, z, "stone", "walls");
  }
  for (let x = -3; x <= 3; x += 1) {
    builder.add(x, y, -8, "stone", "walls");
  }
}

function addTowerWalls(builder: BlueprintBuilder, y: number): void {
  for (let x = -3; x <= 3; x += 1) {
    const navePassage = x === 0 && y <= 4;
    const frontBelfryWindow = (x === -2 || x === 2) && y === 9;
    if (!navePassage && !frontBelfryWindow) builder.add(x, y, 3, "stone", "walls");
    const entrance = x === 0 && y <= 4;
    const belfryWindow = (x === -2 || x === 2) && y === 9;
    if (!entrance && !belfryWindow) builder.add(x, y, 10, "stone", "walls");
  }
  for (let z = 4; z <= 9; z += 1) {
    const towerSideWindow = y === 9 && z === 6;
    if (!towerSideWindow) builder.add(-3, y, z, "stone", "walls");
    if (!towerSideWindow) builder.add(3, y, z, "stone", "walls");
  }
}

function buildUnknownPlaceholder(): BlueprintV1 {
  const builder = new BlueprintBuilder();
  for (let x = -2; x <= 2; x += 1) for (let z = -2; z <= 2; z += 1) builder.add(x, 0, z, "stone", "foundation");
  for (const x of [-2, 2]) for (const z of [-2, 2]) for (let y = 1; y <= 3; y += 1) builder.add(x, y, z, "wood", "frame");
  for (let y = 1; y <= 2; y += 1) {
    for (let x = -1; x <= 1; x += 1) {
      builder.add(x, y, -2, "plank", "walls");
      if (x !== 0) builder.add(x, y, 2, "plank", "walls");
    }
  }
  for (let x = -2; x <= 2; x += 1) for (let z = -2; z <= 2; z += 1) builder.add(x, 4, z, "roof", "roof");
  builder.add(0, 1, 2, "accent", "details"); builder.add(0, 2, 2, "glass", "details");
  return builder.build("builtin-unknown-placeholder", "Unknown Blueprint Placeholder");
}

export const SMALL_WORKSHOP_BLUEPRINT: BlueprintV1 = buildSmallWorkshop();
export const TIMBER_HOUSE_BLUEPRINT: BlueprintV1 = buildTimberHouse();
export const VILLAGE_CHAPEL_BLUEPRINT: BlueprintV1 = buildVillageChapel();
export const UNKNOWN_BLUEPRINT_PLACEHOLDER: BlueprintV1 = buildUnknownPlaceholder();

function catalogEntry(
  blueprint: BlueprintV1,
  displayName: string,
  description: string,
  complexity: BlueprintComplexity,
): BlueprintCatalogEntry {
  return {
    id: blueprint.id,
    displayName,
    description,
    footprint: {
      width: blueprint.bounds.maxX - blueprint.bounds.minX + 1,
      depth: blueprint.bounds.maxZ - blueprint.bounds.minZ + 1,
    },
    complexity,
    blueprint,
  };
}

export const CORE_BUILTIN_BLUEPRINT_CATALOG: readonly BlueprintCatalogEntry[] = [
  catalogEntry(SMALL_WORKSHOP_BLUEPRINT, "林边工坊", "石基、木墙与陡坡屋顶组成的紧凑工坊。", "simple"),
  catalogEntry(TIMBER_HOUSE_BLUEPRINT, "河岸木屋", "带挑出上层、烟囱和双层木构的宽体住宅。", "moderate"),
  catalogEntry(VILLAGE_CHAPEL_BLUEPRINT, "村庄礼拜堂", "拥有石砌礼拜空间、钟塔与高耸屋脊的聚落地标。", "detailed"),
] as const;

const localBuildingAssets = import.meta.glob<unknown>("./local-blueprints/buildings/*.json", {
  eager: true,
  import: "default",
});
const localDailyRewardAssets = import.meta.glob<unknown>("./local-blueprints/daily-rewards/*.json", {
  eager: true,
  import: "default",
});

export const BUILTIN_LOCAL_BUILDING_BLUEPRINTS: readonly BlueprintV1[] = Object.freeze(
  readLocalBlueprintAssets(localBuildingAssets),
);
const dailyRewardBlueprints: readonly BlueprintV1[] = Object.freeze(
  readLocalBlueprintAssets(localDailyRewardAssets),
);
export const BUILTIN_DAILY_REWARD_BLUEPRINTS: readonly BlueprintV1[] = dailyRewardBlueprints;

validateLocalAssetCatalogs(BUILTIN_LOCAL_BUILDING_BLUEPRINTS, dailyRewardBlueprints);
validateDailyRewardAssetLimits(dailyRewardBlueprints);

const LOCAL_BUILTIN_DESCRIPTIONS: ReadonlyMap<string, string> = new Map(
  Object.values(LOCAL_BUILTIN_SOURCES).map(source => [source.id, source.description]),
);

export function localBuiltinBlueprintDescription(id: string, title: string): string {
  const known = LOCAL_BUILTIN_DESCRIPTIONS.get(id);
  if (known !== undefined) return known;
  const prefix = /^([A-Z]{2,6})的/.exec(title)?.[1] ?? "Dieight";
  return `${prefix}：以“${title}”为主题的补充建筑。`;
}

export const BUILTIN_BLUEPRINT_CATALOG: readonly BlueprintCatalogEntry[] = composeBuiltinBlueprintCatalog(
  CORE_BUILTIN_BLUEPRINT_CATALOG,
  BUILTIN_LOCAL_BUILDING_BLUEPRINTS,
);

/** Keeps the checked-in catalog usable when this machine has no private local assets. */
export function composeBuiltinBlueprintCatalog(
  baseCatalog: readonly BlueprintCatalogEntry[],
  localBlueprints: readonly BlueprintV1[],
): readonly BlueprintCatalogEntry[] {
  const ids = new Set(baseCatalog.map((entry) => entry.id));
  const supplemental = localBlueprints.map((rawBlueprint) => {
    const blueprint = validateBlueprint(rawBlueprint);
    if (!blueprint.id.startsWith("builtin-local-")) {
      throw new BlueprintValidationError(`Local built-in ID must start with builtin-local-: ${blueprint.id}`);
    }
    if (ids.has(blueprint.id)) throw new BlueprintValidationError(`Duplicate built-in blueprint ID ${blueprint.id}`);
    ids.add(blueprint.id);
    const complexity: BlueprintComplexity = blueprint.voxels.length < 1_000
      ? "simple"
      : blueprint.voxels.length < 5_000 ? "moderate" : "detailed";
    return catalogEntry(blueprint, blueprint.title, localBuiltinBlueprintDescription(blueprint.id, blueprint.title), complexity);
  });
  return Object.freeze([...baseCatalog, ...supplemental]);
}

function readLocalBlueprintAssets(assets: Record<string, unknown>): BlueprintV1[] {
  return Object.entries(assets)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, raw]) => {
      const blueprint = validateBlueprint(raw);
      if (!blueprint.id.startsWith("builtin-local-")) {
        throw new BlueprintValidationError(`Local built-in ID must start with builtin-local-: ${blueprint.id}`);
      }
      const filename = path.slice(path.lastIndexOf("/") + 1);
      if (filename !== `${blueprint.id}.json`) {
        throw new BlueprintValidationError(`Local built-in asset filename must match its ID: ${path}`);
      }
      return blueprint;
    });
}

function validateDailyRewardAssetLimits(blueprints: readonly BlueprintV1[]): void {
  for (const blueprint of blueprints) {
    const width = blueprint.bounds.maxX - blueprint.bounds.minX + 1;
    const height = blueprint.bounds.maxY - blueprint.bounds.minY + 1;
    const depth = blueprint.bounds.maxZ - blueprint.bounds.minZ + 1;
    if (width > 12 || height > 16 || depth > 12 || blueprint.voxels.length > 2_000) {
      throw new BlueprintValidationError(`Local daily reward ${blueprint.id} exceeds 12 x 12 x 16 / 2000 voxels`);
    }
  }
}

function validateLocalAssetCatalogs(buildings: readonly BlueprintV1[], rewards: readonly BlueprintV1[]): void {
  const validateCategory = (assets: readonly BlueprintV1[], category: LocalBuiltinCategory): void => {
    if (assets.length === 0) return; // Local assets remain optional on a clean checkout.
    const expected = new Map(Object.entries(LOCAL_BUILTIN_SOURCES)
      .filter(([, source]) => source.category === category)
      .map(([file, source]) => [source.id, file.slice(0, -".litematic".length)]));
    if (assets.length !== expected.size || assets.some(asset => expected.get(asset.id) !== asset.title)) {
      throw new BlueprintValidationError(`Local ${category} catalog must match all ${expected.size} registered blueprints; found ${assets.length}`);
    }
  };
  validateCategory(buildings, "building");
  validateCategory(rewards, "daily-reward");
}

export const BUILTIN_BLUEPRINTS: ReadonlyMap<string, BlueprintV1> = new Map(
  BUILTIN_BLUEPRINT_CATALOG.map((entry) => [entry.id, entry.blueprint]),
);

export function resolveBuiltinBlueprint(id: string): BlueprintV1 {
  return BUILTIN_BLUEPRINTS.get(id) ?? UNKNOWN_BLUEPRINT_PLACEHOLDER;
}
