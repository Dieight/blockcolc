import { expect,it,vi } from 'vitest';
import { prepareResidentSceneSettings,sceneSettingsEqual,sceneGeometrySettingsEqual,type SceneSettings } from './deferred-scene-settings';
const initial:SceneSettings={environmentStyle:'ocean-island',worldSeed:'seed',terrainGenerationVersion:4,lightingQuality:'cinematic',constructionOutlineVisibility:'current'};
it('separates settings which recreate a renderer from resident quality/outline preparation',()=>{
  expect(sceneSettingsEqual(initial,{...initial})).toBe(true);
  for(const patch of [{environmentStyle:'mosaic-coast' as const},{worldSeed:'other'},{terrainGenerationVersion:3 as const}]){
    expect(sceneGeometrySettingsEqual(initial,{...initial,...patch})).toBe(false);
  }
  for(const patch of [{lightingQuality:'performance' as const},{constructionOutlineVisibility:'off' as const}]){
    expect(sceneGeometrySettingsEqual(initial,{...initial,...patch})).toBe(true);expect(sceneSettingsEqual(initial,{...initial,...patch})).toBe(false);
  }
});

const renderer=()=>({setConstructionOutlineVisibility:vi.fn(),setLightingQuality:vi.fn(()=>true),setVisible:vi.fn(),preparePresentationFrame:vi.fn(async()=>true),prepareInitialPresentation:vi.fn(async(_projectId?:string|null)=>true)});
it('acknowledges resident settings only after a real prepared frame',async()=>{
  const port=renderer();let resolve!:(value:boolean)=>void;
  port.preparePresentationFrame.mockReturnValueOnce(new Promise(done=>{resolve=done;}));
  const pending=prepareResidentSceneSettings(port,initial,()=>true);
  expect(port.setConstructionOutlineVisibility).toHaveBeenCalledExactlyOnceWith('current');
  expect(port.setLightingQuality).toHaveBeenCalledExactlyOnceWith('cinematic');
  expect(port.setVisible).toHaveBeenCalledExactlyOnceWith(true);
  resolve(true);await expect(pending).resolves.toBe('prepared');
});
it('contains setter, quality and frame failures instead of acknowledging them',async()=>{
  const port=renderer();port.setConstructionOutlineVisibility.mockImplementationOnce(()=>{throw Error('outline');});
  await expect(prepareResidentSceneSettings(port,initial,()=>true)).rejects.toThrow('outline');
  expect(port.preparePresentationFrame).not.toHaveBeenCalled();
  port.setLightingQuality.mockReturnValueOnce(false);
  await expect(prepareResidentSceneSettings(port,initial,()=>true)).rejects.toThrow('quality');
  expect(port.preparePresentationFrame).not.toHaveBeenCalled();
  port.preparePresentationFrame.mockResolvedValueOnce(false);
  await expect(prepareResidentSceneSettings(port,initial,()=>true)).rejects.toThrow('frame');
});
it('ignores a hidden/disposed renderer before and after asynchronous preparation',async()=>{
  const port=renderer();await expect(prepareResidentSceneSettings(port,initial,()=>false)).resolves.toBe('stale');
  expect(port.setLightingQuality).not.toHaveBeenCalled();
  let current=true;port.preparePresentationFrame.mockImplementationOnce(async()=>{current=false;return false;});
  await expect(prepareResidentSceneSettings(port,initial,()=>current)).resolves.toBe('stale');
});
it('adopts the newest retained world before any presentation frame is prepared',async()=>{
  const port=renderer(),events:string[]=[];
  port.preparePresentationFrame.mockImplementationOnce(async()=>{events.push('draw');return true;});
  await expect(prepareResidentSceneSettings(port,initial,()=>true,{adoptLatestWorlds:()=>events.push('adopt')})).resolves.toBe('prepared');
  expect(events).toEqual(['adopt','draw']);
  expect(port.prepareInitialPresentation).not.toHaveBeenCalled();
});
it('resumes an interrupted cold presentation instead of treating one frame as full startup preparation',async()=>{
  const port=renderer();
  await expect(prepareResidentSceneSettings(port,initial,()=>true,{initialPresentation:{openingProjectId:'first-building'}})).resolves.toBe('prepared');
  expect(port.prepareInitialPresentation).toHaveBeenCalledExactlyOnceWith('first-building');
  expect(port.preparePresentationFrame).not.toHaveBeenCalled();
  port.prepareInitialPresentation.mockResolvedValueOnce(false);
  await expect(prepareResidentSceneSettings(port,initial,()=>true,{initialPresentation:{openingProjectId:null}})).rejects.toThrow('frame');
});
