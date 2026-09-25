import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ApplicationCommand, ApplicationResult, ApplicationService } from '@tomato-clock/application';
import type { LitematicImportResult } from '@tomato-clock/litematic';
import { localDateOf, projectProgressBasisPoints } from '@tomato-clock/domain';
import { BarChart3, Clock3, ExternalLink, FileUp, Info, ListTodo, Plus, RefreshCw, Settings, TreePine, Trophy, X } from 'lucide-react';
import type { BlueprintCatalogEntry, BlueprintV1 } from '@tomato-clock/voxel';
import type { ResourcePackRepository } from '@tomato-clock/resource-pack-indexeddb';
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
import { useWorldWeather } from './use-world-weather';
import { MarathonProgressReport } from './FocusReports';
import { BlueprintPicker } from './BlueprintPicker';
import { shouldPersistBlueprintSnapshot, toImportedBlueprint } from './blueprint-adapter';
import { useBlueprintCatalog } from './voxel-runtime';
import { resolveSelectedResourcePack } from './resource-pack-selection';

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
const REPOSITORY_URL = 'https://github.com/Dieight/blockcolc';
const INITIAL_PROJECT_SETUP_DRAFT: ProjectSetupDraft = { kind: 'finite', title: '我的第一座工坊', subtasksText: '确定目标\n完成核心工作\n检查并收尾', blueprintId: 'builtin-small-workshop', habitTargetRounds: 10, imported: null, packCompatibility: null, importRole: 'building' };
const FIRST_PROJECT_SETUP_KEY = 'blockcolc-first-project-setup-v1';
let litematicModulePromise:Promise<typeof import('@tomato-clock/litematic')>|null=null;
function loadLitematicModule(){litematicModulePromise??=import('@tomato-clock/litematic');return litematicModulePromise;}
function readFirstProjectSetupMarker(): boolean { try { return window.localStorage.getItem(FIRST_PROJECT_SETUP_KEY) === '1'; } catch { return false; } }
function writeFirstProjectSetupMarker(): void { try { window.localStorage.setItem(FIRST_PROJECT_SETUP_KEY, '1'); } catch { /* persisted state remains authoritative */ } }



export function App({ service, resourcePacks }: { service: ApplicationService; resourcePacks: ResourcePackRepository }) {
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
  const [ceremony,setCeremony]=useState<{projectId:string;title:string}|null>(null);
  const { preferences, updatePreferences } = useFocusPreferences();
  const [minimalTemporarilyExited, setMinimalTemporarilyExited] = useState(false);
  const [minimalPresentation, setMinimalPresentation] = useState(false);
  const [worldImmersive, setWorldImmersive] = useState(false);
  const [firstProjectSetupDone, setFirstProjectSetupDone] = useState(readFirstProjectSetupMarker);
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
    } catch (error) {
      showMessage(error instanceof Error ? `设置未保存：${error.message}` : '设置未保存，请重试。');
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
  useEffect(()=>{let observed=localDateOf(new Date(),service.snapshot().calendar.timeZone);const timer=window.setInterval(()=>{const next=localDateOf(new Date(),service.snapshot().calendar.timeZone);if(next!==observed){observed=next;refresh();}},60_000);return()=>window.clearInterval(timer);},[service,refresh]);
  useEffect(()=>{if(!message)return;const timeout=window.setTimeout(()=>setMessage(null),5000);return()=>window.clearTimeout(timeout);},[message]);
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [tab, creatingProject]);
  const state = useMemo(() => service.snapshot(), [service, version]); const active = useMemo(() => service.activeProjectProjection(), [service, version]);
  const achievementEntries = useMemo(() => service.achievementsProjection(), [service, version]);
  const orphanedDeferredHostForGate = unsettledMarathonSessions(state).some(session => session.deferredSettlement === true);
  const firstRunRequired = !firstProjectSetupDone && state.projects.length === 0 && !orphanedDeferredHostForGate;
  firstRunRequiredRef.current = firstRunRequired;
  useEffect(() => {
    // Persist the completed choice and migrate installations created before
    // this marker existed. A later empty workspace is still an existing user.
    if (!firstProjectSetupDone && state.projects.length > 0) {
      setFirstProjectSetupDone(true);
      writeFirstProjectSetupMarker();
    }
  }, [firstProjectSetupDone, state.projects.length]);
  useEffect(() => {
    let cancelled = false;
    document.documentElement.dataset.routeModules = 'loading';
    // Load every primary route as one cold-start unit. The chunks stay split so
    // the entry bundle remains bounded, but a first visit never becomes a
    // second, user-visible loading phase.
    void Promise.all([loadTasksScreen(), loadStatsScreen(), loadSettingsScreen()])
      .then(() => {
        if (cancelled) return;
        const durationMs = performance.now();
        document.documentElement.dataset.routeModules = 'ready';
        document.documentElement.dataset.routeModulesReadyMs = durationMs.toFixed(2);
        try {
          const bridge = (window as typeof window & { BlockcolcNativeInput?: { logRenderDiagnostic?: (message: string) => void } }).BlockcolcNativeInput;
          bridge?.logRenderDiagnostic?.(`[blockcolc-startup] ${JSON.stringify({ phase: 'all-routes-ready', durationMs: Number(durationMs.toFixed(2)) })}`);
        } catch { /* Startup diagnostics are optional outside Android. */ }
      })
      .catch(() => {
        if (!cancelled) document.documentElement.dataset.routeModules = 'failed';
      });
    return () => { cancelled = true; };
  }, []);
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
    void import('@tomato-clock/platform-capacitor').then(platform => {
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
  const immersiveFocus = !creatingProject && tab === 'world' && Boolean(active && (worldImmersive || minimalPresentation && minimalWanted || state.activeFocusSession && !fullDeferredPresentation));
  const [landscape,setLandscape]=useState(()=>matchMedia('(orientation: landscape)').matches);
  useEffect(()=>{const media=matchMedia('(orientation: landscape)');const change=()=>setLandscape(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(() => {
    let live = true;
    const sync = (verifyVisibility = false) => {
      if (document.hidden) return;
      void import('@tomato-clock/platform-capacitor').then(platform => {
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
  const worldVisible = tab === 'world' && !creatingProject;
  const worldWeather = useWorldWeather(preferences.realWeatherEnabled, worldVisible && Boolean(active));
  // A deleted/sealed host must not hide retained minimal rounds behind setup.
  // Reporting can explicitly discard them even when there are no target tasks.
  const orphanedDeferredHost = !active
    ? unsettledMarathonSessions(state).find(session => session.deferredSettlement === true)?.projectId
    : undefined;
  const worldPane = active ? <div className={worldVisible?'world-pane':'world-pane is-hidden'} aria-hidden={!worldVisible}><WorldScreenV7 service={service} resourcePacks={resourcePacks} run={run} refresh={refresh} onReconcileFocus={resumeVisibleFocus} preferences={preferences} worldWeather={worldWeather} minimalWanted={minimalWanted} fullDeferredPresentation={fullDeferredPresentation} onMinimalPresentationChange={setMinimalPresentation} onImmersiveLayoutChange={setWorldImmersive} onExitMinimal={()=>setMinimalTemporarilyExited(true)} onEnterMinimal={()=>setMinimalTemporarilyExited(false)} recordedIntegrityNotice={recordedIntegrityNotice} focusedProjectId={worldFocusProjectId} memoryProjectId={worldMemoryProjectId} onFocusWorldProject={selectWorldProject} onClearWorldFocus={clearWorldFocus} onCloseWorldMemory={closeWorldMemory} onOpenTasks={()=>navigateTo('tasks')} visible={worldVisible}/></div> : null;
  const firstRunSetup = <ProjectSetup run={run} resourcePacks={resourcePacks} buildingBlueprints={state.buildingBlueprintResources} existingProjects={state.projects.filter(project=>project.status==='paused')} draft={setupDraft} firstRun={firstRunRequired} onDraftChange={updateSetupDraft} onCreated={()=>{setProjectDraft(null);writeFirstProjectSetupMarker();setFirstProjectSetupDone(true);navigateTo('world');}}/>;
  const creationSetup = <ProjectSetup run={run} resourcePacks={resourcePacks} buildingBlueprints={state.buildingBlueprintResources} existingProjects={[]} draft={setupDraft} onDraftChange={updateSetupDraft} onCancel={discardProjectSetup} onCreated={completeProjectSetup}/>;
  const content = <>
    {worldPane}
    {creatingProject ? creationSetup : <>
      {!active && (tab === 'world' || tab === 'tasks') && (orphanedDeferredHost
        ? <section className="page"><MarathonProgressReport key={orphanedDeferredHost} state={state} hostProjectId={orphanedDeferredHost} run={run} onSubmitted={() => { createRoundPlanStore(() => window.localStorage).write(null); refresh(); }}/></section>
        : firstRunSetup)}
      {active && <RoutePane active={tab === 'tasks'} route="tasks"><Suspense fallback={<LoadingPage status="正在打开任务…"/>}><TasksScreen active={active} state={state} run={run} onCreateProject={beginProjectSetup} onViewProject={viewProjectInWorld}/></Suspense></RoutePane>}
      <RoutePane active={tab === 'stats'} route="stats"><Suspense fallback={<LoadingPage status="正在打开统计…"/>}><StatsScreen state={state} active={tab === 'stats'} achievementEntries={achievementEntries}/></Suspense></RoutePane>
      <RoutePane active={tab === 'settings'} route="settings"><Suspense fallback={<LoadingPage status="正在打开设置…"/>}><SettingsScreen service={service} resourcePacks={resourcePacks} state={state} run={run} refresh={refreshAfterReplacement} preferences={preferences} onPreferencesChange={changePreferences} worldWeather={worldWeather}/></Suspense></RoutePane>
    </>}
  </>;
  return <div className={immersiveFocus?'app-shell focus-immersive':'app-shell'}>{!immersiveFocus&&<header className="topbar"><div><span className="brand-mark">方块钟</span><span className="brand-en">Blockcolc</span></div><button className="today" type="button" aria-label="关于方块钟" onClick={()=>setAboutOpen(true)}><TreePine size={16}/>{new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric'}).format(new Date())}</button></header>}
    <main data-active-route={tab}>{content}</main>
    {message && <div className={message.action?'toast has-action':'toast'} role="status">{message.text}{message.action&&<button type="button" className="toast-action" onClick={()=>{const target=message.action!.target;setMessage(null);navigateTo(target);}}>{message.action.label}</button>}</div>}
    {!immersiveFocus&&<nav className="bottom-nav" aria-label="主导航"><NavButton active={tab==='world'} icon={<Clock3/>} label="计时" onClick={()=>{if(creatingProject)setCreatingProject(false);navigateTo('world');}}/><NavButton active={tab==='tasks'} icon={<ListTodo/>} label="任务" onClick={()=>navigateTo('tasks')}/><NavButton active={tab==='stats'} icon={<BarChart3/>} label="统计" onClick={()=>navigateTo('stats')}/><NavButton active={tab==='settings'} icon={<Settings/>} label="设置" onClick={()=>navigateTo('settings')}/></nav>}
    {aboutOpen&&<AboutDialog onClose={()=>setAboutOpen(false)}/>}
    {ceremony&&<CompletionCeremony title={ceremony.title} onClose={()=>setCeremony(null)}/>}
  </div>;
}
function RoutePane({active,route,children}:{active:boolean;route:Exclude<Tab,'world'>;children:ReactNode}) { return <div className="route-pane" data-route={route} data-route-mounted="true" hidden={!active} aria-hidden={!active}>{children}</div>; }
function NavButton({active,icon,label,onClick}:{active:boolean;icon:ReactNode;label:string;onClick:()=>void}) { return <button className={active?'nav-active':''} onClick={onClick}>{icon}<span>{label}</span></button>; }

function ProjectSetup({run,resourcePacks,buildingBlueprints,existingProjects,draft,firstRun=false,onDraftChange,onCancel,onCreated}:{run:(c:ApplicationCommand)=>Promise<ApplicationResult>;resourcePacks:ResourcePackRepository;buildingBlueprints:ReturnType<ApplicationService['snapshot']>['buildingBlueprintResources'];existingProjects:ReturnType<ApplicationService['snapshot']>['projects'];draft:ProjectSetupDraft;firstRun?:boolean;onDraftChange:(patch:Partial<ProjectSetupDraft>)=>void;onCancel?:()=>void;onCreated?:()=>void}) {
  const catalog=useBlueprintCatalog(); const {kind,blueprintId,habitTargetRounds,imported,packCompatibility,importRole}=draft; const [importing,setImporting]=useState(false); const [submitting,setSubmitting]=useState(false); const submittingRef=useRef(false); const [submitError,setSubmitError]=useState(''); const [importError,setImportError]=useState(''); const [importNotice,setImportNotice]=useState(''); const [nativePicker,setNativePicker]=useState(false);
  const titleInput=useRef<HTMLInputElement>(null);
  const readSubtasks=useRef<(()=>string[])|null>(null);
  useEffect(()=>{let active=true;void import('@tomato-clock/platform-capacitor').then(platform=>{if(active)setNativePicker(platform.isCapacitorNative());});return()=>{active=false;};},[]);
  const importedEntry:BlueprintCatalogEntry|undefined=imported?{id:imported.blueprint.id,displayName:imported.preview.name,description:`本地 Litematic · Minecraft 数据版本 ${imported.preview.minecraftDataVersion}`,footprint:{width:imported.preview.dimensions.width,depth:imported.preview.dimensions.depth},complexity:imported.preview.nonAirBlockCount>3000?'detailed':'moderate',blueprint:imported.blueprint}:undefined;
  const libraryEntries:BlueprintCatalogEntry[]=buildingBlueprints.map(resource=>({id:resource.id,displayName:resource.displayName,description:`本地建筑蓝图 · ${new Date(resource.importedAt).toLocaleDateString('zh-CN')} 导入`,footprint:{width:resource.blueprint.bounds.maxX-resource.blueprint.bounds.minX+1,depth:resource.blueprint.bounds.maxZ-resource.blueprint.bounds.minZ+1},complexity:resource.blueprint.voxels.length>3000?'detailed':'moderate',blueprint:resource.blueprint as BlueprintV1}));
  const options=importedEntry?[...catalog,...libraryEntries,importedEntry]:[...catalog,...libraryEntries];
  const selected=options.find(option=>option.id===blueprintId)??options[0];
  const submit=async(e:FormEvent)=>{e.preventDefault();if(submittingRef.current||submitting||importRole==='decoration')return;const currentTitle=titleInput.current?.value??'';const subtasks=(readSubtasks.current?.()??draft.subtasksText.split('\n').map(x=>x.trim()).filter(Boolean)).map(title=>({title}));if(!currentTitle.trim()){setSubmitError('请先填写任务名称。');return;}if(!selected){setSubmitError('请先选择建筑蓝图。');return;}if(!Number.isInteger(habitTargetRounds)||habitTargetRounds<10||habitTargetRounds>30){setSubmitError('习惯建筑轮数必须在 10 到 30 轮之间。');return;}if(kind==='finite'&&subtasks.length===0){setSubmitError('至少保留一个小任务。');return;}const importedBlueprint=shouldPersistBlueprintSnapshot(selected.blueprint.id)?toImportedBlueprint(selected.blueprint):null;const command:ApplicationCommand=kind==='habit'?{type:'CreateHabitProject',title:currentTitle.trim(),blueprintId:selected.blueprint.id,importedBlueprint,targetRounds:habitTargetRounds}:{type:'CreateProject',title:currentTitle.trim(),blueprintId:selected.blueprint.id,importedBlueprint,subtasks};submittingRef.current=true;setSubmitting(true);setSubmitError('');try{const result=await run(command);if(result?.ok)onCreated?.();else setSubmitError(result?.message??'创建失败，请检查输入后重试。');}catch(error){setSubmitError(error instanceof Error?error.message:'创建失败，请重试。');}finally{submittingRef.current=false;setSubmitting(false);}};
  const parseImportedBytes=async(bytes:Uint8Array)=>{const {parseLitematic}=await loadLitematicModule();const result=await parseLitematic(bytes);const activePack=await resolveSelectedResourcePack(resourcePacks);let nextCompatibility:ProjectSetupDraft['packCompatibility']=null;if(activePack){const {summarizeBlueprintCompatibility}=await import('@tomato-clock/resource-pack');const summary=summarizeBlueprintCompatibility(result.blueprint,activePack.manifest);nextCompatibility={name:activePack.name,textured:summary.texturedVoxelCount,fallback:summary.fallbackVoxelCount,total:summary.totalVoxelCount};}onDraftChange({imported:result,packCompatibility:nextCompatibility,importRole:'building',blueprintId:result.blueprint.id});setImportNotice('');};
  const importBrowserLitematic=async(file:File|undefined)=>{if(!file)return;setImporting(true);setImportError('');try{await parseImportedBytes(await readBrowserFileBytes(file));}catch(error){onDraftChange({imported:null,packCompatibility:null});setImportError(litematicErrorMessage(error));}finally{setImporting(false);}};
  const importNativeLitematic=async()=>{setImporting(true);setImportError('');try{const {pickNativeLitematicFile}=await import('@tomato-clock/platform-capacitor');const selected=await pickNativeLitematicFile(LITEMATIC_MAX_COMPRESSED_BYTES);if(selected)await parseImportedBytes(selected.bytes);}catch(error){onDraftChange({imported:null,packCompatibility:null});setImportError(litematicErrorMessage(error));}finally{setImporting(false);}};
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
      <header className="setup-heading"><h1>{firstRun ? '建立你的第一项任务' : onCancel ? '新增任务' : '建立新任务'}</h1><p>{kind === 'habit' ? '每次专注都会推进习惯建筑，完成后继续选择下一座。' : '每项大型任务会在村落中留下自己的一栋建筑。'}</p></header>
      <div className="setup-kind" role="group" aria-label="任务类型"><button type="button" disabled={submitting} aria-pressed={kind === 'finite'} onClick={() => onDraftChange({ kind: 'finite' })}>普通大型任务</button><button type="button" disabled={submitting} aria-pressed={kind === 'habit'} onClick={() => onDraftChange({ kind: 'habit' })}>习惯任务</button></div>
      <div className="setup-fields">
        <label>{kind === 'habit' ? '习惯名称' : '大型任务'}<NativeImeTextEntry targetRef={titleInput} name="projectTitle" defaultValue={draft.title} onValueChange={title => onDraftChange({ title })}/></label>
        {kind === 'finite' ? <SubtaskRowsEditor initialText={draft.subtasksText} readerRef={readSubtasks} onChange={subtasksText => onDraftChange({ subtasksText })}/> : <div className="habit-target-summary"><span>每座建筑</span><strong>{habitTargetRounds} 轮专注</strong><small>统一在设置中调整；创建后，本周期内不会改变。</small></div>}
      </div>
      {selected ? <BlueprintPicker resourcePacks={resourcePacks} options={options} selected={selected} onSelect={id => onDraftChange({ blueprintId: id, ...(!imported || id !== imported.blueprint.id ? { importRole: 'building' } : {}) })} importControl={importControl}/> : <div className="blueprint-loading" role="status">正在准备建筑预览...</div>}
      {submitError&&<p className="setup-error" role="alert">{submitError}</p>}
      <div className="setup-actions">{onCancel && <button type="button" className="setup-cancel" disabled={submitting} onClick={onCancel}>取消</button>}{importRole === 'decoration' && imported ? <button className="primary setup-submit" type="button" disabled={submitting||importing || Boolean(decorationLimitError)} onClick={() => void addDecoration()}>加入装饰池</button> : <button className="primary setup-submit" type="submit" disabled={submitting||!selected || importing || !Number.isInteger(habitTargetRounds) || habitTargetRounds < 10 || habitTargetRounds > 30 || (kind === 'finite' && draft.subtasksText.split('\n').map(x => x.trim()).filter(Boolean).length === 0)}>{submitting?'正在创建…':'开始建造'}</button>}</div>
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




function AboutDialog({onClose}:{onClose:()=>void}){
  const [checking,setChecking]=useState(false);const [updateResult,setUpdateResult]=useState('');const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{closeRef.current?.focus();const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose]);
  const check=async()=>{setChecking(true);setUpdateResult('');try{const response=await fetch(`${REPOSITORY_URL.replace('github.com','api.github.com/repos')}/releases/latest`,{headers:{Accept:'application/vnd.github+json'}});if(!response.ok)throw new Error(String(response.status));const release=await response.json() as {tag_name?:string;html_url?:string};const latest=(release.tag_name??'').replace(/^v/,'');if(!/^\d+\.\d+\.\d+$/.test(latest))throw new Error('invalid release');setUpdateResult(compareVersions(latest,APP_VERSION)>0?`发现新版本 ${latest}，可前往 GitHub 下载。`:`当前已是最新版本 ${APP_VERSION}。`);}catch{setUpdateResult('暂时无法检查更新，请确认网络后重试。');}finally{setChecking(false);}};
  return <div className="dialog-backdrop" role="presentation"><section className="confirm-dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title"><button ref={closeRef} className="dialog-close" aria-label="关闭关于页面" onClick={onClose}><X/></button><Info className="about-icon"/><h2 id="about-title">方块钟 Blockcolc</h2><p className="about-version">版本 {APP_VERSION}</p><p>本地优先的专注计时器。任务、专注记录、蓝图和资源包默认只保存在你的设备上。</p><dl><div><dt>项目仓库</dt><dd><a href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub <ExternalLink/></a></dd></div><div><dt>隐私</dt><dd>无账号、无云同步、无后台分析</dd></div><div><dt>许可</dt><dd>开源许可与第三方组件信息见项目仓库</dd></div></dl><p className="legal-note">本应用不是 Minecraft 官方产品，未获 Mojang Studios 或 Microsoft 认可或关联。Minecraft 是其权利人的商标。</p><button className="check-update" type="button" disabled={checking} onClick={()=>void check()}><RefreshCw className={checking?'is-spinning':''}/>{checking?'正在检查':'手动检查更新'}</button>{updateResult&&<p className="update-result" role="status">{updateResult}</p>}</section></div>;
}

function CompletionCeremony({title,onClose}:{title:string;onClose:()=>void}){const button=useRef<HTMLButtonElement>(null);useEffect(()=>{button.current?.focus();},[]);return <div className="ceremony-backdrop" role="presentation"><section className="completion-ceremony" role="dialog" aria-modal="true" aria-labelledby="ceremony-title"><div className="ceremony-rays"/><Trophy/><span>主体建筑完成</span><h2 id="ceremony-title">{title}</h2><p>这项长期工作已经在聚落中留下完整建筑。</p><button ref={button} onClick={onClose}>回到聚落</button></section></div>;}

function compareVersions(left:string,right:string):number{const a=left.split('.').map(Number);const b=right.split('.').map(Number);for(let index=0;index<3;index+=1){if(a[index]!==b[index])return(a[index]??0)-(b[index]??0);}return 0;}
