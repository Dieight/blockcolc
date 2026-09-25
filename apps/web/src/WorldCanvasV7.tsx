import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApplicationService } from '@tomato-clock/application';
import type { WorldEnvironmentStyle } from '@tomato-clock/domain';
import type { BlueprintV1, ConstructionOutlineVisibility, ExternalWeatherVisualOverride, VoxelLightingQuality, VoxelRenderer } from '@tomato-clock/voxel';
import type { ResourcePackRepository } from '@tomato-clock/resource-pack-indexeddb';
import { Map as MapIcon, RotateCcw, Hammer } from 'lucide-react';
import { LoadingPage } from './LoadingPage';
import { BuildingMemoryPanel, createBuildingMemory, conditionLabel } from './BuildingMemoryPanel';
import { loadVoxelModule, useBlueprintCatalog, blueprintName, resourcePackAtlasMaximumSizeForTest } from './voxel-runtime';
import { toVoxelWorlds, decorationDatesByProject } from './world-projection';
import { startRendererGeneration, scheduleAfterPaint } from './renderer-generation';
import { markFocusPerformance } from './focus-performance';
import { resolveSelectedResourcePack } from './resource-pack-selection';

export const WorldCanvasV7 = memo(function WorldCanvasV7({service,resourcePacks,lightingQuality,constructionOutlineVisibility,showWorldCoordinates,environmentStyle,worldSeed,terrainGenerationVersion,constructionFeedback=0,sessionActive=false,immersivePresentation=sessionActive,immersiveBand={bottom:0,right:0},externalWeatherOverride=null,focusedProjectId,memoryProjectId,onSelectProject,onClearWorldFocus,onCloseMemory,onContinueProject,switchBlockedReason,visible,onPickTerrain,pickedCell}:{service:ApplicationService;resourcePacks:ResourcePackRepository;lightingQuality:VoxelLightingQuality;constructionOutlineVisibility:ConstructionOutlineVisibility;showWorldCoordinates:boolean;environmentStyle:WorldEnvironmentStyle;worldSeed:string;terrainGenerationVersion:4;constructionFeedback?:number;sessionActive?:boolean;immersivePresentation?:boolean;immersiveBand?:{bottom:number;right:number};externalWeatherOverride?:ExternalWeatherVisualOverride|null;focusedProjectId:string|null;memoryProjectId:string|null;onSelectProject:(projectId:string)=>void;onClearWorldFocus:()=>void;onCloseMemory:()=>void;onContinueProject:(projectId:string)=>Promise<void>;switchBlockedReason?:string;visible:boolean;onPickTerrain:(position:{x:number;y:number;z:number})=>void;pickedCell:{x:number;y:number;z:number}|null}) {
  const ref=useRef<HTMLCanvasElement>(null); const renderer=useRef<VoxelRenderer|null>(null); const catalog=useBlueprintCatalog(); const world=service.worldProjection(); const state=service.snapshot(); const importedRef=useRef(new Map<string,BlueprintV1>()); const focusRef=useRef(focusedProjectId); const selectRef=useRef(onSelectProject); const visibleRef=useRef(visible); const appliedPackRef=useRef<string|null|undefined>(undefined); const sessionActiveRef=useRef(sessionActive); const pickEnabledRef=useRef(false); const pickTerrainRef=useRef(onPickTerrain); const [ready,setReady]=useState(false); const [resourcePackLoading,setResourcePackLoading]=useState(false);
  const immersiveBandRef=useRef(immersiveBand); immersiveBandRef.current=immersiveBand;
  const externalWeatherRef=useRef(externalWeatherOverride); externalWeatherRef.current=externalWeatherOverride;
  // V21 top-right HUD reveal: one shared control governs both the immersive
  // view controls and the ordinary world HUD. Tapping the corner shows them,
  // then they auto-hide after 5 s with the same fade as the other conditional
  // controls. The ordinary workbench starts with the HUD visible and only hides
  // once toggled, so casual use keeps the settlement label.
  const [viewControlsVisible,setViewControlsVisible]=useState(!immersivePresentation);
  const [viewControlsLeaving,setViewControlsLeaving]=useState(false);
  const viewHideTimerRef=useRef<number|null>(null);
  const lastViewToggleRef=useRef(0);
  const viewRevealedAtRef=useRef(0);
  const prevSessionActiveRef=useRef(immersivePresentation);
  useEffect(()=>{
    if(prevSessionActiveRef.current===immersivePresentation)return;
    prevSessionActiveRef.current=immersivePresentation;
    if(viewHideTimerRef.current!==null)window.clearTimeout(viewHideTimerRef.current);
    viewHideTimerRef.current=null;
    lastViewToggleRef.current=0;
    setViewControlsLeaving(false);
    // During focus the control stays hidden until the corner is tapped; back on
    // the idle workbench the settlement HUD is visible again.
    setViewControlsVisible(!immersivePresentation);
  },[immersivePresentation]);
  useEffect(()=>()=>{if(viewHideTimerRef.current!==null)window.clearTimeout(viewHideTimerRef.current);},[]);
  const hideViewControls=useCallback(()=>{
    if(viewHideTimerRef.current!==null)window.clearTimeout(viewHideTimerRef.current);
    viewHideTimerRef.current=null;
    setViewControlsLeaving(true);
    viewHideTimerRef.current=window.setTimeout(()=>{setViewControlsVisible(false);setViewControlsLeaving(false);},180);
  },[]);
  const revealViewControls=useCallback(()=>{
    if(viewHideTimerRef.current!==null)window.clearTimeout(viewHideTimerRef.current);
    setViewControlsVisible(true);
    setViewControlsLeaving(false);
    viewRevealedAtRef.current=performance.now();
    viewHideTimerRef.current=window.setTimeout(hideViewControls,5000);
  },[hideViewControls]);
  const toggleViewControls=useCallback(()=>{
    const now=performance.now();
    // Debounce rapid corner taps so they cannot queue up and replay later, but
    // never swallow the very first tap (performance.now starts at 0 under the
    // Playwright clock, which must not read as a repeated tap).
    if(lastViewToggleRef.current!==0&&now-lastViewToggleRef.current<250)return;
    lastViewToggleRef.current=now;
    if(viewControlsVisible&&!viewControlsLeaving)hideViewControls();
    else revealViewControls();
  },[viewControlsVisible,viewControlsLeaving,hideViewControls,revealViewControls]);
  // Ignore the very tap that revealed the control (the finger may land on a
  // button) and any taps within a short grace period after it.
  const runViewAction=useCallback((action:()=>void)=>{
    if(performance.now()-viewRevealedAtRef.current<400)return;
    action();
  },[]);
  // The query flag remains an explicit diagnostic override. Normal builds use
  // the persistent Settings preference so QA can turn coordinates off after
  // validating a candidate without rebuilding it.
  const pickEnabled=new URLSearchParams(location.search).has('pick')
    || showWorldCoordinates;
  pickEnabledRef.current=pickEnabled; pickTerrainRef.current=onPickTerrain;
  importedRef.current=new Map(world.projects.flatMap(project=>project.building.importedBlueprint?[[project.building.blueprintId,project.building.importedBlueprint as BlueprintV1]]:[])); focusRef.current=focusedProjectId; selectRef.current=onSelectProject; visibleRef.current=visible;
  const blueprintLabel=(blueprintId:string,importedTitle?:string)=>state.buildingBlueprintResources.find(resource=>resource.id===blueprintId)?.displayName??importedTitle??blueprintName(catalog,blueprintId);
  const decorationDates=decorationDatesByProject(state); const snapshotKey=world.projects.map(project=>`${project.project.id}:${project.building.blueprintId}:${project.building.completionBasisPoints}:${project.building.conditionBasisPoints}:${project.isActive}:${project.settlementIndex}:${(decorationDates.get(project.project.id)??[]).join(',')}:${project.importedDecorations.map(reward=>`${reward.rewardId}@${reward.localPosition.x},${reward.localPosition.z},${reward.rotationQuarterTurns}`).join(';')}`).join('|'); const snapshots=useMemo(()=>toVoxelWorlds(world.projects,state),[snapshotKey]); const summary=world.projects.map(project=>`${project.project.title}，${blueprintLabel(project.building.blueprintId,project.building.importedBlueprint?.title)}，${project.isActive?'正在建造':project.project.status==='paused'?'暂停建造':'纪念建筑'}，建造进度 ${Math.round(project.building.completionBasisPoints/100)}%，保存状况 ${conditionLabel(project.building.conditionBasisPoints)}`).join('；'); const focusedTitle=world.projects.find(project=>project.project.id===focusedProjectId)?.project.title;
  useEffect(() => {
    setReady(false);
    return startRendererGeneration({
      schedule: scheduleAfterPaint,
      load: loadVoxelModule,
      create: ({ createVoxelRenderer, resolveBuiltinBlueprint }) => {
        if (!ref.current) return null;
        const current = createVoxelRenderer(ref.current, {
          resolveBlueprint: id => importedRef.current.get(id) ?? resolveBuiltinBlueprint(id),
          resourcePackAtlasMaximumSize: resourcePackAtlasMaximumSizeForTest(),
          lightingQuality, constructionOutlineVisibility, environmentStyle, worldSeed, terrainGenerationVersion,
          onSelectProject: projectId => selectRef.current(projectId),
          onPickTerrain: position => { if (pickEnabledRef.current) pickTerrainRef.current(position); },
          debugFlatColors: new URLSearchParams(location.search).has('flat'),
          debugVoidScan: new URLSearchParams(location.search).has('voidscan'),
        });
        renderer.current = current;
        ref.current.dataset.rendererGeneration = String(Number(ref.current.dataset.rendererGeneration ?? 0) + 1);
        return current;
      },
      initialize: async (current, isCurrent) => {
        current.setReducedMotion(matchMedia('(prefers-reduced-motion: reduce)').matches);
        current.setVisible(visibleRef.current);
        current.setImmersiveBandFraction(immersiveBandRef.current.bottom ?? 0, immersiveBandRef.current.right ?? 0);
        current.setExternalWeatherOverride(externalWeatherRef.current ?? null);
        current.setWorlds(toVoxelWorlds(service.worldProjection().projects, service.snapshot()));
        current.focusProject(focusRef.current);
        const pack = await resolveSelectedResourcePack(resourcePacks);
        if (!isCurrent()) return;
        await current.setResourcePack(pack ? { id: pack.id, manifest: pack.manifest } : null);
        if (!isCurrent()) return;
        appliedPackRef.current = pack ? `${pack.id}:${pack.manifest.pack.packFormat}` : null;
      },
      ready: () => setReady(true),
      error: error => console.error('Voxel world initialization failed', error),
      release: current => {
        if (renderer.current !== current) return;
        renderer.current = null;
        appliedPackRef.current = undefined;
      },
    });
  }, [service, resourcePacks, lightingQuality, constructionOutlineVisibility, environmentStyle, worldSeed, terrainGenerationVersion]);
  useEffect(()=>{renderer.current?.setVisible(visible);},[visible]);
  useEffect(()=>{renderer.current?.setExternalWeatherOverride(externalWeatherOverride??null);},[externalWeatherOverride]);
  // IF-01: bounded construction pulses — round completed (stronger) and focus started (gentle).
  useEffect(()=>{if(constructionFeedback>0)renderer.current?.playConstructionPulse(1);},[constructionFeedback]);
  useEffect(()=>{
    const previous=sessionActiveRef.current;
    sessionActiveRef.current=sessionActive;
    if(!sessionActive||previous)return;
    markFocusPerformance('renderer-requested');
    renderer.current?.playConstructionPulse(0.6);
    // This is a browser diagnostic boundary: it records the first committed
    // frame after the focus state reached the resident renderer. It is not a
    // device FPS or end-to-end latency claim.
    let frame=0;
    if(typeof requestAnimationFrame==='function') frame=requestAnimationFrame(()=>markFocusPerformance('renderer-updated'));
    else markFocusPerformance('renderer-updated');
    return ()=>{if(frame)cancelAnimationFrame(frame);};
  },[sessionActive]);
  useEffect(()=>{renderer.current?.setImmersiveBandFraction(immersiveBandRef.current.bottom??0,immersiveBandRef.current.right??0);},[immersiveBand?.bottom,immersiveBand?.right]);
  // MT-02: with the renderer resident, the pack switched in settings must apply when the pane returns; re-apply only when the active pack actually changed.
  useEffect(() => {
    const current = renderer.current;
    if (!visible || !ready || !current) return;
    let cancelled = false;
    void resolveSelectedResourcePack(resourcePacks).then(async pack => {
      if (cancelled || renderer.current !== current) return;
      const key = pack ? `${pack.id}:${pack.manifest.pack.packFormat}` : null;
      if (appliedPackRef.current === key) return;
      setResourcePackLoading(true);
      try {
        await new Promise<void>(resolve => requestAnimationFrame(() => window.setTimeout(resolve, 0)));
        if (cancelled || renderer.current !== current) return;
        await current.setResourcePack(pack ? { id: pack.id, manifest: pack.manifest } : null);
        if (cancelled || renderer.current !== current) return;
        appliedPackRef.current = key;
        current.setVisible(visibleRef.current);
      } finally {
        if (!cancelled) setResourcePackLoading(false);
      }
    }).catch(error => { if (!cancelled) console.error('Voxel resource pack refresh failed', error); });
    return () => { cancelled = true; };
  }, [visible, resourcePacks, ready]);
  useEffect(()=>{renderer.current?.setWorlds(snapshots);},[snapshots]);
  useEffect(()=>{renderer.current?.focusProject(focusedProjectId);},[focusedProjectId]);
  const memoryProject=world.projects.find(project=>project.project.id===memoryProjectId);
  const memory=memoryProject?createBuildingMemory(state,memoryProject,blueprintLabel(memoryProject.building.blueprintId,memoryProject.building.importedBlueprint?.title)):null;
  return <><figure className={focusedProjectId?'world is-project-focused':'world'}><canvas ref={ref} role="img" aria-label="项目建筑世界" aria-describedby="world-summary" data-coordinate-picking={pickEnabled?'true':'false'}/>{visible&&<div className="world-hud-tapzone" aria-hidden="true" onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>{event.stopPropagation();toggleViewControls();}}/>}{visible&&immersivePresentation&&(viewControlsVisible||viewControlsLeaving)&&<div className={`immersive-view-controls${viewControlsLeaving?' is-leaving':''}`}>{focusedProjectId&&<button type="button" className="immersive-reset-view" aria-label="重置地图" title="重置地图" onClick={()=>runViewAction(onClearWorldFocus)}><MapIcon/></button>}<button type="button" className="immersive-reset-view" aria-label="重置视角" title="重置视角" onClick={()=>runViewAction(()=>renderer.current?.resetCamera())}><RotateCcw/></button></div>}{visible&&<figcaption id="world-summary" className="sr-only">林边聚落，共 {world.projects.length} 栋建筑。{summary}</figcaption>}{visible&&!immersivePresentation&&<nav className="world-building-index" aria-label="聚落建筑">{world.projects.map(project=><button key={project.project.id} type="button" onClick={()=>onSelectProject(project.project.id)}>查看建筑记忆：{project.project.title}</button>)}</nav>}{visible&&pickEnabled&&pickedCell&&<div className="world-pick-chip" role="status" data-testid="world-pick">x {pickedCell.x} · z {pickedCell.z} · 高 {pickedCell.y}</div>}{visible&&!immersivePresentation&&(viewControlsVisible||viewControlsLeaving)&&<div className={`world-hud${viewControlsLeaving?' is-leaving':''}`}><span>{focusedTitle?`正在查看 · ${focusedTitle}`:`林边聚落 · ${world.projects.length} 栋`}</span><div className="world-hud-actions">{focusedProjectId&&<button title="重置地图" aria-label="重置地图" onClick={()=>runViewAction(onClearWorldFocus)}><MapIcon/></button>}<button title="重置视角" aria-label="重置视角" onClick={()=>runViewAction(()=>renderer.current?.resetCamera())}><RotateCcw/></button></div></div>}{visible&&constructionFeedback>0&&<div key={constructionFeedback} className="construction-feedback" role="status"><Hammer/><span>材料已送达，继续建造</span><i/><i/><i/></div>}</figure>{visible&&!immersivePresentation&&memory&&<BuildingMemoryPanel memory={memory} switchBlockedReason={memory.isActive?undefined:switchBlockedReason} onClose={onCloseMemory} onContinue={()=>void onContinueProject(memory.projectId)}/>} {(!ready||resourcePackLoading)&&<LoadingPage status={resourcePackLoading?'正在更新世界材质…':'正在建造世界…'}/>}</>;
});
