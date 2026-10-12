import type { MergedGeometryData } from './terrain';
import { TERRAIN_MATERIALS } from './terrain';
import type { WorldScenery } from './scenery';
import type { compactTerrainRenderMesh } from './terrain-render-mesh';
import { unpackWorldSceneCache, packedWorldSceneCacheBytes } from './world-scene-cache-codec';
export { packWorldSceneCache } from './world-scene-cache-codec';

// Bump when terrain, placement, scenery or compact-mesh generation changes.
// This is a disposable rendering cache, not a domain schema migration.
export const WORLD_SCENE_CACHE_REVISION = 3;
export const WORLD_SCENE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export interface WorldSceneCache {
  revision: typeof WORLD_SCENE_CACHE_REVISION;
  terrain: { key: string; data: MergedGeometryData; renderMesh?: ReturnType<typeof compactTerrainRenderMesh> };
  scenery: { key: string; plan: WorldScenery } | null;
}
export interface WorldSceneCachePort {
  read(): Promise<unknown>;
  /** Queue the immutable current layout; never await this from a focus command. */
  write(entry: WorldSceneCache): void;
}

export function worldSceneCacheBytes(entry: WorldSceneCache): number {
  // Budget the actual packed representation, not two object graphs for shared
  // near/far blocks. Large coast layouts otherwise silently miss every start.
  return packedWorldSceneCacheBytes(entry);
}

type RecordValue = Record<string, any>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const key = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256_000;
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const coords = (value: unknown, names: readonly string[]) => record(value) && names.every(name => finite(value[name]));

function validGeometry(value: unknown): boolean {
  if (!record(value) || !Array.isArray(value.positions) || value.positions.length % 3 || value.positions.length > 6_000_000
    || !record(value.indicesByMaterial) || !record(value.sideIndices) || !count(value.triangleCount)) return false;
  if (!value.positions.every(finite)) return false;
  const vertices = value.positions.length / 3;
  let indices = 0;
  for (const list of [...TERRAIN_MATERIALS.map(material => value.indicesByMaterial[material]),value.sideIndices.dirt,value.sideIndices.stone]) {
    if (!Array.isArray(list) || list.length % 3 || list.length > 6_000_000
      || !list.every(index => Number.isSafeInteger(index) && index >= 0 && index < vertices)) return false;
    indices += list.length;
  }
  return indices / 3 === value.triangleCount;
}

/** Validate data before any geometry, sampler or camera consumes it. */
export function restoreWorldSceneCache(value: unknown): WorldSceneCache | null {
  try {
    value = unpackWorldSceneCache(value);
    if (!record(value) || value.revision !== WORLD_SCENE_CACHE_REVISION || !record(value.terrain)
      || !key(value.terrain.key) || !validGeometry(value.terrain.data)) return null;
    const terrain = value.terrain.data;
    if (!coords(terrain.bounds,['minX','maxX','minY','maxY','minZ','maxZ'])
      || !coords(terrain.framingBounds,['minX','maxX','minZ','maxZ']) || !coords(terrain.nearDetailBounds,['minX','maxX','minZ','maxZ'])
      || ![1,2,3,4].includes(terrain.terrainGenerationVersion) || !count(terrain.cellCount)
      || !record(terrain.lodCellCounts) || !['near','middle','far'].every(name => count(terrain.lodCellCounts[name]))
      || !record(terrain.hydrology) || !['networkCount','basinCount','riverCellCount','lakeCellCount','riverSegmentCount','outletCount',
        'maxUphillWaterStep','protectedWaterCellCount','waterSurfaceArea','terrainSurfaceArea'].every(name => finite(terrain.hydrology[name]))
      || !Array.isArray(terrain.naturalTrees) || terrain.naturalTrees.length > 20_000
      || !terrain.naturalTrees.every((tree: unknown) => coords(tree,['x','y','z','scale']))) return null;
    if (terrain.oceanMain !== undefined && !coords(terrain.oceanMain,['radius','beach'])) return null;
    if (terrain.oceanIslets !== undefined && (!Array.isArray(terrain.oceanIslets) || terrain.oceanIslets.length > 128
      || !terrain.oceanIslets.every((islet: unknown) => coords(islet,['x','z','radius'])))) return null;
    if (value.terrain.renderMesh !== undefined && !validGeometry(value.terrain.renderMesh)) return null;
    if (value.scenery !== null) {
      if (!record(value.scenery) || !key(value.scenery.key) || !value.scenery.key.startsWith(`${value.terrain.key}|`)
        || !record(value.scenery.plan) || !Array.isArray(value.scenery.plan.objects) || value.scenery.plan.objects.length > 4096) return null;
      const plan = value.scenery.plan;
      if (plan.village !== null && !coords(plan.village,['x','z','width','depth'])) return null;
      let voxels = 0;
      for (const object of plan.objects) {
        if (!record(object) || !key(object.id) || !['house','well','farm','path','tree','garden','dock','camp','wreck','ruin','rock'].includes(object.role)
          || !coords(object,['x','y','z','width','depth']) || !Array.isArray(object.voxels) || !Array.isArray(object.distantVoxels)) return null;
        voxels += object.voxels.length + object.distantVoxels.length;
        if (voxels > 500_000) return null;
        for (const voxel of [...object.voxels,...object.distantVoxels]) {
          if (!coords(voxel,['x','y','z','buildOrder']) || typeof voxel.materialId !== 'string'
            || (voxel.sourceBlockId !== undefined && typeof voxel.sourceBlockId !== 'string')
            || (voxel.sourceBlockState !== undefined && (!record(voxel.sourceBlockState)
              || !Object.values(voxel.sourceBlockState).every(state => typeof state === 'string')))) return null;
        }
        // Some LOD structures replace their model. For subset LODs, structured
        // clone must retain references: geometryLayers relies on this identity.
      }
    }
    return worldSceneCacheBytes(value as WorldSceneCache) <= WORLD_SCENE_CACHE_MAX_BYTES ? value as WorldSceneCache : null;
  } catch { return null; }
}

/** Rewards reserve their full footprint; progress, titles and textures do not. */
export function sceneryGenerationInputKey(terrainKey: string, rewards: readonly {
  worldPosition: { x:number; y:number; z:number }; footprint: { width:number; depth:number };
}[]): string {
  return `${terrainKey}|${JSON.stringify(rewards.map(reward => [reward.worldPosition.x,reward.worldPosition.z,reward.footprint.width,reward.footprint.depth]))}`;
}
