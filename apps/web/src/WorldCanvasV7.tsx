import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ApplicationService } from '@blockcolc/application';
import type { WorldEnvironmentStyle } from '@blockcolc/domain';
import type { AstronomyContext, BlueprintV1, ConstructionOutlineVisibility, ExternalWeatherVisualOverride, VoxelLightingQuality, VoxelRenderer } from '@blockcolc/voxel';
import type { ResourcePackRepository, ResourcePackSelectionMetadata } from '@blockcolc/resource-pack-indexeddb';
import { Map as MapIcon, RotateCcw, Hammer } from 'lucide-react';
import { LoadingPage, type LoadingStage } from './LoadingPage';
import { waitForInitialEnvironment } from './initial-environment';
import { useWorldGlass } from './use-world-glass';
import { BuildingMemoryPanel, createBuildingMemory, conditionLabel } from './BuildingMemoryPanel';
import { loadVoxelModule, useBlueprintCatalog, blueprintName, resourcePackAtlasMaximumSizeForTest } from './voxel-runtime';
import { toVoxelWorlds, decorationDatesByProject } from './world-projection';
import { startRendererGeneration, scheduleAfterPaint } from './renderer-generation';
import { createRendererWorldSnapshotCoordinator, initializeRendererWorlds } from './renderer-bootstrap';
import type { RendererWorldSnapshotOwner } from './renderer-bootstrap';
import { markFocusPerformance } from './focus-performance';
import { resolveSelectedResourcePackState } from './resource-pack-selection';
import type { WorldDebugProjection } from './world-debug';
import { closeFocusSubmissionObservation, commitFocusSubmissionProjection, isFocusSubmissionDiagnosticsEnabled, observeFocusSubmissionFrame, peekFocusSubmissionProjection } from './submission-performance';
import { finishQualityLifecycleBoot, recordQualityLifecyclePhase } from './quality-lifecycle-performance';

export const WorldCanvasV7 = memo(function WorldCanvasV7({service,resourcePacks,lightingQuality,constructionOutlineVisibility,showWorldCoordinates,environmentStyle,worldSeed,terrainGenerationVersion,constructionFeedback=0,sessionActive=false,immersivePresentation=sessionActive,immersiveBand={bottom:0,right:0},glassClarity=50,externalWeatherOverride=null,astronomyContext=null,worldDebug=null,initialEnvironmentPending=false,openingProjectId=null,focusedProjectId,memoryProjectId,onSelectProject,onInitialProjectFocus,onClearWorldFocus,onCloseMemory,onContinueProject,switchBlockedReason,visible,onPickTerrain,pickedCell}:{service:ApplicationService;resourcePacks:ResourcePackRepository;lightingQuality:VoxelLightingQuality;constructionOutlineVisibility:ConstructionOutlineVisibility;showWorldCoordinates:boolean;environmentStyle:WorldEnvironmentStyle;worldSeed:string;terrainGenerationVersion:4;constructionFeedback?:number;sessionActive?:boolean;immersivePresentation?:boolean;immersiveBand?:{bottom:number;right:number};glassClarity?:number;externalWeatherOverride?:ExternalWeatherVisualOverride|null;astronomyContext?:AstronomyContext|null;worldDebug?:WorldDebugProjection|null;initialEnvironmentPending?:boolean;openingProjectId?:string|null;focusedProjectId:string|null;memoryProjectId:string|null;onSelectProject:(projectId:string)=>void;onInitialProjectFocus?:(projectId:string)=>void;onClearWorldFocus:()=>void;onCloseMemory:()=>void;onContinueProject:(projectId:string)=>Promise<void>;switchBlockedReason?:string;visible:boolean;onPickTerrain:(position:{x:number;y:number;z:number})=>void;pickedCell:{x:number;y:number;z:number}|null}) {
  const projectionToken=peekFocusSubmissionProjection();
  const projectionStartedAt=projectionToken===null?0:performance.now();
  const world=service.worldProjection();
  const worldProjectionMs=projectionToken===null?0:performance.now()-projectionStartedAt;
  const state=service.snapshot();
  const ref=useRef<HTMLCanvasElement>(null); const renderer=useRef<VoxelRenderer|null>(null); const catalog=useBlueprintCatalog(); const importedRef=useRef(new Map<string,BlueprintV1>()); const focusRef=useRef(focusedProjectId); const selectRef=useRef(onSelectProject); const visibleRef=useRef(visible); const appliedPackRef=useRef<string|null|undefined>(undefined); const sessionActiveRef=useRef(sessionActive); const pickEnabledRef=useRef(false); const pickTerrainRef=useRef(onPickTerrain); const [ready,setReady]=useState(false); const [resourcePackLoading,setResourcePackLoading]=useState(false); const [resourcePackError,setResourcePackError]=useState(false); const [packRetryRevision,setPackRetryRevision]=useState(0);
  const appliedPackMetadataRef=useRef<ResourcePackSelectionMetadata|null>(null);
  const packRefreshOwnerRef=useRef(0);
  const forceFullPackValidationRef=useRef(true);
  const lastHandledPackRetryRef=useRef(0);
  const latestQualityRef=useRef(lightingQuality); latestQualityRef.current=lightingQuality;
  const immersiveBandRef=useRef(immersiveBand); immersiveBandRef.current=immersiveBand;
  const glassPreference=useWorldGlass(immersivePresentation,glassClarity);
  const glassPreferenceRef=useRef(glassPreference); glassPreferenceRef.current=glassPreference;
  const externalWeatherRef=useRef(externalWeatherOverride); externalWeatherRef.current=externalWeatherOverride;
  const initialEnvironmentPendingRef=useRef(initialEnvironmentPending); initialEnvironmentPendingRef.current=initialEnvironmentPending;
  const [bootStage,setBootStage]=useState<LoadingStage>('resources');
  const astronomyRef=useRef(astronomyContext); astronomyRef.current=astronomyContext;
  const debugRef=useRef(worldDebug); debugRef.current=worldDebug;
  const openingProjectRef=useRef(openingProjectId); openingProjectRef.current=openingProjectId;
  const initialFocusRef=useRef(onInitialProjectFocus); initialFocusRef.current=onInitialProjectFocus;
  const preparedRendererRef=useRef<VoxelRenderer|null>(null);
  const initialPackAttemptRef=useRef<{key:string|null;readFailed:boolean}|null>(null);
  const snapshotOwnerRef=useRef<RendererWorldSnapshotOwner<Parameters<VoxelRenderer['setWorlds']>[0]>|null>(null);
  const pendingWorldSubmissionRef=useRef<{token:number;key:string}|null>(null);
  const worldSubmissionObservationRef=useRef<(()=>void)|null>(null);
  const committedSnapshotKeyRef=useRef<string|null>(null);
  const appliedDebugRef=useRef<WorldDebugProjection|null|undefined>(undefined);
  const [environmentUpdating,setEnvironmentUpdating]=useState(false);
  const initialRevealStartedRef=useRef(false);
  const observeSubmittedWorldRebuild=(current:VoxelRenderer,key:string)=>{
    const pending=pendingWorldSubmissionRef.current;
    if(!pending||pending.key!==key)return;
    pendingWorldSubmissionRef.current=null;
    worldSubmissionObservationRef.current?.();
    const baselineRebuildCount=current.getDiagnostics().renderedWorldRebuildCount;
    const requestedAtMs=performance.now();
    worldSubmissionObservationRef.current=observeFocusSubmissionFrame({
      token:pending.token,
      baselineRebuildCount,
      requestedAtMs,
      readDiagnostics:()=>current.getDiagnostics(),
      isCurrentGeneration:()=>renderer.current===current,
      isVisible:()=>visibleRef.current&&!document.hidden,
      subscribeHidden:callback=>{
        const onVisibility=()=>{if(document.hidden)callback();};
        document.addEventListener('visibilitychange',onVisibility);
        return()=>document.removeEventListener('visibilitychange',onVisibility);
      },
      setTimer:(callback,delay)=>setTimeout(callback,delay),
      clearTimer:handle=>clearTimeout(handle),
    });
  };
  const [documentVisible,setDocumentVisible]=useState(()=>!document.hidden);
  useEffect(()=>{
    const changed=()=>setDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange',changed);
    return()=>document.removeEventListener('visibilitychange',changed);
  },[]);
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
  importedRef.current=new Map(world.projects.flatMap(project=>project.building.importedBlueprint?[[project.building.blueprintId,project.building.importedBlueprint as BlueprintV1]]:[])); focusRef.current=focusedProjectId; selectRef.current=onSelectProject; visibleRef.current=visible && documentVisible;
  const blueprintLabel=(blueprintId:string,importedTitle?:string)=>state.buildingBlueprintResources.find(resource=>resource.id===blueprintId)?.displayName??importedTitle??blueprintName(catalog,blueprintId);
  const decorationDates=decorationDatesByProject(state); const snapshotKey=world.projects.map(project=>`${project.project.id}:${project.building.blueprintId}:${project.building.completionBasisPoints}:${project.building.conditionBasisPoints}:${project.isActive}:${project.settlementIndex}:${(decorationDates.get(project.project.id)??[]).join(',')}:${project.importedDecorations.map(reward=>`${reward.rewardId}@${reward.localPosition.x},${reward.localPosition.z},${reward.rotationQuarterTurns}`).join(';')}`).join('|');
  const snapshots=useMemo(()=>toVoxelWorlds(world.projects,state),[snapshotKey]); const latestSnapshotsRef=useRef({key:snapshotKey,worlds:snapshots}); latestSnapshotsRef.current={key:snapshotKey,worlds:snapshots}; const summary=world.projects.map(project=>`${project.project.title}，${blueprintLabel(project.building.blueprintId,project.building.importedBlueprint?.title)}，${project.isActive?'正在建造':project.project.status==='paused'?'暂停建造':'纪念建筑'}，建造进度 ${Math.round(project.building.completionBasisPoints/100)}%，保存状况 ${conditionLabel(project.building.conditionBasisPoints)}`).join('；'); const focusedTitle=world.projects.find(project=>project.project.id===focusedProjectId)?.project.title;
  useLayoutEffect(()=>{
    if(!isFocusSubmissionDiagnosticsEnabled())return;
    const previousCommittedKey=committedSnapshotKeyRef.current;
    const worldKeyChanged=previousCommittedKey!==null&&previousCommittedKey!==snapshotKey;
    let preservedFrame=null;
    if(!worldKeyChanged&&renderer.current){
      try{preservedFrame=renderer.current.getDiagnostics();}catch{/* unavailable after renderer disposal */}
    }
    const adoption=commitFocusSubmissionProjection({token:projectionToken,snapshotKey,previousCommittedKey,elapsedMs:worldProjectionMs,preservedFrame});
    if(adoption.adopted)pendingWorldSubmissionRef.current=adoption.worldKeyChanged?{token:projectionToken!,key:snapshotKey}:null;
    committedSnapshotKeyRef.current=snapshotKey;
  },[projectionToken,snapshotKey,worldProjectionMs]);
  useEffect(() => {
    setReady(false);
    setResourcePackLoading(false);
    setResourcePackError(false);
    let generationActive = true;
    const releaseGeneration = startRendererGeneration({
      schedule: scheduleAfterPaint,
      load: async () => {
        if (initialEnvironmentPendingRef.current) setBootStage('environment');
        const result = await waitForInitialEnvironment({
          pending: () => initialEnvironmentPendingRef.current,
          current: () => generationActive,
          visible: () => visibleRef.current && !document.hidden,
          now: () => performance.now(), wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
        });
        if (!generationActive) throw new Error('Superseded world generation');
        if (ref.current) ref.current.dataset.initialEnvironmentPreparation = result;
        setBootStage('resources');
        return loadVoxelModule();
      },
      create: ({ createVoxelRenderer, resolveBuiltinBlueprint }) => {
        if (!ref.current) return null;
        const current = createVoxelRenderer(ref.current, {
          resolveBlueprint: id => importedRef.current.get(id) ?? resolveBuiltinBlueprint(id),
          resourcePackAtlasMaximumSize: resourcePackAtlasMaximumSizeForTest(),
          lightingQuality, constructionOutlineVisibility, environmentStyle, worldSeed, terrainGenerationVersion,
          initialEnvironment: { weather: externalWeatherRef.current, astronomy: astronomyRef.current, debug: debugRef.current },
          onSelectProject: projectId => selectRef.current(projectId),
          onPickTerrain: position => { if (pickEnabledRef.current) pickTerrainRef.current(position); },
          debugFlatColors: new URLSearchParams(location.search).has('flat'),
          debugVoidScan: new URLSearchParams(location.search).has('voidscan'),
        });
        renderer.current = current;
        appliedDebugRef.current = debugRef.current;
        snapshotOwnerRef.current = createRendererWorldSnapshotCoordinator(current, latestSnapshotsRef.current, requestedSnapshot => {
          observeSubmittedWorldRebuild(current,requestedSnapshot.key);
        });
        ref.current.dataset.rendererGeneration = String(Number(ref.current.dataset.rendererGeneration ?? 0) + 1);
        recordQualityLifecyclePhase('renderer-created', { rendererGeneration: Number(ref.current.dataset.rendererGeneration) });
        return current;
      },
      initialize: async (current, isCurrent) => {
        current.setReducedMotion(matchMedia('(prefers-reduced-motion: reduce)').matches);
        // Keep atmosphere, transitions and shader warm-up behind the loader.
        current.setVisible(false);
        current.setImmersiveBandFraction(immersiveBandRef.current.bottom ?? 0, immersiveBandRef.current.right ?? 0);
        current.setGlassSurface(glassPreferenceRef.current);
        current.focusProject(focusRef.current);
        let adoptedSelectionMetadata: ResourcePackSelectionMetadata | null = null;
        await initializeRendererWorlds({
          isCurrent,
          latestSnapshot: () => latestSnapshotsRef.current,
          resolvePack: async () => {
            const selection = await resolveSelectedResourcePackState(resourcePacks, null, true);
            adoptedSelectionMetadata = selection.metadata;
            return selection.pack ? { id: selection.pack.id, manifest: selection.pack.manifest } : null;
          },
          initializeWorlds: async (worlds, pack) => {
            setBootStage('scene');
            await new Promise<void>(resolve => scheduleAfterPaint(resolve));
            if (isCurrent()) await current.initializeWorlds(worlds, pack);
          },
          onWorldsInitializationRequested: snapshot => observeSubmittedWorldRebuild(current,snapshot.key),
          onError: error => { setResourcePackError(true); console.error('Voxel resource pack initialization failed; using default materials', error); },
          onPrepared: (key, pack, requestedPack, packReadFailed) => {
            appliedPackRef.current = pack ? `${pack.id}:${pack.manifest.pack.packFormat}` : null;
            initialPackAttemptRef.current = {
              key: requestedPack ? `${requestedPack.id}:${requestedPack.manifest.pack.packFormat}` : null,
              readFailed: packReadFailed,
            };
            appliedPackMetadataRef.current = packReadFailed ? null : adoptedSelectionMetadata;
            forceFullPackValidationRef.current = packReadFailed;
            snapshotOwnerRef.current?.observe(latestSnapshotsRef.current);
            snapshotOwnerRef.current?.prepared(key);
            preparedRendererRef.current = current;
            if (isCurrent()) current.setLightingQuality(latestQualityRef.current);
          },
        });
        if (!isCurrent()) return;
        current.setExternalWeatherOverride(externalWeatherRef.current);
        current.setAstronomyContext(astronomyRef.current);
        if (appliedDebugRef.current !== debugRef.current) current.setEnvironmentDebugOverride(debugRef.current);
        appliedDebugRef.current = debugRef.current;
        setBootStage('environment');
        current.setVisible(visibleRef.current);
        await current.prepareInitialPresentation();
      },
      ready: () => setReady(true),
      readyOnError: false,
      error: error => { setResourcePackError(true); console.error('Voxel world initialization failed', error); },
      release: current => {
        if (renderer.current !== current) return;
        recordQualityLifecyclePhase('renderer-released');
        worldSubmissionObservationRef.current?.();
        worldSubmissionObservationRef.current = null;
        if(pendingWorldSubmissionRef.current)closeFocusSubmissionObservation(pendingWorldSubmissionRef.current.token,'disposed');
        pendingWorldSubmissionRef.current = null;
        renderer.current = null;
        snapshotOwnerRef.current?.dispose();
        snapshotOwnerRef.current = null;
        preparedRendererRef.current = null;
        appliedDebugRef.current = undefined;
        appliedPackRef.current = undefined;
      },
    });
    return () => { generationActive = false; releaseGeneration(); };
  }, [service, resourcePacks, constructionOutlineVisibility, environmentStyle, worldSeed, terrainGenerationVersion]);
  useEffect(()=>{
    const current=renderer.current;
    if(!ready||!current||preparedRendererRef.current!==current)return;
    current.setLightingQuality(lightingQuality);
  },[lightingQuality,ready]);
  useEffect(()=>{renderer.current?.setVisible(visible && documentVisible);},[visible,documentVisible]);
  useEffect(()=>{if(ready)renderer.current?.setExternalWeatherOverride(externalWeatherOverride??null);},[externalWeatherOverride,ready]);
  useEffect(()=>{
    const current=renderer.current;
    if (!ready || !visible || !documentVisible || resourcePackLoading || !current || preparedRendererRef.current!==current) return;
    return scheduleAfterPaint(()=>{
      if (renderer.current===current && visibleRef.current && !document.hidden) current.setAstronomyContext(astronomyRef.current);
    });
  },[astronomyContext,ready,visible,documentVisible,resourcePackLoading]);
  useEffect(()=>{
    const current=renderer.current;
    if (!ready || !visible || !documentVisible || resourcePackLoading || !current || preparedRendererRef.current!==current) {
      setEnvironmentUpdating(false);
      return;
    }
    if (appliedDebugRef.current===worldDebug) return;
    if (appliedDebugRef.current===undefined && worldDebug===null) {
      appliedDebugRef.current=null;
      return;
    }
    const rebuildNeeded=(appliedDebugRef.current?.decayAmount ?? null)!==(worldDebug?.decayAmount ?? null);
    // Corruption changes can replace building geometry. Paint its loader first;
    // weather/time only update the resident presentation without that loader.
    if (rebuildNeeded) setEnvironmentUpdating(true);
    return scheduleAfterPaint(()=>{
      if (renderer.current!==current || !visibleRef.current || document.hidden) return;
      try {
        current.setEnvironmentDebugOverride(debugRef.current);
        appliedDebugRef.current=debugRef.current;
      } catch (error) { console.warn('World presentation update unavailable',error); }
      finally { setEnvironmentUpdating(false); }
    });
  },[worldDebug,ready,visible,documentVisible,resourcePackLoading]);
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const changed=()=>renderer.current?.setReducedMotion(media.matches);
    media.addEventListener('change',changed);
    return()=>media.removeEventListener('change',changed);
  },[]);
  useEffect(()=>{
    const current=renderer.current;
    if (!ready || !visible || !documentVisible || resourcePackLoading || environmentUpdating || !current
      || current !== preparedRendererRef.current || initialRevealStartedRef.current) return;
    // Wait until the loader's removal has painted. Direct camera control must
    // never reuse project selection, which would also open building memory.
    return scheduleAfterPaint(()=>{
      if (renderer.current !== current || !visibleRef.current || document.hidden || initialRevealStartedRef.current) return;
      initialRevealStartedRef.current=true;
      const openingProject=openingProjectRef.current;
      void current.revealInitialProject(openingProject).then(result=>{
        if (result==='completed' && openingProject && renderer.current===current
          && focusRef.current===null && openingProjectRef.current===openingProject) {
          initialFocusRef.current?.(openingProject);
        }
        recordQualityLifecyclePhase('initial-reveal-complete', { status: result === 'completed' ? 'ok' : 'stale' });
        finishQualityLifecycleBoot(result === 'completed' ? 'completed' : 'cancelled');
      }).catch(error=>{
        recordQualityLifecyclePhase('initial-reveal-complete', { status: 'failed' });
        finishQualityLifecycleBoot('failed');
        console.warn('Initial world reveal unavailable',error);
      });
    });
  },[ready,visible,documentVisible,resourcePackLoading,environmentUpdating]);
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
  useEffect(()=>{renderer.current?.setGlassSurface(glassPreference);},[glassPreference]);
  // MT-02: with the renderer resident, the pack switched in settings must apply when the pane returns; re-apply only when the active pack actually changed.
  useEffect(() => {
    const refreshOwner = ++packRefreshOwnerRef.current;
    let ownsLoading = false;
    const finishOwnedLoading = () => {
      if (!ownsLoading || packRefreshOwnerRef.current !== refreshOwner) return;
      ownsLoading = false;
      setResourcePackLoading(false);
    };
    const current = renderer.current;
    if (!visible || !documentVisible || !ready || !current) return () => { finishOwnedLoading(); };
    if (packRetryRevision > lastHandledPackRetryRef.current) {
      lastHandledPackRetryRef.current = packRetryRevision;
      forceFullPackValidationRef.current = true;
    }
    let cancelled = false;
    void resolveSelectedResourcePackState(resourcePacks, appliedPackMetadataRef.current, forceFullPackValidationRef.current || resourcePackError).then(async selection => {
      if (cancelled || renderer.current !== current) return;
      const pack = selection.pack;
      const key = pack ? `${pack.id}:${pack.manifest.pack.packFormat}` : null;
      const initialAttempt = initialPackAttemptRef.current;
      if (selection.unchanged) {
        initialPackAttemptRef.current = null;
        forceFullPackValidationRef.current = false;
        return;
      }
      if (initialAttempt && !selection.metadata && !initialAttempt.readFailed && initialAttempt.key === key) {
        initialPackAttemptRef.current = null;
        return;
      }
      ownsLoading = true;
      setResourcePackLoading(true);
      try {
        await new Promise<void>(resolve => requestAnimationFrame(() => window.setTimeout(resolve, 0)));
        if (cancelled || renderer.current !== current) return;
        await current.setResourcePack(pack ? { id: pack.id, manifest: pack.manifest } : null);
        if (cancelled || renderer.current !== current) return;
        appliedPackRef.current = key;
        appliedPackMetadataRef.current = selection.metadata;
        forceFullPackValidationRef.current = false;
        initialPackAttemptRef.current = null;
        current.setVisible(visibleRef.current);
        setResourcePackError(false);
      } finally {
        finishOwnedLoading();
      }
    }).catch(error => { if (!cancelled) { forceFullPackValidationRef.current = true; setResourcePackError(true); console.error('Voxel resource pack refresh failed', error); } });
    return () => { cancelled = true; finishOwnedLoading(); };
  }, [visible, documentVisible, resourcePacks, ready, packRetryRevision]);
  useEffect(()=>{snapshotOwnerRef.current?.observe({key:snapshotKey,worlds:snapshots});},[snapshotKey,snapshots]);
  useEffect(()=>{renderer.current?.focusProject(focusedProjectId);},[focusedProjectId]);
  useEffect(()=>{
    const current=renderer.current;
    if(current && ref.current?.dataset.openingRevealState==='active'){
      current.focusProject(focusRef.current);
      current.resetCamera();
    }
  },[openingProjectId]);
  const memoryProject=world.projects.find(project=>project.project.id===memoryProjectId);
  const memory=memoryProject?createBuildingMemory(state,memoryProject,blueprintLabel(memoryProject.building.blueprintId,memoryProject.building.importedBlueprint?.title)):null;
  const loadingStatus=!ready?(resourcePackError?'世界初始化失败，请重新打开此页面或刷新后重试。':bootStage==='environment'?'正在校准光照与天气…':bootStage==='scene'?'正在准备地形与建筑…':'正在读取世界资源…'):resourcePackLoading?'正在更新世界材质…':environmentUpdating?'正在更新世界画面…':null;
  return <>
    <figure className={focusedProjectId?'world is-project-focused':'world'}>
      <canvas ref={ref} role="img" aria-label="项目建筑世界" aria-describedby="world-summary" data-coordinate-picking={pickEnabled?'true':'false'}/>
      {visible&&<div className="world-hud-tapzone" aria-hidden="true" onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>{event.stopPropagation();toggleViewControls();}}/>}
      {visible&&immersivePresentation&&(viewControlsVisible||viewControlsLeaving)&&<div className={`immersive-view-controls${viewControlsLeaving?' is-leaving':''}`}>
        {focusedProjectId&&<button type="button" className="immersive-reset-view" aria-label="重置地图" title="重置地图" onClick={()=>runViewAction(onClearWorldFocus)}><MapIcon/></button>}
        <button type="button" className="immersive-reset-view" aria-label="重置视角" title="重置视角" onClick={()=>runViewAction(()=>renderer.current?.resetCamera())}><RotateCcw/></button>
      </div>}
      {visible&&<figcaption id="world-summary" className="sr-only">林边聚落，共 {world.projects.length} 栋建筑。{summary}</figcaption>}
      {visible&&ready&&resourcePackError&&<div className="world-pack-error" role="status">材质包暂不可用，当前使用默认材质。 <button type="button" onClick={()=>setPackRetryRevision(value=>value+1)}>重试</button></div>}
      {visible&&!immersivePresentation&&<nav className="world-building-index" aria-label="聚落建筑">{world.projects.map(project=><button key={project.project.id} type="button" onClick={()=>onSelectProject(project.project.id)}>查看建筑记忆：{project.project.title}</button>)}</nav>}
      {visible&&pickEnabled&&pickedCell&&<div className="world-pick-chip" role="status" data-testid="world-pick">x {pickedCell.x} · z {pickedCell.z} · 高 {pickedCell.y}</div>}
      {visible&&!immersivePresentation&&(viewControlsVisible||viewControlsLeaving)&&<div className={`world-hud${viewControlsLeaving?' is-leaving':''}`}>
        <span>{focusedTitle?`正在查看 · ${focusedTitle}`:`林边聚落 · ${world.projects.length} 栋`}</span>
        <div className="world-hud-actions">
          {focusedProjectId&&<button title="重置地图" aria-label="重置地图" onClick={()=>runViewAction(onClearWorldFocus)}><MapIcon/></button>}
          <button title="重置视角" aria-label="重置视角" onClick={()=>runViewAction(()=>renderer.current?.resetCamera())}><RotateCcw/></button>
        </div>
      </div>}
      {visible&&constructionFeedback>0&&<div key={constructionFeedback} className="construction-feedback" role="status"><Hammer/><span>材料已送达，继续建造</span><i/><i/><i/></div>}
    </figure>
    {visible&&!immersivePresentation&&memory&&<BuildingMemoryPanel memory={memory} switchBlockedReason={memory.isActive?undefined:switchBlockedReason} onClose={onCloseMemory} onContinue={()=>void onContinueProject(memory.projectId)}/>}
    {loadingStatus&&<LoadingPage stage={resourcePackError?'error':!ready?bootStage:resourcePackLoading?'resources':'environment'} status={loadingStatus}/>}
  </>;
});
