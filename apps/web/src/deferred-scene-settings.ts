import type { ConstructionOutlineVisibility, TerrainEnvironmentStyle, TerrainGenerationVersion, VoxelLightingQuality, VoxelRenderer } from '@blockcolc/voxel';

export interface SceneSettings {
  environmentStyle: TerrainEnvironmentStyle;
  worldSeed: string;
  terrainGenerationVersion: TerrainGenerationVersion;
  lightingQuality: VoxelLightingQuality;
  constructionOutlineVisibility: ConstructionOutlineVisibility;
}
export function sceneGeometrySettingsEqual(a:SceneSettings,b:SceneSettings) {
  return a.environmentStyle===b.environmentStyle && a.worldSeed===b.worldSeed && a.terrainGenerationVersion===b.terrainGenerationVersion;
}
export function sceneSettingsEqual(a:SceneSettings,b:SceneSettings) {
  return sceneGeometrySettingsEqual(a,b) && a.lightingQuality===b.lightingQuality
    && a.constructionOutlineVisibility===b.constructionOutlineVisibility;
}

/** A saved preference is not ready until the current renderer has drawn it. */
export async function prepareResidentSceneSettings(
  renderer: Pick<VoxelRenderer,'setConstructionOutlineVisibility'|'setLightingQuality'|'setVisible'|'preparePresentationFrame'|'prepareInitialPresentation'>,
  settings: Pick<SceneSettings,'lightingQuality'|'constructionOutlineVisibility'>,
  isCurrent:()=>boolean,
  preparation: { adoptLatestWorlds?:()=>void; initialPresentation?:{openingProjectId:string|null} }={},
):Promise<'prepared'|'stale'> {
  if(!isCurrent())return 'stale';
  renderer.setConstructionOutlineVisibility(settings.constructionOutlineVisibility);
  if(!renderer.setLightingQuality(settings.lightingQuality))throw new Error('Scene quality preparation failed');
  preparation.adoptLatestWorlds?.();
  if(!isCurrent())return 'stale';
  renderer.setVisible(true);
  const drawn=preparation.initialPresentation
    ? await renderer.prepareInitialPresentation(preparation.initialPresentation.openingProjectId)
    : await renderer.preparePresentationFrame();
  if(!isCurrent())return 'stale';
  if(!drawn)throw new Error('Scene frame preparation failed');
  return 'prepared';
}
