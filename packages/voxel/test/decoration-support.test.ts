import {it,expect} from 'vitest';
import {supportImportedDecorations,decorationFoundationVoxels} from '../src/decoration-support';
import {placeImportedDecorations,layoutVillage} from '../src/village';
import {holidayBuildingBlueprint} from '../src/holiday-buildings';
import {createSteppedTerrainData} from '../src/terrain';
import {terrainSurfaceRectangles} from '../src/renderer';

it('rewards rest on actual slopes without changing the terrain or project datum',()=>{
  const blueprint=holidayBuildingBlueprint('china-national','红旗灯笼亭');
  const worlds=layoutVillage([{settlementIndex:0,blueprint}]).map(w=>({...w,projectId:'p'}));
  const decorations=placeImportedDecorations([{rewardId:'r',resourceId:'b',date:'2026-10-01',projectId:'p',blueprint,localPosition:{x:5,z:5},rotationQuarterTurns:1}],worlds,[]);
  const ground=[{minX:-300,maxX:300,minZ:-300,maxZ:300,supportY:4.5,water:false},
    {minX:decorations[0]!.worldPosition.x-1,maxX:decorations[0]!.worldPosition.x+8,minZ:-300,maxZ:300,supportY:8.5,water:false}];
  const original=structuredClone(ground),originalLayout=structuredClone(decorations);
  const [supported]=supportImportedDecorations(decorations,ground);
  expect(supported!.worldPosition.y).toBe(8.5);
  expect(decorationFoundationVoxels(supported!,ground).length).toBeGreaterThan(0);
  expect(ground).toEqual(original);expect(decorations).toEqual(originalLayout);
});
it('terrain generation does not require reward support pads even on an ocean construction area',()=>{
  const terrain=createSteppedTerrainData([],[],[{x:0,z:0,width:24,depth:24,groundLevel:4}],undefined,{environmentStyle:'ocean-island',worldSeed:'reward-support',terrainGenerationVersion:4});
  const surfaces=terrainSurfaceRectangles(terrain),before=structuredClone(terrain.bounds);
  const blueprint=holidayBuildingBlueprint('us-independence','星光烟花亭');
  const worlds=layoutVillage([{settlementIndex:0,blueprint}]).map(w=>({...w,projectId:'p'}));
  const rewards=placeImportedDecorations([{rewardId:'r',resourceId:'b',date:'2026-07-04',projectId:'p',blueprint,localPosition:{x:3,z:3},rotationQuarterTurns:0}],worlds,[]);
  const result=supportImportedDecorations(rewards,surfaces);
  expect(result[0]!.worldPosition.y).toBeGreaterThanOrEqual(4);
  expect(terrain.bounds).toEqual(before);expect(terrain.hydrology.protectedWaterCellCount).toBe(0);
},30_000);
