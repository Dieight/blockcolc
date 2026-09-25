import { useEffect, useState } from 'react';
import type { BlueprintCatalogEntry } from '@tomato-clock/voxel';

let voxelModulePromise:Promise<typeof import('@tomato-clock/voxel')>|null=null;
export function loadVoxelModule(){voxelModulePromise??=import('@tomato-clock/voxel').then(module=>{if(testBuildEnabled())(window as typeof window&{__blockcolcVoxelTest?:typeof module}).__blockcolcVoxelTest=module;return module;});return voxelModulePromise;}
export function testBuildEnabled():boolean{return import.meta.env.DEV||import.meta.env.MODE==='test';}
export function resourcePackAtlasMaximumSizeForTest():number|undefined{if(!testBuildEnabled())return undefined;const value=Number(new URLSearchParams(location.search).get('__atlasPageSize'));return Number.isSafeInteger(value)&&value>=32&&value<=2048?value:undefined;}
export function useBlueprintCatalog(){const [catalog,setCatalog]=useState<readonly BlueprintCatalogEntry[]>([]);useEffect(()=>{let active=true;void loadVoxelModule().then(module=>{if(active)setCatalog(module.BUILTIN_BLUEPRINT_CATALOG);});return()=>{active=false;};},[]);return catalog;}
export function blueprintName(catalog:readonly BlueprintCatalogEntry[],id: string) {
  return catalog.find(entry=>entry.id===id)?.displayName??'兼容建筑';
}
