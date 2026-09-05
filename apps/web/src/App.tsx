import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ApplicationCommand, ApplicationService } from '@tomato-clock/application';
import type { FocusInterruptionCategory, ImportedBlueprintStage, ImportedBlueprintV1, WorldEnvironmentStyle } from '@tomato-clock/domain';
import type { LitematicImportResult } from '@tomato-clock/litematic';
import { completedPomodorosOn, dailyGoalForDate, localDateOf, projectProgressBasisPoints } from '@tomato-clock/domain';
import { AlertTriangle, BarChart3, Check, Clock3, ExternalLink, FileUp, Hammer, Info, ListTodo, Map as MapIcon, Plus, RefreshCw, RotateCcw, Settings, Square, TreePine, Trophy, X } from 'lucide-react';
import type { BlueprintCatalogEntry, BlueprintV1, ConstructionOutlineVisibility, VoxelLightingQuality, VoxelRenderer, WorldSnapshot } from '@tomato-clock/voxel';
import type { ResourcePackRepository } from '@tomato-clock/resource-pack-indexeddb';
import { LoadingPage } from './LoadingPage';
import { ChoiceMenu } from './ChoiceMenu';
import { BuildingMemoryPanel, createBuildingMemory, conditionLabel, constructionStage } from './BuildingMemoryPanel';
import { handleBack, useBackLayer } from './back-layer';
import { NativeImeTextEntry, isImeCommitKey, type NativeImeInputRef } from './NativeImeTextEntry';
import type { FocusPreferences } from './app-types';
import { focusGlassMaterialFor } from './focus-glass';
import { LITEMATIC_MAX_COMPRESSED_BYTES, readBrowserFileBytes } from './browser-adapters';
import { APPLICATION_STATE_CHANGED_EVENT, type ApplicationStateChangedDetail } from './bootstrap';
import { MAX_MARATHON_ROUNDS, parseRoundPlan, planRoundsForDuration, plannedDurationMs, reconcileRoundPlan, roundPlansEqual, type RoundPlan } from './round-plan';
import releaseVersion from '../../../version.json';

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
interface RecordedIntegrityNotice { sessionId: string; count: number; max: number; sequence: number }
const PREFERENCES_KEY = 'blockcolc-focus-preferences-v1';
const ROUND_PLAN_KEY = 'blockcolc-round-plan-v1';
const SKIP_BREAK_REQUEST_KEY = 'blockcolc-skip-break-request-v1';
const APP_VERSION = releaseVersion.versionName;
const REPOSITORY_URL = 'https://github.com/Dieight/blockcolc';
const INITIAL_PROJECT_SETUP_DRAFT: ProjectSetupDraft = { kind: 'finite', title: '我的第一座工坊', subtasksText: '确定目标\n完成核心工作\n检查并收尾', blueprintId: 'builtin-small-workshop', habitTargetRounds: 10, imported: null, packCompatibility: null, importRole: 'building' };
let voxelModulePromise:Promise<typeof import('@tomato-clock/voxel')>|null=null;
function loadVoxelModule(){voxelModulePromise??=import('@tomato-clock/voxel').then(module=>{if(testBuildEnabled())(window as typeof window&{__blockcolcVoxelTest?:typeof module}).__blockcolcVoxelTest=module;return module;});return voxelModulePromise;}
function testBuildEnabled():boolean{return import.meta.env.DEV||import.meta.env.MODE==='test';}
function resourcePackAtlasMaximumSizeForTest():number|undefined{if(!testBuildEnabled())return undefined;const value=Number(new URLSearchParams(location.search).get('__atlasPageSize'));return Number.isSafeInteger(value)&&value>=32&&value<=2048?value:undefined;}
function immersiveBandTestOverride():{bottom:number;right:number}|undefined{if(!testBuildEnabled())return undefined;const read=(key:string)=>{const raw=new URLSearchParams(location.search).get(key);if(raw===null)return undefined;const value=Number(raw);return Number.isFinite(value)&&value>=0&&value<=0.75?value:undefined;};const bottom=read('__immersiveBand');const right=read('__immersiveRightBand');if(bottom===undefined&&right===undefined)return undefined;return{bottom:bottom??0,right:right??0};}
let litematicModulePromise:Promise<typeof import('@tomato-clock/litematic')>|null=null;
function loadLitematicModule(){litematicModulePromise??=import('@tomato-clock/litematic');return litematicModulePromise;}
function useBlueprintCatalog(){const [catalog,setCatalog]=useState<readonly BlueprintCatalogEntry[]>([]);useEffect(()=>{let active=true;void loadVoxelModule().then(module=>{if(active)setCatalog(module.BUILTIN_BLUEPRINT_CATALOG);});return()=>{active=false;};},[]);return catalog;}

function blueprintName(catalog:readonly BlueprintCatalogEntry[],id: string) {
  return catalog.find(entry=>entry.id===id)?.displayName??'兼容建筑';
}

function complexityLabel(value:BlueprintCatalogEntry['complexity']) { return value==='simple'?'紧凑':value==='moderate'?'适中':'丰富'; }

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
  const [preferences, setPreferences] = useState<FocusPreferences>(loadPreferences);
  const [recordedIntegrityNotice, setRecordedIntegrityNotice] = useState<RecordedIntegrityNotice | null>(null);
  const recordedIntegrityNoticeSequenceRef = useRef(0);
  const navigateTo = useCallback((next: Tab) => {
    setTab(next);
  }, []);
  const showMessage = useCallback((text: string, action?: { label: string; target: Tab }) => {
    setMessage(action ? { text, action } : { text });
  }, []);
  const clearMessage = useCallback(() => setMessage(null), []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = preferences.themeMode === 'dark' || (preferences.themeMode === 'system' && media.matches);
      const root = document.documentElement;
      root.dataset.theme = dark ? 'dark' : 'light';
      root.style.colorScheme = dark ? 'dark' : 'light';
    };
    apply();
    if (preferences.themeMode === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    return undefined;
  }, [preferences.themeMode]);
  useEffect(() => {
    const material = focusGlassMaterialFor(preferences.focusGlassTransparency);
    const root = document.documentElement;
    root.style.setProperty('--focus-glass-light-alpha', material.lightAlpha);
    root.style.setProperty('--focus-glass-dark-alpha', material.darkAlpha);
    root.style.setProperty('--focus-glass-blur', material.blur);
    root.style.setProperty('--focus-glass-saturation', material.saturation);
    root.style.setProperty('--focus-glass-brightness', material.brightness);
    root.style.setProperty('--focus-glass-highlight-alpha', material.highlightAlpha);
    root.style.setProperty('--focus-glass-accent-alpha', material.accentAlpha);
    root.style.setProperty('--focus-glass-shadow-alpha', material.shadowAlpha);
  }, [preferences.focusGlassTransparency]);
  const refresh = useCallback(() => setVersion(v => v + 1), []);
  const run = useCallback(async (command: ApplicationCommand) => {
    try {
      const result = await service.dispatch(command);
      if (!result.ok) {
        showMessage(result.message);
      } else {
        const earlyEvent = result.events.find(event => event.type === 'FocusCompletedEarly');
        const earlySession = earlyEvent
          ? result.state.focusHistory.find(session => session.id === earlyEvent.sessionId)
          : undefined;
        if (result.events.some(event => event.type === 'FocusInterrupted' && event.reason === 'app-switch-limit')) clearMessage();
        else if (result.events.some(event => event.type === 'FocusInterrupted')) showMessage('本轮已记录，有效专注时间已计入统计。');
        else if (result.events.some(event => event.type === 'HabitBuildingCompleted')) showMessage('这座习惯建筑已完成，请选择下一座建筑。');
        else if (earlyEvent) {
          if (result.events.some(event => event.type === 'HabitBuildingProgressed')) showMessage('习惯专注已推进一轮，实际专注时间已记录。');
          else if (earlySession?.marathon === true) showMessage('本轮已提前完成，实际专注时间已记录。');
          else showMessage('小任务已提前完成，实际专注时间已记录。');
        } else if (result.warnings.some(warning => warning.code === 'NOTIFICATION_INEXACT')) showMessage('系统提醒已开启，但未获精准闹钟权限，锁屏时可能略有延迟。', { label: '去设置', target: 'settings' });
        else if (result.warnings.length) showMessage('计时已开始；系统通知当前不可用，回到应用时仍会正确恢复。', { label: '去设置', target: 'settings' });
        else if (result.events.some(event => event.type === 'ProjectDeleted')) showMessage('任务已删除，已完成的习惯建筑仍保留在聚落中。');
        else clearMessage();
        const sealed = result.events.find(event => event.type === 'ProjectSealedAsMonument');
        if (sealed) {
          const project = result.state.projects.find(item => item.id === sealed.projectId);
          if (project) setCeremony({ projectId: project.id, title: project.title });
        }
      }
      refresh();
      return result;
    } catch (error) {
      showMessage(error instanceof Error ? error.message : '操作失败，请重试。');
      throw error;
    }
  }, [service, refresh, showMessage, clearMessage]);
  useEffect(() => { const resumeFromPageCache = (event:PageTransitionEvent) => { if(event.persisted)void service.resume().then(refresh); }; window.addEventListener('pageshow',resumeFromPageCache);return()=>window.removeEventListener('pageshow',resumeFromPageCache);},[service,refresh]);
  useEffect(() => {
    const refreshAfterLifecycle = (event: Event) => {
      const detail = (event as CustomEvent<ApplicationStateChangedDetail>).detail;
      if (detail?.excursionRecorded && detail.effectiveExcursions !== null && detail.sessionId) {
        setRecordedIntegrityNotice({
          sessionId: detail.sessionId,
          count: detail.effectiveExcursions,
          max: detail.maxEffectiveExcursions,
          sequence: ++recordedIntegrityNoticeSequenceRef.current,
        });
      }
      refresh();
    };
    window.addEventListener(APPLICATION_STATE_CHANGED_EVENT, refreshAfterLifecycle);
    return () => window.removeEventListener(APPLICATION_STATE_CHANGED_EVENT, refreshAfterLifecycle);
  }, [refresh]);
  useEffect(()=>{let observed=localDateOf(new Date(),service.snapshot().calendar.timeZone);const timer=window.setInterval(()=>{const next=localDateOf(new Date(),service.snapshot().calendar.timeZone);if(next!==observed){observed=next;refresh();}},60_000);return()=>window.clearInterval(timer);},[service,refresh]);
  useEffect(()=>{if(!message)return;const timeout=window.setTimeout(()=>setMessage(null),5000);return()=>window.clearTimeout(timeout);},[message]);
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [tab, creatingProject]);
  const state = useMemo(() => service.snapshot(), [service, version]); const active = useMemo(() => service.activeProjectProjection(), [service, version]);
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
  const updatePreferences=useCallback((value:FocusPreferences)=>{setPreferences(value);localStorage.setItem(PREFERENCES_KEY,JSON.stringify(value));},[]);
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
  const immersiveFocus = !creatingProject && tab === 'world' && Boolean(active && state.activeFocusSession);
  const [landscape,setLandscape]=useState(()=>matchMedia('(orientation: landscape)').matches);
  useEffect(()=>{const media=matchMedia('(orientation: landscape)');const change=()=>setLandscape(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{let live=true;const sync=()=>{if(document.hidden)return;void import('@tomato-clock/platform-capacitor').then(platform=>{if(live)return platform.setNativeFocusImmersive(immersiveFocus||landscape);});};sync();document.addEventListener('visibilitychange',sync);window.addEventListener('focus',sync);window.addEventListener('blockcolc-window-focus',sync);return()=>{live=false;document.removeEventListener('visibilitychange',sync);window.removeEventListener('focus',sync);window.removeEventListener('blockcolc-window-focus',sync);};},[immersiveFocus,landscape]);
  const worldVisible = tab === 'world' && !creatingProject;
  const worldPane = active ? <div className={worldVisible?'world-pane':'world-pane is-hidden'} aria-hidden={!worldVisible}><WorldScreenV7 service={service} resourcePacks={resourcePacks} run={run} refresh={refresh} preferences={preferences} recordedIntegrityNotice={recordedIntegrityNotice} focusedProjectId={worldFocusProjectId} memoryProjectId={worldMemoryProjectId} onFocusWorldProject={selectWorldProject} onClearWorldFocus={clearWorldFocus} onCloseWorldMemory={closeWorldMemory} onOpenTasks={()=>navigateTo('tasks')} visible={worldVisible}/></div> : null;
  const firstRunSetup = <ProjectSetup run={run} resourcePacks={resourcePacks} buildingBlueprints={state.buildingBlueprintResources} existingProjects={state.projects.filter(project=>project.status==='paused')} draft={setupDraft} onDraftChange={updateSetupDraft} onCreated={()=>{setProjectDraft(null);navigateTo('world');}}/>;
  const creationSetup = <ProjectSetup run={run} resourcePacks={resourcePacks} buildingBlueprints={state.buildingBlueprintResources} existingProjects={[]} draft={setupDraft} onDraftChange={updateSetupDraft} onCancel={discardProjectSetup} onCreated={completeProjectSetup}/>;
  const content = <>
    {worldPane}
    {creatingProject ? creationSetup : <>
      {!active && (tab === 'world' || tab === 'tasks') && firstRunSetup}
      {active && <RoutePane active={tab === 'tasks'} route="tasks"><Suspense fallback={<LoadingPage status="正在打开任务…"/>}><TasksScreen active={active} state={state} run={run} onCreateProject={beginProjectSetup} onViewProject={viewProjectInWorld}/></Suspense></RoutePane>}
      <RoutePane active={tab === 'stats'} route="stats"><Suspense fallback={<LoadingPage status="正在打开统计…"/>}><StatsScreen state={state}/></Suspense></RoutePane>
      <RoutePane active={tab === 'settings'} route="settings"><Suspense fallback={<LoadingPage status="正在打开设置…"/>}><SettingsScreen service={service} resourcePacks={resourcePacks} state={state} run={run} refresh={refresh} preferences={preferences} onPreferencesChange={updatePreferences}/></Suspense></RoutePane>
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

function ProjectSetup({run,resourcePacks,buildingBlueprints,existingProjects,draft,onDraftChange,onCancel,onCreated}:{run:(c:ApplicationCommand)=>Promise<any>;resourcePacks:ResourcePackRepository;buildingBlueprints:ReturnType<ApplicationService['snapshot']>['buildingBlueprintResources'];existingProjects:ReturnType<ApplicationService['snapshot']>['projects'];draft:ProjectSetupDraft;onDraftChange:(patch:Partial<ProjectSetupDraft>)=>void;onCancel?:()=>void;onCreated?:()=>void}) {
  const catalog=useBlueprintCatalog(); const {kind,blueprintId,habitTargetRounds,imported,packCompatibility,importRole}=draft; const [importing,setImporting]=useState(false); const [importError,setImportError]=useState(''); const [importNotice,setImportNotice]=useState(''); const [nativePicker,setNativePicker]=useState(false);
  const titleInput=useRef<HTMLInputElement>(null);
  const readSubtasks=useRef<(()=>string[])|null>(null);
  useEffect(()=>{let active=true;void import('@tomato-clock/platform-capacitor').then(platform=>{if(active)setNativePicker(platform.isCapacitorNative());});return()=>{active=false;};},[]);
  const importedEntry:BlueprintCatalogEntry|undefined=imported?{id:imported.blueprint.id,displayName:imported.preview.name,description:`本地 Litematic · Minecraft 数据版本 ${imported.preview.minecraftDataVersion}`,footprint:{width:imported.preview.dimensions.width,depth:imported.preview.dimensions.depth},complexity:imported.preview.nonAirBlockCount>3000?'detailed':'moderate',blueprint:imported.blueprint}:undefined;
  const libraryEntries:BlueprintCatalogEntry[]=buildingBlueprints.map(resource=>({id:resource.id,displayName:resource.displayName,description:`本地建筑蓝图 · ${new Date(resource.importedAt).toLocaleDateString('zh-CN')} 导入`,footprint:{width:resource.blueprint.bounds.maxX-resource.blueprint.bounds.minX+1,depth:resource.blueprint.bounds.maxZ-resource.blueprint.bounds.minZ+1},complexity:resource.blueprint.voxels.length>3000?'detailed':'moderate',blueprint:resource.blueprint as BlueprintV1}));
  const options=importedEntry?[...catalog,...libraryEntries,importedEntry]:[...catalog,...libraryEntries];
  const selected=options.find(option=>option.id===blueprintId)??options[0];
  const submit=async(e:FormEvent)=>{e.preventDefault();if(importRole==='decoration')return;const currentTitle=titleInput.current?.value??'';if(!currentTitle.trim()||!selected||!Number.isInteger(habitTargetRounds)||habitTargetRounds<10||habitTargetRounds>30)return;const importedBlueprint=selected.blueprint.id.startsWith('builtin-')?null:toImportedBlueprint(selected.blueprint);const subtasks=(readSubtasks.current?.()??draft.subtasksText.split('\n').map(x=>x.trim()).filter(Boolean)).map(title=>({title}));if(kind==='finite'&&subtasks.length===0)return;const command:ApplicationCommand=kind==='habit'?{type:'CreateHabitProject',title:currentTitle.trim(),blueprintId:selected.blueprint.id,importedBlueprint,targetRounds:habitTargetRounds}:{type:'CreateProject',title:currentTitle.trim(),blueprintId:selected.blueprint.id,importedBlueprint,subtasks};const result=await run(command);if(result?.ok)onCreated?.();};
  const parseImportedBytes=async(bytes:Uint8Array)=>{const {parseLitematic}=await loadLitematicModule();const result=await parseLitematic(bytes);const activePack=await resourcePacks.getActive();let nextCompatibility:ProjectSetupDraft['packCompatibility']=null;if(activePack){const {summarizeBlueprintCompatibility}=await import('@tomato-clock/resource-pack');const summary=summarizeBlueprintCompatibility(result.blueprint,activePack.manifest);nextCompatibility={name:activePack.name,textured:summary.texturedVoxelCount,fallback:summary.fallbackVoxelCount,total:summary.totalVoxelCount};}onDraftChange({imported:result,packCompatibility:nextCompatibility,importRole:'building',blueprintId:result.blueprint.id});setImportNotice('');};
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
      <header className="setup-heading"><h1>{onCancel ? '新增任务' : '建立你的第一项任务'}</h1><p>{kind === 'habit' ? '每次专注都会推进习惯建筑，完成后继续选择下一座。' : '每项大型任务会在村落中留下自己的一栋建筑。'}</p></header>
      <div className="setup-kind" role="group" aria-label="任务类型"><button type="button" aria-pressed={kind === 'finite'} onClick={() => onDraftChange({ kind: 'finite' })}>普通大型任务</button><button type="button" aria-pressed={kind === 'habit'} onClick={() => onDraftChange({ kind: 'habit' })}>习惯任务</button></div>
      <div className="setup-fields">
        <label>{kind === 'habit' ? '习惯名称' : '大型任务'}<NativeImeTextEntry targetRef={titleInput} name="projectTitle" defaultValue={draft.title} onValueChange={title => onDraftChange({ title })}/></label>
        {kind === 'finite' ? <SubtaskRowsEditor initialText={draft.subtasksText} readerRef={readSubtasks} onChange={subtasksText => onDraftChange({ subtasksText })}/> : <div className="habit-target-summary"><span>每座建筑</span><strong>{habitTargetRounds} 轮专注</strong><small>统一在设置中调整；创建后，本周期内不会改变。</small></div>}
      </div>
      {selected ? <BlueprintPicker resourcePacks={resourcePacks} options={options} selected={selected} onSelect={id => onDraftChange({ blueprintId: id, ...(!imported || id !== imported.blueprint.id ? { importRole: 'building' } : {}) })} importControl={importControl}/> : <div className="blueprint-loading" role="status">正在准备建筑预览...</div>}
      <div className="setup-actions">{onCancel && <button type="button" className="setup-cancel" onClick={onCancel}>取消</button>}{importRole === 'decoration' && imported ? <button className="primary setup-submit" type="button" disabled={importing || Boolean(decorationLimitError)} onClick={() => void addDecoration()}>加入装饰池</button> : <button className="primary setup-submit" type="submit" disabled={!selected || importing || !Number.isInteger(habitTargetRounds) || habitTargetRounds < 10 || habitTargetRounds > 30 || (kind === 'finite' && draft.subtasksText.split('\n').map(x => x.trim()).filter(Boolean).length === 0)}>开始建造</button>}</div>
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

function BlueprintPicker({resourcePacks,options,selected,onSelect,importControl}:{resourcePacks:ResourcePackRepository;options:readonly BlueprintCatalogEntry[];selected:BlueprintCatalogEntry;onSelect:(id:string)=>void;importControl?:ReactNode}) {
  const canvasRef=useRef<HTMLCanvasElement>(null); const rendererRef=useRef<VoxelRenderer|null>(null); const selectedRef=useRef(selected); const optionsRef=useRef(options); selectedRef.current=selected; optionsRef.current=options;
  const previewSnapshot=useCallback((entry:BlueprintCatalogEntry):WorldSnapshot=>({projectId:'blueprint-preview',blueprintId:entry.id,buildingCompletionBasisPoints:10000,buildingConditionBasisPoints:10000,isMonument:false,settlementIndex:0}),[]);
  useEffect(()=>{let cancelled=false;let current:VoxelRenderer|null=null;void loadVoxelModule().then(async({createVoxelRenderer,resolveBuiltinBlueprint})=>{if(cancelled||!canvasRef.current)return;current=createVoxelRenderer(canvasRef.current,{previewMode:true,resolveBlueprint:id=>optionsRef.current.find(option=>option.id===id)?.blueprint??resolveBuiltinBlueprint(id),resourcePackAtlasMaximumSize:resourcePackAtlasMaximumSizeForTest()});rendererRef.current=current;current.setReducedMotion(matchMedia('(prefers-reduced-motion: reduce)').matches);current.setWorld(previewSnapshot(selectedRef.current));const pack=await resourcePacks.getActive();if(!cancelled&&current)await current.setResourcePack(pack?{id:pack.id,manifest:pack.manifest}:null);}).catch(()=>undefined);return()=>{cancelled=true;current?.dispose();if(rendererRef.current===current)rendererRef.current=null;};},[previewSnapshot,resourcePacks]);
  useEffect(()=>{rendererRef.current?.setWorld(previewSnapshot(selected));},[previewSnapshot,selected]);
  return <fieldset className="blueprint-picker"><legend>选择建筑蓝图</legend><div className="blueprint-preview"><canvas ref={canvasRef} role="img" aria-label={`${selected.displayName}完整建筑预览，可拖动旋转`}/><div className="world-hud preview-hud"><span>{selected.displayName}</span><button type="button" title="重置预览视角" aria-label="重置预览视角" onClick={()=>rendererRef.current?.resetCamera()}><RotateCcw/></button></div></div><div className="blueprint-options">{options.map(option=><label className={option.id===selected.id?'blueprint-option selected':'blueprint-option'} key={option.id}><input type="radio" name="blueprint" value={option.id} checked={option.id===selected.id} onChange={()=>onSelect(option.id)}/><span className="blueprint-option-copy"><strong>{option.displayName}</strong><small>{option.footprint.width} x {option.footprint.depth} 方块 · {complexityLabel(option.complexity)}</small></span>{option.id===selected.id&&<Check aria-hidden="true"/>}</label>)}</div><p className="blueprint-description">{selected.description}</p><p className="blueprint-lock">蓝图在创建后不可更换，请确认完整预览。</p>{importControl}</fieldset>;
}

function WorldScreen({service,resourcePacks,run,refresh,preferences}:{service:ApplicationService;resourcePacks:ResourcePackRepository;run:(c:ApplicationCommand)=>Promise<any>;refresh:()=>void;preferences:FocusPreferences}) { const active=service.activeProjectProjection()!; const state=service.snapshot(); const [selected,setSelected]=useState(active.project.subtasks.find(s=>s.progressBasisPoints<10000)?.id ?? active.project.subtasks[0]!.id); const [rounds,setRounds]=useState(1); const [plan,setPlanState]=useState<RoundPlan|null>(()=>loadRoundPlan(active.project.id)); const [ending,setEnding]=useState(false);const [constructionFeedback,setConstructionFeedback]=useState(0); const reconciling=useRef(false);const latestSuccess=lastSuccessfulSession(state.focusHistory);const latestSuccessRef=useRef(latestSuccess?.id);
  const setPlan=useCallback((next:RoundPlan|null)=>{setPlanState(next);if(next)localStorage.setItem(ROUND_PLAN_KEY,JSON.stringify(next));else localStorage.removeItem(ROUND_PLAN_KEY);},[]);
  const reconcile=useCallback(async()=>{if(reconciling.current)return;const current=service.snapshot().activeFocusSession;if(!current||Date.parse(current.endsAt)>Date.now())return;reconciling.current=true;try{await service.resume();refresh();}finally{reconciling.current=false;}},[service,refresh]);
  const finishBreak=useCallback(()=>{if(plan?.status!=='break'||!plan.breakEndsAt||Date.parse(plan.breakEndsAt)>Date.now())return;if(plan.endAfterBreak)setPlan(null);else{const {breakEndsAt:_breakEndsAt,...withoutBreak}=plan;setPlan({...withoutBreak,status:'ready'});}},[plan,setPlan]);
  useEffect(()=>{if(latestSuccess&&latestSuccess.id!==latestSuccessRef.current){latestSuccessRef.current=latestSuccess.id;setConstructionFeedback(value=>value+1);const timer=window.setTimeout(()=>setConstructionFeedback(0),1800);return()=>clearTimeout(timer);}},[latestSuccess?.id]);
  const session=state.activeFocusSession; const lastFocus=state.focusHistory[state.focusHistory.length-1];const integrityFailure=!session&&lastFocus?.status==='interrupted'&&lastFocus.interruptionReason==='app-switch-limit'; const isBreak=plan?.status==='break'&&!!plan.breakEndsAt; const timerEndsAt=session?.endsAt??(isBreak?plan?.breakEndsAt:undefined); const pending=active.unreportedCompletedSessions; const selectedId=plan?.subtaskId??selected; const subtask=active.project.subtasks.find(s=>s.id===selectedId) ?? active.project.subtasks[0]!;
  useEffect(()=>{if(integrityFailure&&plan?.status==='focus')setPlan(null);},[integrityFailure,plan,setPlan]);
  const startFocus=async(total=plan?.totalRounds??rounds)=>{const next:RoundPlan=plan??{projectId:active.project.id,subtaskId:subtask.id,totalRounds:total,completedRounds:0,status:'focus',reportedSessionIds:[]};const result=await run({type:'StartFocus',subtaskId:next.subtaskId,plannedDurationMs:preferences.focusMinutes*60000});if(result?.ok){const {breakEndsAt:_breakEndsAt,...withoutBreak}=next;setPlan({...withoutBreak,status:'focus'});}};
  const interruptFocus=async(interruptionCategory:FocusInterruptionCategory|null)=>{const current=service.snapshot().activeFocusSession;if(current&&Date.parse(current.endsAt)<=Date.now()){setEnding(false);await reconcile();return;}const result=await run({type:'CancelFocus',interruptionCategory});if(result?.ok){setPlan(null);setEnding(false);}};
  const completeEarly=async()=>{const current=service.snapshot().activeFocusSession;if(current&&Date.parse(current.endsAt)<=Date.now()){setEnding(false);await reconcile();return;}const result=await run({type:'CompleteFocusEarly'});if(!result?.ok)return;setEnding(false);const sealed=result.events.some((event:{type:string})=>event.type==='ProjectSealedAsMonument');if(sealed){setPlan(null);return;}const currentPlan=plan;if(currentPlan&&currentPlan.totalRounds>1&&preferences.breakMinutes>0)setPlan({...currentPlan,completedRounds:currentPlan.completedRounds+1,status:'break',endAfterBreak:true,breakEndsAt:new Date(Date.now()+preferences.breakMinutes*60000).toISOString()});else setPlan(null);};
  const afterReport=()=>{if(!plan)return;const completed=plan.completedRounds+1;if(completed>=plan.totalRounds){setPlan(null);return;}if(preferences.breakMinutes===0){const {breakEndsAt:_breakEndsAt,endAfterBreak:_endAfterBreak,...withoutBreak}=plan;setPlan({...withoutBreak,completedRounds:completed,status:'ready'});return;}setPlan({...plan,completedRounds:completed,status:'break',breakEndsAt:new Date(Date.now()+preferences.breakMinutes*60000).toISOString()});};
  return <div className={session?'world-screen is-focusing':'world-screen'}><WorldCanvas service={service} resourcePacks={resourcePacks} lightingQuality={preferences.lightingQuality} constructionOutlineVisibility={preferences.constructionOutlineVisibility} constructionFeedback={constructionFeedback}/><section className="focus-panel">{!session&&<><div className="project-heading"><div><span className="eyebrow">正在建造</span><h1>{active.project.title}</h1></div><div className="build-percent">{Math.round(active.building.completionBasisPoints/100)}%</div></div><div className="meter"><i style={{width:`${active.building.completionBasisPoints/100}%`}}/></div><div className="construction-stage">{constructionStage(active.building.completionBasisPoints)}</div></>}
    {pending.length>0 ? <ProgressReport active={active} run={run} onSubmitted={afterReport}/> : <>{session?<div className="focus-task-context"><span>本轮任务</span><strong>{subtask.title}</strong></div>:<ChoiceMenu label="本次专注" value={selectedId} disabled={!!plan} onChange={setSelected} options={active.project.subtasks.map(s=>({id:s.id,label:s.title,detail:`${Math.round(s.progressBasisPoints/100)}%`}))}/>}<div className={isBreak?'session-kind rest':'session-kind'}>{isBreak?(plan?.endAfterBreak?'任务已完成 · 休息时间':'休息时间'):session?`第 ${(plan?.completedRounds??0)+1} / ${plan?.totalRounds??1} 轮专注`:plan?.status==='ready'?`准备第 ${plan.completedRounds+1} / ${plan.totalRounds} 轮`:preferences.breakMinutes===0?`每轮 ${preferences.focusMinutes} 分钟专注 · 不休息`:`每轮 ${preferences.focusMinutes} 分钟专注 + ${preferences.breakMinutes} 分钟休息`}</div>{session&&state.focusIntegrityPolicy.enabled&&<div className={session.integrity.effectiveExcursions>0?'focus-integrity-warning active':'focus-integrity-warning'}><AlertTriangle/>有效离开 {session.integrity.effectiveExcursions} / {state.focusIntegrityPolicy.maxEffectiveExcursions} 次</div>}{integrityFailure&&<div className="focus-integrity-ended" role="alert"><AlertTriangle/>本轮专注因达到离开应用次数上限而结束。下次可以从这里继续。</div>}<FocusTimer endsAt={timerEndsAt} fallbackMs={preferences.focusMinutes*60000} onElapsed={session?reconcile:finishBreak}/>{!session&&!plan&&<div className="duration" aria-label="专注轮次">{[1,2,3,4].map(n=><button key={n} className={rounds===n?'selected':''} onClick={()=>setRounds(n)}>{n} 轮</button>)}</div>}{isBreak?<button className="primary secondary-action" onClick={()=>{if(plan?.endAfterBreak)setPlan(null);else{const {breakEndsAt:_breakEndsAt,...withoutBreak}=plan!;setPlan({...withoutBreak,status:'ready'});}}}>跳过休息</button>:plan?.status==='ready'?<button className="primary" onClick={()=>void startFocus()}><Clock3/>开始下一轮</button>:<button className={session?'destructive primary':'primary'} onClick={()=>void(session?setEnding(true):startFocus())}>{session?<><Square/>结束本次专注</>:<><Clock3/>开始 {rounds} 轮</>}</button>}</>}
    {ending&&session&&(
      <EndFocusDialog taskTitle={subtask.title} onClose={()=>setEnding(false)} onInterrupt={interruptFocus} onCompleteEarly={completeEarly}/>
    )}
  </section></div>; }

function WorldScreenV7({ service, resourcePacks, run, refresh, preferences, recordedIntegrityNotice, focusedProjectId, memoryProjectId, onFocusWorldProject, onClearWorldFocus, onCloseWorldMemory, onOpenTasks, visible }: {
  service: ApplicationService;
  resourcePacks: ResourcePackRepository;
  run: (command: ApplicationCommand) => Promise<any>;
  refresh: () => void;
  preferences: FocusPreferences;
  recordedIntegrityNotice: RecordedIntegrityNotice | null;
  focusedProjectId: string | null;
  memoryProjectId: string | null;
  onFocusWorldProject: (projectId: string) => void;
  onClearWorldFocus: () => void;
  onCloseWorldMemory: () => void;
  onOpenTasks: () => void;
  visible: boolean;
}) {
  const active = service.activeProjectProjection()!;
  const state = service.snapshot();
  const blueprintCatalog = useBlueprintCatalog();
  const isHabit = active.project.kind === 'habit';
  const habit = active.project.habit;
  const [selected, setSelected] = useState<string | null>(isHabit ? null : active.project.subtasks.find((subtask) => subtask.progressBasisPoints < 10000)?.id ?? active.project.subtasks[0]!.id);
  const [rounds, setRounds] = useState(1);
  const [plan, setPlanState] = useState<RoundPlan | null>(() => loadRoundPlan(active.project.id));
  const [ending, setEnding] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  // V21 marathon scheduling draft: the user picks only an end time; rounds and
  // breaks are derived from the remaining duration with the normal per-round
  // settings, and progress is reported once after the last round.
  const [planMode, setPlanMode] = useState<'rounds' | 'marathon'>('rounds');
  const [endAtDraft, setEndAtDraft] = useState('18:00');
  const focusPanelRef = useRef<HTMLElement>(null);
  const [immersiveBand, setImmersiveBand] = useState({ bottom: 0, right: 0 });
  const [controlsVisible, setControlsVisible] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const [pickedCell, setPickedCell] = useState<{ x: number; y: number; z: number } | null>(null);
  const [integrityNotice, setIntegrityNotice] = useState<{ sessionId: string; count: number; max: number; sequence: number } | null>(null);
  // V20 FX-04 exit: conditional controls stay mounted for a ~180 ms fade-down
  // after their close/hide action so enter and exit read as one symmetric move.
  const [controlsLeaving, setControlsLeaving] = useState(false);
  const [integrityLeaving, setIntegrityLeaving] = useState(false);
  const [endingLeaving, setEndingLeaving] = useState(false);
  const [planLeaving, setPlanLeaving] = useState(false);
  const exitTimersRef = useRef<number[]>([]);
  const exitAfter = (ms: number, done: () => void): void => {
    const timer = window.setTimeout(done, ms);
    exitTimersRef.current.push(timer);
  };
  const integrityNoticeSequenceRef = useRef(0);
  const integrityNoticeTimerRef = useRef<number | null>(null);
  const integrityNoticeExitTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [constructionFeedback, setConstructionFeedback] = useState(0);
  const reconciling = useRef(false);

  const showIntegrityNotice = useCallback((sessionId: string, count: number, max: number) => {
    if (integrityNoticeTimerRef.current !== null) window.clearTimeout(integrityNoticeTimerRef.current);
    if (integrityNoticeExitTimerRef.current !== null) window.clearTimeout(integrityNoticeExitTimerRef.current);
    const sequence = ++integrityNoticeSequenceRef.current;
    setIntegrityLeaving(false);
    setIntegrityNotice({ sessionId, count, max, sequence });
    integrityNoticeTimerRef.current = window.setTimeout(() => {
      setIntegrityLeaving(true);
      integrityNoticeExitTimerRef.current = window.setTimeout(() => {
        setIntegrityNotice((current) => current?.sequence === sequence ? null : current);
        setIntegrityLeaving(false);
      }, 180);
    }, 5_000);
  }, []);

  const setPlan = useCallback((next: RoundPlan | null) => {
    setPlanState(next);
    if (next) localStorage.setItem(ROUND_PLAN_KEY, JSON.stringify(next));
    else localStorage.removeItem(ROUND_PLAN_KEY);
  }, []);
  const reconcile = useCallback(async () => {
    if (reconciling.current) return;
    const current = service.snapshot().activeFocusSession;
    if (!current || Date.parse(current.endsAt) > Date.now()) return;
    reconciling.current = true;
    try { await service.resume(); refresh(); } finally { reconciling.current = false; }
  }, [service, refresh]);
  const finishBreak = useCallback(() => {
    if (plan?.status !== 'break' || !plan.breakEndsAt || Date.parse(plan.breakEndsAt) > Date.now()) return;
    if (plan.endAfterBreak) setPlan(null);
    else {
      const { breakEndsAt: _breakEndsAt, ...withoutBreak } = plan;
      setPlan({ ...withoutBreak, status: 'ready' });
    }
  }, [plan, setPlan]);

  useEffect(() => {
    setSelected(active.project.kind === 'habit' ? null : active.project.subtasks.find((subtask) => subtask.progressBasisPoints < 10000)?.id ?? active.project.subtasks[0]!.id);
    // V22: an end-time plan is its own lane, so switching the active project must
    // not drop it; only the classic per-project plan reloads.
    setPlanState((previous) => {
      if (previous?.mode === 'marathon') return previous;
      const loaded = loadRoundPlan(active.project.id);
      if (loaded) localStorage.setItem(ROUND_PLAN_KEY, JSON.stringify(loaded));
      else localStorage.removeItem(ROUND_PLAN_KEY);
      return loaded;
    });
    setPlanOpen(false);
    setPlanMode('rounds');
  }, [active.project.id]);
  // The "materials delivered" beat fires when the user commits progress (which
  // is also when the construction blocks land), not when a session merely ends.
  const fireConstructionFeedback = useCallback(() => {
    setConstructionFeedback((value) => value + 1);
    window.setTimeout(() => setConstructionFeedback(0), 1800);
  }, []);

  const session = state.activeFocusSession;
  const lastFocus = state.focusHistory[state.focusHistory.length - 1];
  const integrityFailure = !session && lastFocus?.status === 'interrupted' && lastFocus.interruptionReason === 'app-switch-limit';
  const pending = active.unreportedCompletedSessions;
  const habitAwaiting = isHabit && habit?.awaitingNextBuilding === true;
  const reconciledPlan = reconcileRoundPlan(plan, state, active.project.id, Date.now(), preferences.breakMinutes * 60_000, preferences.breakMinutes * 60_000);
  const isBreak = reconciledPlan?.status === 'break' && !!reconciledPlan.breakEndsAt;
  const skipBreak = useCallback(() => {
    try { localStorage.removeItem(SKIP_BREAK_REQUEST_KEY); } catch {}
    if (reconciledPlan?.status !== 'break') return;
    if (reconciledPlan.endAfterBreak) {
      setPlan(null);
      return;
    }
    const { breakEndsAt: _breakEndsAt, ...withoutBreak } = reconciledPlan;
    setPlan({ ...withoutBreak, status: 'ready' });
  }, [reconciledPlan, setPlan]);
  useEffect(() => {
    const onNativeSkipBreak = () => skipBreak();
    window.addEventListener('blockcolc-skip-break', onNativeSkipBreak);
    try {
      if (localStorage.getItem(SKIP_BREAK_REQUEST_KEY) === '1') skipBreak();
    } catch {}
    return () => window.removeEventListener('blockcolc-skip-break', onNativeSkipBreak);
  }, [skipBreak]);
  // Immersive design A: the end control stays hidden so the world is the whole
  // screen; a double-tap on the bottom band reveals it. A one-time hint explains
  // the gesture at the start of each session.
  useEffect(() => {
    // Every session transition resets the gesture state so a pending reveal
    // timer can never surface the end button inside the next session.
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = null;
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
    lastTapRef.current = null;
    setControlsVisible(false);
    setControlsLeaving(false);
    if (!session) return;
    setHintVisible(true);
    // Match the five-second reveal rhythm of the end control: the 1.2 s CSS
    // fade completes right at five seconds.
    const timer = window.setTimeout(() => setHintVisible(false), 3_800);
    return () => window.clearTimeout(timer);
  }, [session?.id]);
  // The revealed end control stays for five seconds and then hides itself, so a
  // focused session never keeps the red button hanging around.
  const hideControls = useCallback(() => {
    setControlsLeaving(true);
    exitAfter(180, () => { setControlsVisible(false); setControlsLeaving(false); });
  }, []);
  useEffect(() => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
    if (!controlsVisible || !session) return;
    hideTimerRef.current = window.setTimeout(hideControls, 5_000);
  }, [controlsVisible, session?.id, hideControls]);
  const handlePanelTap = useCallback((event: { target: EventTarget | null; clientX: number; clientY: number }) => {
    if (!session || (event.target instanceof Element && event.target.closest('button'))) return;
    const now = performance.now();
    const previous = lastTapRef.current;
    lastTapRef.current = { time: now, x: event.clientX, y: event.clientY };
    if (previous && now - previous.time < 450 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 48) {
      lastTapRef.current = null;
      // Reveal after a beat so the second tap's trailing click lands on empty space
      // instead of the freshly shown button; hiding plays the symmetric fade-down.
      if (controlsVisible) hideControls();
      else {
        if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = window.setTimeout(() => setControlsVisible(true), 250);
      }
    }
  }, [session, controlsVisible, hideControls]);
  // V21: in immersive focus the world fills the screen but a frosted band covers
  // part of it (bottom on portrait, right-hand column on landscape). Measure that
  // band so the renderer can center the world on the visible window instead of
  // the full-screen center.
  useEffect(() => {
    if (!session) {
      setImmersiveBand({ bottom: 0, right: 0 });
      return;
    }
    const override = immersiveBandTestOverride();
    if (override !== undefined) {
      setImmersiveBand(override);
      return;
    }
    const panel = focusPanelRef.current;
    if (!panel) return;
    const measure = () => {
      const rect = panel.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const bottomBand = rect.width >= vw * 0.6;
      setImmersiveBand(bottomBand
        ? { bottom: Math.min(0.62, rect.height / vh), right: 0 }
        : { bottom: 0, right: Math.min(0.62, rect.width / vw) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [session?.id]);

  // Preserve the original V19 world-overlay notice. Session start owns the
  // initial 0/N presentation; subsequent counts come from the authoritative
  // lifecycle result instead of being inferred from a render-time snapshot.
  useEffect(() => {
    if (!session || !state.focusIntegrityPolicy.enabled) {
      if (integrityNoticeTimerRef.current !== null) window.clearTimeout(integrityNoticeTimerRef.current);
      if (integrityNoticeExitTimerRef.current !== null) window.clearTimeout(integrityNoticeExitTimerRef.current);
      integrityNoticeTimerRef.current = null;
      integrityNoticeExitTimerRef.current = null;
      setIntegrityLeaving(false);
      setIntegrityNotice(null);
      return;
    }
    showIntegrityNotice(session.id, session.integrity.effectiveExcursions, state.focusIntegrityPolicy.maxEffectiveExcursions);
  }, [session?.id, state.focusIntegrityPolicy.enabled, state.focusIntegrityPolicy.maxEffectiveExcursions, showIntegrityNotice]);
  useEffect(() => {
    if (!recordedIntegrityNotice) return;
    showIntegrityNotice(recordedIntegrityNotice.sessionId, recordedIntegrityNotice.count, recordedIntegrityNotice.max);
  }, [recordedIntegrityNotice, showIntegrityNotice]);
  // V22 follow-up: the app-switch-limit notice plays the same bounded entrance
  // and fade-out as the other transient controls instead of lingering forever.
  const [integrityEndedLeaving, setIntegrityEndedLeaving] = useState(false);
  const [integrityEndedHidden, setIntegrityEndedHidden] = useState(false);
  useEffect(() => {
    if (!integrityFailure) {
      setIntegrityEndedLeaving(false);
      setIntegrityEndedHidden(false);
      return;
    }
    setIntegrityEndedLeaving(false);
    setIntegrityEndedHidden(false);
    const timer = window.setTimeout(() => {
      setIntegrityEndedLeaving(true);
      exitAfter(180, () => { setIntegrityEndedHidden(true); setIntegrityEndedLeaving(false); });
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [integrityFailure]);
  useEffect(() => {
    if (plan?.mode === 'marathon' && reconciledPlan === null) setPlanMode('rounds');
    if (!roundPlansEqual(plan, reconciledPlan)) setPlan(reconciledPlan);
  }, [plan, reconciledPlan, setPlan]);
  const selectedId = reconciledPlan?.subtaskId ?? selected;
  const subtask = active.project.subtasks.find((item) => item.id === selectedId) ?? active.project.subtasks[0]!;
  const today = localDateOf(new Date(), state.calendar.timeZone);
  const dailyGoal = dailyGoalForDate(state, today);
  const completedToday = completedPomodorosOn(state, today);
  const dailySummary = dailyGoal.enabled ? `今日 ${completedToday} / ${dailyGoal.targetPomodoros} 轮` : `今日已完成 ${completedToday} 轮`;

  useEffect(() => {
    const hostProject = reconciledPlan
      ? state.projects.find((project) => project.id === reconciledPlan.projectId) ?? active.project
      : active.project;
    const nextTaskTitle = reconciledPlan?.endAfterBreak
      ? '休息后返回工作台'
      : hostProject.kind === 'habit'
        ? hostProject.title
        : hostProject.subtasks.find((item) => item.id === reconciledPlan?.subtaskId)?.title
          ?? hostProject.subtasks.find((item) => item.progressBasisPoints < 10000)?.title
          ?? hostProject.title;
    const operation = reconciledPlan?.status === 'break' && reconciledPlan.breakEndsAt
      ? service.scheduleBreakCompletion({
          endsAt: reconciledPlan.breakEndsAt,
          completedRounds: reconciledPlan.completedRounds,
          totalRounds: reconciledPlan.totalRounds,
          nextTaskTitle,
        })
      : service.cancelBreakCompletion();
    void operation.then((warnings) => {
      for (const warning of warnings) console.warn(warning.message, warning.cause);
    });
  }, [service, state.projects, active.project, reconciledPlan?.projectId, reconciledPlan?.subtaskId, reconciledPlan?.status, reconciledPlan?.breakEndsAt, reconciledPlan?.completedRounds, reconciledPlan?.totalRounds, reconciledPlan?.endAfterBreak]);

  useEffect(() => {
    if (habitAwaiting && plan !== null) setPlan(null);
  }, [habitAwaiting, plan, setPlan]);

  const startFocus = async (total = reconciledPlan?.totalRounds ?? rounds) => {
    if (habitAwaiting) return;
    const marathonDraft = planMode === 'marathon' && !reconciledPlan;
    // V22: a locked end-time plan keeps its own host project even after the
    // active project was switched away, so rounds keep landing on the host.
    const marathonHost = reconciledPlan?.mode === 'marathon'
      ? state.projects.find((project) => project.id === reconciledPlan.projectId) ?? active.project
      : active.project;
    const marathonHostIsHabit = marathonHost.kind === 'habit';
    // Marathon is one shared scheduling contract regardless of whether its
    // host is a finite or habit project. Classic habit rounds keep their own
    // duration; every end-time round uses the normal-task duration everywhere.
    const marathonRound = reconciledPlan?.mode === 'marathon' || marathonDraft;
    const focusMinutes = marathonRound
      ? preferences.focusMinutes
      : marathonHostIsHabit ? preferences.habitFocusMinutes : preferences.focusMinutes;
    let marathonTotal = total;
    let marathonEndAt: string | undefined = reconciledPlan?.endAt;
    if (marathonDraft) {
      const endMs = marathonEndInstant(endAtDraft);
      const schedule = endMs === null ? null : planRoundsForDuration(endMs - Date.now(), focusMinutes, preferences.breakMinutes);
      if (!schedule || schedule.rounds < 1) return;
      marathonTotal = schedule.rounds;
      marathonEndAt = new Date(endMs!).toISOString();
    }
    const targetSubtaskId = marathonHostIsHabit
      ? null
      : marathonRound
        ? (marathonHost.subtasks.find((item) => item.progressBasisPoints < 10000)?.id ?? marathonHost.subtasks[0]?.id ?? null)
        : (reconciledPlan?.subtaskId ?? subtask?.id ?? null);
    if (!marathonHostIsHabit && targetSubtaskId === null) return;
    const next: RoundPlan = reconciledPlan ?? { projectId: marathonHost.id, subtaskId: targetSubtaskId, totalRounds: marathonTotal, completedRounds: 0, status: 'focus', reportedSessionIds: [] };
    if (!marathonHostIsHabit && next.subtaskId !== targetSubtaskId) next.subtaskId = targetSubtaskId;
    if (marathonDraft) { next.mode = 'marathon'; next.endAt = marathonEndAt; }
    const result = await run({
      type: 'StartFocus',
      subtaskId: next.subtaskId,
      plannedDurationMs: focusMinutes * 60000,
      ...(reconciledPlan?.mode === 'marathon' || marathonDraft ? { projectId: marathonHost.id, marathon: true } : {}),
    });
    if (result?.ok) {
      const { breakEndsAt: _breakEndsAt, ...withoutBreak } = next;
      const started = result.events.find((event: { type: string; sessionId?: string }) => event.type === 'FocusStarted');
      setPlan({ ...withoutBreak, status: 'focus', currentSessionId: started?.sessionId });
    }
  };
  // FX-04 exit: close actions play the symmetric fade-down before unmounting.
  const closeEnding = useCallback(() => {
    setEndingLeaving(true);
    exitAfter(180, () => { setEnding(false); setEndingLeaving(false); });
  }, []);
  const closePlan = useCallback(() => {
    setPlanLeaving(true);
    exitAfter(180, () => { setPlanOpen(false); setPlanLeaving(false); });
  }, []);
  // V22: cancel is the only exit from a locked end-time plan, and it settles
  // immediately: the current round (if any) is interrupted and every finished
  // round enters the cross-project settlement report.
  const cancelPlan = useCallback(async () => {
    const currentPlan = reconciledPlan;
    if (currentPlan?.mode !== 'marathon') {
      setPlan(null);
      closePlan();
      return;
    }
    // Leaving a locked marathon must also leave its local draft mode. Otherwise
    // the idle timer keeps counting toward the stale endAt after the plan is gone.
    setPlanMode('rounds');
    closePlan();
    const soon = service.snapshot().activeFocusSession;
    if (soon) {
      if (Date.parse(soon.endsAt) <= Date.now()) {
        await reconcile();
      } else {
        await run({ type: 'CancelFocus', interruptionCategory: null });
      }
    }
    const latest = service.snapshot();
    const hostProject = latest.projects.find((project) => project.id === currentPlan.projectId);
    // Habit rounds are settled by the domain as they finish. Cancelling its
    // end-time schedule must never open the finite-task cross-project report.
    if (hostProject?.kind === 'habit') {
      setPlan(null);
      return;
    }
    const reported = new Set(latest.progressReports.flatMap((report) => report.focusSessionIds));
    const settled = latest.focusHistory.filter((item) =>
      item.projectId === currentPlan.projectId && (item.status === 'completed' || item.status === 'completed-early')
        && item.marathon === true && !reported.has(item.id)
        && item.settledAt === undefined && !marathonRoundSettled(latest, item.id));
    if (settled.length > 0) {
      setPlan({
        ...currentPlan,
        status: 'report',
        currentSessionId: undefined,
        breakEndsAt: undefined,
        endAfterBreak: undefined,
      });
    } else {
      setPlan(null);
    }
  }, [reconciledPlan, service, reconcile, run, setPlan, closePlan]);
  // V22: confirming a marathon draft locks the schedule right away (the sheet
  // button becomes the red “cancel plan”), without starting the first round.
  const confirmPlan = useCallback(() => {
    if (reconciledPlan) {
      void cancelPlan();
      return;
    }
    if (planMode === 'marathon') {
      const endMs = marathonEndInstant(endAtDraft);
      const schedule = endMs === null ? null : planRoundsForDuration(
        endMs - Date.now(),
        preferences.focusMinutes,
        preferences.breakMinutes,
      );
      if (schedule === null) return;
      const targetSubtaskId = isHabit
        ? null
        : active.project.subtasks.find((item) => item.progressBasisPoints < 10000)?.id ?? active.project.subtasks[0]?.id ?? null;
      if (!isHabit && targetSubtaskId === null) return;
      setPlan({
        projectId: active.project.id,
        subtaskId: targetSubtaskId,
        totalRounds: schedule.rounds,
        completedRounds: 0,
        status: 'ready',
        reportedSessionIds: [],
        mode: 'marathon',
        endAt: new Date(endMs!).toISOString(),
      });
    }
    closePlan();
  }, [reconciledPlan, planMode, endAtDraft, isHabit, preferences.focusMinutes, preferences.habitFocusMinutes, preferences.breakMinutes, active.project, setPlan, closePlan, cancelPlan]);
  useEffect(() => () => {
    for (const timer of exitTimersRef.current) window.clearTimeout(timer);
    if (integrityNoticeTimerRef.current !== null) window.clearTimeout(integrityNoticeTimerRef.current);
    if (integrityNoticeExitTimerRef.current !== null) window.clearTimeout(integrityNoticeExitTimerRef.current);
  }, []);
  const interruptFocus = async (interruptionCategory: FocusInterruptionCategory | null) => {
    const current = service.snapshot().activeFocusSession;
    if (current && Date.parse(current.endsAt) <= Date.now()) {
      closeEnding();
      await reconcile();
      return;
    }
    const result = await run({ type: 'CancelFocus', interruptionCategory });
    if (result?.ok) {
      const currentPlan = reconciledPlan;
      // A marathon interruption only ends this round; the schedule keeps its
      // next round. Cancelling the whole plan is done from the plan sheet.
      if (currentPlan?.mode === 'marathon') {
        const { breakEndsAt: _breakEndsAt, endAfterBreak: _endAfterBreak, ...withoutBreak } = currentPlan;
        setPlan({ ...withoutBreak, status: 'ready', currentSessionId: undefined });
      } else {
        setPlan(null);
      }
      closeEnding();
    }
  };
  const completeEarly = async () => {
    const current = service.snapshot().activeFocusSession;
    if (current && Date.parse(current.endsAt) <= Date.now()) {
      closeEnding();
      await reconcile();
      return;
    }
    const result = await run({ type: 'CompleteFocusEarly' });
    if (!result?.ok) return;
    closeEnding();
    const sealed = result.events.some((event: { type: string }) => event.type === 'ProjectSealedAsMonument' || event.type === 'HabitBuildingCompleted');
    const currentPlan = reconciledPlan;
    const currentPlanIsHabit = currentPlan?.mode === 'marathon'
      ? result.state.projects.find((project: { id: string; kind: string }) => project.id === currentPlan.projectId)?.kind === 'habit'
      : isHabit;
    const completedSession = result.events.find((event: { type: string; sessionId?: string }) => event.type === 'FocusCompletedEarly');
    const sessionId = completedSession?.sessionId;
    // A marathon pushes all rounds into the cross-project settlement report,
    // sealed building or not: the report filters already-settled rounds via
    // marathonRoundSettled (the sealed round IS settled by its seal report),
    // so the sealed round shows as completed there instead of bypassing it.
    if (currentPlan?.mode === 'marathon') {
      const completed = currentPlan.completedRounds + 1;
      const reportedSessionIds = sessionId && !currentPlan.reportedSessionIds.includes(sessionId)
        ? [...currentPlan.reportedSessionIds, sessionId]
        : currentPlan.reportedSessionIds;
      if (currentPlanIsHabit && (sealed || completed >= currentPlan.totalRounds)) {
        setPlanMode('rounds');
        setPlan(null);
      } else if (completed >= currentPlan.totalRounds) {
        setPlan({ ...currentPlan, completedRounds: completed, status: 'report', currentSessionId: undefined, reportedSessionIds });
      } else if (preferences.breakMinutes === 0) {
        setPlan({ ...currentPlan, completedRounds: completed, status: 'ready', currentSessionId: undefined, reportedSessionIds });
      } else {
        setPlan({ ...currentPlan, completedRounds: completed, status: 'break', breakEndsAt: new Date(Date.now() + preferences.breakMinutes * 60000).toISOString(), currentSessionId: undefined, reportedSessionIds });
      }
      return;
    }
    if (sealed || !currentPlan || currentPlan.totalRounds === 1) {
      setPlan(null);
      return;
    }
    if (preferences.breakMinutes === 0) {
      setPlan(null);
      return;
    }
    setPlan({ ...currentPlan, completedRounds: currentPlan.completedRounds + 1, status: 'break', endAfterBreak: true, breakEndsAt: new Date(Date.now() + preferences.breakMinutes * 60000).toISOString(), currentSessionId: undefined, reportedSessionIds: sessionId && !currentPlan.reportedSessionIds.includes(sessionId) ? [...currentPlan.reportedSessionIds, sessionId] : currentPlan.reportedSessionIds });
  };
  const afterReport = (sessionId: string) => {
    if (!reconciledPlan) return;
    fireConstructionFeedback();
    const completed = reconciledPlan.completedRounds + 1;
    const reportedSessionIds = reconciledPlan.reportedSessionIds.includes(sessionId) ? reconciledPlan.reportedSessionIds : [...reconciledPlan.reportedSessionIds, sessionId];
    if (completed >= reconciledPlan.totalRounds) {
      setPlan(null);
      return;
    }
    if (preferences.breakMinutes === 0) {
      const { breakEndsAt: _breakEndsAt, endAfterBreak: _endAfterBreak, ...withoutBreak } = reconciledPlan;
      setPlan({ ...withoutBreak, completedRounds: completed, status: 'ready', currentSessionId: undefined, reportedSessionIds });
      return;
    }
    setPlan({ ...reconciledPlan, completedRounds: completed, status: 'break', breakEndsAt: new Date(Date.now() + preferences.breakMinutes * 60000).toISOString(), currentSessionId: undefined, reportedSessionIds });
  };
  const planHostProject = reconciledPlan?.mode === 'marathon'
    ? state.projects.find((project) => project.id === reconciledPlan.projectId)
    : active.project;
  const planHostIsHabit = planHostProject?.kind === 'habit';
  const [marathonNow, setMarathonNow] = useState(Date.now());
  const marathonPlan = reconciledPlan?.mode === 'marathon';
  const isMarathonContext = marathonPlan || planMode === 'marathon';
  const focusMinutes = isMarathonContext
    ? preferences.focusMinutes
    : planHostIsHabit ? preferences.habitFocusMinutes : preferences.focusMinutes;
  useEffect(() => {
    if (!marathonPlan) return;
    const timer = window.setInterval(() => setMarathonNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [marathonPlan]);
  const marathonReportPhase = reconciledPlan?.status === 'report' && !planHostIsHabit;
  const marathonDraftEndMs = planMode === 'marathon' && !reconciledPlan ? marathonEndInstant(endAtDraft) : null;
  const marathonDraftSchedule = marathonDraftEndMs === null
    ? null
    : planRoundsForDuration(marathonDraftEndMs - Date.now(), focusMinutes, preferences.breakMinutes);
  const plannedRounds = reconciledPlan?.totalRounds ?? rounds;
  const fullPlanDurationMs = plannedDurationMs(focusMinutes, preferences.breakMinutes, plannedRounds);
  // While idle the clock shows the per-round length for the classic schedule,
  // but for a marathon it keeps counting the total time still left until the
  // chosen end instant.
  const marathonEndsAt = isMarathonContext
    ? (reconciledPlan?.endAt ?? (marathonDraftEndMs !== null ? new Date(marathonDraftEndMs).toISOString() : undefined))
    : undefined;
  const timerMode = isBreak ? 'break' : session ? 'focus' : isMarathonContext ? 'marathon' : reconciledPlan?.status === 'ready' ? 'ready' : 'plan';
  const timerEndsAt = session?.endsAt ?? (isBreak ? reconciledPlan?.breakEndsAt : (timerMode === 'marathon' ? marathonEndsAt : undefined));
  const timerFallbackMs = focusMinutes * 60_000;
  // V22 follow-up: while the locked end-time plan idles, the big timer shows the
  // remaining planned work (rounds + inter-round breaks) instead of duplicating
  // the countdown to the chosen end instant (which the plan card already shows).
  const marathonRemainingTotalMs = marathonPlan && reconciledPlan
    ? (reconciledPlan.totalRounds - reconciledPlan.completedRounds) * focusMinutes * 60_000
      + Math.max(0, reconciledPlan.totalRounds - reconciledPlan.completedRounds - 1) * preferences.breakMinutes * 60_000
    : undefined;
  const marathonSummary = marathonPlan && reconciledPlan?.endAt
    ? `结束 ${formatClockTime(reconciledPlan.endAt)} · 剩余 ${formatClockDuration(Math.max(0, Date.parse(reconciledPlan.endAt) - marathonNow))} · 约 ${reconciledPlan.totalRounds} 轮`
    : marathonDraftEndMs !== null && marathonDraftSchedule
      ? `${marathonDraftSchedule.rounds} 轮 · 结束 ${formatClockTime(marathonDraftEndMs)}`
      : '按结束时间排程';
  const planSummary = marathonPlan || planMode === 'marathon'
    ? marathonSummary
    : `${plannedRounds} 轮 · 总计 ${formatDurationSummary(fullPlanDurationMs)}`;
  const startLabel = marathonPlan && reconciledPlan?.endAt
    ? `开始到 ${formatClockTime(reconciledPlan.endAt)}`
    : planMode === 'marathon' && !reconciledPlan
      ? (marathonDraftEndMs !== null && marathonDraftSchedule ? `开始到 ${formatClockTime(marathonDraftEndMs)}` : '选择结束时间')
      : `开始 ${plannedRounds} 轮`;
  const startDisabled = planMode === 'marathon' && !reconciledPlan && !(marathonDraftEndMs !== null && marathonDraftSchedule);
  // A locked end-time plan is its own lane. Facts from whichever project is
  // currently selected must not cover or replace that lane.
  const activePendingBlocksWorkbench = pending.length > 0 && !marathonPlan;
  const activeHabitAwaitingBlocksWorkbench = habitAwaiting && !marathonPlan;

  const currentBuildingLabel = state.buildingBlueprintResources.find(resource => resource.id === active.project.blueprintId)?.displayName
    ?? active.project.importedBlueprint?.title
    ?? blueprintName(blueprintCatalog, active.project.blueprintId);

  // Android back inside the world screen dismisses its own overlays first:
  // revealed end controls, then the end-focus dialog, then the plan sheet.
  useBackLayer(Boolean(session && (controlsVisible || controlsLeaving)), () => { hideControls(); return true; });
  useBackLayer(Boolean(ending), () => { closeEnding(); return true; });
  useBackLayer(Boolean(planOpen), () => { closePlan(); return true; });

  return <div className={session ? 'world-screen is-focusing' : marathonReportPhase ? 'world-screen has-report' : activePendingBlocksWorkbench ? 'world-screen has-report' : activeHabitAwaitingBlocksWorkbench ? 'world-screen is-choosing-habit-building' : 'world-screen'}>
    <WorldCanvasV7 service={service} resourcePacks={resourcePacks} lightingQuality={preferences.lightingQuality} constructionOutlineVisibility={preferences.constructionOutlineVisibility} showWorldCoordinates={preferences.showWorldCoordinates} environmentStyle={state.worldSettings.environmentStyle} worldSeed={state.worldSettings.worldSeed} terrainGenerationVersion={state.worldSettings.terrainGenerationVersion} constructionFeedback={constructionFeedback} sessionActive={!!session} immersiveBand={immersiveBand} focusedProjectId={focusedProjectId} memoryProjectId={memoryProjectId} onSelectProject={onFocusWorldProject} onClearWorldFocus={onClearWorldFocus} onCloseMemory={onCloseWorldMemory} onContinueProject={async(projectId)=>{if(projectId!==active.project.id){const result=await run({type:'SwitchActiveProject',projectId});if(!result?.ok)return;}onCloseWorldMemory();}} switchBlockedReason={session?'结束本轮专注后才能切换任务。':pending.length>0?'先完成当前任务的进度汇报，再切换任务。':undefined} visible={visible} onPickTerrain={setPickedCell} pickedCell={pickedCell}/>
    {visible && <section ref={focusPanelRef} className="focus-panel focus-workbench-panel" onPointerUp={(event) => handlePanelTap({ target: event.target, clientX: event.clientX, clientY: event.clientY })}>
      {!session && <div className="workbench-heading">
        <h1>{marathonPlan ? '按结束时间排程' : active.project.title}</h1>
        {!marathonPlan && <button className="task-switch-action" type="button" aria-label="切换当前工作" onClick={onOpenTasks}><ListTodo/><span>切换任务</span></button>}
      </div>}
       {!session && !isBreak && !activePendingBlocksWorkbench && !activeHabitAwaitingBlocksWorkbench && !marathonReportPhase && <>
         {marathonPlan
           ? <div className="workbench-context"><span>本场安排</span><strong>按结束时间排程</strong><small>{planHostIsHabit ? `习惯轮次直接推进建筑 · 已完成 ${reconciledPlan?.completedRounds ?? 0} / ${reconciledPlan?.totalRounds ?? 1} 轮` : '本场不指定小任务，结束后统一汇报'}</small></div>
           : isHabit
             ? <div className="workbench-context"><span>当前习惯建筑 · 第 {habit!.cycleNumber} 座</span><strong>{currentBuildingLabel}</strong><small>本周期 {habit!.completedFocusSessionIds.length} / {habit!.targetRounds} 轮 · {dailySummary}</small></div>
             : <div className="workbench-context"><span>当前小任务</span><strong>{subtask!.title}</strong><small>已完成 {Math.round(subtask!.progressBasisPoints / 100)}% · {dailySummary}</small></div>}
         <button type="button" className="plan-summary" aria-label="调整本次计划" aria-expanded={planOpen} onClick={() => setPlanOpen(true)}><span>{planSummary}</span><span>调整</span></button>
       </>}
       {activeHabitAwaitingBlocksWorkbench ? <HabitBuildingSelection state={state} active={active} resourcePacks={resourcePacks} run={run} targetRounds={preferences.habitTargetRounds}/>
        : marathonReportPhase ? <MarathonProgressReport state={state} hostProjectId={reconciledPlan!.projectId} run={run} onSubmitted={() => { setPlanMode('rounds'); setPlan(null); fireConstructionFeedback(); }}/>
        : pending.length > 0 && !marathonPlan ? <ProgressReportV7 active={active} run={run} onSubmitted={afterReport}/> : <>
         {session && <div className="focus-task-context"><strong>{marathonPlan ? `马拉松 第 ${(reconciledPlan?.completedRounds ?? 0) + 1} / ${reconciledPlan?.totalRounds ?? 1} 轮` : isHabit ? active.project.title : subtask!.title}</strong></div>}
        {isBreak && <div className="rest-summary"><span>休息时间</span><strong>{marathonPlan ? `第 ${reconciledPlan?.completedRounds ?? 0} / ${reconciledPlan?.totalRounds ?? 1} 轮已结束` : (reconciledPlan?.endAfterBreak ? '小任务已完成' : '下一轮准备中')}</strong><small>{marathonPlan ? '休息结束后自动进入下一轮' : dailySummary}</small></div>}
        {(isBreak || reconciledPlan?.status === 'ready') && <div className={isBreak ? 'session-kind rest' : 'session-kind'}>{isBreak ? '放松一下，结束后会回到下一步。' : `准备第 ${reconciledPlan!.completedRounds + 1} / ${reconciledPlan!.totalRounds} 轮`}</div>}
        {(session && state.focusIntegrityPolicy.enabled && integrityNotice?.sessionId === session.id) && <div className={`${integrityNotice.count > 0 ? 'focus-integrity-warning flash active' : 'focus-integrity-warning flash'}${integrityLeaving ? ' is-leaving' : ''}`} role="status"><AlertTriangle/>有效离开 {integrityNotice.count} / {integrityNotice.max} 次</div>}
        {integrityFailure && !integrityEndedHidden && <div className={`focus-integrity-ended${integrityEndedLeaving ? ' is-leaving' : ''}`} role="alert"><AlertTriangle/>本轮专注因达到离开应用次数上限而结束。下次可以从这里继续。</div>}
         <FocusTimer mode={timerMode} endsAt={timerEndsAt} fallbackMs={timerFallbackMs} marathonRemainingMs={marathonRemainingTotalMs} onElapsed={session ? reconcile : finishBreak}/>
        {session && <div className="focus-building-progress" aria-hidden="true"><span>建筑 · {constructionStage(active.building.completionBasisPoints)}</span><strong>{Math.round(active.building.completionBasisPoints / 100)}%</strong></div>}
        {isBreak ? <button className="primary secondary-action" onClick={skipBreak}>跳过休息</button>
          : reconciledPlan?.status === 'ready' ? <button className="primary" onClick={() => void startFocus()}><Clock3/>{marathonPlan && reconciledPlan.completedRounds === 0 ? startLabel : '开始下一轮'}</button>
            : session ? <div className={`immersive-controls${controlsLeaving ? ' is-leaving' : ''}`}>{(controlsVisible || controlsLeaving)
              ? <button className="destructive primary" onClick={() => void setEnding(true)}><Square/>结束本次专注</button>
              : <p className={hintVisible ? 'immersive-hint' : 'immersive-hint is-faded'} role="status">双击下方空白处唤出结束按钮</p>}</div>
            : <button className="primary" disabled={startDisabled} onClick={() => void startFocus()}><Clock3/>{startLabel}</button>}
      </>}
    </section>}
    {ending && session && (
      <div className={endingLeaving ? 'dialog-leave' : undefined}>
        <EndFocusDialog taskTitle={planHostIsHabit ? planHostProject?.title ?? active.project.title : marathonPlan ? `马拉松 第 ${(reconciledPlan?.completedRounds ?? 0) + 1} / ${reconciledPlan?.totalRounds ?? 1} 轮` : subtask!.title} habit={planHostIsHabit} marathon={reconciledPlan?.mode === 'marathon'} isLastMarathonRound={reconciledPlan?.mode === 'marathon' && (reconciledPlan?.completedRounds ?? 0) + 1 >= (reconciledPlan?.totalRounds ?? 1)} onClose={closeEnding} onInterrupt={interruptFocus} onCompleteEarly={completeEarly}/>
      </div>
    )}
    {(planOpen || planLeaving) && !session && <div className={planLeaving ? 'dialog-leave' : undefined}>{planHostIsHabit
      ? <HabitFocusPlanSheet rounds={rounds} focusMinutes={(reconciledPlan?.mode ?? planMode) === 'marathon' ? preferences.focusMinutes : preferences.habitFocusMinutes} breakMinutes={preferences.breakMinutes} locked={Boolean(reconciledPlan)} mode={reconciledPlan?.mode ?? planMode} endAtDraft={endAtDraft} onModeChange={setPlanMode} onEndAtDraftChange={setEndAtDraft} onRoundsChange={setRounds} onClose={closePlan} onConfirm={confirmPlan} onCancelPlan={cancelPlan}/>
      : <FocusPlanSheet subtasks={active.project.subtasks} selectedId={reconciledPlan?.subtaskId ?? selected!} rounds={rounds} focusMinutes={preferences.focusMinutes} breakMinutes={preferences.breakMinutes} locked={Boolean(reconciledPlan)} mode={reconciledPlan?.mode ?? planMode} endAtDraft={endAtDraft} onModeChange={setPlanMode} onEndAtDraftChange={setEndAtDraft} onSelect={setSelected} onRoundsChange={setRounds} onClose={closePlan} onConfirm={confirmPlan} onCancelPlan={cancelPlan}/>}</div>}
  </div>;
}

function FocusPlanSheet({ subtasks, selectedId, rounds, focusMinutes, breakMinutes, locked, mode, endAtDraft, onModeChange, onEndAtDraftChange, onSelect, onRoundsChange, onClose, onConfirm, onCancelPlan }: {
  subtasks: Array<{ id: string; title: string; progressBasisPoints: number }>;
  selectedId: string;
  rounds: number;
  focusMinutes: number;
  breakMinutes: number;
  locked: boolean;
  mode: 'rounds' | 'marathon';
  endAtDraft: string;
  onModeChange: (mode: 'rounds' | 'marathon') => void;
  onEndAtDraftChange: (draft: string) => void;
  onSelect: (id: string) => void;
  onRoundsChange: (rounds: number) => void;
  onClose: () => void;
  onConfirm: () => void;
  onCancelPlan: () => Promise<void>;
}) {
  const endMs = mode === 'marathon' ? marathonEndInstant(endAtDraft) : null;
  const schedule = endMs === null ? null : planRoundsForDuration(endMs - Date.now(), focusMinutes, breakMinutes);
  const rawSchedule = endMs === null ? null : planRoundsForDuration(endMs - Date.now(), focusMinutes, breakMinutes, 1_000_000);
  const capped = schedule !== null && rawSchedule !== null && rawSchedule.rounds > schedule.rounds;
  const marathonValid = endMs !== null && schedule !== null;
  const note = locked ? ' 当前计划已开始，只能取消整个计划；取消后可重新安排。' : '';
  // Custom end-time picker (hours/minutes steppers) styled to the app, replacing
  // the native time input that would pop the system picker on Android.
  const draftMatch = /^(\d{2}):(\d{2})$/.exec(endAtDraft);
  const draftHour = draftMatch ? Number(draftMatch[1]) : 0;
  const draftMinute = draftMatch ? Number(draftMatch[2]) : 0;
  const pad2 = (value: number) => String(value).padStart(2, '0');
  const stepEndTime = (deltaMinutes: number) => {
    const total = (((draftHour * 60 + draftMinute + deltaMinutes) % 1440) + 1440) % 1440;
    onEndAtDraftChange(`${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`);
  };
  return <div className="dialog-backdrop plan-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="focus-plan-sheet" role="dialog" aria-modal="true" aria-labelledby="focus-plan-title">
      <div className="sheet-heading"><div><span className="eyebrow">本次计划</span><h2 id="focus-plan-title">安排下一轮</h2></div><button type="button" className="dialog-close" aria-label="关闭本次计划" onClick={onClose}><X/></button></div>
      <div className="plan-mode" role="group" aria-label="排程方式">
        <button type="button" aria-pressed={mode === 'rounds'} disabled={locked} onClick={() => onModeChange('rounds')}>固定轮次</button>
        <button type="button" aria-pressed={mode === 'marathon'} disabled={locked} onClick={() => onModeChange('marathon')}>按结束时间</button>
      </div>
      {mode === 'rounds' ? <>
        <ChoiceMenu label="本次专注" value={selectedId} disabled={locked} onChange={onSelect} options={subtasks.map((subtask) => ({ id: subtask.id, label: subtask.title, detail: `已完成 ${Math.round(subtask.progressBasisPoints / 100)}%` }))}/>
        <div className="round-picker" aria-label="专注轮数"><span>计划轮数</span><div>{[1, 2, 3, 4].map((value) => <button key={value} type="button" aria-pressed={rounds === value} disabled={locked} onClick={() => onRoundsChange(value)}>{value} 轮</button>)}</div></div>
        <p className="plan-sheet-note">每轮 {focusMinutes} 分钟专注{breakMinutes > 0 ? `；多轮之间休息 ${breakMinutes} 分钟。` : '；休息已关闭。'}{note}</p>
      </> : <>
        <div className="marathon-end-picker" role="group" aria-label="结束时间">
          <div className="time-stepper"><span>时</span><button type="button" aria-label="减少结束小时" disabled={locked} onClick={() => stepEndTime(-60)}>−</button><strong aria-label="结束小时">{pad2(draftHour)}</strong><button type="button" aria-label="增加结束小时" disabled={locked} onClick={() => stepEndTime(60)}>+</button></div>
          <span className="time-colon" aria-hidden="true">:</span>
          <div className="time-stepper"><span>分</span><button type="button" aria-label="减少结束分钟" disabled={locked} onClick={() => stepEndTime(-5)}>−</button><strong aria-label="结束分钟">{pad2(draftMinute)}</strong><button type="button" aria-label="增加结束分钟" disabled={locked} onClick={() => stepEndTime(5)}>+</button></div>
        </div>
        {endMs === null
          ? <p className="plan-sheet-error">请先选择结束时间。</p>
          : schedule === null
            ? <p className="plan-sheet-error">从现在到 {formatClockTime(endMs)} 不足一轮专注（{focusMinutes} 分钟），请选择更晚的时间。</p>
            : <p className="plan-sheet-note">到 {formatClockTime(endMs)} 共约 {Math.max(1, Math.round((endMs - Date.now()) / 60000))} 分钟：安排 {schedule.rounds} 轮专注{schedule.breaks > 0 ? `、${schedule.breaks} 次休息` : ''}，全部结束后再统一汇报推进了哪些小任务。{capped ? `时间超过上限 ${MAX_MARATHON_ROUNDS} 轮，按前 ${schedule.rounds} 轮（约 ${formatDurationSummary(schedule.usableMs)}）排程。` : ''}{note}</p>}
      </>}
      <button type="button" className={locked ? 'primary destructive' : 'primary'} disabled={!locked && mode === 'marathon' && !marathonValid} onClick={locked ? () => void onCancelPlan() : onConfirm}>{locked ? '取消计划' : '确认计划'}</button>
    </section>
  </div>;
}

function HabitFocusPlanSheet({ rounds, focusMinutes, breakMinutes, locked, mode, endAtDraft, onModeChange, onEndAtDraftChange, onRoundsChange, onClose, onConfirm, onCancelPlan }: {
  rounds: number;
  focusMinutes: number;
  breakMinutes: number;
  locked: boolean;
  mode: 'rounds' | 'marathon';
  endAtDraft: string;
  onModeChange: (mode: 'rounds' | 'marathon') => void;
  onEndAtDraftChange: (draft: string) => void;
  onRoundsChange: (rounds: number) => void;
  onClose: () => void;
  onConfirm: () => void;
  onCancelPlan: () => void;
}) {
  const endMs = mode === 'marathon' ? marathonEndInstant(endAtDraft) : null;
  const schedule = endMs === null ? null : planRoundsForDuration(endMs - Date.now(), focusMinutes, breakMinutes);
  const rawSchedule = endMs === null ? null : planRoundsForDuration(endMs - Date.now(), focusMinutes, breakMinutes, 1_000_000);
  const capped = schedule !== null && rawSchedule !== null && rawSchedule.rounds > schedule.rounds;
  const marathonValid = endMs !== null && schedule !== null;
  const draftMatch = /^(\d{2}):(\d{2})$/.exec(endAtDraft);
  const draftHour = draftMatch ? Number(draftMatch[1]) : 0;
  const draftMinute = draftMatch ? Number(draftMatch[2]) : 0;
  const pad2 = (value: number) => String(value).padStart(2, '0');
  const stepEndTime = (deltaMinutes: number) => {
    const total = (((draftHour * 60 + draftMinute + deltaMinutes) % 1440) + 1440) % 1440;
    onEndAtDraftChange(`${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`);
  };
  const note = locked ? ' 当前计划已开始，只能取消整个计划；取消后可重新安排。' : '';
  return <div className="dialog-backdrop plan-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="focus-plan-sheet" role="dialog" aria-modal="true" aria-labelledby="habit-focus-plan-title">
      <div className="sheet-heading"><div><span className="eyebrow">本次计划</span><h2 id="habit-focus-plan-title">安排习惯专注</h2></div><button type="button" className="dialog-close" aria-label="关闭本次计划" onClick={onClose}><X/></button></div>
      <div className="plan-mode" role="group" aria-label="排程方式">
        <button type="button" aria-pressed={mode === 'rounds'} disabled={locked} onClick={() => onModeChange('rounds')}>固定轮次</button>
        <button type="button" aria-pressed={mode === 'marathon'} disabled={locked} onClick={() => onModeChange('marathon')}>按结束时间</button>
      </div>
      {mode === 'rounds' ? <>
        <div className="round-picker" aria-label="习惯专注轮数"><span>计划轮数</span><div>{[1, 2, 3, 4].map((value) => <button key={value} type="button" aria-pressed={rounds === value} disabled={locked} onClick={() => onRoundsChange(value)}>{value} 轮</button>)}</div></div>
        <p className="plan-sheet-note">每轮 {focusMinutes} 分钟专注{breakMinutes > 0 ? `；多轮之间休息 ${breakMinutes} 分钟。` : '；休息已关闭。'}每个完成或提前完成的轮次都会推进当前建筑。{note}</p>
      </> : <>
        <div className="marathon-end-picker" role="group" aria-label="结束时间">
          <div className="time-stepper"><span>时</span><button type="button" aria-label="减少结束小时" disabled={locked} onClick={() => stepEndTime(-60)}>−</button><strong aria-label="结束小时">{pad2(draftHour)}</strong><button type="button" aria-label="增加结束小时" disabled={locked} onClick={() => stepEndTime(60)}>+</button></div>
          <span className="time-colon" aria-hidden="true">:</span>
          <div className="time-stepper"><span>分</span><button type="button" aria-label="减少结束分钟" disabled={locked} onClick={() => stepEndTime(-5)}>−</button><strong aria-label="结束分钟">{pad2(draftMinute)}</strong><button type="button" aria-label="增加结束分钟" disabled={locked} onClick={() => stepEndTime(5)}>+</button></div>
        </div>
        {endMs === null
          ? <p className="plan-sheet-error">请先选择结束时间。</p>
          : schedule === null
            ? <p className="plan-sheet-error">从现在到 {formatClockTime(endMs)} 不足一轮习惯专注（{focusMinutes} 分钟），请选择更晚的时间。</p>
            : <p className="plan-sheet-note">到 {formatClockTime(endMs)} 共约 {Math.max(1, Math.round((endMs - Date.now()) / 60000))} 分钟：以普通任务设置的 {focusMinutes} 分钟为一轮，安排 {schedule.rounds} 轮习惯专注{schedule.breaks > 0 ? `、${schedule.breaks} 次休息` : ''}。每轮完成后直接推进当前建筑，结束后不进入普通任务的统一汇报。{capped ? `时间超过上限 ${MAX_MARATHON_ROUNDS} 轮，按前 ${schedule.rounds} 轮（约 ${formatDurationSummary(schedule.usableMs)}）排程。` : ''}{note}</p>}
      </>}
      <button type="button" className={locked ? 'primary destructive' : 'primary'} disabled={!locked && mode === 'marathon' && !marathonValid} onClick={locked ? onCancelPlan : onConfirm}>{locked ? '取消计划' : '确认计划'}</button>
    </section>
  </div>;
}

function HabitBuildingSelection({ state, active, resourcePacks, run, targetRounds }: {
  state: ReturnType<ApplicationService['snapshot']>;
  active: NonNullable<ReturnType<ApplicationService['activeProjectProjection']>>;
  resourcePacks: ResourcePackRepository;
  run: (command: ApplicationCommand) => Promise<any>;
  targetRounds: number;
}) {
  const catalog = useBlueprintCatalog();
  const libraryEntries: BlueprintCatalogEntry[] = state.buildingBlueprintResources.map((resource) => ({
    id: resource.id,
    displayName: resource.displayName,
    description: `本地建筑蓝图 · ${new Date(resource.importedAt).toLocaleDateString('zh-CN')} 导入`,
    footprint: { width: resource.blueprint.bounds.maxX - resource.blueprint.bounds.minX + 1, depth: resource.blueprint.bounds.maxZ - resource.blueprint.bounds.minZ + 1 },
    complexity: resource.blueprint.voxels.length > 3000 ? 'detailed' : 'moderate',
    blueprint: resource.blueprint as BlueprintV1,
  }));
  const options = [...catalog, ...libraryEntries];
  const [selectedId, setSelectedId] = useState<string>('');
  const [pending, setPending] = useState(false);
  const selected = options.find((option) => option.id === selectedId) ?? options[0];
  const completedCount = state.habitBuildings.filter((building) => building.habitProjectId === active.project.id).length;
  const choose = async () => {
    if (!selected || pending) return;
    setPending(true);
    try {
      await run({
        type: 'SelectNextHabitBuilding',
        blueprintId: selected.id,
        importedBlueprint: selected.blueprint.id.startsWith('builtin-') ? null : toImportedBlueprint(selected.blueprint),
        targetRounds,
      });
    } finally {
      setPending(false);
    }
  };
  if (!selected) return <div className="blueprint-loading" role="status">正在准备建筑预览...</div>;
  return <div className="habit-building-selection">
    <div className="habit-selection-heading"><span className="eyebrow">上一座已完成</span><h2>选择第 {active.project.habit!.cycleNumber} 座建筑</h2><p>已留下 {completedCount} 座建筑；下一座需要 {targetRounds} 轮专注。确认后，本周期内不能更换。</p></div>
    <BlueprintPicker resourcePacks={resourcePacks} options={options} selected={selected} onSelect={setSelectedId}/>
    <button type="button" className="primary habit-building-confirm" disabled={pending} onClick={() => void choose()}><Hammer/>{pending ? '正在确定...' : '开始建造这座建筑'}</button>
  </div>;
}

function ProgressReportV7({active,run,onSubmitted}:{active:NonNullable<ReturnType<ApplicationService['activeProjectProjection']>>;run:(c:ApplicationCommand)=>Promise<any>;onSubmitted:(sessionId:string)=>void}) {
  const session=active.unreportedCompletedSessions[0]!;
  const task=active.project.subtasks.find((subtask)=>subtask.id===session.subtaskId)!;
  const options=[task.progressBasisPoints,2500,5000,7500,10000].filter((value,index,all)=>value>=task.progressBasisPoints&&all.indexOf(value)===index);
  const submit=async(value:number)=>{const result=await run({type:'ReportSubtaskProgress',subtaskId:task.id,focusSessionIds:[session.id],progressBasisPoints:value});if(result?.ok)onSubmitted(session.id);};
  return <div className="report progress-report-panel"><Check/><span className="eyebrow">本轮已记录</span><h2>这次工作推进到哪里？</h2><p><strong>{task.title}</strong><br/>当前总进度 {Math.round(task.progressBasisPoints/100)}%。提交后会更新建筑的永久施工阶段。</p><div className="report-options">{options.map((value)=><button key={value} onClick={()=>void submit(value)}>{value===task.progressBasisPoints?`保持 ${value/100}%`:value===10000?'完成小任务':`推进至 ${value/100}%`}</button>)}</div></div>;
}

// V22 marathon settlement report: after every scheduled round (or when the
// locked plan is cancelled) the user attributes the completed rounds across ALL
// projects at once. Habit buildings may take the first K rounds via steppers
// (earliest rounds first); the remaining N-K rounds form one block shared by
// every chosen subtask. One combined command applies everything atomically.
/**
 * A completed marathon round is settled once it has been consumed by a progress
 * report, a habit building, or an explicit settlement — it must never be offered
 * to a later settlement again. V23: this is what lets a "confirm then cancel"
 * plan return straight to the classic lane even after earlier rounds were
 * allocated to habits (the old code re-surfaced them as if unreported).
 */
function marathonRoundSettled(state: ReturnType<ApplicationService['snapshot']>, sessionId: string): boolean {
  return state.progressReports.some((report) => report.focusSessionIds.includes(sessionId))
    || state.habitBuildings.some((building) => building.focusSessionIds.includes(sessionId))
    || state.projects.some((project) => project.kind === 'habit' && project.habit !== null && project.habit.completedFocusSessionIds.includes(sessionId));
}

function MarathonProgressReport({ state, hostProjectId, run, onSubmitted }: {
  state: ReturnType<ApplicationService['snapshot']>;
  hostProjectId: string;
  run: (command: ApplicationCommand) => Promise<any>;
  onSubmitted: () => void;
}) {
  const reported = new Set(state.progressReports.flatMap((report) => report.focusSessionIds));
  // Every round of this plan that still awaits settlement — completed or
  // early-completed marathon rounds that neither a previous settlement nor an
  // automatic report has consumed. Rounds settled by older versions are not
  // offered again, so the total shown is exactly the distributable pool.
  const sessions = state.focusHistory.filter((item) =>
    item.projectId === hostProjectId && (item.status === 'completed' || item.status === 'completed-early') && item.marathon === true
      && !reported.has(item.id) && item.settledAt === undefined && !marathonRoundSettled(state, item.id));
  const totalRounds = sessions.length;
  const projects = state.projects.filter((project) =>
    project.status !== 'deleted' && project.kind === 'finite' && project.subtasks.some((subtask) => subtask.progressBasisPoints < 10000));
  const habits = state.projects.filter((project) =>
    project.status !== 'deleted' && project.kind === 'habit' && project.habit !== null && !project.habit.awaitingNextBuilding);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [habitRounds, setHabitRounds] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const toggleProject = (projectId: string) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    return next;
  });
  const subtaskProject = new Map<string, string>();
  const subtaskCurrent = new Map<string, number>();
  for (const project of projects) {
    for (const subtask of project.subtasks) {
      subtaskProject.set(subtask.id, project.id);
      subtaskCurrent.set(subtask.id, subtask.progressBasisPoints);
    }
  }
  const ownHabitMax = (project: typeof habits[number]): number => {
    const habit = project.habit!;
    return Math.max(0, Math.min(totalRounds, habit.targetRounds - habit.completedFocusSessionIds.length));
  };
  const allocatedRounds = Object.values(habitRounds).reduce((sum, value) => sum + value, 0);
  const expandHabit = (projectId: string) => {
    if (!expanded.has(projectId)) {
      const next = new Set(expanded);
      next.add(projectId);
      setExpanded(next);
    } else {
      const next = new Set(expanded);
      next.delete(projectId);
      setExpanded(next);
    }
  };
  const stepHabit = (projectId: string, delta: number) => {
    const project = habits.find((item) => item.id === projectId);
    if (!project) return;
    const current = habitRounds[projectId] ?? 0;
    const others = allocatedRounds - current;
    const max = Math.max(0, Math.min(ownHabitMax(project), totalRounds - others));
    const nextValue = Math.max(0, Math.min(max, current + delta));
    setHabitRounds((previous) => {
      const next = { ...previous };
      if (nextValue === 0) delete next[projectId];
      else next[projectId] = nextValue;
      return next;
    });
  };
  const optionsFor = (current: number) =>
    [current, 2500, 5000, 7500, 10000].filter((value, index, all) => value >= current && all.indexOf(value) === index);
  const canPickSubtasks = allocatedRounds < totalRounds;
  const entries = Object.entries(choices)
    .map(([subtaskId, progressBasisPoints]) => ({
      projectId: subtaskProject.get(subtaskId) ?? '',
      subtaskId,
      progressBasisPoints,
    }))
    .filter((entry) => entry.projectId !== '' && entry.progressBasisPoints > (subtaskCurrent.get(entry.subtaskId) ?? 0));
  const hasTargets = projects.length > 0 || habits.length > 0;
  // V23: submitting with nothing allocated is valid — the remaining rounds (or
  // all rounds) are simply discarded instead of attributed to any task.
  const canSubmit = !busy;
  const submit = async () => {
    if (busy) return;
    if (totalRounds === 0 || !hasTargets) {
      onSubmitted();
      return;
    }
    setBusy(true);
    try {
      const habitAllocations = Object.entries(habitRounds)
        .map(([projectId, rounds]) => ({ projectId, rounds }))
        .filter((entry) => entry.rounds > 0);
      const result = await run({
        type: 'ReportMarathonFocus',
        entries,
        habitAllocations,
        focusSessionIds: sessions.map((session) => session.id),
      });
      if (!result?.ok) return;
    } finally {
      setBusy(false);
    }
    onSubmitted();
  };
  return <div className="report progress-report-panel marathon-progress-report">
    <Check/>
    <span className="eyebrow">{totalRounds} 轮专注已结束</span>
    <h2>把这次推进汇报给哪些任务？</h2>
    <p>展开任务选择要推进的小任务；习惯任务可以计入部分轮次（从最早完成的一轮开始）。剩余轮次会同时计入所有勾选的小任务；没有勾选的任务轮次将直接丢弃，最后统一提交。</p>
    {totalRounds === 0
      ? <p className="plan-sheet-note">这次没有需要汇报的轮次，直接结束计划即可。</p>
      : !hasTargets
        ? <p className="plan-sheet-note">没有可推进的任务：所有小任务都已完成，习惯建筑也都在等待选择下一座。直接结束计划即可。</p>
        : <div className="marathon-settlement-list">
            {habits.map((project) => {
              const habit = project.habit!;
              const rounds = habitRounds[project.id] ?? 0;
              return <section className="marathon-settlement-card" key={project.id}>
                <button type="button" className="marathon-settlement-head" aria-expanded={expanded.has(project.id)} onClick={() => expandHabit(project.id)}>
                  <span className="marathon-settlement-copy"><strong>{project.title}</strong><small>习惯 · 第 {habit.cycleNumber} 座建筑 · {habit.completedFocusSessionIds.length} / {habit.targetRounds} 轮</small></span>
                  <span className="marathon-settlement-toggle">{expanded.has(project.id) ? '收起' : '计入轮数'}</span>
                </button>
                {expanded.has(project.id) && <div className="marathon-settlement-body">
                  <div className="time-stepper habit-round-stepper"><span>计入</span><button type="button" aria-label="减少计入轮数" disabled={busy || rounds === 0} onClick={() => stepHabit(project.id, -1)}>−</button><strong aria-label="计入轮数">{rounds}</strong><button type="button" aria-label="增加计入轮数" disabled={busy || rounds >= Math.min(ownHabitMax(project), totalRounds - (allocatedRounds - rounds))} onClick={() => stepHabit(project.id, 1)}>+</button><span>轮</span></div>
                  <small>{allocatedRounds >= totalRounds ? '全部轮次已计入习惯建筑' : `计入后剩余 ${totalRounds - allocatedRounds} 轮可分配给小任务`}</small>
                </div>}
              </section>;
            })}
            {projects.map((project) => (
              <section className="marathon-settlement-card" key={project.id}>
                <button type="button" className="marathon-settlement-head" aria-expanded={expanded.has(project.id)} onClick={() => toggleProject(project.id)}>
                  <span className="marathon-settlement-copy"><strong>{project.title}</strong><small>{Math.round(project.subtasks.reduce((sum, subtask) => sum + subtask.progressBasisPoints, 0) / project.subtasks.length / 100)}% 总进度</small></span>
                  <span className="marathon-settlement-toggle">{expanded.has(project.id) ? '收起' : '展开'}</span>
                </button>
                {expanded.has(project.id) && <div className="marathon-settlement-body">
                  {project.subtasks.filter((subtask) => subtask.progressBasisPoints < 10000).map((subtask) => {
                    const current = subtask.progressBasisPoints;
                    const chosen = choices[subtask.id] ?? current;
                    return <div className="marathon-report-row" key={subtask.id}>
                      <div className="marathon-report-copy"><strong>{subtask.title}</strong><small>当前 {Math.round(current / 100)}%（{Math.round(current / 100) === 0 ? '尚未推进' : '已有建筑进度'}）</small></div>
                      <div className="marathon-report-options">{optionsFor(current).map((value) => (
                        <button key={value} type="button" aria-pressed={chosen === value} disabled={busy || !canPickSubtasks} onClick={() => setChoices((previous) => {
                          const next = { ...previous };
                          if (value === current) delete next[subtask.id];
                          else next[subtask.id] = value;
                          return next;
                        })}>{value === current ? `保持 ${value / 100}%` : value === 10000 ? '完成' : `推进至 ${value / 100}%`}</button>
                      ))}</div>
                    </div>;
                  })}
                </div>}
              </section>
            ))}
          </div>}
    {totalRounds > 0 && allocatedRounds === totalRounds && <p className="plan-sheet-note">全部轮次已计入习惯建筑，不能再勾选小任务。</p>}
    {totalRounds > 0 && hasTargets && allocatedRounds < totalRounds && entries.length === 0 && <p className="plan-sheet-note">还有 {totalRounds - allocatedRounds} 轮未分配，可直接提交丢弃这些轮次，或展开任务选择小任务推进。</p>}
    <button type="button" className="primary marathon-report-submit" disabled={busy || (totalRounds > 0 && hasTargets && !canSubmit)} onClick={() => void submit()}>{totalRounds > 0 && hasTargets ? '提交本次推进' : '直接结束计划'}</button>
  </div>;
}

const WorldCanvasV7 = memo(function WorldCanvasV7({service,resourcePacks,lightingQuality,constructionOutlineVisibility,showWorldCoordinates,environmentStyle,worldSeed,terrainGenerationVersion,constructionFeedback=0,sessionActive=false,immersiveBand={bottom:0,right:0},focusedProjectId,memoryProjectId,onSelectProject,onClearWorldFocus,onCloseMemory,onContinueProject,switchBlockedReason,visible,onPickTerrain,pickedCell}:{service:ApplicationService;resourcePacks:ResourcePackRepository;lightingQuality:VoxelLightingQuality;constructionOutlineVisibility:ConstructionOutlineVisibility;showWorldCoordinates:boolean;environmentStyle:WorldEnvironmentStyle;worldSeed:string;terrainGenerationVersion:4;constructionFeedback?:number;sessionActive?:boolean;immersiveBand?:{bottom:number;right:number};focusedProjectId:string|null;memoryProjectId:string|null;onSelectProject:(projectId:string)=>void;onClearWorldFocus:()=>void;onCloseMemory:()=>void;onContinueProject:(projectId:string)=>Promise<void>;switchBlockedReason?:string;visible:boolean;onPickTerrain:(position:{x:number;y:number;z:number})=>void;pickedCell:{x:number;y:number;z:number}|null}) {
  const ref=useRef<HTMLCanvasElement>(null); const renderer=useRef<VoxelRenderer|null>(null); const catalog=useBlueprintCatalog(); const world=service.worldProjection(); const state=service.snapshot(); const importedRef=useRef(new Map<string,BlueprintV1>()); const focusRef=useRef(focusedProjectId); const selectRef=useRef(onSelectProject); const visibleRef=useRef(visible); const appliedPackRef=useRef<string|null|undefined>(undefined); const sessionActiveRef=useRef(sessionActive); const pickEnabledRef=useRef(false); const pickTerrainRef=useRef(onPickTerrain); const [ready,setReady]=useState(false);
  const immersiveBandRef=useRef(immersiveBand); immersiveBandRef.current=immersiveBand;
  // V21 top-right HUD reveal: one shared control governs both the immersive
  // view controls and the ordinary world HUD. Tapping the corner shows them,
  // then they auto-hide after 5 s with the same fade as the other conditional
  // controls. The ordinary workbench starts with the HUD visible and only hides
  // once toggled, so casual use keeps the settlement label.
  const [viewControlsVisible,setViewControlsVisible]=useState(true);
  const [viewControlsLeaving,setViewControlsLeaving]=useState(false);
  const viewHideTimerRef=useRef<number|null>(null);
  const lastViewToggleRef=useRef(0);
  const viewRevealedAtRef=useRef(0);
  const prevSessionActiveRef=useRef(sessionActive);
  useEffect(()=>{
    if(prevSessionActiveRef.current===sessionActive)return;
    prevSessionActiveRef.current=sessionActive;
    if(viewHideTimerRef.current!==null)window.clearTimeout(viewHideTimerRef.current);
    viewHideTimerRef.current=null;
    lastViewToggleRef.current=0;
    setViewControlsLeaving(false);
    // During focus the control stays hidden until the corner is tapped; back on
    // the idle workbench the settlement HUD is visible again.
    setViewControlsVisible(!sessionActive);
  },[sessionActive]);
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
  useEffect(()=>{let cancelled=false;let current:VoxelRenderer|null=null;setReady(false);let raf=0;let timer=0;const markReady=()=>setReady(true);const begin=()=>{void loadVoxelModule().then(async({createVoxelRenderer,resolveBuiltinBlueprint})=>{if(cancelled||!ref.current)return;current=createVoxelRenderer(ref.current,{resolveBlueprint:id=>importedRef.current.get(id)??resolveBuiltinBlueprint(id),resourcePackAtlasMaximumSize:resourcePackAtlasMaximumSizeForTest(),lightingQuality,constructionOutlineVisibility,environmentStyle,worldSeed,terrainGenerationVersion,onSelectProject:projectId=>selectRef.current(projectId),onPickTerrain:position=>{if(pickEnabledRef.current)pickTerrainRef.current(position);},debugFlatColors:new URLSearchParams(location.search).has('flat'),debugVoidScan:new URLSearchParams(location.search).has('voidscan')});renderer.current=current;current.setReducedMotion(matchMedia('(prefers-reduced-motion: reduce)').matches);current.setVisible(visibleRef.current);current.setImmersiveBandFraction(immersiveBandRef.current.bottom??0,immersiveBandRef.current.right??0);current.setWorlds(toVoxelWorlds(service.worldProjection().projects,service.snapshot()));current.focusProject(focusRef.current);const pack=await resourcePacks.getActive();appliedPackRef.current=pack?`${pack.id}:${pack.manifest.pack.packFormat}`:null;if(!cancelled&&current)await current.setResourcePack(pack?{id:pack.id,manifest:pack.manifest}:null);if(!cancelled)markReady();}).catch(error=>{console.error('Voxel world initialization failed',error);if(!cancelled)markReady();});};raf=requestAnimationFrame(()=>{timer=window.setTimeout(begin,0);});return()=>{cancelled=true;cancelAnimationFrame(raf);window.clearTimeout(timer);current?.dispose();if(renderer.current===current)renderer.current=null;};},[service,resourcePacks,lightingQuality,constructionOutlineVisibility,environmentStyle,worldSeed,terrainGenerationVersion]);
  useEffect(()=>{renderer.current?.setVisible(visible);},[visible]);
  // IF-01: bounded construction pulses — round completed (stronger) and focus started (gentle).
  useEffect(()=>{if(constructionFeedback>0)renderer.current?.playConstructionPulse(1);},[constructionFeedback]);
  useEffect(()=>{const previous=sessionActiveRef.current;sessionActiveRef.current=sessionActive;if(sessionActive&&!previous)renderer.current?.playConstructionPulse(0.6);},[sessionActive]);
  useEffect(()=>{renderer.current?.setImmersiveBandFraction(immersiveBandRef.current.bottom??0,immersiveBandRef.current.right??0);},[immersiveBand?.bottom,immersiveBand?.right]);
  // MT-02: with the renderer resident, the pack switched in settings must apply when the pane returns; re-apply only when the active pack actually changed.
  useEffect(()=>{if(!visible)return;let cancelled=false;void resourcePacks.getActive().then(pack=>{if(cancelled||!renderer.current)return;const key=pack?`${pack.id}:${pack.manifest.pack.packFormat}`:null;if(appliedPackRef.current===key)return;appliedPackRef.current=key;void renderer.current!.setResourcePack(pack?{id:pack.id,manifest:pack.manifest}:null).then(()=>{if(!cancelled)renderer.current?.setVisible(true);});});return()=>{cancelled=true;};},[visible,resourcePacks]);
  useEffect(()=>{renderer.current?.setWorlds(snapshots);},[snapshots]);
  useEffect(()=>{renderer.current?.focusProject(focusedProjectId);},[focusedProjectId]);
  const memoryProject=world.projects.find(project=>project.project.id===memoryProjectId);
  const memory=memoryProject?createBuildingMemory(state,memoryProject,blueprintLabel(memoryProject.building.blueprintId,memoryProject.building.importedBlueprint?.title)):null;
  return <><figure className={focusedProjectId?'world is-project-focused':'world'}><canvas ref={ref} role="img" aria-label="项目建筑世界" aria-describedby="world-summary" data-coordinate-picking={pickEnabled?'true':'false'}/>{visible&&<div className="world-hud-tapzone" aria-hidden="true" onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>{event.stopPropagation();toggleViewControls();}}/>}{visible&&sessionActive&&(viewControlsVisible||viewControlsLeaving)&&<div className={`immersive-view-controls${viewControlsLeaving?' is-leaving':''}`}>{focusedProjectId&&<button type="button" className="immersive-reset-view" aria-label="重置地图" title="重置地图" onClick={()=>runViewAction(onClearWorldFocus)}><MapIcon/></button>}<button type="button" className="immersive-reset-view" aria-label="重置视角" title="重置视角" onClick={()=>runViewAction(()=>renderer.current?.resetCamera())}><RotateCcw/></button></div>}{visible&&<figcaption id="world-summary" className="sr-only">林边聚落，共 {world.projects.length} 栋建筑。{summary}</figcaption>}{visible&&!sessionActive&&<nav className="world-building-index" aria-label="聚落建筑">{world.projects.map(project=><button key={project.project.id} type="button" onClick={()=>onSelectProject(project.project.id)}>查看建筑记忆：{project.project.title}</button>)}</nav>}{visible&&pickEnabled&&pickedCell&&<div className="world-pick-chip" role="status" data-testid="world-pick">x {pickedCell.x} · z {pickedCell.z} · 高 {pickedCell.y}</div>}{visible&&!sessionActive&&(viewControlsVisible||viewControlsLeaving)&&<div className={`world-hud${viewControlsLeaving?' is-leaving':''}`}><span>{focusedTitle?`正在查看 · ${focusedTitle}`:`林边聚落 · ${world.projects.length} 栋`}</span><div className="world-hud-actions">{focusedProjectId&&<button title="重置地图" aria-label="重置地图" onClick={()=>runViewAction(onClearWorldFocus)}><MapIcon/></button>}<button title="重置视角" aria-label="重置视角" onClick={()=>runViewAction(()=>renderer.current?.resetCamera())}><RotateCcw/></button></div></div>}{visible&&constructionFeedback>0&&<div key={constructionFeedback} className="construction-feedback" role="status"><Hammer/><span>材料已送达，继续建造</span><i/><i/><i/></div>}</figure>{visible&&!sessionActive&&memory&&<BuildingMemoryPanel memory={memory} switchBlockedReason={memory.isActive?undefined:switchBlockedReason} onClose={onCloseMemory} onContinue={()=>void onContinueProject(memory.projectId)}/>} {!ready&&<LoadingPage status="正在建造世界…"/>}</>;
});

type FocusTimerMode = 'plan' | 'focus' | 'break' | 'ready' | 'marathon';

function FocusTimer({ mode, endsAt, fallbackMs, marathonRemainingMs, onElapsed }: { mode?: FocusTimerMode; endsAt?: string; fallbackMs: number; marathonRemainingMs?: number; onElapsed: () => void }) {
  const [now, setNow] = useState(Date.now());
  const elapsed = useRef(false);
  useEffect(() => {
    if (!endsAt) return;
    elapsed.current = false;
    const tick = () => {
      const next = Date.now();
      setNow(next);
      if (next >= Date.parse(endsAt) && !elapsed.current) {
        elapsed.current = true;
        onElapsed();
      }
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [endsAt, onElapsed]);
  const remaining = endsAt ? Math.max(0, Date.parse(endsAt) - now) : fallbackMs;
  const timerMode = mode ?? (endsAt ? 'focus' : 'ready');
  const displayMs = timerMode === 'marathon' && marathonRemainingMs !== undefined ? marathonRemainingMs : remaining;
  const label = timerMode === 'plan' ? '每轮时长' : timerMode === 'break' ? '休息剩余' : timerMode === 'ready' ? '下一轮时长' : timerMode === 'marathon' ? (marathonRemainingMs !== undefined ? '剩余总时长' : '距结束') : '本轮剩余';
  const clock = formatClockDuration(displayMs);
  return <div className={`timer timer-${timerMode}`} role={endsAt ? 'timer' : undefined} aria-label={`${label} ${clock}`}>
    <span className="timer-label">{label}</span>
    <strong className="timer-value" aria-hidden="true">{clock}</strong>
  </div>;
}

function formatClockDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

function formatDurationSummary(milliseconds: number): string {
  const totalMinutes = Math.round(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} 分钟`;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}

function formatClockTime(value: string | number): string {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const nextDay = date.getFullYear() === tomorrow.getFullYear() && date.getMonth() === tomorrow.getMonth() && date.getDate() === tomorrow.getDate();
  const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  if (sameDay) return time;
  if (nextDay) return `明天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

/** Interprets an HH:MM draft as today's clock time, rolling into tomorrow when it already passed. */
function marathonEndInstant(draft: string, now = Date.now()): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(draft);
  if (!match) return null;
  const target = new Date(now);
  target.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (!Number.isFinite(target.getTime())) return null;
  if (target.getTime() <= now) target.setDate(target.getDate() + 1);
  return target.getTime();
}

const WorldCanvas = memo(function WorldCanvas({service,resourcePacks,lightingQuality,constructionOutlineVisibility,constructionFeedback=0}:{service:ApplicationService;resourcePacks:ResourcePackRepository;lightingQuality:VoxelLightingQuality;constructionOutlineVisibility:ConstructionOutlineVisibility;constructionFeedback?:number}) {
  const ref=useRef<HTMLCanvasElement>(null); const renderer=useRef<VoxelRenderer|null>(null); const catalog=useBlueprintCatalog(); const world=service.worldProjection(); const state=service.snapshot(); const importedRef=useRef(new Map<string,BlueprintV1>()); importedRef.current=new Map(world.projects.flatMap(project=>project.building.importedBlueprint?[[project.building.blueprintId,project.building.importedBlueprint as BlueprintV1]]:[])); const decorationDates=decorationDatesByProject(state); const snapshotKey=world.projects.map(project=>`${project.project.id}:${project.building.blueprintId}:${project.building.completionBasisPoints}:${project.building.conditionBasisPoints}:${project.isActive}:${project.settlementIndex}:${(decorationDates.get(project.project.id)??[]).join(',')}:${project.importedDecorations.map(reward=>`${reward.rewardId}@${reward.localPosition.x},${reward.localPosition.z},${reward.rotationQuarterTurns}`).join(';')}`).join('|'); const snapshots=useMemo(()=>toVoxelWorlds(world.projects,state),[snapshotKey]); const summary=world.projects.map(project=>`${project.project.title}，${project.building.importedBlueprint?.title??blueprintName(catalog,project.building.blueprintId)}，${project.isActive?'正在建造':project.project.status==='paused'?'暂停建造':'纪念建筑'}，建造进度 ${Math.round(project.building.completionBasisPoints/100)}%，保存状况 ${conditionLabel(project.building.conditionBasisPoints)}`).join('；');
  useEffect(()=>{let cancelled=false;let current:VoxelRenderer|null=null;void loadVoxelModule().then(async({createVoxelRenderer,resolveBuiltinBlueprint})=>{if(cancelled||!ref.current)return;const snapshot=service.snapshot();current=createVoxelRenderer(ref.current,{resolveBlueprint:id=>importedRef.current.get(id)??resolveBuiltinBlueprint(id),resourcePackAtlasMaximumSize:resourcePackAtlasMaximumSizeForTest(),lightingQuality,constructionOutlineVisibility,environmentStyle:snapshot.worldSettings.environmentStyle,worldSeed:snapshot.worldSettings.worldSeed,terrainGenerationVersion:snapshot.worldSettings.terrainGenerationVersion,debugFlatColors:new URLSearchParams(location.search).has('flat'),debugVoidScan:new URLSearchParams(location.search).has('voidscan')});renderer.current=current;current.setReducedMotion(matchMedia('(prefers-reduced-motion: reduce)').matches);current.setWorlds(toVoxelWorlds(service.worldProjection().projects,snapshot));const pack=await resourcePacks.getActive();if(!cancelled&&current)await current.setResourcePack(pack?{id:pack.id,manifest:pack.manifest}:null);}).catch(error=>console.error('Voxel world initialization failed',error));return()=>{cancelled=true;current?.dispose();if(renderer.current===current)renderer.current=null;};},[service,resourcePacks,lightingQuality,constructionOutlineVisibility,state.worldSettings.environmentStyle,state.worldSettings.worldSeed,state.worldSettings.terrainGenerationVersion]);
  useEffect(()=>{renderer.current?.setWorlds(snapshots);},[snapshots]);
  return <figure className="world"><canvas ref={ref} role="img" aria-label="项目建筑世界" aria-describedby="world-summary"/><figcaption id="world-summary" className="sr-only">林边聚落，共 {world.projects.length} 栋建筑。{summary}</figcaption><div className="world-hud"><span>林边聚落 · {world.projects.length} 栋</span><button title="重置视角" aria-label="重置视角" onClick={()=>renderer.current?.resetCamera()}><RotateCcw/></button></div>{constructionFeedback>0&&<div key={constructionFeedback} className="construction-feedback" role="status"><Hammer/><span>材料已送达，继续建造</span><i/><i/><i/></div>}</figure>;
});
function toVoxelWorlds(projects:ReturnType<ApplicationService['worldProjection']>['projects'],state?:ReturnType<ApplicationService['snapshot']>):WorldSnapshot[] { const dates=state?decorationDatesByProject(state):new Map<string,string[]>();return projects.map(project=>({projectId:project.project.id,blueprintId:project.building.blueprintId,buildingCompletionBasisPoints:project.building.completionBasisPoints,buildingConditionBasisPoints:project.building.conditionBasisPoints,isMonument:project.project.status==='monument',isActive:project.isActive,settlementIndex:project.settlementIndex,decorationDates:dates.get(project.project.id)??[],importedDecorations:project.importedDecorations.map(reward=>({...reward,blueprint:reward.blueprint as BlueprintV1}))})); }
function decorationDatesByProject(state:ReturnType<ApplicationService['snapshot']>):Map<string,string[]> { const result=new Map<string,string[]>();const importedDates=new Set(state.decorationRewards.map(reward=>reward.date));for(const goal of state.dailyGoals){if(!goal.reachedAt||importedDates.has(goal.date))continue;const session=state.focusHistory.find(candidate=>candidate.status!=='interrupted'&&candidate.completedAt===goal.reachedAt);if(!session)continue;const dates=result.get(session.projectId)??[];dates.push(goal.date);result.set(session.projectId,dates);}return result; }
function toImportedBlueprint(blueprint:BlueprintV1):ImportedBlueprintV1 { return {...blueprint,voxels:blueprint.voxels.map(voxel=>({...voxel,stage:stageForBuildOrder(voxel.buildOrder)}))}; }
function stageForBuildOrder(value:number):ImportedBlueprintStage { return value<1800?'foundation':value<3800?'frame':value<6500?'walls':value<8800?'roof':'details'; }
function decorationBlueprintLimitError(blueprint:BlueprintV1):string { const width=blueprint.bounds.maxX-blueprint.bounds.minX+1;const height=blueprint.bounds.maxY-blueprint.bounds.minY+1;const depth=blueprint.bounds.maxZ-blueprint.bounds.minZ+1;if(width>12||depth>12||height>16)return`这份蓝图为 ${width} x ${height} x ${depth}，奖励装饰上限为 12 x 12 x 16。`;if(blueprint.voxels.length>2000)return`这份蓝图含 ${blueprint.voxels.length.toLocaleString('zh-CN')} 个方块，奖励装饰上限为 2,000 个。`;return''; }
function litematicErrorMessage(error:unknown):string { const code=typeof error==='object'&&error!==null&&'code'in error?String((error as {code:unknown}).code):'';if(code==='INPUT_TOO_LARGE'||code==='NBT_TOO_LARGE'||code==='LIMIT_EXCEEDED')return'图纸超过安全限制：文件 64 MB、占地 96 x 96、高度 256、最多 300,000 个方块。';if(code==='NOT_GZIP'||code==='INVALID_GZIP'||code==='INVALID_NBT'||code==='INVALID_LITEMATIC')return'无法读取这份 .litematic，请确认文件完整且由 Litematica 导出。';return error instanceof Error?error.message:'图纸导入失败，请换一份文件重试。'; }

function ProgressReport({active,run,onSubmitted}:{active:NonNullable<ReturnType<ApplicationService['activeProjectProjection']>>;run:(c:ApplicationCommand)=>Promise<any>;onSubmitted:()=>void}) { const session=active.unreportedCompletedSessions[0]!; const task=active.project.subtasks.find(s=>s.id===session.subtaskId)!; const submit=async(value:number)=>{const result=await run({type:'ReportSubtaskProgress',subtaskId:task.id,focusSessionIds:[session.id],progressBasisPoints:value});if(result?.ok)onSubmitted();};return <div className="report"><Check/><h2>这次专注完成了多少？</h2><p>{task.title}</p><div className="report-options">{[0,2500,5000,7500,10000].filter(n=>n>=task.progressBasisPoints).map(n=><button key={n} onClick={()=>void submit(n)}>{n===0?'没有进展':`${n/100}%`}</button>)}</div></div>; }

const INTERRUPTION_OPTIONS:readonly {value:FocusInterruptionCategory|null;label:string}[]=[
  {value:'external-interruption',label:'外部打扰'}, {value:'task-blocked',label:'任务受阻'},
  {value:'fatigue',label:'需要休息'}, {value:'priority-changed',label:'优先级变化'},
  {value:'device-or-app',label:'设备或应用问题'}, {value:'other',label:'其他'}, {value:null,label:'不记录'},
];

function EndFocusDialog({taskTitle,habit=false,marathon=false,isLastMarathonRound=false,onClose,onInterrupt,onCompleteEarly}:{taskTitle:string;habit?:boolean;marathon?:boolean;isLastMarathonRound?:boolean;onClose:()=>void;onInterrupt:(reason:FocusInterruptionCategory|null)=>Promise<void>;onCompleteEarly:()=>Promise<void>}){
  const [mode,setMode]=useState<'choose'|'interrupt'>('choose');const [busy,setBusy]=useState(false);const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{closeRef.current?.focus();const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy)onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[busy,onClose]);
  const early=async()=>{setBusy(true);try{await onCompleteEarly();}finally{setBusy(false);}};
  const interrupt=async(reason:FocusInterruptionCategory|null)=>{setBusy(true);try{await onInterrupt(reason);}finally{setBusy(false);}};
  const earlyLabel = marathon || habit ? '提前完成本轮' : '提前完成任务';
  const earlyDetail = marathon
    ? habit
      ? isLastMarathonRound ? '推进当前习惯建筑，并结束本场计划' : '推进当前习惯建筑，并继续本场计划'
      : isLastMarathonRound ? '记录本轮，并进入本场统一汇报' : '记录本轮，并继续本场计划'
    : habit
      ? '推进当前习惯建筑，并结束本轮计划'
      : '将当前小任务标为完成并结束本轮计划';
  // End-time rounds can finish early without claiming that a finite subtask is
  // complete. The domain records the round; only the final settlement changes
  // finite-task progress.
  return <div className="dialog-backdrop" role="presentation"><div className="confirm-dialog end-focus-dialog" role="dialog" aria-modal="true" aria-labelledby="end-focus-title"><button ref={closeRef} className="dialog-close" aria-label="关闭结束专注窗口" disabled={busy} onClick={onClose}><X/></button><h2 id="end-focus-title">{mode==='choose'?'如何结束这次专注？':'这次为什么中断？'}</h2><p>{mode==='choose'?taskTitle:'选择一项便于以后复盘，也可以不记录。'}</p>{mode==='choose'?<div className="end-focus-choices"><button disabled={busy} onClick={()=>setMode('interrupt')}><Square/><span><strong>中断本轮</strong><small>保留已有任务进度，不计完整轮次{marathon?'；本轮计划继续':''}</small></span></button><button disabled={busy} onClick={()=>void early()}><Check/><span><strong>{earlyLabel}</strong><small>{earlyDetail}</small></span></button></div>:<><div className="interruption-options">{INTERRUPTION_OPTIONS.map(option=><button key={option.value??'none'} disabled={busy} onClick={()=>void interrupt(option.value)}>{option.label}</button>)}</div><button className="dialog-back" disabled={busy} onClick={()=>setMode('choose')}>返回</button></>}</div></div>;
}


function AboutDialog({onClose}:{onClose:()=>void}){
  const [checking,setChecking]=useState(false);const [updateResult,setUpdateResult]=useState('');const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{closeRef.current?.focus();const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose]);
  const check=async()=>{setChecking(true);setUpdateResult('');try{const response=await fetch(`${REPOSITORY_URL.replace('github.com','api.github.com/repos')}/releases/latest`,{headers:{Accept:'application/vnd.github+json'}});if(!response.ok)throw new Error(String(response.status));const release=await response.json() as {tag_name?:string;html_url?:string};const latest=(release.tag_name??'').replace(/^v/,'');if(!/^\d+\.\d+\.\d+$/.test(latest))throw new Error('invalid release');setUpdateResult(compareVersions(latest,APP_VERSION)>0?`发现新版本 ${latest}，可前往 GitHub 下载。`:`当前已是最新版本 ${APP_VERSION}。`);}catch{setUpdateResult('暂时无法检查更新，请确认网络后重试。');}finally{setChecking(false);}};
  return <div className="dialog-backdrop" role="presentation"><section className="confirm-dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title"><button ref={closeRef} className="dialog-close" aria-label="关闭关于页面" onClick={onClose}><X/></button><Info className="about-icon"/><h2 id="about-title">方块钟 Blockcolc</h2><p className="about-version">版本 {APP_VERSION}</p><p>本地优先的专注计时器。任务、专注记录、蓝图和资源包默认只保存在你的设备上。</p><dl><div><dt>项目仓库</dt><dd><a href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub <ExternalLink/></a></dd></div><div><dt>隐私</dt><dd>无账号、无云同步、无后台分析</dd></div><div><dt>许可</dt><dd>开源许可与第三方组件信息见项目仓库</dd></div></dl><p className="legal-note">本应用不是 Minecraft 官方产品，未获 Mojang Studios 或 Microsoft 认可或关联。Minecraft 是其权利人的商标。</p><button className="check-update" type="button" disabled={checking} onClick={()=>void check()}><RefreshCw className={checking?'is-spinning':''}/>{checking?'正在检查':'手动检查更新'}</button>{updateResult&&<p className="update-result" role="status">{updateResult}</p>}</section></div>;
}

function CompletionCeremony({title,onClose}:{title:string;onClose:()=>void}){const button=useRef<HTMLButtonElement>(null);useEffect(()=>{button.current?.focus();},[]);return <div className="ceremony-backdrop" role="presentation"><section className="completion-ceremony" role="dialog" aria-modal="true" aria-labelledby="ceremony-title"><div className="ceremony-rays"/><Trophy/><span>主体建筑完成</span><h2 id="ceremony-title">{title}</h2><p>这项长期工作已经在聚落中留下完整建筑。</p><button ref={button} onClick={onClose}>回到聚落</button></section></div>;}

function compareVersions(left:string,right:string):number{const a=left.split('.').map(Number);const b=right.split('.').map(Number);for(let index=0;index<3;index+=1){if(a[index]!==b[index])return(a[index]??0)-(b[index]??0);}return 0;}
function lastSuccessfulSession(history:ReturnType<ApplicationService['snapshot']>['focusHistory']){for(let index=history.length-1;index>=0;index-=1){const session=history[index]!;if(session.status==='completed'||session.status==='completed-early')return session;}return undefined;}


function loadPreferences():FocusPreferences {
  try {
    const value=JSON.parse(localStorage.getItem(PREFERENCES_KEY)??'null');
    if(value&&Number.isFinite(value.focusMinutes)&&Number.isFinite(value.breakMinutes)){
      const legacy=value.visualExperiment;
      const lightingQuality:VoxelLightingQuality=value.lightingQuality==='performance'||value.lightingQuality==='balanced'||value.lightingQuality==='cinematic'||value.lightingQuality==='auto'?value.lightingQuality:legacy==='water'||legacy==='mist-beam'?'cinematic':'auto';
      const constructionOutlineVisibility:ConstructionOutlineVisibility=value.constructionOutlineVisibility==='off'||value.constructionOutlineVisibility==='all'||value.constructionOutlineVisibility==='current'?value.constructionOutlineVisibility:'current';
      return{focusMinutes:clamp(value.focusMinutes,1,180),habitFocusMinutes:clamp(value.habitFocusMinutes??value.focusMinutes,1,180),habitTargetRounds:clamp(value.habitTargetRounds??10,10,30),breakMinutes:clamp(value.breakMinutes,0,60),lightingQuality,constructionOutlineVisibility,showWorldCoordinates:typeof value.showWorldCoordinates==='boolean'?value.showWorldCoordinates:true,focusGlassTransparency:clamp(value.focusGlassTransparency??50,0,100),themeMode:value.themeMode==='light'||value.themeMode==='dark'?value.themeMode:'system'};
    }
  } catch {}
  return{focusMinutes:45,habitFocusMinutes:45,habitTargetRounds:10,breakMinutes:5,lightingQuality:'auto',constructionOutlineVisibility:'current',showWorldCoordinates:false,focusGlassTransparency:50,themeMode:'system'};
}
function loadRoundPlan(projectId:string):RoundPlan|null { try{return parseRoundPlan(JSON.parse(localStorage.getItem(ROUND_PLAN_KEY)??'null'),projectId);}catch{return null;} }
function clamp(value:number,min:number,max:number){return Math.min(max,Math.max(min,Math.round(value)));}
