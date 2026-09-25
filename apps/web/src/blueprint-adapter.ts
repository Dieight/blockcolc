import type { ImportedBlueprintStage, ImportedBlueprintV1 } from '@tomato-clock/domain';
import type { BlueprintV1 } from '@tomato-clock/voxel';

export function toImportedBlueprint(blueprint:BlueprintV1):ImportedBlueprintV1 { return {...blueprint,voxels:blueprint.voxels.map(voxel=>({...voxel,stage:stageForBuildOrder(voxel.buildOrder)}))}; }
// Supplemental local assets are optional in later builds: persist a copy with projects.
export function shouldPersistBlueprintSnapshot(id:string):boolean { return id.startsWith('builtin-local-') || !id.startsWith('builtin-'); }
export function stageForBuildOrder(value:number):ImportedBlueprintStage { return value<1800?'foundation':value<3800?'frame':value<6500?'walls':value<8800?'roof':'details'; }
