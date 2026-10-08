import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ApplicationCommand, ApplicationResult, ApplicationService } from '@blockcolc/application';
import type { LitematicImportResult } from '@blockcolc/litematic';
import { localDateOf, projectProgressBasisPoints } from '@blockcolc/domain';
import { FileUp } from 'lucide-react';
import { PixelChart as BarChart3, PixelClock as Clock3, PixelTasks as ListTodo, PixelPlus as Plus, PixelSettings as Settings, PixelCalendar, PixelTrophy as Trophy, PixelClose as X, PixelCube, PixelBrand, PixelRepeat, PixelHammer } from './ui/PixelIcon';
import type { BlueprintCatalogEntry, BlueprintV1 } from '@blockcolc/voxel';
import type { ResourcePackRepository } from '@blockcolc/resource-pack-indexeddb';
import { LoadingPage } from './LoadingPage';
import { handleBack, useBackLayer } from './back-layer';
import { NativeImeTextEntry, isImeCommitKey, type NativeImeInputRef } from './NativeImeTextEntry';
import type { FocusPreferences } from './app-types';
import { useFocusPreferences } from './use-focus-preferences';
import { unsettledMarathonSessions } from './marathon-settlement';
import { LITEMATIC_MAX_COMPRESSED_BYTES, readBrowserFileBytes } from './browser-adapters';
import { useApplicationLifecycle } from './use-application-lifecycle';
import { createRoundPlanStore } from './round-plan-store';
import { createCommandRunner } from './command-runner';
import releaseVersion from '../../../version.json';
import { WorldScreenV7 } from './WorldScreenV7';
import { WorldCanvasV7 } from './WorldCanvasV7';
import { useWorldWeather } from './use-world-weather';
import { NORMAL_WORLD_DEBUG, projectWorldDebug, type WorldDebugSettings } from './world-debug';
import { MarathonProgressReport } from './FocusReports';
import { BlueprintPicker } from './BlueprintPicker';
import { shouldPersistBlueprintSnapshot, toImportedBlueprint } from './blueprint-adapter';
import { useBlueprintCatalog } from './voxel-runtime';
import { resolveSelectedResourcePack } from './resource-pack-selection';
import { requiresFirstProjectSetup, workspacePresentation } from './workspace-presentation';
import { WorkspaceRest } from './WorkspaceRest';
import { usePresentationTransition } from './use-presentation-transition';
import { useModePortal } from './use-mode-portal';
import { installButtonIconMotion } from './ui/button-icon-motion';
import { useDailyBackup } from './use-daily-backup';
import { paintPendingFeedback } from './refresh-feedback';
import { createScenePreparation } from './scene-preparation';
import type { AppRelease } from './app-update';
import { useAutoUpdateCheck } from './use-auto-update-check';
import { AboutDialog } from './AboutDialog';
import { appUpdater } from './app-updater';
import { OnboardingDialog } from './OnboardingDialog';
import { shouldOfferTutorial, completeTutorial } from './onboarding';

let tasksScreenModulePromise: Promise<{ default: (typeof import('./TaskManagement'))['TasksScreen'] }> | null = null;
let statsScreenModulePromise: Promise<{ default: (typeof import('./StatsScreen'))['StatsScreen'] }> | null = null;
let settingsScreenModulePromise: Promise<{ default: (typeof import('./SettingsScreen'))['SettingsScreen'] }> | null = null;
function loadTasksScreen() { return tasksScreenModulePromise ??= import('./TaskManagement').then(module => ({ default: module.TasksScreen })); }
function loadStatsScreen() { return statsScreenModulePromise ??= import('./StatsScreen').then(module => ({ default: module.StatsScreen })); }
function loadSettingsScreen() { return settingsScreenModulePromise ??= import('./SettingsScreen').then(module => ({ default: module.SettingsScreen })); }
const TasksScreen = memo(lazy(loadTasksScreen));
const StatsScreen = memo(lazy(loadStatsScreen));
const SettingsScreen = memo(lazy(loadSettingsScreen));

type Tab = 'world' | 'tasks' | 'stats' | 'settings';
type ImportRole = 'building' | 'decoration';
interface ProjectSetupDraft { kind: 'finite' | 'habit'; title: string; subtasksText: string; blueprintId: string; habitTargetRounds: number; imported: LitematicImportResult | null; packCompatibility: { name: string; textured: number; fallback: number; total: number } | null; importRole: ImportRole }
const APP_VERSION = releaseVersion.versionName;
const INITIAL_PROJECT_SETUP_DRAFT: ProjectSetupDraft = { kind: 'finite', title: '我的第一座工坊', subtasksText: '确定目标\n完成核心工作\n检查并收尾', blueprintId: 'builtin-small-workshop', habitTargetRounds: 10, imported: null, packCompatibility: null, importRole: 'building' };
const FIRST_PROJECT_SETUP_KEY = 'blockcolc-first-project-setup-v1';
let litematicModulePromise:Promise<typeof import('@blockcolc/litematic')>|null=null;
function loadLitematicModule(){litematicModulePromise??=import('@blockcolc/litematic');return litematicModulePromise;}
function readFirstProjectSetupMarker(): boolean { try { return window.localStorage.getItem(FIRST_PROJECT_SETUP_KEY) === '1'; } catch { return false; } }
function writeFirstProjectSetupMarker(): void { try { window.localStorage.setItem(FIRST_PROJECT_SETUP_KEY, '1'); } catch { /* persisted state remains authoritative */ } }



export function App({ service, resourcePacks }: { service: ApplicationService; resourcePacks: ResourcePackRepository }) {
  useEffect(() => installButtonIconMotion(document), []);
  useDailyBackup(service);
  useEffect(() => appUpdater.attach(), []);
  const [tab, setTab] = useState<Tab>('world'); const [version, setVersion] = useState(0);
  // Transient status toasts may carry one navigable action (e.g. open settings)
  // when the message needs a user decision, not just an acknowledgement. The
  // excursion warning stays on the world page's own chip and never routes here.
  const [message, setMessage] = useState<{ text: string; action?: { label: string; target: Tab } } | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState<ProjectSetupDraft | null>(null);
  const [worldFocusProjectId,setWorldFocusProjectId]=useState<string|null>(null);
  const [worldMemoryProjectId,setWorldMemoryProjectId]=useState<string|null>(null);
  const [aboutOpen,setAboutOpen]=useState(false);
  const [availableRelease,setAvailableRelease]=useState<AppRelease|null>(null);
  const [ceremony,setCeremony]=useState<{projectId:string;title:string}|null>(null);
  const { preferences, updatePreferences } = useFocusPreferences();
  const [minimalTemporarilyExited, setMinimalTemporarilyExited] = useState(false);
  const [minimalPresentation, setMinimalPresentation] = useState(false);
  const [worldImmersive, setWorldImmersive] = useState(false);
  const [preparingEnvironment,setPreparingEnvironment]=useState<ReturnType<ApplicationService['snapshot']>['worldSettings']['environmentStyle']|null>(null);
  const scenePreparation=useMemo(()=>createScenePreparation(setPreparingEnvironment),[]);
  const hasResidentWorld=useRef(false);
  useEffect(()=>()=>scenePreparation.cancel(),[scenePreparation]);
  const [worldDebug, setWorldDebug] = useState<WorldDebugSettings>(NORMAL_WORLD_DEBUG);
  const worldDebugProjection = useMemo(() => projectWorldDebug(worldDebug, Date.now()), [worldDebug]);
  const [firstProjectSetupDone, setFirstProjectSetupDone] = useState(readFirstProjectSetupMarker);
  const [tutorial,setTutorial]=useState<'first'|'replay'|null>(()=>shouldOfferTutorial(window.localStorage,requiresFirstProjectSetup(service.snapshot(),readFirstProjectSetupMarker(),unsettledMarathonSessions(service.snapshot()).some(session=>session.deferredSettlement===true)))?'first':null);
  const closeTutorial=useCallback(()=>{completeTutorial(window.localStorage);setTutorial(null);},[]);
  const replayTutorial=useCallback(()=>setTutorial('replay'),[]);
  const firstRunRequiredRef = useRef(false);
  const navigateTo = useCallback((next: Tab) => {
    if (firstRunRequiredRef.current && next !== 'world') { setTab('world'); return; }
    setTab(next);
  }, []);
  const showMessage = useCallback((text: string, action?: { label: string; target: Tab }) => {
    setMessage(action ? { text, action } : { text });
  }, []);
  const clearMessage = useCallback(() => setMessage(null), []);
  const refresh = useCallback(() => setVersion(v => v + 1), []);
  const recordedIntegrityNotice = useApplicationLifecycle(service, refresh);
  const refreshAfterReplacement = useCallback(() => {
    // Backup import/rollback is a silent new baseline, never an unlock event.
    clearMessage(); refresh();
  }, [refresh, clearMessage]);
  const resumeVisibleFocus = useCallback(async () => {
    await service.resume();
    refresh();
  }, [service, refresh]);
  const changePreferences = useCallback((next: FocusPreferences) => {
    try {
      updatePreferences(next);
      if (next.minimalMode !== preferences.minimalMode) setMinimalTemporarilyExited(false);
      return true;
    } catch (error) {
      showMessage(error instanceof Error ? `设置未保存：${error.message}` : '设置未保存，请重试。');
      return false;
    }
  }, [updatePreferences, preferences.minimalMode, showMessage]);
  const run = useMemo(() => createCommandRunner({
    service, refresh, failure: showMessage,
    feedback: ({ message: next, ceremony: completed }) => {
      if (next) showMessage(next.text, next.action);
      else clearMessage();
      if (completed) setCeremony(completed);
    },
  }), [service, refresh, showMessage, clearMessage]);
  const configureOutline=useCallback(async(value:FocusPreferences['constructionOutlineVisibility'])=>{
    if(value===preferences.constructionOutlineVisibility)return;
    if(!hasResidentWorld.current){changePreferences({...preferences,constructionOutlineVisibility:value});return;}
    const environment=service.snapshot().worldSettings.environmentStyle;
    const prepared=scenePreparation.begin(environment);
    try{await paintPendingFeedback();if(!changePreferences({...preferences,constructionOutlineVisibility:value})){scenePreparation.cancel();return;}await prepared;}
    catch{scenePreparation.failed(environment);showMessage('施工轮廓准备未完成，请重试。');}
  },[preferences,changePreferences,service,scenePreparation,showMessage]);
  const configureEnvironment=useCallback(async(environmentStyle:NonNullable<typeof preparingEnvironment>)=>{
    if(environmentStyle===service.snapshot().worldSettings.environmentStyle)return;
    if(!hasResidentWorld.current)return run({type:'ConfigureWorldEnvironment',environmentStyle});
    const prepared=scenePreparation.begin(environmentStyle);
    try {
      await paintPendingFeedback();
      const result=await run({type:'ConfigureWorldEnvironment',environmentStyle});
      if(!result.ok){scenePreparation.cancel();return result;}
      await prepared;return result;
    } catch(error){scenePreparation.failed(environmentStyle);showMessage(error instanceof Error?error.message:'世界准备未完成，请重试。');}
  },[service,run,scenePreparation,showMessage]);
  useEffect(()=>{let observed=localDateOf(new Date(),service.snapshot().calendar.timeZone);const timer=window.setInterval(()=>{const next=localDateOf(new Date(),service.snapshot().calendar.timeZone);if(next!==observed){observed=next;refresh();}},60_000);return()=>window.clearInterval(timer);},[service,refresh]);
  useEffect(()=>{if(!message)return;const timeout=window.setTimeout(()=>setMessage(null),5000);return()=>window.clearTimeout(timeout);},[message]);
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [tab, creatingProject]);
  const state = useMemo(() => service.snapshot(), [service, version]); const active = useMemo(() => service.activeProjectProjection(), [service, version]);
  const stateRevision = useMemo(() => service.stateRevision(), [service, version]);
  const workspace = useMemo(() => workspacePresentation(state, active, service.worldProjection()), [state, active, service]);
  const achievementEntries = useMemo(() => tab === 'stats' ? service.achievementsProjection() : [], [service, version, tab]);
  const orphanedDeferredHostForGate = unsettledMarathonSessions(state).some(session => session.deferredSettlement === true);
  const firstRunRequired = requiresFirstProjectSetup(state, firstProjectSetupDone, orphanedDeferredHostForGate);
  firstRunRequiredRef.current = firstRunRequired;
  const receiveUpdate = useCallback((release: AppRelease) => {
    setAvailableRelease(release); setAboutOpen(true); void appUpdater.download(release, true);
  }, []);
  useAutoUpdateCheck(preferences.autoCheckUpdates === true,
    !firstRunRequired && !creatingProject && !state.activeFocusSession && !orphanedDeferredHostForGate && preparingEnvironment === null,
    APP_VERSION, receiveUpdate);
  useEffect(() => {
    // Persist the completed choice and migrate installations created before
    // this marker existed. A later empty workspace is still an existing user.
    if (!firstProjectSetupDone && state.projects.length > 0) {
      setFirstProjectSetupDone(true);
      writeFirstProjectSetupMarker();
    }
  }, [firstProjectSetupDone, state.projects.length]);
  const setupDraft=projectDraft??{...INITIAL_PROJECT_SETUP_DRAFT,habitTargetRounds:preferences.habitTargetRounds};
  const updateSetupDraft=useCallback((patch:Partial<ProjectSetupDraft>)=>setProjectDraft(current=>({...current??INITIAL_PROJECT_SETUP_DRAFT,...patch})),[]);
  const beginProjectSetup=useCallback(()=>{setProjectDraft(current=>current??{...INITIAL_PROJECT_SETUP_DRAFT,habitTargetRounds:preferences.habitTargetRounds});setCreatingProject(true);},[preferences.habitTargetRounds]);
  const discardProjectSetup=useCallback(()=>{setCreatingProject(false);setProjectDraft(null);},[]);
  const completeProjectSetup=useCallback(()=>{setCreatingProject(false);setProjectDraft(null);navigateTo('world');},[navigateTo]);
  const viewProjectInWorld=useCallback((projectId:string)=>{setCreatingProject(false);setWorldFocusProjectId(projectId);setWorldMemoryProjectId(projectId);navigateTo('world');},[navigateTo]);
  const selectWorldProject=useCallback((projectId:string)=>{setWorldFocusProjectId(projectId);setWorldMemoryProjectId(projectId);},[]);
  const clearWorldFocus=useCallback(()=>{setWorldFocusProjectId(null);setWorldMemoryProjectId(null);},[]);
  const closeWorldMemory=useCallback(()=>setWorldMemoryProjectId(null),[]);
  // Android hardware back walks the open overlays top-down (about dialog,
  // ceremony, building memory, project setup) before it may leave a secondary
  // tab; at the world root with nothing open it exits the app.
  useBackLayer(Boolean(creatingProject), () => { discardProjectSetup(); return true; });
  useBackLayer(Boolean(worldMemoryProjectId), () => { closeWorldMemory(); return true; });
  useBackLayer(aboutOpen, () => { setAboutOpen(false); return true; });
  useBackLayer(Boolean(ceremony), () => { setCeremony(null); return true; });
  const backRouteRef = useRef({ tab, creatingProject });
  backRouteRef.current = { tab, creatingProject };
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    void import('@blockcolc/platform-capacitor').then(platform => {
      if (disposed) return;
      void platform.subscribeHardwareBack(() => {
        if (handleBack()) return;
        const route = backRouteRef.current;
        if (route.creatingProject) { discardProjectSetup(); return; }
        if (route.tab !== 'world') { navigateTo('world'); return; }
        void platform.exitAndroidApp();
      }).then(disposer => { if (disposed) void disposer(); else unsubscribe = disposer; });
    });
    return () => { disposed = true; void unsubscribe?.(); };
  }, [discardProjectSetup, navigateTo]);
  const minimalWanted = preferences.minimalMode === true && !minimalTemporarilyExited;
  const fullDeferredPresentation = state.activeFocusSession?.deferredSettlement === true && minimalTemporarilyExited;
  // A retained deferred report has the same immersive surface even if its host
  // was deleted. It must not fall back to setup or a disconnected report page.
  const orphanedDeferredHost = !active
    ? unsettledMarathonSessions(state).find(session => session.deferredSettlement === true)?.projectId
    : undefined;
  hasResidentWorld.current=Boolean(workspace&&!orphanedDeferredHost);
  const immersiveFocus = !creatingProject && Boolean(orphanedDeferredHost && (tab === 'world' || tab === 'tasks')
    || tab === 'world' && active && (worldImmersive || minimalPresentation && minimalWanted || state.activeFocusSession && !fullDeferredPresentation));
  const shellRef = usePresentationTransition(immersiveFocus);
  const travelMode = useModePortal(shellRef, minimal => setMinimalTemporarilyExited(!minimal), () => showMessage('转场未完成，已恢复操作。'));
  const [landscape,setLandscape]=useState(()=>matchMedia('(orientation: landscape)').matches);
  useEffect(()=>{const media=matchMedia('(orientation: landscape)');const change=()=>setLandscape(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(() => {
    let live = true;
    const sync = (verifyVisibility = false) => {
      if (document.hidden) return;
      void import('@blockcolc/platform-capacitor').then(platform => {
        if (live) return platform.setNativeFocusImmersive(immersiveFocus || landscape, verifyVisibility);
      });
    };
    const onReturn = () => sync(true);
    const onVisibility = () => { if (!document.hidden) onReturn(); };
    sync();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onReturn);
    window.addEventListener('blockcolc-window-focus', onReturn);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('blockcolc-window-focus', onReturn);
    };
  }, [immersiveFocus, landscape]);
  const worldVisible = !creatingProject && (tab === 'world' || Boolean(orphanedDeferredHost && tab === 'tasks'));
  // The resident world owns sync cadence. A tab change is not a new location request.
  const worldWeather = useWorldWeather(preferences.realWeatherEnabled, Boolean(workspace));
  // A deleted/sealed host must not hide retained minimal rounds behind setup.
  // Reporting can explicitly discard them even when there are no target tasks.
  const worldPane = workspace && !orphanedDeferredHost ? <div className={preparingEnvironment?'world-pane is-preparing':worldVisible && tab === 'world'?'world-pane':'world-pane is-hidden'} aria-hidden={!worldVisible || tab !== 'world'}>
    <WorldScreenV7 service={service} active={workspace} state={state} stateRevision={stateRevision} hasActiveProject={Boolean(active)} onCreateProject={beginProjectSetup} resourcePacks={resourcePacks} run={run} refresh={refresh}
      onReconcileFocus={resumeVisibleFocus} preferences={preferences} worldWeather={worldWeather}
      worldDebug={worldDebugProjection}
      minimalWanted={minimalWanted} fullDeferredPresentation={fullDeferredPresentation}
      onMinimalPresentationChange={setMinimalPresentation} onImmersiveLayoutChange={setWorldImmersive}
      onExitMinimal={()=>travelMode('leave')} onEnterMinimal={()=>travelMode('enter')}
      recordedIntegrityNotice={recordedIntegrityNotice} focusedProjectId={worldFocusProjectId} memoryProjectId={worldMemoryProjectId}
      onFocusWorldProject={selectWorldProject} onInitialProjectFocus={setWorldFocusProjectId} onClearWorldFocus={clearWorldFocus} onCloseWorldMemory={closeWorldMemory}
      visible={preparingEnvironment!==null || worldVisible && tab === 'world'} onScenePrepared={scenePreparation.ready} onScenePreparationFailed={scenePreparation.failed}/>
  </div> : null;
  const firstRunSetup = <ProjectSetup run={run} resourcePacks={resourcePacks} buildingBlueprints={state.buildingBlueprintResources} existingProjects={state.projects.filter(project=>project.status==='paused')} draft={setupDraft} firstRun={firstRunRequired} onDraftChange={updateSetupDraft} onCreated={()=>{setProjectDraft(null);writeFirstProjectSetupMarker();setFirstProjectSetupDone(true);navigateTo('world');}}/>;
  const creationSetup = <ProjectSetup run={run} resourcePacks={resourcePacks} buildingBlueprints={state.buildingBlueprintResources} existingProjects={[]} draft={setupDraft} onDraftChange={updateSetupDraft} onCancel={discardProjectSetup} onCreated={completeProjectSetup}/>;
  const content = <>
    {worldPane}
    {creatingProject ? creationSetup : <>
      {!active && (tab === 'world' || tab === 'tasks') && (orphanedDeferredHost
        ? <div className="world-screen is-focusing orphaned-focus-report">
          <div className="world-stage"><WorldCanvasV7 service={service} stateRevision={service.stateRevision()} resourcePacks={resourcePacks}
            lightingQuality={preferences.lightingQuality} constructionOutlineVisibility={preferences.constructionOutlineVisibility}
            worldColorAdjustment={preferences.worldColorAdjustment}
            showWorldCoordinates={preferences.showWorldCoordinates} environmentStyle={state.worldSettings.environmentStyle}
            worldSeed={state.worldSettings.worldSeed} terrainGenerationVersion={state.worldSettings.terrainGenerationVersion}
            immersivePresentation externalWeatherOverride={worldWeather.override} astronomyContext={worldWeather.astronomyContext ?? null}
            worldDebug={worldDebugProjection} focusedProjectId={null}
            onSelectProject={()=>{}} onClearWorldFocus={()=>{}}
            visible={worldVisible} onPickTerrain={()=>{}} pickedCell={null}/></div>
          <section className="focus-panel"><MarathonProgressReport variant="minimal" key={orphanedDeferredHost} state={state} hostProjectId={orphanedDeferredHost} run={run} onSubmitted={() => { createRoundPlanStore(() => window.localStorage).write(null); refresh(); }}/></section>
        </div>
        : firstRunRequired ? tutorial==='first'?null:firstRunSetup : (tab === 'tasks' || !workspace) ? <WorkspaceRest state={state} run={run} onCreate={beginProjectSetup}/> : null)}
      {active && <RoutePane active={tab === 'tasks'} route="tasks"><Suspense fallback={<LoadingPage status="正在打开任务…"/>}><TasksScreen active={active} state={state} run={run} onCreateProject={beginProjectSetup} onViewProject={viewProjectInWorld}/></Suspense></RoutePane>}
      <RoutePane active={tab === 'stats'} route="stats"><Suspense fallback={<LoadingPage status="正在打开统计…"/>}><StatsScreen state={state} active={tab === 'stats'} achievementEntries={achievementEntries}/></Suspense></RoutePane>
<RoutePane active={tab === 'settings'} route="settings"><Suspense fallback={<LoadingPage status="正在打开设置…"/>}><SettingsScreen active={tab === 'settings'} service={service} resourcePacks={resourcePacks} state={state} run={run} refresh={refreshAfterReplacement} preferences={preferences} onPreferencesChange={changePreferences} worldWeather={worldWeather} worldDebug={worldDebug} onWorldDebugChange={setWorldDebug} onConfigureEnvironment={configureEnvironment} onReplayTutorial={replayTutorial} onConfigureOutline={configureOutline}/></Suspense></RoutePane>
    </>}
  </>;
  return <div ref={shellRef} data-world-preparing={preparingEnvironment!==null?'true':undefined} className={immersiveFocus?'app-shell focus-immersive':'app-shell'}>{!immersiveFocus&&<header className="topbar"><div className="app-brand"><button type="button" className="brand-bounce" aria-label="跳一跳，方块钟"><PixelBrand/></button><div><span className="brand-mark">方块钟</span><span className="brand-en">Blockcolc</span></div></div><button className="today" type="button" aria-label="关于方块钟" onClick={()=>setAboutOpen(true)}><PixelCalendar size={18}/>{new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric'}).format(new Date())}</button></header>}
    {preparingEnvironment!==null&&<LoadingPage stage="scene" status="正在准备世界…"/>}
    <main data-active-route={tab}>{content}</main>
    {message && <div className={message.action?'toast has-action':'toast'} role="status">{message.text}{message.action&&<button type="button" className="toast-action" onClick={()=>{const target=message.action!.target;setMessage(null);navigateTo(target);}}>{message.action.label}</button>}</div>}
    {!immersiveFocus&&<nav className="bottom-nav" aria-label="主导航"><NavButton active={tab==='world'} icon={<Clock3/>} label="计时" onClick={()=>{if(creatingProject)setCreatingProject(false);navigateTo('world');}}/><NavButton active={tab==='tasks'} icon={<ListTodo/>} label="任务" onClick={()=>navigateTo('tasks')}/><NavButton active={tab==='stats'} icon={<BarChart3/>} label="统计" onClick={()=>navigateTo('stats')}/><NavButton active={tab==='settings'} icon={<Settings/>} label="设置" onClick={()=>navigateTo('settings')}/></nav>}
    {aboutOpen&&<AboutDialog availableRelease={availableRelease} onClose={()=>setAboutOpen(false)}/>}
    {ceremony&&<CompletionCeremony title={ceremony.title} onClose={()=>setCeremony(null)}/>}
    {tutorial&&<OnboardingDialog onClose={closeTutorial}/>}
  </div>;
}
function RoutePane({active,route,children}:{active:boolean;route:Exclude<Tab,'world'>;children:ReactNode}) {
  const visited = useRef(active);
  if (active) visited.current = true;
  // First paint does not mount three invisible screens. After a real visit,
  // retain the screen so form drafts and scroll/UI state survive navigation.
  return visited.current ? <div className="route-pane" data-route={route} data-route-mounted="true" hidden={!active} aria-hidden={!active}>{children}</div> : null;
}
function NavButton({active,icon,label,onClick}:{active:boolean;icon:ReactNode;label:string;onClick:()=>void}) {
  const [motion, setMotion] = useState(0);
  return <button type="button" className={active?'nav-active':''} aria-current={active?'page':undefined} onClick={()=>{setMotion(value=>value+1);onClick();}}><span className="nav-icon-motion" data-nav-motion={motion>0?'playing':undefined} key={motion}>{icon}</span><span>{label}</span></button>;
}

function ProjectSetup({run,resourcePacks,buildingBlueprints,existingProjects,draft,firstRun=false,onDraftChange,onCancel,onCreated}:{run:(c:ApplicationCommand)=>Promise<ApplicationResult>;resourcePacks:ResourcePackRepository;buildingBlueprints:ReturnType<ApplicationService['snapshot']>['buildingBlueprintResources'];existingProjects:ReturnType<ApplicationService['snapshot']>['projects'];draft:ProjectSetupDraft;firstRun?:boolean;onDraftChange:(patch:Partial<ProjectSetupDraft>)=>void;onCancel?:()=>void;onCreated?:()=>void}) {
  const catalog=useBlueprintCatalog(); const {kind,blueprintId,habitTargetRounds,imported,packCompatibility,importRole}=draft; const [importing,setImporting]=useState(false); const [submitting,setSubmitting]=useState(false); const submittingRef=useRef(false); const [submitError,setSubmitError]=useState(''); const [importError,setImportError]=useState(''); const [importNotice,setImportNotice]=useState(''); const [nativePicker,setNativePicker]=useState(false);
  const titleInput=useRef<HTMLInputElement>(null);
  const readSubtasks=useRef<(()=>string[])|null>(null);
  useEffect(()=>{let active=true;void import('@blockcolc/platform-capacitor').then(platform=>{if(active)setNativePicker(platform.isCapacitorNative());});return()=>{active=false;};},[]);
  const importedEntry:BlueprintCatalogEntry|undefined=imported?{id:imported.blueprint.id,displayName:imported.preview.name,description:`本地 Litematic · Minecraft 数据版本 ${imported.preview.minecraftDataVersion}`,footprint:{width:imported.preview.dimensions.width,depth:imported.preview.dimensions.depth},complexity:imported.preview.nonAirBlockCount>3000?'detailed':'moderate',blueprint:imported.blueprint}:undefined;
  const libraryEntries:BlueprintCatalogEntry[]=buildingBlueprints.map(resource=>({id:resource.id,displayName:resource.displayName,description:`本地建筑蓝图 · ${new Date(resource.importedAt).toLocaleDateString('zh-CN')} 导入`,footprint:{width:resource.blueprint.bounds.maxX-resource.blueprint.bounds.minX+1,depth:resource.blueprint.bounds.maxZ-resource.blueprint.bounds.minZ+1},complexity:resource.blueprint.voxels.length>3000?'detailed':'moderate',blueprint:resource.blueprint as BlueprintV1}));
  const options=importedEntry?[...catalog,...libraryEntries,importedEntry]:[...catalog,...libraryEntries];
  const selected=options.find(option=>option.id===blueprintId)??options[0];
  const submit=async(e:FormEvent)=>{e.preventDefault();if(submittingRef.current||submitting||importRole==='decoration')return;const currentTitle=titleInput.current?.value??'';const subtasks=(readSubtasks.current?.()??draft.subtasksText.split('\n').map(x=>x.trim()).filter(Boolean)).map(title=>({title}));if(!currentTitle.trim()){setSubmitError('请先填写任务名称。');return;}if(!selected){setSubmitError('请先选择建筑蓝图。');return;}if(!Number.isInteger(habitTargetRounds)||habitTargetRounds<10||habitTargetRounds>30){setSubmitError('习惯建筑轮数必须在 10 到 30 轮之间。');return;}if(kind==='finite'&&subtasks.length===0){setSubmitError('至少保留一个小任务。');return;}const importedBlueprint=shouldPersistBlueprintSnapshot(selected.blueprint.id)?toImportedBlueprint(selected.blueprint):null;const command:ApplicationCommand=kind==='habit'?{type:'CreateHabitProject',title:currentTitle.trim(),blueprintId:selected.blueprint.id,importedBlueprint,targetRounds:habitTargetRounds}:{type:'CreateProject',title:currentTitle.trim(),blueprintId:selected.blueprint.id,importedBlueprint,subtasks};submittingRef.current=true;setSubmitting(true);setSubmitError('');try{const result=await run(command);if(result?.ok)onCreated?.();else setSubmitError(result?.message??'创建失败，请检查输入后重试。');}catch(error){setSubmitError(error instanceof Error?error.message:'创建失败，请重试。');}finally{submittingRef.current=false;setSubmitting(false);}};
  const parseImportedBytes=async(bytes:Uint8Array)=>{const {parseLitematic}=await loadLitematicModule();const result=await parseLitematic(bytes);const activePack=await resolveSelectedResourcePack(resourcePacks);let nextCompatibility:ProjectSetupDraft['packCompatibility']=null;if(activePack){const {summarizeBlueprintCompatibility}=await import('@blockcolc/resource-pack');const summary=summarizeBlueprintCompatibility(result.blueprint,activePack.manifest);nextCompatibility={name:activePack.name,textured:summary.texturedVoxelCount,fallback:summary.fallbackVoxelCount,total:summary.totalVoxelCount};}onDraftChange({imported:result,packCompatibility:nextCompatibility,importRole:'building',blueprintId:result.blueprint.id});setImportNotice('');};
  const importBrowserLitematic=async(file:File|undefined)=>{if(!file)return;setImporting(true);setImportError('');try{await parseImportedBytes(await readBrowserFileBytes(file));}catch(error){onDraftChange({imported:null,packCompatibility:null});setImportError(litematicErrorMessage(error));}finally{setImporting(false);}};
  const importNativeLitematic=async()=>{setImporting(true);setImportError('');try{const {pickNativeLitematicFile}=await import('@blockcolc/platform-capacitor');const selected=await pickNativeLitematicFile(LITEMATIC_MAX_COMPRESSED_BYTES);if(selected)await parseImportedBytes(selected.bytes);}catch(error){onDraftChange({imported:null,packCompatibility:null});setImportError(litematicErrorMessage(error));}finally{setImporting(false);}};
  const resume=async(projectId:string)=>{const result=await run({type:'SwitchActiveProject',projectId});if(result?.ok)onCreated?.();};
  const decorationLimitError=imported?decorationBlueprintLimitError(imported.blueprint):'';
  const chooseImportRole=(role:ImportRole)=>{onDraftChange({importRole:role,...(role==='building'&&imported?{blueprintId:imported.blueprint.id}:{})});setImportError('');setImportNotice('');};
  const addDecoration=async()=>{if(!imported)return;if(decorationLimitError){setImportError(decorationLimitError);return;}setImporting(true);setImportError('');setImportNotice('');try{const result=await run({type:'ImportDecorationBlueprint',blueprint:toImportedBlueprint(imported.blueprint)});if(result?.ok)setImportNotice(result.events.some((event:{type:string})=>event.type==='DecorationBlueprintImported')?'已加入本地装饰池。':'这份装饰蓝图已在本地装饰池中。');else setImportError(result?.message??'无法加入装饰池。');}finally{setImporting(false);}};
  const ignoredFeatures=imported?imported.preview.compatibility.ignoredEntities+imported.preview.compatibility.ignoredTileEntities+imported.preview.compatibility.ignoredPendingTicks:0;
  const importControl=<div className="litematic-import">{nativePicker?<button className="litematic-file" type="button" disabled={importing} onClick={()=>void importNativeLitematic()}><FileUp/><span>{importing?'正在解析...':'导入 .litematic'}</span></button>:<label className="litematic-file"><FileUp/><span>{importing?'正在解析...':'导入 .litematic'}</span><input className="sr-only" type="file" accept=".litematic,application/octet-stream" disabled={importing} onChange={event=>void importBrowserLitematic(event.target.files?.[0])}/></label>}{imported&&<><div className="litematic-summary"><strong>{imported.preview.dimensions.width} x {imported.preview.dimensions.height} x {imported.preview.dimensions.depth}</strong><span>{imported.preview.nonAirBlockCount.toLocaleString('zh-CN')} 个方块 · {imported.preview.regionCount} 个区域</span>{packCompatibility&&<span className={packCompatibility.fallback>0?'import-warning':''}>{packCompatibility.name}：{packCompatibility.textured.toLocaleString('zh-CN')}/{packCompatibility.total.toLocaleString('zh-CN')} 个方块使用资源包，{packCompatibility.fallback.toLocaleString('zh-CN')} 个原创回退</span>}{imported.preview.compatibility.placeholderVoxelCount>0&&<span className="import-warning">{imported.preview.compatibility.placeholderVoxelCount} 个方块使用占位材质</span>}{ignoredFeatures>0&&<span className="import-warning">忽略 {ignoredFeatures} 个实体、方块实体或计划刻</span>}</div><div className="import-role" role="group" aria-label="蓝图用途"><button type="button" aria-pressed={importRole==='building'} onClick={()=>chooseImportRole('building')}>主任务建筑</button><button type="button" aria-pressed={importRole==='decoration'} onClick={()=>chooseImportRole('decoration')}>每日奖励装饰</button></div>{importRole==='decoration'&&<p className={decorationLimitError?'import-error':'import-role-note'}>{decorationLimitError||'装饰上限 12 x 12 x 16、2,000 个非空气方块；达成每日目标后自动选取。'}</p>}</>}{importError&&<p className="import-error" role="alert">{importError}</p>}{importNotice&&<p className="import-notice" role="status">{importNotice}</p>}</div>;
  return <section className="setup">
    {existingProjects.length > 0 && <div className="resume-projects">
      <h2>已有任务</h2>
      {existingProjects.map(project => <button type="button" key={project.id} onClick={() => void resume(project.id)}><span><strong>{project.title}</strong><small>{project.kind === 'habit' ? `习惯 · ${project.habit?.awaitingNextBuilding ? '等待选择下一建筑' : `${project.habit?.completedFocusSessionIds.length ?? 0} / ${project.habit?.targetRounds ?? 10} 轮`}` : `${Math.round(projectProgressBasisPoints(project) / 100)}% · ${project.subtasks.length} 个小任务`}</small></span><span>切换</span></button>)}
    </div>}
    <form onSubmit={submit}>
      <header className="setup-heading"><div className="setup-title"><PixelCube/><h1>{firstRun ? '建立你的第一项任务' : onCancel ? '新增任务' : '建立新任务'}</h1></div><p>{kind === 'habit' ? '让日常坚持，一座接一座地建造。' : '拆成小任务，一步步建成自己的建筑。'}</p></header>
      <div className="setup-kind" role="group" aria-label="任务类型"><button type="button" disabled={submitting} aria-pressed={kind === 'finite'} onClick={() => onDraftChange({ kind: 'finite' })}><PixelCube size={18}/>普通大型任务</button><button type="button" disabled={submitting} aria-pressed={kind === 'habit'} onClick={() => onDraftChange({ kind: 'habit' })}><PixelRepeat size={18}/>习惯任务</button></div>
      <div className="setup-fields">
        <label>{kind === 'habit' ? '习惯名称' : '大型任务'}<NativeImeTextEntry targetRef={titleInput} name="projectTitle" defaultValue={draft.title} onValueChange={title => onDraftChange({ title })}/></label>
        {kind === 'finite' ? <SubtaskRowsEditor initialText={draft.subtasksText} readerRef={readSubtasks} onChange={subtasksText => onDraftChange({ subtasksText })}/> : <div className="habit-target-summary"><span>每座建筑</span><strong>{habitTargetRounds} 轮专注</strong><small>统一在设置中调整；创建后，本周期内不会改变。</small></div>}
      </div>
      {selected ? <BlueprintPicker resourcePacks={resourcePacks} options={options} selected={selected} onSelect={id => onDraftChange({ blueprintId: id, ...(!imported || id !== imported.blueprint.id ? { importRole: 'building' } : {}) })} importControl={importControl}/> : <div className="blueprint-loading" role="status">正在准备建筑预览...</div>}
      {submitError&&<p className="setup-error" role="alert">{submitError}</p>}
      <div className="setup-actions">{onCancel && <button type="button" className="setup-cancel" disabled={submitting} onClick={onCancel}>取消</button>}{importRole === 'decoration' && imported ? <button className="primary setup-submit" type="button" aria-busy={importing} disabled={submitting||importing || Boolean(decorationLimitError)} onClick={() => void addDecoration()}><PixelCube size={18}/>加入装饰池</button> : <button className="primary setup-submit" type="submit" aria-busy={submitting} disabled={submitting||!selected || importing || !Number.isInteger(habitTargetRounds) || habitTargetRounds < 10 || habitTargetRounds > 30 || (kind === 'finite' && draft.subtasksText.split('\n').map(x => x.trim()).filter(Boolean).length === 0)}><PixelHammer size={18}/>{submitting?'正在创建…':'开始建造'}</button>}</div>
    </form>
  </section>;
}

interface SubtaskRowDraft { id: string; title: string }

function SubtaskRowsEditor({initialText,readerRef,onChange}:{initialText:string;readerRef:{current:(()=>string[])|null};onChange:(text:string)=>void}) {
  const [rows,setRows]=useState<SubtaskRowDraft[]>(()=>initialText.split('\n').map(title=>title.trim()).filter(Boolean).map(title=>({id:crypto.randomUUID(),title})));
  const [adding,setAdding]=useState('');
  const addingRef=useRef<HTMLInputElement>(null);
  const rowsRef=useRef(rows);rowsRef.current=rows;
  const rowRefs=useRef(new Map<string,NativeImeInputRef>());
  const pendingFocusId=useRef<string|null>(null);
  const emit=(next:SubtaskRowDraft[])=>{setRows(next);onChange(next.map(row=>row.title).join('\n'));};
  const updateRow=(id:string,title:string)=>emit(rowsRef.current.map(row=>row.id===id?{...row,title}:row));
  const removeRow=(id:string)=>{rowRefs.current.delete(id);emit(rowsRef.current.filter(row=>row.id!==id));};
  const appendRows=(titles:string[])=>{const next=[...rowsRef.current,...titles.map(title=>({id:crypto.randomUUID(),title}))];pendingFocusId.current=next[next.length-1]!.id;emit(next);};
  const commitAdd=()=>{const title=(addingRef.current?.value??adding).trim();if(!title)return;appendRows([title]);if(addingRef.current)addingRef.current.value='';setAdding('');};
  const clearRows=()=>{pendingFocusId.current=null;emit([]);};
  readerRef.current=()=>rowsRef.current.map(row=>(rowRefs.current.get(row.id)?.current?.value??row.title).trim()).filter(Boolean);
  useEffect(()=>()=>{readerRef.current=null;},[readerRef]);
  useEffect(()=>{if(!pendingFocusId.current)return;const id=pendingFocusId.current;pendingFocusId.current=null;const ref=rowRefs.current.get(id);if(ref?.current)ref.current.focus();},[rows]);
  return <div className="setup-subtasks">
    <div className="setup-subtasks-head"><span>拆成小任务</span>{rows.length>0&&<button type="button" className="settings-text-action" aria-label="清空小任务" onClick={clearRows}>清空</button>}</div>
    {rows.map((row,index)=>{let ref=rowRefs.current.get(row.id);if(!ref){ref={current:null};rowRefs.current.set(row.id,ref);}return <div className="setup-subtask-row" key={row.id}>
      <span className="setup-subtask-order" aria-hidden="true">{index+1}</span>
      <NativeImeTextEntry targetRef={ref} name={`subtask-${index}`} ariaLabel={`小任务 ${index+1}`} defaultValue={row.title} onValueChange={title=>updateRow(row.id,title)}/>
      <button type="button" className="setup-subtask-delete" aria-label={`删除“${row.title}”`} onClick={()=>removeRow(row.id)}><X/></button>
    </div>;})}
    <div className="setup-subtask-add">
      <NativeImeTextEntry targetRef={addingRef} name="new-project-subtask" defaultValue="" ariaLabel="新增小任务" placeholder="例如：整理验证结果" onValueChange={setAdding} onNativeKeyDown={event=>{if(isImeCommitKey(event)){event.preventDefault();commitAdd();}}}/>
      <button type="button" disabled={!adding.trim()} onClick={commitAdd}><Plus/>添加</button>
    </div>
  </div>;
}











function decorationBlueprintLimitError(blueprint:BlueprintV1):string { const width=blueprint.bounds.maxX-blueprint.bounds.minX+1;const height=blueprint.bounds.maxY-blueprint.bounds.minY+1;const depth=blueprint.bounds.maxZ-blueprint.bounds.minZ+1;if(width>12||depth>12||height>16)return`这份蓝图为 ${width} x ${height} x ${depth}，奖励装饰上限为 12 x 12 x 16。`;if(blueprint.voxels.length>2000)return`这份蓝图含 ${blueprint.voxels.length.toLocaleString('zh-CN')} 个方块，奖励装饰上限为 2,000 个。`;return''; }
function litematicErrorMessage(error:unknown):string { const code=typeof error==='object'&&error!==null&&'code'in error?String((error as {code:unknown}).code):'';if(code==='INPUT_TOO_LARGE'||code==='NBT_TOO_LARGE'||code==='LIMIT_EXCEEDED')return'图纸超过安全限制：文件 64 MB、占地 96 x 96、高度 256、最多 300,000 个方块。';if(code==='NOT_GZIP'||code==='INVALID_GZIP'||code==='INVALID_NBT'||code==='INVALID_LITEMATIC')return'无法读取这份 .litematic，请确认文件完整且由 Litematica 导出。';return error instanceof Error?error.message:'图纸导入失败，请换一份文件重试。'; }




function CompletionCeremony({title,onClose}:{title:string;onClose:()=>void}){const button=useRef<HTMLButtonElement>(null);useEffect(()=>{button.current?.focus();},[]);return <div className="ceremony-backdrop" role="presentation"><section className="completion-ceremony" role="dialog" aria-modal="true" aria-labelledby="ceremony-title"><div className="ceremony-rays"/><Trophy/><span>主体建筑完成</span><h2 id="ceremony-title">{title}</h2><p>这项长期工作已经在聚落中留下完整建筑。</p><button ref={button} onClick={onClose}>回到聚落</button></section></div>;}
