import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ApplicationCommand, ApplicationService, NotificationCapability } from '@tomato-clock/application';
import type { FocusInterruptionCategory, ImportedBlueprintStage, ImportedBlueprintV1, WorldEnvironmentStyle } from '@tomato-clock/domain';
import type { LitematicImportResult } from '@tomato-clock/litematic';
import { addLocalDays, completedPomodorosOn, dailyGoalForDate, isPlannedFocusDay, localDateOf, projectProgressBasisPoints } from '@tomato-clock/domain';
import { AlertTriangle, BarChart3, Check, Clock3, Download, ExternalLink, FileUp, Hammer, History, Info, ListTodo, Map as MapIcon, Pencil, Plus, RefreshCw, RotateCcw, Settings, Square, TreePine, Trophy, Upload, X } from 'lucide-react';
import type { BlueprintCatalogEntry, BlueprintV1, ConstructionOutlineVisibility, VoxelLightingQuality, VoxelRenderer, WorldSnapshot } from '@tomato-clock/voxel';
import type { ResourcePackRepository } from '@tomato-clock/resource-pack-indexeddb';
import { TasksScreen } from './TaskManagement';
import { LoadingPage } from './LoadingPage';
import { ResourcePackPanel } from './ResourcePackPanel';
import { ChoiceMenu } from './ChoiceMenu';
import { LITEMATIC_MAX_COMPRESSED_BYTES, readBrowserFileBytes, saveBackupFile } from './browser-adapters';
import { APPLICATION_STATE_CHANGED_EVENT } from './bootstrap';
import { effectiveFocusMillisecondsByDate, focusHeatmapLevel, focusHourDistribution, focusSessionEndedAt, focusSessionLocalDate, focusWindowSummary, projectFocusAllocation, settlementTotals } from './focus-stats';
import { parseRoundPlan, plannedDurationMs, reconcileRoundPlan, roundPlansEqual, type RoundPlan } from './round-plan';
import releaseVersion from '../../../version.json';

type Tab = 'world' | 'tasks' | 'stats' | 'settings';
interface FocusPreferences { focusMinutes: number; habitFocusMinutes: number; habitTargetRounds: number; breakMinutes: number; lightingQuality: VoxelLightingQuality; constructionOutlineVisibility: ConstructionOutlineVisibility }
type ImportRole = 'building' | 'decoration';
interface ProjectSetupDraft { kind: 'finite' | 'habit'; title: string; subtasksText: string; blueprintId: string; habitTargetRounds: number; imported: LitematicImportResult | null; packCompatibility: { name: string; textured: number; fallback: number; total: number } | null; importRole: ImportRole }
const PREFERENCES_KEY = 'blockcolc-focus-preferences-v1';
const ROUND_PLAN_KEY = 'blockcolc-round-plan-v1';
const APP_VERSION = releaseVersion.versionName;
const REPOSITORY_URL = 'https://github.com/Dieight/blockcolc';
const INITIAL_PROJECT_SETUP_DRAFT: ProjectSetupDraft = { kind: 'finite', title: '我的第一座工坊', subtasksText: '确定目标\n完成核心工作\n检查并收尾', blueprintId: 'builtin-small-workshop', habitTargetRounds: 10, imported: null, packCompatibility: null, importRole: 'building' };
let voxelModulePromise:Promise<typeof import('@tomato-clock/voxel')>|null=null;
function loadVoxelModule(){voxelModulePromise??=import('@tomato-clock/voxel');return voxelModulePromise;}
function resourcePackAtlasMaximumSizeForTest():number|undefined{if(!import.meta.env.DEV)return undefined;const value=Number(new URLSearchParams(location.search).get('__atlasPageSize'));return Number.isSafeInteger(value)&&value>=32&&value<=2048?value:undefined;}
let litematicModulePromise:Promise<typeof import('@tomato-clock/litematic')>|null=null;
function loadLitematicModule(){litematicModulePromise??=import('@tomato-clock/litematic');return litematicModulePromise;}
function useBlueprintCatalog(){const [catalog,setCatalog]=useState<readonly BlueprintCatalogEntry[]>([]);useEffect(()=>{let active=true;void loadVoxelModule().then(module=>{if(active)setCatalog(module.BUILTIN_BLUEPRINT_CATALOG);});return()=>{active=false;};},[]);return catalog;}

function blueprintName(catalog:readonly BlueprintCatalogEntry[],id: string) {
  return catalog.find(entry=>entry.id===id)?.displayName??'兼容建筑';
}

function complexityLabel(value:BlueprintCatalogEntry['complexity']) { return value==='simple'?'紧凑':value==='moderate'?'适中':'丰富'; }

export function App({ service, resourcePacks }: { service: ApplicationService; resourcePacks: ResourcePackRepository }) {
  const [tab, setTab] = useState<Tab>('world'); const [version, setVersion] = useState(0); const [message, setMessage] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState<ProjectSetupDraft | null>(null);
  const [worldFocusProjectId,setWorldFocusProjectId]=useState<string|null>(null);
  const [aboutOpen,setAboutOpen]=useState(false);
  const [ceremony,setCeremony]=useState<{projectId:string;title:string}|null>(null);
  const [preferences, setPreferences] = useState<FocusPreferences>(loadPreferences);
  const refresh = useCallback(() => setVersion(v => v + 1), []);
  const run = useCallback(async (command: ApplicationCommand) => { try { const result = await service.dispatch(command); if (!result.ok) setMessage(result.message); else {if(result.events.some(event=>event.type==='FocusInterrupted'&&event.reason==='app-switch-limit'))setMessage('本轮专注因达到离开应用次数上限而结束。下次可以从这里继续。'); else if(result.events.some(event=>event.type==='FocusInterrupted'))setMessage('本轮已记录，有效专注时间已计入统计。'); else if(result.events.some(event=>event.type==='HabitBuildingCompleted'))setMessage('这座习惯建筑已完成，请选择下一座建筑。'); else if(result.events.some(event=>event.type==='FocusCompletedEarly'))setMessage(result.events.some(event=>event.type==='HabitBuildingProgressed')?'习惯专注已推进一轮，实际专注时间已记录。':'小任务已提前完成，实际专注时间已记录。'); else if(result.warnings.some(warning=>warning.code==='NOTIFICATION_INEXACT'))setMessage('系统提醒已开启，但未获精准闹钟权限，锁屏时可能略有延迟。'); else if (result.warnings.length) setMessage('计时已开始；系统通知当前不可用，回到应用时仍会正确恢复。'); else if (result.events.some(event => event.type === 'ProjectDeleted')) setMessage('任务已删除，已完成的习惯建筑仍保留在聚落中。'); else setMessage(''); const sealed=result.events.find(event=>event.type==='ProjectSealedAsMonument');if(sealed){const project=result.state.projects.find(item=>item.id===sealed.projectId);if(project)setCeremony({projectId:project.id,title:project.title});}} refresh(); return result; } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败，请重试。'); throw error; } }, [service, refresh]);
  useEffect(() => { const resumeFromPageCache = (event:PageTransitionEvent) => { if(event.persisted)void service.resume().then(refresh); }; window.addEventListener('pageshow',resumeFromPageCache);return()=>window.removeEventListener('pageshow',resumeFromPageCache);},[service,refresh]);
  useEffect(() => { const refreshAfterLifecycle = () => refresh(); window.addEventListener(APPLICATION_STATE_CHANGED_EVENT,refreshAfterLifecycle);return()=>window.removeEventListener(APPLICATION_STATE_CHANGED_EVENT,refreshAfterLifecycle);},[refresh]);
  useEffect(()=>{let observed=localDateOf(new Date(),service.snapshot().calendar.timeZone);const timer=window.setInterval(()=>{const next=localDateOf(new Date(),service.snapshot().calendar.timeZone);if(next!==observed){observed=next;refresh();}},60_000);return()=>window.clearInterval(timer);},[service,refresh]);
  useEffect(()=>{if(!message)return;const timeout=window.setTimeout(()=>setMessage(''),5000);return()=>window.clearTimeout(timeout);},[message]);
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [tab, creatingProject]);
  const state = useMemo(() => service.snapshot(), [service, version]); const active = useMemo(() => service.activeProjectProjection(), [service, version]);
  const setupDraft=projectDraft??{...INITIAL_PROJECT_SETUP_DRAFT,habitTargetRounds:preferences.habitTargetRounds};
  const updateSetupDraft=useCallback((patch:Partial<ProjectSetupDraft>)=>setProjectDraft(current=>({...current??INITIAL_PROJECT_SETUP_DRAFT,...patch})),[]);
  const beginProjectSetup=useCallback(()=>{setProjectDraft(current=>current??{...INITIAL_PROJECT_SETUP_DRAFT,habitTargetRounds:preferences.habitTargetRounds});setCreatingProject(true);},[preferences.habitTargetRounds]);
  const discardProjectSetup=useCallback(()=>{setCreatingProject(false);setProjectDraft(null);},[]);
  const completeProjectSetup=useCallback(()=>{setCreatingProject(false);setProjectDraft(null);setTab('world');},[]);
  const viewProjectInWorld=useCallback((projectId:string)=>{setCreatingProject(false);setWorldFocusProjectId(projectId);setTab('world');},[]);
  const immersiveFocus = !creatingProject && tab === 'world' && Boolean(active && state.activeFocusSession);
  const [landscape,setLandscape]=useState(()=>matchMedia('(orientation: landscape)').matches);
  useEffect(()=>{const media=matchMedia('(orientation: landscape)');const change=()=>setLandscape(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{let live=true;const sync=()=>{if(document.hidden)return;void import('@tomato-clock/platform-capacitor').then(platform=>{if(live)return platform.setNativeFocusImmersive(immersiveFocus||landscape);});};sync();document.addEventListener('visibilitychange',sync);window.addEventListener('focus',sync);window.addEventListener('blockcolc-window-focus',sync);return()=>{live=false;document.removeEventListener('visibilitychange',sync);window.removeEventListener('focus',sync);window.removeEventListener('blockcolc-window-focus',sync);};},[immersiveFocus,landscape]);
  const worldVisible = tab === 'world' && !creatingProject;
  const worldPane = active ? <div className={worldVisible?'world-pane':'world-pane is-hidden'} aria-hidden={!worldVisible}><WorldScreenV7 service={service} resourcePacks={resourcePacks} run={run} refresh={refresh} preferences={preferences} focusedProjectId={worldFocusProjectId} onFocusWorldProject={setWorldFocusProjectId} onClearWorldFocus={()=>setWorldFocusProjectId(null)} onOpenTasks={()=>setTab('tasks')} visible={worldVisible}/></div> : null;
  const firstRunSetup = <ProjectSetup run={run} resourcePacks={resourcePacks} buildingBlueprints={state.buildingBlueprintResources} existingProjects={state.projects.filter(project=>project.status==='paused')} draft={setupDraft} onDraftChange={updateSetupDraft} onCreated={()=>{setProjectDraft(null);setTab('world');}}/>;
  const creationSetup = <ProjectSetup run={run} resourcePacks={resourcePacks} buildingBlueprints={state.buildingBlueprintResources} existingProjects={[]} draft={setupDraft} onDraftChange={updateSetupDraft} onCancel={discardProjectSetup} onCreated={completeProjectSetup}/>;
  const otherPane = !active
    ? tab === 'settings' ? <SettingsScreen service={service} resourcePacks={resourcePacks} state={state} run={run} refresh={refresh} preferences={preferences} onPreferencesChange={value=>{setPreferences(value);localStorage.setItem(PREFERENCES_KEY,JSON.stringify(value));}}/> : tab === 'stats' ? <StatsScreen state={state}/> : firstRunSetup
    : tab === 'tasks' ? <TasksScreen active={active} state={state} run={run} onCreateProject={beginProjectSetup} onViewProject={viewProjectInWorld}/> : tab === 'stats' ? <StatsScreen state={state}/> : tab === 'settings' ? <SettingsScreen service={service} resourcePacks={resourcePacks} state={state} run={run} refresh={refresh} preferences={preferences} onPreferencesChange={value=>{setPreferences(value);localStorage.setItem(PREFERENCES_KEY,JSON.stringify(value));}}/> : null;
  const content = <>
    {worldPane}
    {creatingProject ? creationSetup : otherPane}
  </>;
  return <div className={immersiveFocus?'app-shell focus-immersive':'app-shell'}>{!immersiveFocus&&<header className="topbar"><div><span className="brand-mark">方块钟</span><span className="brand-en">Blockcolc</span></div><button className="today" type="button" aria-label="关于方块钟" onClick={()=>setAboutOpen(true)}><TreePine size={16}/>{new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric'}).format(new Date())}</button></header>}
    <main>{content}</main>
    {message && <div className="toast" role="status">{message}</div>}
    {!immersiveFocus&&<nav className="bottom-nav" aria-label="主导航"><NavButton active={tab==='world'} icon={<Clock3/>} label="计时" onClick={()=>{if(creatingProject)setCreatingProject(false);setWorldFocusProjectId(null);setTab('world');}}/><NavButton active={tab==='tasks'} icon={<ListTodo/>} label="任务" onClick={()=>setTab('tasks')}/><NavButton active={tab==='stats'} icon={<BarChart3/>} label="统计" onClick={()=>setTab('stats')}/><NavButton active={tab==='settings'} icon={<Settings/>} label="设置" onClick={()=>setTab('settings')}/></nav>}
    {aboutOpen&&<AboutDialog onClose={()=>setAboutOpen(false)}/>}
    {ceremony&&<CompletionCeremony title={ceremony.title} onClose={()=>setCeremony(null)}/>}
  </div>;
}
function NavButton({active,icon,label,onClick}:{active:boolean;icon:ReactNode;label:string;onClick:()=>void}) { return <button className={active?'nav-active':''} onClick={onClick}>{icon}<span>{label}</span></button>; }

function ProjectSetup({run,resourcePacks,buildingBlueprints,existingProjects,draft,onDraftChange,onCancel,onCreated}:{run:(c:ApplicationCommand)=>Promise<any>;resourcePacks:ResourcePackRepository;buildingBlueprints:ReturnType<ApplicationService['snapshot']>['buildingBlueprintResources'];existingProjects:ReturnType<ApplicationService['snapshot']>['projects'];draft:ProjectSetupDraft;onDraftChange:(patch:Partial<ProjectSetupDraft>)=>void;onCancel?:()=>void;onCreated?:()=>void}) {
  const catalog=useBlueprintCatalog(); const {kind,blueprintId,habitTargetRounds,imported,packCompatibility,importRole}=draft; const [importing,setImporting]=useState(false); const [importError,setImportError]=useState(''); const [importNotice,setImportNotice]=useState(''); const [nativePicker,setNativePicker]=useState(false);
  const titleInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{let active=true;void import('@tomato-clock/platform-capacitor').then(platform=>{if(active)setNativePicker(platform.isCapacitorNative());});return()=>{active=false;};},[]);
  const importedEntry:BlueprintCatalogEntry|undefined=imported?{id:imported.blueprint.id,displayName:imported.preview.name,description:`本地 Litematic · Minecraft 数据版本 ${imported.preview.minecraftDataVersion}`,footprint:{width:imported.preview.dimensions.width,depth:imported.preview.dimensions.depth},complexity:imported.preview.nonAirBlockCount>3000?'detailed':'moderate',blueprint:imported.blueprint}:undefined;
  const libraryEntries:BlueprintCatalogEntry[]=buildingBlueprints.map(resource=>({id:resource.id,displayName:resource.displayName,description:`本地建筑蓝图 · ${new Date(resource.importedAt).toLocaleDateString('zh-CN')} 导入`,footprint:{width:resource.blueprint.bounds.maxX-resource.blueprint.bounds.minX+1,depth:resource.blueprint.bounds.maxZ-resource.blueprint.bounds.minZ+1},complexity:resource.blueprint.voxels.length>3000?'detailed':'moderate',blueprint:resource.blueprint as BlueprintV1}));
  const options=importedEntry?[...catalog,...libraryEntries,importedEntry]:[...catalog,...libraryEntries];
  const selected=options.find(option=>option.id===blueprintId)??options[0];
  const submit=async(e:FormEvent)=>{e.preventDefault();if(importRole==='decoration')return;const currentTitle=titleInput.current?.value??'';if(!currentTitle.trim()||!selected||!Number.isInteger(habitTargetRounds)||habitTargetRounds<10||habitTargetRounds>30)return;const importedBlueprint=selected.blueprint.id.startsWith('builtin-')?null:toImportedBlueprint(selected.blueprint);const subtasks=draft.subtasksText.split('\n').map(x=>x.trim()).filter(Boolean).map(title=>({title}));if(kind==='finite'&&subtasks.length===0)return;const command:ApplicationCommand=kind==='habit'?{type:'CreateHabitProject',title:currentTitle.trim(),blueprintId:selected.blueprint.id,importedBlueprint,targetRounds:habitTargetRounds}:{type:'CreateProject',title:currentTitle.trim(),blueprintId:selected.blueprint.id,importedBlueprint,subtasks};const result=await run(command);if(result?.ok)onCreated?.();};
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
        {kind === 'finite' ? <SubtaskRowsEditor initialText={draft.subtasksText} onChange={subtasksText => onDraftChange({ subtasksText })}/> : <div className="habit-target-summary"><span>每座建筑</span><strong>{habitTargetRounds} 轮专注</strong><small>统一在设置中调整；创建后，本周期内不会改变。</small></div>}
      </div>
      {selected ? <BlueprintPicker resourcePacks={resourcePacks} options={options} selected={selected} onSelect={id => onDraftChange({ blueprintId: id, ...(!imported || id !== imported.blueprint.id ? { importRole: 'building' } : {}) })} importControl={importControl}/> : <div className="blueprint-loading" role="status">正在准备建筑预览...</div>}
      <div className="setup-actions">{onCancel && <button type="button" className="setup-cancel" onClick={onCancel}>取消</button>}{importRole === 'decoration' && imported ? <button className="primary setup-submit" type="button" disabled={importing || Boolean(decorationLimitError)} onClick={() => void addDecoration()}>加入装饰池</button> : <button className="primary setup-submit" type="submit" disabled={!selected || importing || !Number.isInteger(habitTargetRounds) || habitTargetRounds < 10 || habitTargetRounds > 30 || (kind === 'finite' && draft.subtasksText.split('\n').map(x => x.trim()).filter(Boolean).length === 0)}>开始建造</button>}</div>
    </form>
  </section>;
}

function NativeImeTextEntry({targetRef,name,defaultValue,rows,ariaLabel,onValueChange}:{targetRef:{current:HTMLInputElement|null}|{current:HTMLTextAreaElement|null};name:string;defaultValue:string;rows?:number;ariaLabel?:string;onValueChange?:(value:string)=>void}) { const host=useRef<HTMLSpanElement>(null);const initialValue=useRef(defaultValue);const valueChangeRef=useRef(onValueChange);valueChangeRef.current=onValueChange;useLayoutEffect(()=>{const element=rows===undefined?document.createElement('input'):document.createElement('textarea');element.name=name;element.required=true;element.value=initialValue.current;if(ariaLabel)element.setAttribute('aria-label',ariaLabel);element.dataset.imeDiagnostic=name;if(element instanceof HTMLTextAreaElement)element.rows=rows??5;targetRef.current=element as never;host.current?.append(element);const report=(event:Event)=>{const input=event as InputEvent & {isComposing?:boolean;data?:string};const current=element as HTMLInputElement|HTMLTextAreaElement;console.info('[tomato-ime]',JSON.stringify({field:name,type:event.type,inputType:input.inputType??null,isComposing:input.isComposing??false,dataLength:input.data?.length??0,valueLength:current.value.length,selectionStart:current.selectionStart,selectionEnd:current.selectionEnd,time:performance.now()}));};const retain=()=>valueChangeRef.current?.(element.value);const events=['compositionstart','compositionupdate','compositionend','beforeinput','input','focus','blur','select','keyup'];events.forEach(type=>element.addEventListener(type,report));element.addEventListener('input',retain);return()=>{retain();element.removeEventListener('input',retain);events.forEach(type=>element.removeEventListener(type,report));if(targetRef.current===element)targetRef.current=null;element.remove();};},[name,rows,targetRef,ariaLabel]);return <span className="native-ime-entry" ref={host}/>; }

interface SubtaskRowDraft { id: string; title: string }

function SubtaskRowsEditor({initialText,onChange}:{initialText:string;onChange:(text:string)=>void}) {
  const [rows,setRows]=useState<SubtaskRowDraft[]>(()=>initialText.split('\n').map(title=>title.trim()).filter(Boolean).map(title=>({id:crypto.randomUUID(),title})));
  const [adding,setAdding]=useState('');
  const rowsRef=useRef(rows);rowsRef.current=rows;
  const rowRefs=useRef(new Map<string,{current:HTMLInputElement|null}>());
  const pendingFocusId=useRef<string|null>(null);
  const emit=(next:SubtaskRowDraft[])=>{setRows(next);onChange(next.map(row=>row.title).join('\n'));};
  const updateRow=(id:string,title:string)=>emit(rowsRef.current.map(row=>row.id===id?{...row,title}:row));
  const removeRow=(id:string)=>{rowRefs.current.delete(id);emit(rowsRef.current.filter(row=>row.id!==id));};
  const appendRows=(titles:string[])=>{const next=[...rowsRef.current,...titles.map(title=>({id:crypto.randomUUID(),title}))];pendingFocusId.current=next[next.length-1]!.id;emit(next);};
  const commitAdd=()=>{const title=adding.trim();if(!title)return;appendRows([title]);setAdding('');};
  const clearRows=()=>{pendingFocusId.current=null;emit([]);};
  useEffect(()=>{if(!pendingFocusId.current)return;const id=pendingFocusId.current;pendingFocusId.current=null;const ref=rowRefs.current.get(id);if(ref?.current)ref.current.focus();},[rows]);
  return <div className="setup-subtasks">
    <div className="setup-subtasks-head"><span>拆成小任务</span>{rows.length>0&&<button type="button" className="settings-text-action" aria-label="清空小任务" onClick={clearRows}>清空</button>}</div>
    {rows.map((row,index)=>{let ref=rowRefs.current.get(row.id);if(!ref){ref={current:null};rowRefs.current.set(row.id,ref);}return <div className="setup-subtask-row" key={row.id}>
      <span className="setup-subtask-order" aria-hidden="true">{index+1}</span>
      <NativeImeTextEntry targetRef={ref} name={`subtask-${index}`} ariaLabel={`小任务 ${index+1}`} defaultValue={row.title} onValueChange={title=>updateRow(row.id,title)}/>
      <button type="button" className="setup-subtask-delete" aria-label={`删除“${row.title}”`} onClick={()=>removeRow(row.id)}><X/></button>
    </div>;})}
    <div className="setup-subtask-add">
      <input aria-label="新增小任务" placeholder="例如：整理验证结果" value={adding} onChange={event=>setAdding(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();commitAdd();}}}/>
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

function WorldScreenV7({ service, resourcePacks, run, refresh, preferences, focusedProjectId, onFocusWorldProject, onClearWorldFocus, onOpenTasks, visible }: {
  service: ApplicationService;
  resourcePacks: ResourcePackRepository;
  run: (command: ApplicationCommand) => Promise<any>;
  refresh: () => void;
  preferences: FocusPreferences;
  focusedProjectId: string | null;
  onFocusWorldProject: (projectId: string) => void;
  onClearWorldFocus: () => void;
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
  const [controlsVisible, setControlsVisible] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const [pickedCell, setPickedCell] = useState<{ x: number; y: number; z: number } | null>(null);
  const [integrityFlash, setIntegrityFlash] = useState(false);
  const lastExcursionsRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [constructionFeedback, setConstructionFeedback] = useState(0);
  const reconciling = useRef(false);
  const latestSuccess = lastSuccessfulSession(state.focusHistory);
  const latestSuccessRef = useRef(latestSuccess?.id);

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
    setPlan(loadRoundPlan(active.project.id));
    setPlanOpen(false);
  }, [active.project.id, setPlan]);
  useEffect(() => {
    if (!latestSuccess || latestSuccess.id === latestSuccessRef.current) return;
    latestSuccessRef.current = latestSuccess.id;
    setConstructionFeedback((value) => value + 1);
    const timer = window.setTimeout(() => setConstructionFeedback(0), 1800);
    return () => window.clearTimeout(timer);
  }, [latestSuccess?.id]);

  const session = state.activeFocusSession;
  const lastFocus = state.focusHistory[state.focusHistory.length - 1];
  const integrityFailure = !session && lastFocus?.status === 'interrupted' && lastFocus.interruptionReason === 'app-switch-limit';
  const pending = active.unreportedCompletedSessions;
  const habitAwaiting = isHabit && habit?.awaitingNextBuilding === true;
  const reconciledPlan = reconcileRoundPlan(plan, state, active.project.id, Date.now(), preferences.breakMinutes * 60_000);
  const isBreak = reconciledPlan?.status === 'break' && !!reconciledPlan.breakEndsAt;
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
    if (!session) return;
    setHintVisible(true);
    // Match the five-second reveal rhythm of the end control: the 1.2 s CSS
    // fade completes right at five seconds.
    const timer = window.setTimeout(() => setHintVisible(false), 3_800);
    return () => window.clearTimeout(timer);
  }, [session?.id]);
  // The revealed end control stays for five seconds and then hides itself, so a
  // focused session never keeps the red button hanging around.
  useEffect(() => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
    if (!controlsVisible || !session) return;
    hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 5_000);
  }, [controlsVisible, session?.id]);
  const handlePanelTap = useCallback((event: { target: EventTarget | null; clientX: number; clientY: number }) => {
    if (!session || (event.target instanceof Element && event.target.closest('button'))) return;
    const now = performance.now();
    const previous = lastTapRef.current;
    lastTapRef.current = { time: now, x: event.clientX, y: event.clientY };
    if (previous && now - previous.time < 450 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 48) {
      lastTapRef.current = null;
      // Reveal after a beat so the second tap's trailing click lands on empty space
      // instead of the freshly shown button; hiding stays immediate.
      if (controlsVisible) setControlsVisible(false);
      else {
        if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = window.setTimeout(() => setControlsVisible(true), 250);
      }
    }
  }, [session, controlsVisible]);
  // The integrity count pops up only when the session starts and when a new
  // excursion is consumed (returning from an app switch); the rest of the time
  // the band stays quiet.
  useEffect(() => {
    if (!session || !state.focusIntegrityPolicy.enabled) {
      lastExcursionsRef.current = null;
      return;
    }
    const count = session.integrity.effectiveExcursions;
    const previous = lastExcursionsRef.current;
    lastExcursionsRef.current = count;
    if (previous !== null && count <= previous) return;
    setIntegrityFlash(true);
    const timer = window.setTimeout(() => setIntegrityFlash(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [session?.id, session?.integrity.effectiveExcursions, state.focusIntegrityPolicy.enabled]);
  useEffect(() => {
    if (!roundPlansEqual(plan, reconciledPlan)) setPlan(reconciledPlan);
  }, [plan, reconciledPlan, setPlan]);
  const selectedId = reconciledPlan?.subtaskId ?? selected;
  const subtask = active.project.subtasks.find((item) => item.id === selectedId) ?? active.project.subtasks[0]!;
  const timerEndsAt = session?.endsAt ?? (isBreak ? reconciledPlan?.breakEndsAt : undefined);
  const today = localDateOf(new Date(), state.calendar.timeZone);
  const dailyGoal = dailyGoalForDate(state, today);
  const completedToday = completedPomodorosOn(state, today);
  const dailySummary = dailyGoal.enabled ? `今日 ${completedToday} / ${dailyGoal.targetPomodoros} 轮` : `今日已完成 ${completedToday} 轮`;

  useEffect(() => {
    const operation = reconciledPlan?.status === 'break' && reconciledPlan.breakEndsAt
      ? service.scheduleBreakCompletion({ endsAt: reconciledPlan.breakEndsAt })
      : service.cancelBreakCompletion();
    void operation.then((warnings) => {
      for (const warning of warnings) console.warn(warning.message, warning.cause);
    });
  }, [service, reconciledPlan?.status, reconciledPlan?.breakEndsAt]);

  useEffect(() => {
    if (integrityFailure && reconciledPlan?.status === 'focus') setPlan(null);
  }, [integrityFailure, reconciledPlan, setPlan]);
  useEffect(() => {
    if (habitAwaiting && plan !== null) setPlan(null);
  }, [habitAwaiting, plan, setPlan]);

  const startFocus = async (total = reconciledPlan?.totalRounds ?? rounds) => {
    if (habitAwaiting) return;
    const next: RoundPlan = reconciledPlan ?? { projectId: active.project.id, subtaskId: isHabit ? null : subtask!.id, totalRounds: total, completedRounds: 0, status: 'focus', reportedSessionIds: [] };
    const focusMinutes = isHabit ? preferences.habitFocusMinutes : preferences.focusMinutes;
    const result = await run({ type: 'StartFocus', subtaskId: next.subtaskId, plannedDurationMs: focusMinutes * 60000 });
    if (result?.ok) {
      const { breakEndsAt: _breakEndsAt, ...withoutBreak } = next;
      const started = result.events.find((event: { type: string; sessionId?: string }) => event.type === 'FocusStarted');
      setPlan({ ...withoutBreak, status: 'focus', currentSessionId: started?.sessionId });
    }
  };
  const interruptFocus = async (interruptionCategory: FocusInterruptionCategory | null) => {
    const current = service.snapshot().activeFocusSession;
    if (current && Date.parse(current.endsAt) <= Date.now()) {
      setEnding(false);
      await reconcile();
      return;
    }
    const result = await run({ type: 'CancelFocus', interruptionCategory });
    if (result?.ok) {
      setPlan(null);
      setEnding(false);
    }
  };
  const completeEarly = async () => {
    const current = service.snapshot().activeFocusSession;
    if (current && Date.parse(current.endsAt) <= Date.now()) {
      setEnding(false);
      await reconcile();
      return;
    }
    const result = await run({ type: 'CompleteFocusEarly' });
    if (!result?.ok) return;
    setEnding(false);
    const sealed = result.events.some((event: { type: string }) => event.type === 'ProjectSealedAsMonument' || event.type === 'HabitBuildingCompleted');
    const currentPlan = reconciledPlan;
    if (sealed || !currentPlan || currentPlan.totalRounds === 1 || preferences.breakMinutes === 0) {
      setPlan(null);
      return;
    }
    const completedSession = result.events.find((event: { type: string; sessionId?: string }) => event.type === 'FocusCompletedEarly');
    setPlan({ ...currentPlan, completedRounds: currentPlan.completedRounds + 1, status: 'break', endAfterBreak: true, breakEndsAt: new Date(Date.now() + preferences.breakMinutes * 60000).toISOString(), currentSessionId: undefined, reportedSessionIds: completedSession?.sessionId ? [...currentPlan.reportedSessionIds, completedSession.sessionId] : currentPlan.reportedSessionIds });
  };
  const afterReport = (sessionId: string) => {
    if (!reconciledPlan) return;
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
  const focusMinutes = isHabit ? preferences.habitFocusMinutes : preferences.focusMinutes;
  const plannedRounds = reconciledPlan?.totalRounds ?? rounds;
  const fullPlanDurationMs = plannedDurationMs(focusMinutes, preferences.breakMinutes, plannedRounds);
  const timerMode = isBreak ? 'break' : session ? 'focus' : reconciledPlan?.status === 'ready' ? 'ready' : 'plan';
  const timerFallbackMs = timerMode === 'plan' ? fullPlanDurationMs : focusMinutes * 60_000;
  const planSummary = `${plannedRounds} 轮 · 总计 ${formatDurationSummary(fullPlanDurationMs)}`;

  return <div className={session ? 'world-screen is-focusing' : pending.length > 0 ? 'world-screen has-report' : habitAwaiting ? 'world-screen is-choosing-habit-building' : 'world-screen'}>
    <WorldCanvasV7 service={service} resourcePacks={resourcePacks} lightingQuality={preferences.lightingQuality} constructionOutlineVisibility={preferences.constructionOutlineVisibility} environmentStyle={state.worldSettings.environmentStyle} worldSeed={state.worldSettings.worldSeed} terrainGenerationVersion={state.worldSettings.terrainGenerationVersion} constructionFeedback={constructionFeedback} sessionActive={!!session} focusedProjectId={focusedProjectId} onSelectProject={onFocusWorldProject} onClearWorldFocus={onClearWorldFocus} visible={visible} onPickTerrain={setPickedCell} pickedCell={pickedCell}/>
    {visible && <section className="focus-panel v7-focus-panel" onPointerUp={(event) => handlePanelTap({ target: event.target, clientX: event.clientX, clientY: event.clientY })}>
      {!session && <div className="workbench-heading">
        <h1>{active.project.title}</h1>
        <button className="task-switch-action" type="button" aria-label="切换当前工作" onClick={onOpenTasks}><ListTodo/><span>切换任务</span></button>
      </div>}
       {!session && !isBreak && pending.length === 0 && !habitAwaiting && <>
         {isHabit ? <div className="workbench-context"><span>当前习惯建筑 · 第 {habit!.cycleNumber} 座</span><strong>{blueprintName(blueprintCatalog, active.project.blueprintId)}</strong><small>本周期 {habit!.completedFocusSessionIds.length} / {habit!.targetRounds} 轮 · {dailySummary}</small></div> : <div className="workbench-context"><span>当前小任务</span><strong>{subtask!.title}</strong><small>已完成 {Math.round(subtask!.progressBasisPoints / 100)}% · {dailySummary}</small></div>}
         <button type="button" className="plan-summary" aria-label="调整本次计划" aria-expanded={planOpen} onClick={() => setPlanOpen(true)}><span>{planSummary}</span><span>调整</span></button>
       </>}
       {habitAwaiting ? <HabitBuildingSelection state={state} active={active} resourcePacks={resourcePacks} run={run} targetRounds={preferences.habitTargetRounds}/> : pending.length > 0 ? <ProgressReportV7 active={active} run={run} onSubmitted={afterReport}/> : <>
         {session && <div className="focus-task-context"><span>{isHabit ? '本轮习惯' : '本轮任务'}</span><strong>{isHabit ? active.project.title : subtask!.title}</strong></div>}
        {isBreak && <div className="rest-summary"><span>休息时间</span><strong>{reconciledPlan?.endAfterBreak ? '小任务已完成' : '下一轮准备中'}</strong><small>{dailySummary}</small></div>}
        {(isBreak || session || reconciledPlan?.status === 'ready') && <div className={isBreak ? 'session-kind rest' : 'session-kind'}>{isBreak ? '放松一下，结束后会回到下一步。' : session ? `第 ${(reconciledPlan?.completedRounds ?? 0) + 1} / ${reconciledPlan?.totalRounds ?? 1} 轮专注` : `准备第 ${reconciledPlan!.completedRounds + 1} / ${reconciledPlan!.totalRounds} 轮`}</div>}
        {session && state.focusIntegrityPolicy.enabled && integrityFlash && <div className={session.integrity.effectiveExcursions > 0 ? 'focus-integrity-warning flash active' : 'focus-integrity-warning flash'} role="status"><AlertTriangle/>有效离开 {session.integrity.effectiveExcursions} / {state.focusIntegrityPolicy.maxEffectiveExcursions} 次</div>}
        {integrityFailure && <div className="focus-integrity-ended" role="alert"><AlertTriangle/>本轮专注因达到离开应用次数上限而结束。下次可以从这里继续。</div>}
         <FocusTimer mode={timerMode} endsAt={timerEndsAt} fallbackMs={timerFallbackMs} onElapsed={session ? reconcile : finishBreak}/>
        {isBreak ? <button className="primary secondary-action" onClick={() => { if (reconciledPlan?.endAfterBreak) setPlan(null); else { const { breakEndsAt: _breakEndsAt, ...withoutBreak } = reconciledPlan!; setPlan({ ...withoutBreak, status: 'ready' }); } }}>跳过休息</button>
          : reconciledPlan?.status === 'ready' ? <button className="primary" onClick={() => void startFocus()}><Clock3/>开始下一轮</button>
            : session ? <div className="immersive-controls">{controlsVisible
              ? <button className="destructive primary" onClick={() => void setEnding(true)}><Square/>结束本次专注</button>
              : <p className={hintVisible ? 'immersive-hint' : 'immersive-hint is-faded'} role="status">双击下方空白处唤出结束按钮</p>}</div>
            : <button className="primary" onClick={() => void startFocus()}><Clock3/>开始 {reconciledPlan?.totalRounds ?? rounds} 轮</button>}
      </>}
      {ending && session && (
         <EndFocusDialog taskTitle={isHabit ? active.project.title : subtask!.title} habit={isHabit} onClose={() => setEnding(false)} onInterrupt={interruptFocus} onCompleteEarly={completeEarly}/>
      )}
      {planOpen && !session && (isHabit
        ? <HabitFocusPlanSheet rounds={rounds} focusMinutes={preferences.habitFocusMinutes} breakMinutes={preferences.breakMinutes} locked={Boolean(reconciledPlan)} onRoundsChange={setRounds} onClose={() => setPlanOpen(false)}/>
        : <FocusPlanSheet subtasks={active.project.subtasks} selectedId={reconciledPlan?.subtaskId ?? selected!} rounds={rounds} focusMinutes={preferences.focusMinutes} breakMinutes={preferences.breakMinutes} locked={Boolean(reconciledPlan)} onSelect={setSelected} onRoundsChange={setRounds} onClose={() => setPlanOpen(false)}/>)}
    </section>}
  </div>;
}

function FocusPlanSheet({ subtasks, selectedId, rounds, focusMinutes, breakMinutes, locked, onSelect, onRoundsChange, onClose }: {
  subtasks: Array<{ id: string; title: string; progressBasisPoints: number }>;
  selectedId: string;
  rounds: number;
  focusMinutes: number;
  breakMinutes: number;
  locked: boolean;
  onSelect: (id: string) => void;
  onRoundsChange: (rounds: number) => void;
  onClose: () => void;
}) {
  return <div className="dialog-backdrop plan-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="focus-plan-sheet" role="dialog" aria-modal="true" aria-labelledby="focus-plan-title">
      <div className="sheet-heading"><div><span className="eyebrow">本次计划</span><h2 id="focus-plan-title">安排下一轮</h2></div><button type="button" className="dialog-close" aria-label="关闭本次计划" onClick={onClose}><X/></button></div>
      <ChoiceMenu label="本次专注" value={selectedId} disabled={locked} onChange={onSelect} options={subtasks.map((subtask) => ({ id: subtask.id, label: subtask.title, detail: `已完成 ${Math.round(subtask.progressBasisPoints / 100)}%` }))}/>
      <div className="round-picker" aria-label="专注轮数"><span>计划轮数</span><div>{[1, 2, 3, 4].map((value) => <button key={value} type="button" aria-pressed={rounds === value} disabled={locked} onClick={() => onRoundsChange(value)}>{value} 轮</button>)}</div></div>
      <p className="plan-sheet-note">每轮 {focusMinutes} 分钟专注{breakMinutes > 0 ? `；多轮之间休息 ${breakMinutes} 分钟。` : '；休息已关闭。'}{locked ? ' 当前计划已开始，轮数和任务将在本轮计划结束后生效。' : ''}</p>
      <button type="button" className="primary" onClick={onClose}>确认计划</button>
    </section>
  </div>;
}

function HabitFocusPlanSheet({ rounds, focusMinutes, breakMinutes, locked, onRoundsChange, onClose }: {
  rounds: number;
  focusMinutes: number;
  breakMinutes: number;
  locked: boolean;
  onRoundsChange: (rounds: number) => void;
  onClose: () => void;
}) {
  return <div className="dialog-backdrop plan-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="focus-plan-sheet" role="dialog" aria-modal="true" aria-labelledby="habit-focus-plan-title">
      <div className="sheet-heading"><div><span className="eyebrow">本次计划</span><h2 id="habit-focus-plan-title">安排习惯专注</h2></div><button type="button" className="dialog-close" aria-label="关闭本次计划" onClick={onClose}><X/></button></div>
      <div className="round-picker" aria-label="习惯专注轮数"><span>计划轮数</span><div>{[1, 2, 3, 4].map((value) => <button key={value} type="button" aria-pressed={rounds === value} disabled={locked} onClick={() => onRoundsChange(value)}>{value} 轮</button>)}</div></div>
      <p className="plan-sheet-note">每轮 {focusMinutes} 分钟专注{breakMinutes > 0 ? `；多轮之间休息 ${breakMinutes} 分钟。` : '；休息已关闭。'}每个完成或提前完成的轮次都会推进当前建筑。{locked ? ' 当前计划已开始，轮数将在本轮计划结束后生效。' : ''}</p>
      <button type="button" className="primary" onClick={onClose}>确认计划</button>
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
  return <div className="report v7-progress-report"><Check/><span className="eyebrow">本轮已记录</span><h2>这次工作推进到哪里？</h2><p><strong>{task.title}</strong><br/>当前总进度 {Math.round(task.progressBasisPoints/100)}%。提交后会更新建筑的永久施工阶段。</p><div className="report-options">{options.map((value)=><button key={value} onClick={()=>void submit(value)}>{value===task.progressBasisPoints?`保持 ${value/100}%`:value===10000?'完成小任务':`推进至 ${value/100}%`}</button>)}</div></div>;
}

const WorldCanvasV7 = memo(function WorldCanvasV7({service,resourcePacks,lightingQuality,constructionOutlineVisibility,environmentStyle,worldSeed,terrainGenerationVersion,constructionFeedback=0,sessionActive=false,focusedProjectId,onSelectProject,onClearWorldFocus,visible,onPickTerrain,pickedCell}:{service:ApplicationService;resourcePacks:ResourcePackRepository;lightingQuality:VoxelLightingQuality;constructionOutlineVisibility:ConstructionOutlineVisibility;environmentStyle:WorldEnvironmentStyle;worldSeed:string;terrainGenerationVersion:4;constructionFeedback?:number;sessionActive?:boolean;focusedProjectId:string|null;onSelectProject:(projectId:string)=>void;onClearWorldFocus:()=>void;visible:boolean;onPickTerrain:(position:{x:number;y:number;z:number})=>void;pickedCell:{x:number;y:number;z:number}|null}) {
  const ref=useRef<HTMLCanvasElement>(null); const renderer=useRef<VoxelRenderer|null>(null); const catalog=useBlueprintCatalog(); const world=service.worldProjection(); const state=service.snapshot(); const importedRef=useRef(new Map<string,BlueprintV1>()); const focusRef=useRef(focusedProjectId); const selectRef=useRef(onSelectProject); const visibleRef=useRef(visible); const appliedPackRef=useRef<string|null|undefined>(undefined); const sessionActiveRef=useRef(sessionActive); const [ready,setReady]=useState(false);
  importedRef.current=new Map(world.projects.flatMap(project=>project.building.importedBlueprint?[[project.building.blueprintId,project.building.importedBlueprint as BlueprintV1]]:[])); focusRef.current=focusedProjectId; selectRef.current=onSelectProject; visibleRef.current=visible;
  const blueprintLabel=(blueprintId:string,importedTitle?:string)=>state.buildingBlueprintResources.find(resource=>resource.id===blueprintId)?.displayName??importedTitle??blueprintName(catalog,blueprintId);
  const decorationDates=decorationDatesByProject(state); const snapshotKey=world.projects.map(project=>`${project.project.id}:${project.building.blueprintId}:${project.building.completionBasisPoints}:${project.building.conditionBasisPoints}:${project.isActive}:${project.settlementIndex}:${(decorationDates.get(project.project.id)??[]).join(',')}:${project.importedDecorations.map(reward=>`${reward.rewardId}@${reward.localPosition.x},${reward.localPosition.z},${reward.rotationQuarterTurns}`).join(';')}`).join('|'); const snapshots=useMemo(()=>toVoxelWorlds(world.projects,state),[snapshotKey]); const summary=world.projects.map(project=>`${project.project.title}，${blueprintLabel(project.building.blueprintId,project.building.importedBlueprint?.title)}，${project.isActive?'正在建造':project.project.status==='paused'?'暂停建造':'纪念建筑'}，建造进度 ${Math.round(project.building.completionBasisPoints/100)}%，保存状况 ${conditionLabel(project.building.conditionBasisPoints)}`).join('；'); const focusedTitle=world.projects.find(project=>project.project.id===focusedProjectId)?.project.title;
  useEffect(()=>{let cancelled=false;let current:VoxelRenderer|null=null;setReady(false);let raf=0;let timer=0;const begin=()=>{void loadVoxelModule().then(async({createVoxelRenderer,resolveBuiltinBlueprint})=>{if(cancelled||!ref.current)return;current=createVoxelRenderer(ref.current,{resolveBlueprint:id=>importedRef.current.get(id)??resolveBuiltinBlueprint(id),resourcePackAtlasMaximumSize:resourcePackAtlasMaximumSizeForTest(),lightingQuality,constructionOutlineVisibility,environmentStyle,worldSeed,terrainGenerationVersion,onSelectProject:projectId=>selectRef.current(projectId),onPickTerrain,debugFlatColors:new URLSearchParams(location.search).has('flat'),debugVoidScan:new URLSearchParams(location.search).has('voidscan')});renderer.current=current;current.setReducedMotion(matchMedia('(prefers-reduced-motion: reduce)').matches);current.setVisible(visibleRef.current);current.setWorlds(toVoxelWorlds(service.worldProjection().projects,service.snapshot()));current.focusProject(focusRef.current);const pack=await resourcePacks.getActive();appliedPackRef.current=pack?`${pack.id}:${pack.manifest.pack.packFormat}`:null;if(!cancelled&&current)await current.setResourcePack(pack?{id:pack.id,manifest:pack.manifest}:null);if(!cancelled)setReady(true);}).catch(error=>{console.error('Voxel world initialization failed',error);if(!cancelled)setReady(true);});};raf=requestAnimationFrame(()=>{timer=window.setTimeout(begin,0);});return()=>{cancelled=true;cancelAnimationFrame(raf);window.clearTimeout(timer);current?.dispose();if(renderer.current===current)renderer.current=null;};},[service,resourcePacks,lightingQuality,constructionOutlineVisibility,environmentStyle,worldSeed,terrainGenerationVersion]);
  useEffect(()=>{renderer.current?.setVisible(visible);},[visible]);
  // IF-01: bounded construction pulses — round completed (stronger) and focus started (gentle).
  useEffect(()=>{if(constructionFeedback>0)renderer.current?.playConstructionPulse(1);},[constructionFeedback]);
  useEffect(()=>{const previous=sessionActiveRef.current;sessionActiveRef.current=sessionActive;if(sessionActive&&!previous)renderer.current?.playConstructionPulse(0.6);},[sessionActive]);
  // MT-02: with the renderer resident, the pack switched in settings must apply when the pane returns; re-apply only when the active pack actually changed.
  useEffect(()=>{if(!visible)return;let cancelled=false;void resourcePacks.getActive().then(pack=>{if(cancelled||!renderer.current)return;const key=pack?`${pack.id}:${pack.manifest.pack.packFormat}`:null;if(appliedPackRef.current===key)return;appliedPackRef.current=key;void renderer.current!.setResourcePack(pack?{id:pack.id,manifest:pack.manifest}:null).then(()=>{if(!cancelled)renderer.current?.setVisible(true);});});return()=>{cancelled=true;};},[visible,resourcePacks]);
  useEffect(()=>{renderer.current?.setWorlds(snapshots);},[snapshots]);
  useEffect(()=>{renderer.current?.focusProject(focusedProjectId);},[focusedProjectId]);
  const focusedProject=world.projects.find(project=>project.project.id===focusedProjectId);
  const memory=focusedProject?buildingMemory(state,focusedProject.project.id):null;
  const focusedBlueprint=focusedProject?blueprintLabel(focusedProject.building.blueprintId,focusedProject.building.importedBlueprint?.title):'';
  return <><figure className={focusedProjectId?'world is-project-focused':'world'}><canvas ref={ref} role="img" aria-label="项目建筑世界" aria-describedby="world-summary"/>{visible&&<figcaption id="world-summary" className="sr-only">林边聚落，共 {world.projects.length} 栋建筑。{summary}</figcaption>}{visible&&pickedCell&&<div className="world-pick-chip" role="status" data-testid="world-pick">x {pickedCell.x} · z {pickedCell.z} · 高 {pickedCell.y}</div>}{visible&&<div className="world-hud"><span>{focusedTitle?`正在查看 · ${focusedTitle}`:`林边聚落 · ${world.projects.length} 栋`}</span><div className="world-hud-actions">{focusedProjectId&&<button title="返回完整聚落" aria-label="返回完整聚落" onClick={onClearWorldFocus}><MapIcon/></button>}<button title="重置视角" aria-label="重置视角" onClick={()=>renderer.current?.resetCamera()}><RotateCcw/></button></div></div>}{visible&&focusedProject&&<div className="world-building-details" role="status"><div><strong>{focusedProject.project.title}</strong><span>{focusedProject.project.status==='monument'?'纪念建筑':focusedProject.isActive?'正在建造':'暂停建造'} · {conditionLabel(focusedProject.building.conditionBasisPoints)}</span><small>{focusedBlueprint} · {constructionStage(focusedProject.building.completionBasisPoints).replace('施工阶段：','')}</small><small>{memory!.minutes>0?`累计 ${memory!.minutes} 分钟 · ${memory!.successfulRounds} 轮有效完成${memory!.lastDate?` · 最近 ${memory!.lastDate}`:''}`:'还没有有效专注记录'}</small></div><b>{Math.round(focusedProject.building.completionBasisPoints/100)}%</b></div>}{visible&&constructionFeedback>0&&<div key={constructionFeedback} className="construction-feedback" role="status"><Hammer/><span>材料已送达，继续建造</span><i/><i/><i/></div>}</figure>{!ready&&<LoadingPage status="正在建造世界…"/>}</>;
});

type FocusTimerMode = 'plan' | 'focus' | 'break' | 'ready';

function FocusTimer({ mode, endsAt, fallbackMs, onElapsed }: { mode?: FocusTimerMode; endsAt?: string; fallbackMs: number; onElapsed: () => void }) {
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
  const label = timerMode === 'plan' ? '计划总时长' : timerMode === 'break' ? '休息剩余' : timerMode === 'ready' ? '下一轮时长' : '本轮剩余';
  const clock = formatClockDuration(remaining);
  return <div className={`timer timer-${timerMode}`} role={endsAt ? 'timer' : undefined} aria-label={`${label} ${clock}`}>
    <span className="timer-label">{label}</span>
    <strong className="timer-value">{clock}</strong>
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

const WorldCanvas = memo(function WorldCanvas({service,resourcePacks,lightingQuality,constructionOutlineVisibility,constructionFeedback=0}:{service:ApplicationService;resourcePacks:ResourcePackRepository;lightingQuality:VoxelLightingQuality;constructionOutlineVisibility:ConstructionOutlineVisibility;constructionFeedback?:number}) {
  const ref=useRef<HTMLCanvasElement>(null); const renderer=useRef<VoxelRenderer|null>(null); const catalog=useBlueprintCatalog(); const world=service.worldProjection(); const state=service.snapshot(); const importedRef=useRef(new Map<string,BlueprintV1>()); importedRef.current=new Map(world.projects.flatMap(project=>project.building.importedBlueprint?[[project.building.blueprintId,project.building.importedBlueprint as BlueprintV1]]:[])); const decorationDates=decorationDatesByProject(state); const snapshotKey=world.projects.map(project=>`${project.project.id}:${project.building.blueprintId}:${project.building.completionBasisPoints}:${project.building.conditionBasisPoints}:${project.isActive}:${project.settlementIndex}:${(decorationDates.get(project.project.id)??[]).join(',')}:${project.importedDecorations.map(reward=>`${reward.rewardId}@${reward.localPosition.x},${reward.localPosition.z},${reward.rotationQuarterTurns}`).join(';')}`).join('|'); const snapshots=useMemo(()=>toVoxelWorlds(world.projects,state),[snapshotKey]); const summary=world.projects.map(project=>`${project.project.title}，${project.building.importedBlueprint?.title??blueprintName(catalog,project.building.blueprintId)}，${project.isActive?'正在建造':project.project.status==='paused'?'暂停建造':'纪念建筑'}，建造进度 ${Math.round(project.building.completionBasisPoints/100)}%，保存状况 ${conditionLabel(project.building.conditionBasisPoints)}`).join('；');
  useEffect(()=>{let cancelled=false;let current:VoxelRenderer|null=null;void loadVoxelModule().then(async({createVoxelRenderer,resolveBuiltinBlueprint})=>{if(cancelled||!ref.current)return;const snapshot=service.snapshot();current=createVoxelRenderer(ref.current,{resolveBlueprint:id=>importedRef.current.get(id)??resolveBuiltinBlueprint(id),resourcePackAtlasMaximumSize:resourcePackAtlasMaximumSizeForTest(),lightingQuality,constructionOutlineVisibility,environmentStyle:snapshot.worldSettings.environmentStyle,worldSeed:snapshot.worldSettings.worldSeed,terrainGenerationVersion:snapshot.worldSettings.terrainGenerationVersion,debugFlatColors:new URLSearchParams(location.search).has('flat'),debugVoidScan:new URLSearchParams(location.search).has('voidscan')});renderer.current=current;current.setReducedMotion(matchMedia('(prefers-reduced-motion: reduce)').matches);current.setWorlds(toVoxelWorlds(service.worldProjection().projects,snapshot));const pack=await resourcePacks.getActive();if(!cancelled&&current)await current.setResourcePack(pack?{id:pack.id,manifest:pack.manifest}:null);}).catch(error=>console.error('Voxel world initialization failed',error));return()=>{cancelled=true;current?.dispose();if(renderer.current===current)renderer.current=null;};},[service,resourcePacks,lightingQuality,constructionOutlineVisibility,state.worldSettings.environmentStyle,state.worldSettings.worldSeed,state.worldSettings.terrainGenerationVersion]);
  useEffect(()=>{renderer.current?.setWorlds(snapshots);},[snapshots]);
  return <figure className="world"><canvas ref={ref} role="img" aria-label="项目建筑世界" aria-describedby="world-summary"/><figcaption id="world-summary" className="sr-only">林边聚落，共 {world.projects.length} 栋建筑。{summary}</figcaption><div className="world-hud"><span>林边聚落 · {world.projects.length} 栋</span><button title="重置视角" aria-label="重置视角" onClick={()=>renderer.current?.resetCamera()}><RotateCcw/></button></div>{constructionFeedback>0&&<div key={constructionFeedback} className="construction-feedback" role="status"><Hammer/><span>材料已送达，继续建造</span><i/><i/><i/></div>}</figure>;
});
function toVoxelWorlds(projects:ReturnType<ApplicationService['worldProjection']>['projects'],state?:ReturnType<ApplicationService['snapshot']>):WorldSnapshot[] { const dates=state?decorationDatesByProject(state):new Map<string,string[]>();return projects.map(project=>({projectId:project.project.id,blueprintId:project.building.blueprintId,buildingCompletionBasisPoints:project.building.completionBasisPoints,buildingConditionBasisPoints:project.building.conditionBasisPoints,isMonument:project.project.status==='monument',isActive:project.isActive,settlementIndex:project.settlementIndex,decorationDates:dates.get(project.project.id)??[],importedDecorations:project.importedDecorations.map(reward=>({...reward,blueprint:reward.blueprint as BlueprintV1}))})); }
function decorationDatesByProject(state:ReturnType<ApplicationService['snapshot']>):Map<string,string[]> { const result=new Map<string,string[]>();const importedDates=new Set(state.decorationRewards.map(reward=>reward.date));for(const goal of state.dailyGoals){if(!goal.reachedAt||importedDates.has(goal.date))continue;const session=state.focusHistory.find(candidate=>candidate.status!=='interrupted'&&candidate.completedAt===goal.reachedAt);if(!session)continue;const dates=result.get(session.projectId)??[];dates.push(goal.date);result.set(session.projectId,dates);}return result; }
function conditionLabel(value:number) { return value>=8000?'完整':value>=5000?'风化':'破损'; }
function toImportedBlueprint(blueprint:BlueprintV1):ImportedBlueprintV1 { return {...blueprint,voxels:blueprint.voxels.map(voxel=>({...voxel,stage:stageForBuildOrder(voxel.buildOrder)}))}; }
function stageForBuildOrder(value:number):ImportedBlueprintStage { return value<1800?'foundation':value<3800?'frame':value<6500?'walls':value<8800?'roof':'details'; }
function decorationBlueprintLimitError(blueprint:BlueprintV1):string { const width=blueprint.bounds.maxX-blueprint.bounds.minX+1;const height=blueprint.bounds.maxY-blueprint.bounds.minY+1;const depth=blueprint.bounds.maxZ-blueprint.bounds.minZ+1;if(width>12||depth>12||height>16)return`这份蓝图为 ${width} x ${height} x ${depth}，奖励装饰上限为 12 x 12 x 16。`;if(blueprint.voxels.length>2000)return`这份蓝图含 ${blueprint.voxels.length.toLocaleString('zh-CN')} 个方块，奖励装饰上限为 2,000 个。`;return''; }
function litematicErrorMessage(error:unknown):string { const code=typeof error==='object'&&error!==null&&'code'in error?String((error as {code:unknown}).code):'';if(code==='INPUT_TOO_LARGE'||code==='NBT_TOO_LARGE'||code==='LIMIT_EXCEEDED')return'图纸超过首版安全限制：文件 10 MB、占地 48 x 48、高度 128、最多 100,000 个方块。';if(code==='NOT_GZIP'||code==='INVALID_GZIP'||code==='INVALID_NBT'||code==='INVALID_LITEMATIC')return'无法读取这份 .litematic，请确认文件完整且由 Litematica 导出。';return error instanceof Error?error.message:'图纸导入失败，请换一份文件重试。'; }

function ProgressReport({active,run,onSubmitted}:{active:NonNullable<ReturnType<ApplicationService['activeProjectProjection']>>;run:(c:ApplicationCommand)=>Promise<any>;onSubmitted:()=>void}) { const session=active.unreportedCompletedSessions[0]!; const task=active.project.subtasks.find(s=>s.id===session.subtaskId)!; const submit=async(value:number)=>{const result=await run({type:'ReportSubtaskProgress',subtaskId:task.id,focusSessionIds:[session.id],progressBasisPoints:value});if(result?.ok)onSubmitted();};return <div className="report"><Check/><h2>这次专注完成了多少？</h2><p>{task.title}</p><div className="report-options">{[0,2500,5000,7500,10000].filter(n=>n>=task.progressBasisPoints).map(n=><button key={n} onClick={()=>void submit(n)}>{n===0?'没有进展':`${n/100}%`}</button>)}</div></div>; }

const INTERRUPTION_OPTIONS:readonly {value:FocusInterruptionCategory|null;label:string}[]=[
  {value:'external-interruption',label:'外部打扰'}, {value:'task-blocked',label:'任务受阻'},
  {value:'fatigue',label:'需要休息'}, {value:'priority-changed',label:'优先级变化'},
  {value:'device-or-app',label:'设备或应用问题'}, {value:'other',label:'其他'}, {value:null,label:'不记录'},
];

function EndFocusDialog({taskTitle,habit=false,onClose,onInterrupt,onCompleteEarly}:{taskTitle:string;habit?:boolean;onClose:()=>void;onInterrupt:(reason:FocusInterruptionCategory|null)=>Promise<void>;onCompleteEarly:()=>Promise<void>}){
  const [mode,setMode]=useState<'choose'|'interrupt'>('choose');const [busy,setBusy]=useState(false);const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{closeRef.current?.focus();const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy)onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[busy,onClose]);
  const early=async()=>{setBusy(true);try{await onCompleteEarly();}finally{setBusy(false);}};
  const interrupt=async(reason:FocusInterruptionCategory|null)=>{setBusy(true);try{await onInterrupt(reason);}finally{setBusy(false);}};
  return <div className="dialog-backdrop" role="presentation"><div className="confirm-dialog end-focus-dialog" role="dialog" aria-modal="true" aria-labelledby="end-focus-title"><button ref={closeRef} className="dialog-close" aria-label="关闭结束专注窗口" disabled={busy} onClick={onClose}><X/></button><h2 id="end-focus-title">{mode==='choose'?'如何结束这次专注？':'这次为什么中断？'}</h2><p>{mode==='choose'?taskTitle:'选择一项便于以后复盘，也可以不记录。'}</p>{mode==='choose'?<div className="end-focus-choices"><button disabled={busy} onClick={()=>setMode('interrupt')}><Square/><span><strong>中断本轮</strong><small>保留已有任务进度，不计完整轮次</small></span></button><button disabled={busy} onClick={()=>void early()}><Check/><span><strong>{habit?'提前完成本轮':'提前完成任务'}</strong><small>{habit?'推进当前习惯建筑，并结束本轮计划':'将当前小任务标为完成并结束本轮计划'}</small></span></button></div>:<><div className="interruption-options">{INTERRUPTION_OPTIONS.map(option=><button key={option.value??'none'} disabled={busy} onClick={()=>void interrupt(option.value)}>{option.label}</button>)}</div><button className="dialog-back" disabled={busy} onClick={()=>setMode('choose')}>返回</button></>}</div></div>;
}

const PROJECT_COLORS=['#276749','#4d8f60','#167a72','#a0652b','#5b7a99','#6b6f4b'] as const;
function projectColor(index:number){return PROJECT_COLORS[index%PROJECT_COLORS.length]!;}

function StatsScreen({state}:{state:ReturnType<ApplicationService['snapshot']>}) {
  const week=periodStats(state,'week');
  const heatmap=focusHeatmapStats(state);
  const today=localDateOf(new Date(),state.calendar.timeZone);
  const recent7=focusWindowSummary(state,today,7);
  const previous7=focusWindowSummary(state,addLocalDays(today,-7),7);
  const recent30=focusWindowSummary(state,today,30);
  const allocationAll=projectFocusAllocation(state,today,30);
  const allocation=allocationAll.slice(0,5);
  const otherMinutes=allocationAll.slice(5).reduce((sum,item)=>sum+item.minutes,0);
  const allocationTotal=allocationAll.reduce((sum,item)=>sum+item.minutes,0);
  const weeklyDelta=recent7.minutes-previous7.minutes;
  const hours=focusHourDistribution(state,today,90);
  const peakHours=Math.max(...hours.map(bucket=>bucket.minutes),0);
  const peak=peakHours>0?hours.reduce((best,bucket)=>bucket.minutes>best.minutes?bucket:best,hours[0]!):null;
  const totals=settlementTotals(state);
  const projectTitles=new Map(state.projects.map(project=>[project.id,project.title]));
  const colorIndexByProject=new Map<string,number>();
  allocationAll.forEach((item,index)=>colorIndexByProject.set(item.projectId,index));
  let nextColorIndex=allocationAll.length;
  const hourProjectIds=[...new Set(hours.flatMap(bucket=>bucket.projects.map(entry=>entry.projectId)))];
  for(const projectId of hourProjectIds){if(!colorIndexByProject.has(projectId))colorIndexByProject.set(projectId,nextColorIndex++);}
  const colorFor=(projectId:string)=>projectColor(colorIndexByProject.get(projectId)??0);
  return <section className="page stats-page">
    <h1>专注轨迹</h1><p className="stats-intro">所有数据只保存在本机；中断前的有效投入同样计入。</p>
    <FocusHeatmap heatmap={heatmap}/>
    <section className="stats-overview" aria-labelledby="stats-overview-title">
      <div className="stats-section-heading"><div><h2 id="stats-overview-title">本周</h2><p>从周一到今天的记录</p></div><span>{formatFocusMinutes(week.minutes)}</span></div>
      <div className="stats-grid">
        <div className="stats-duration"><strong>{formatFocusMinutes(week.minutes)}</strong><span>有效专注时长</span></div>
        <div><strong>{week.completed}</strong><span>完整轮次</span></div>
        <div><strong>{week.early}</strong><span>提前完成</span></div>
        <div><strong>{week.activeDays}</strong><span>活跃天数</span></div>
      </div>
      <div className="stats-detail-line" aria-label="本周记录详情"><span><b>{week.completed+week.early}</b> 次有效完成</span><span><b>{week.interrupted}</b> 次中断</span><span><b>{week.rate}%</b> 完成率</span></div>
    </section>
    <section className="stats-rhythm" aria-labelledby="stats-rhythm-title"><div className="stats-section-heading"><div><h2 id="stats-rhythm-title">近期专注</h2><p>回顾近 7 天与近 30 天的有效专注时长。</p></div></div><div className="rhythm-grid"><div><span>近 7 天</span><strong>{formatFocusMinutes(recent7.minutes)}</strong><small>{recent7.activeDays} 个活跃日</small></div><div><span>近 30 天</span><strong>{formatFocusMinutes(recent30.minutes)}</strong><small>{recent30.activeDays} 个活跃日</small></div></div><p className="rhythm-comparison">{weeklyDelta===0?'与此前 7 天的有效专注时长相近':`比此前 7 天${weeklyDelta>0?'多':'少'}专注 ${formatFocusMinutes(Math.abs(weeklyDelta))}`}</p></section>
    <section className="focus-hour-card" aria-labelledby="focus-hour-title"><div className="stats-section-heading"><div><h2 id="focus-hour-title">专注时段</h2><p>近 90 天有效专注按结束时刻的分布</p></div>{peak&&<span>高峰 {peak.hour}:00 前后</span>}</div><div className="focus-hour-chart" role="img" aria-label={peak?`近 90 天按小时的有效专注分布，高峰在 ${peak.hour} 点前后`:'近 90 天还没有有效专注记录'}>{hours.map(bucket=><div key={bucket.hour} className="focus-hour-column" title={`${bucket.hour}:00 前后 · 有效专注 ${bucket.minutes} 分钟`}>{bucket.projects.map(entry=><i key={entry.projectId} style={{height:`${Math.max(2,Math.round(entry.minutes/Math.max(peakHours,1)*100))}%`,background:colorFor(entry.projectId)}}/>)}</div>)}</div><div className="focus-hour-axis" aria-hidden="true"><span>0时</span><span>6时</span><span>12时</span><span>18时</span><span>23时</span></div>{hourProjectIds.length>0&&<ul className="focus-hour-legend">{hourProjectIds.map(projectId=><li key={projectId}><i style={{background:colorFor(projectId)}}/>{projectTitles.get(projectId)??'已移除任务'}</li>)}</ul>}</section>
    <section className="project-allocation" aria-labelledby="project-allocation-title"><div className="stats-section-heading"><div><h2 id="project-allocation-title">项目投入</h2><p>近 30 天有效专注时长</p></div>{allocationTotal>0&&<span>{formatFocusMinutes(allocationTotal)}</span>}</div>{allocationAll.length===0?<p>还没有可分配的有效投入。</p>:<><div className="allocation-bar" role="img" aria-label={`近 30 天项目投入：${allocation.map(item=>`${item.title} ${formatFocusMinutes(item.minutes)}`).join('，')}${otherMinutes>0?`，其他 ${formatFocusMinutes(otherMinutes)}`:''}`}>{allocation.map(item=><i key={item.projectId} style={{width:`${item.minutes/allocationTotal*100}%`,background:colorFor(item.projectId)}} title={`${item.title} · ${formatFocusMinutes(item.minutes)} · ${Math.round(item.minutes/allocationTotal*100)}%`}/>)}{otherMinutes>0&&<i className="allocation-other" style={{width:`${otherMinutes/allocationTotal*100}%`}} title={`其他 · ${formatFocusMinutes(otherMinutes)} · ${Math.round(otherMinutes/allocationTotal*100)}%`}/>}</div><ul className="allocation-legend">{allocation.map(item=><li key={item.projectId}><i style={{background:colorFor(item.projectId)}}/><div><strong>{item.title}</strong><span>{formatFocusMinutes(item.minutes)} · {Math.round(item.minutes/allocationTotal*100)}%</span></div></li>)}{otherMinutes>0&&<li><i className="allocation-other"/><div><strong>其他</strong><span>{formatFocusMinutes(otherMinutes)} · {Math.round(otherMinutes/allocationTotal*100)}%</span></div></li>}</ul></>}</section>
    <section className="interruption-summary focus-hour-card" aria-labelledby="interruption-summary-title"><h2 id="interruption-summary-title">本周中断原因</h2><p className="interruption-note">共 {week.interrupted} 次中断</p>{week.reasons.length===0?<p>这个周期没有已归类的中断。</p>:<ul className="interruption-list">{week.reasons.map(reason=><li key={reason.value}><div><span>{reason.label}</span><strong>{reason.count} 次{week.interrupted>0?` · ${Math.round(reason.count/week.interrupted*100)}%`:''}</strong></div><i className="interruption-bar"><b style={{width:`${Math.max(6,reason.count/Math.max(week.interrupted,1)*100)}%`}}/></i></li>)}</ul>}</section>
    <section className="settlement-totals" aria-labelledby="settlement-totals-title"><div className="stats-section-heading"><div><h2 id="settlement-totals-title">聚落总览</h2><p>从第一天起累计</p></div></div><div className="settlement-rows"><div><span>累计有效专注</span><strong>{formatFocusMinutes(totals.totalMinutes)}</strong></div><div><span>有效轮次</span><strong>{totals.completedRounds}</strong></div><div><span>建成建筑</span><strong>{totals.buildings}</strong></div></div></section>
    <p className="muted stats-note">热力图按实际专注时长统计，完整、提前完成和中断前的有效时间都会计入。</p>
  </section>;
}

function FocusHeatmap({heatmap}:{heatmap:ReturnType<typeof focusHeatmapStats>}) {
  return <section className="focus-heatmap-card" aria-labelledby="focus-heatmap-title">
    <div className="stats-section-heading"><div><h2 id="focus-heatmap-title">近 26 周</h2><p>按有效专注时长着色</p></div><span>{formatFocusMinutes(heatmap.totalMinutes)}</span></div>
    <div className="focus-heatmap-scroll"><div className="focus-heatmap" role="img" aria-label={`近 26 周有效专注热力图，共 ${heatmap.totalMinutes} 分钟，${heatmap.activeDays} 个活跃日`}>
      <div className="focus-heatmap-months" aria-hidden="true">{heatmap.months.map(month=><span key={month.column} style={{gridColumn:`${month.column} / span ${month.span}`}}>{month.label}</span>)}</div>
      <div className="focus-heatmap-content"><div className="focus-heatmap-weekdays" aria-hidden="true"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span></span></div><div className="focus-heatmap-grid">{heatmap.weeks.flatMap(week=>week.days.map(day=><span key={day.date} className={`focus-heatmap-cell heat-level-${day.level}${day.future?' is-future':''}`} title={`${heatmapDateLabel(day.date)}：有效专注 ${day.minutes} 分钟`}/>))}</div></div>
    </div></div>
    <div className="focus-heatmap-legend" aria-label="色阶：0、少于 90、90、180、270、360 分钟以上">{([['0',0],['<90',1],['90',2],['180',3],['270',4],['360+',5]] as const).map(([label,level])=><span className="heatmap-legend-item" key={level}><i className={`heat-level-${level}`}/>{label}</span>)}</div>
  </section>;
}
function SettingsScreen({service,resourcePacks,state,run,refresh,preferences,onPreferencesChange}:{service:ApplicationService;resourcePacks:ResourcePackRepository;state:ReturnType<ApplicationService['snapshot']>;run:(c:ApplicationCommand)=>Promise<unknown>;refresh:()=>void;preferences:FocusPreferences;onPreferencesChange:(value:FocusPreferences)=>void}) {
  const update=(key:'focusMinutes'|'habitFocusMinutes'|'habitTargetRounds'|'breakMinutes',value:number)=>onPreferencesChange({...preferences,[key]:value});
  return <section className="page settings-page">
    <header className="settings-head"><h1>设置</h1><p>专注节奏、聚落外观与本地数据。</p></header>
    <section className="settings-group" aria-labelledby="settings-group-timing">
      <h2 id="settings-group-timing">计时</h2>
      <div className="setting-row">
        <div className="setting-name"><span>普通任务专注</span></div>
        <label className="number-field"><DeferredNumberInput ariaLabel="普通任务专注分钟" min={1} max={180} value={preferences.focusMinutes} onCommit={value=>update('focusMinutes',value)}/><span>分钟</span></label>
      </div>
      <div className="setting-row">
        <div className="setting-name"><span>习惯任务专注</span></div>
        <label className="number-field"><DeferredNumberInput ariaLabel="习惯任务专注分钟" min={1} max={180} value={preferences.habitFocusMinutes} onCommit={value=>update('habitFocusMinutes',value)}/><span>分钟</span></label>
      </div>
      <div className="setting-row">
        <div className="setting-name"><span>每座习惯建筑</span></div>
        <label className="number-field"><DeferredNumberInput ariaLabel="每座习惯建筑轮数" min={10} max={30} value={preferences.habitTargetRounds} onCommit={value=>update('habitTargetRounds',value)}/><span>轮</span></label>
      </div>
      <div className="setting-row">
        <div className="setting-name"><span>每轮休息</span><small>0 表示不休息</small></div>
        <label className="number-field"><DeferredNumberInput ariaLabel="每轮休息分钟" min={0} max={60} value={preferences.breakMinutes} onCommit={value=>update('breakMinutes',value)}/><span>分钟</span></label>
      </div>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-protection">
      <h2 id="settings-group-protection">专注保护</h2>
      <FocusIntegritySetting policy={state.focusIntegrityPolicy} run={run}/>
      <PlannedFocusDaysSetting state={state} run={run}/>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-notice">
      <h2 id="settings-group-notice">提醒</h2>
      <NotificationHealthSetting service={service}/>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-world">
      <h2 id="settings-group-world">世界</h2>
      <div className="setting-row toggle-row">
        <div className="setting-name"><span>聚落环境</span><small>只改变外围地形</small></div>
        <div className="text-toggle" role="group" aria-label="聚落环境">{([['natural-valley','自然山谷'],['classic-island','经典空岛']] as const).map(([value,label])=><button key={value} aria-pressed={state.worldSettings.environmentStyle===value} onClick={()=>void run({type:'ConfigureWorldEnvironment',environmentStyle:value})}>{label}</button>)}</div>
      </div>
      <div className="setting-row toggle-row">
        <div className="setting-name"><span>光影质量</span><small>更高档位增加耗电</small></div>
        <div className="text-toggle" role="group" aria-label="光影质量">{([['auto','自动'],['performance','流畅'],['balanced','均衡'],['cinematic','精致']] as const).map(([value,label])=><button key={value} aria-pressed={preferences.lightingQuality===value} onClick={()=>onPreferencesChange({...preferences,lightingQuality:value})}>{label}</button>)}</div>
      </div>
      <div className="setting-row toggle-row">
        <div className="setting-name"><span>施工轮廓</span><small>未建部分的显示范围</small></div>
        <div className="text-toggle" role="group" aria-label="施工轮廓">{([['off','关闭'],['current','当前'],['all','全部']] as const).map(([value,label])=><button key={value} aria-pressed={preferences.constructionOutlineVisibility===value} onClick={()=>onPreferencesChange({...preferences,constructionOutlineVisibility:value})}>{label}</button>)}</div>
      </div>
      <div className="setting-row">
        <div className="setting-name"><span>建筑腐败</span><small>错过的计划日会风化建筑，专注可修复</small></div>
        <label className="switch-control"><input aria-label="开启建筑腐败" type="checkbox" checked={state.decayPolicy.enabled} onChange={event=>void run(event.target.checked?{type:'EnableDecay',damagePerMissedPlannedDayBasisPoints:500,gracePlannedDays:3}:{type:'DisableDecay'})}/></label>
      </div>
    </section>
    <BuildingBlueprintPanel resources={state.buildingBlueprintResources} run={run}/>
    <ResourcePackPanel repository={resourcePacks}/>
    <BackupPanel service={service} onChanged={refresh}/>
  </section>;
}

function NotificationHealthSetting({service}:{service:ApplicationService}) {
  const [capability,setCapability]=useState<NotificationCapability|null>(null);const [failed,setFailed]=useState(false);const [loading,setLoading]=useState(true);const [native,setNative]=useState(false);
  const refresh=useCallback(()=>{setLoading(true);setFailed(false);void service.notificationCapability().then(setCapability).catch(()=>setFailed(true)).finally(()=>setLoading(false));},[service]);
  useEffect(refresh,[refresh]);
  useEffect(()=>{void import('@tomato-clock/platform-capacitor').then(platform=>setNative(platform.isCapacitorNative())).catch(()=>{});},[]);
  const openSystemSettings=()=>{void import('@tomato-clock/platform-capacitor').then(async platform=>{const opened=await platform.openSystemNotificationSettings();if(opened)window.setTimeout(refresh,1500);}).catch(()=>{});};
  const status=failed?'暂时无法读取系统提醒状态':loading?'正在读取系统提醒状态':capability?.permission==='granted'?(capability.precision==='exact'?'提醒可用 · 精准提醒已开启':'提醒可用 · 锁屏时可能略有延迟'):capability?.permission==='prompt'?'首次开始专注时请求通知权限':capability?.permission==='denied'?'系统通知已关闭':'当前平台不提供系统通知';
  return <div className="setting-row notification-health"><div className="setting-name"><span>专注结束提醒</span><small>{status}</small></div><div className="notification-actions">{native&&capability?.permission==='denied'&&<button type="button" className="settings-text-action" onClick={openSystemSettings}>打开系统设置</button>}<button type="button" className="settings-text-action" aria-label="刷新通知状态" title="刷新通知状态" disabled={loading} onClick={refresh}><RefreshCw className={loading?'is-spinning':''}/></button></div></div>;
}

function BuildingBlueprintPanel({resources,run}:{resources:ReturnType<ApplicationService['snapshot']>['buildingBlueprintResources'];run:(c:ApplicationCommand)=>Promise<unknown>}) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [nativePicker,setNativePicker]=useState(false);const [remove,setRemove]=useState<string|null>(null);const [candidate,setCandidate]=useState<LitematicImportResult|null>(null);const [role,setRole]=useState<ImportRole>('building');const [renaming,setRenaming]=useState<string|null>(null);const renameInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{void import('@tomato-clock/platform-capacitor').then(platform=>setNativePicker(platform.isCapacitorNative()));},[]);
  const parse=async(bytes:Uint8Array)=>{setBusy(true);setError('');try{const {parseLitematic}=await loadLitematicModule();setCandidate(await parseLitematic(bytes));setRole('building');}catch(cause){setError(litematicErrorMessage(cause));}finally{setBusy(false);}};
  const nativeImport=async()=>{try{const {pickNativeLitematicFile}=await import('@tomato-clock/platform-capacitor');const file=await pickNativeLitematicFile(LITEMATIC_MAX_COMPRESSED_BYTES);if(file)await parse(file.bytes);}catch(cause){setError(litematicErrorMessage(cause));}};
  const save=async()=>{if(!candidate)return;const blueprint=toImportedBlueprint(candidate.blueprint);const limit=role==='decoration'?decorationBlueprintLimitError(blueprint):resources.length>=12?'建筑蓝图库最多保存 12 份，请先删除一份。':'';if(limit){setError(limit);return;}setBusy(true);setError('');try{const result=await run(role==='building'?{type:'ImportBuildingBlueprint',blueprint}:{type:'ImportDecorationBlueprint',blueprint});if(!(typeof result==='object'&&result!==null&&'ok' in result&&result.ok===true)){setError('无法保存这份蓝图。');return;}setCandidate(null);}catch(cause){setError(cause instanceof Error?cause.message:'无法保存这份蓝图。');}finally{setBusy(false);}};
  const beginRename=(id:string)=>{setRenaming(id);setError('');};
  const rename=async()=>{if(!renaming)return;const displayName=(renameInput.current?.value??'').trim();if(!displayName){setError('蓝图名称不能为空。');return;}setBusy(true);setError('');try{const result=await run({type:'RenameBuildingBlueprint',blueprintId:renaming,displayName});if(typeof result==='object'&&result!==null&&'ok' in result&&result.ok===true)setRenaming(null);else setError('无法修改蓝图名称。');}catch(cause){setError(cause instanceof Error?cause.message:'无法修改蓝图名称。');}finally{setBusy(false);}};
  return <section className="building-blueprint-panel" aria-labelledby="building-blueprint-title"><header><h2 id="building-blueprint-title">建筑蓝图库</h2><p>最多 12 份；建筑用于任务预览，装饰进入每日奖励池。</p></header>{nativePicker?<button type="button" className="litematic-file" disabled={busy} onClick={()=>void nativeImport()}><FileUp/><span>{busy?'正在解析...':'导入 .litematic'}</span></button>:<label className="litematic-file"><FileUp/><span>{busy?'正在解析...':'导入 .litematic'}</span><input className="sr-only" type="file" accept=".litematic,application/octet-stream" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.currentTarget.value='';if(file)void readBrowserFileBytes(file).then(parse).catch(cause=>setError(litematicErrorMessage(cause)));}}/></label>}{candidate&&<div className="imported-blueprint-role"><strong>{candidate.preview.name}</strong><small>{candidate.preview.dimensions.width} x {candidate.preview.dimensions.height} x {candidate.preview.dimensions.depth} · {candidate.preview.nonAirBlockCount.toLocaleString('zh-CN')} 方块</small><div className="import-role" role="group" aria-label="导入蓝图用途"><button type="button" aria-pressed={role==='building'} onClick={()=>setRole('building')}>大型任务建筑</button><button type="button" aria-pressed={role==='decoration'} onClick={()=>setRole('decoration')}>每日奖励装饰</button></div><div className="dialog-actions"><button type="button" disabled={busy} onClick={()=>setCandidate(null)}>取消</button><button type="button" className="primary" disabled={busy} onClick={()=>void save()}>{role==='building'?'保存到建筑蓝图库':'加入每日奖励装饰池'}</button></div></div>}{error&&<p className="import-error" role="alert">{error}</p>}{resources.length>0&&<ul className="building-blueprint-list">{resources.map(resource=><li key={resource.id}><div className="blueprint-library-copy">{renaming===resource.id?<input ref={renameInput} autoFocus aria-label={`重命名“${resource.displayName}”`} maxLength={80} defaultValue={resource.displayName} disabled={busy} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&event.keyCode!==229)void rename();if(event.key==='Escape')setRenaming(null);}}/>:<strong>{resource.displayName}</strong>}<small>{resource.blueprint.bounds.maxX-resource.blueprint.bounds.minX+1} x {resource.blueprint.bounds.maxZ-resource.blueprint.bounds.minZ+1} 方块 · {resource.blueprint.voxels.length.toLocaleString('zh-CN')} 方块</small></div><div className="blueprint-library-actions">{renaming===resource.id?<><button type="button" className="blueprint-rename" aria-label="保存蓝图名称" disabled={busy} onClick={()=>void rename()}><Check/></button><button type="button" className="blueprint-rename-cancel" aria-label="取消重命名" disabled={busy} onClick={()=>setRenaming(null)}><X/></button></>:<><button type="button" className="blueprint-rename" aria-label={`重命名“${resource.displayName}”`} disabled={busy} onClick={()=>beginRename(resource.id)}><Pencil/></button><button type="button" className="blueprint-delete" disabled={busy} onClick={()=>setRemove(resource.id)}>删除</button></>}</div></li>)}</ul>}{remove&&<div className="dialog-backdrop" role="presentation"><div className="confirm-dialog" role="alertdialog" aria-modal="true"><h2>从蓝图库删除？</h2><p>不会改变使用这份蓝图创建的已有大型任务。</p><div className="dialog-actions"><button disabled={busy} onClick={()=>setRemove(null)}>取消</button><button className="danger-action" disabled={busy} onClick={()=>{setBusy(true);void run({type:'DeleteBuildingBlueprint',blueprintId:remove}).finally(()=>{setBusy(false);setRemove(null);});}}>删除蓝图</button></div></div></div>}</section>;
}

const WEEKDAY_OPTIONS=[{value:1,label:'一'},{value:2,label:'二'},{value:3,label:'三'},{value:4,label:'四'},{value:5,label:'五'},{value:6,label:'六'},{value:0,label:'日'}] as const;
function PlannedFocusDaysSetting({state,run}:{state:ReturnType<ApplicationService['snapshot']>;run:(c:ApplicationCommand)=>Promise<unknown>}){
  const plannedCount=7-state.calendar.restWeekdays.length;
  const toggle=(day:number)=>{const isRest=state.calendar.restWeekdays.includes(day);if(!isRest&&plannedCount===1)return;const restWeekdays=isRest?state.calendar.restWeekdays.filter(value=>value!==day):[...state.calendar.restWeekdays,day].sort((a,b)=>a-b);void run({type:'ConfigureCalendar',timeZone:state.calendar.timeZone,restWeekdays});};
  return <div className="setting-row toggle-row"><div className="setting-name"><span>计划专注日</span><small>连续记录跳过休息日</small></div><div className="planned-days" role="group" aria-label="计划专注日">{WEEKDAY_OPTIONS.map(day=>{const active=!state.calendar.restWeekdays.includes(day.value);return <button key={day.value} aria-pressed={active} disabled={active&&plannedCount===1} onClick={()=>toggle(day.value)}>{day.label}</button>;})}</div></div>;
}

function FocusIntegritySetting({policy,run}:{policy:ReturnType<ApplicationService['snapshot']>['focusIntegrityPolicy'];run:(c:ApplicationCommand)=>Promise<unknown>}) {
  const [draft,setDraft]=useState(policy); const [pending,setPending]=useState(false); const draftRef=useRef(policy); const queue=useRef<Promise<void>>(Promise.resolve()); const pendingCount=useRef(0);
  useEffect(()=>{if(pendingCount.current===0){draftRef.current=policy;setDraft(policy);}},[policy.enabled,policy.maxEffectiveExcursions]);
  const configure=(next:typeof policy)=>{draftRef.current=next;setDraft(next);pendingCount.current+=1;setPending(true);queue.current=queue.current.then(async()=>{await run({type:'ConfigureFocusIntegrity',...next});}).catch(()=>{draftRef.current=policy;setDraft(policy);}).finally(()=>{pendingCount.current-=1;if(pendingCount.current===0)setPending(false);});};
  return <div className="setting-row integrity-setting" aria-busy={pending}><div className="setting-name"><span>专注完整性</span><small>离开超过 3 秒计入；达到上限本轮失败</small></div><div className="integrity-controls"><label className="switch-control"><input aria-label="开启专注完整性" type="checkbox" checked={draft.enabled} onChange={e=>configure({...draftRef.current,enabled:e.target.checked})}/></label><label className="number-field"><DeferredNumberInput ariaLabel="允许有效离开次数" min={1} max={5} value={draft.maxEffectiveExcursions} disabled={!draft.enabled} onCommit={value=>configure({...draftRef.current,maxEffectiveExcursions:value})}/><span>次</span></label></div></div>;
}

function DeferredNumberInput({ariaLabel,min,max,value,disabled=false,onCommit}:{ariaLabel:string;min:number;max:number;value:number;disabled?:boolean;onCommit:(value:number)=>void}) {
  const [draft,setDraft]=useState(String(value)); const focused=useRef(false);
  useEffect(()=>{if(!focused.current)setDraft(String(value));},[value]);
  const commit=()=>{focused.current=false;const next=normalizedIntegerDraft(draft,min,max);setDraft(String(next));if(next!==value)onCommit(next);};
  return <input aria-label={ariaLabel} type="number" inputMode="numeric" min={min} max={max} step="1" disabled={disabled} value={draft} onFocus={()=>{focused.current=true;}} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/>;
}

function normalizedIntegerDraft(draft:string,minimum:number,maximum:number):number {
  if(!/^\d+$/.test(draft))return minimum;
  const value=Number(draft);
  return Number.isSafeInteger(value)?clamp(value,minimum,maximum):minimum;
}

const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
function BackupPanel({service,onChanged}:{service:ApplicationService;onChanged:()=>void}) {
  const [preview,setPreview]=useState<Awaited<ReturnType<ApplicationService['previewImport']>>|null>(null);
  const [importText,setImportText]=useState<string|null>(null);
  const [rollbacks,setRollbacks]=useState<Awaited<ReturnType<ApplicationService['listRollbackBackups']>>>([]);
  const [restoreTarget,setRestoreTarget]=useState<Awaited<ReturnType<ApplicationService['listRollbackBackups']>>[number]|null>(null);
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const reloadRollbacks=useCallback(async()=>{ try { setRollbacks(await service.listRollbackBackups()); } catch (cause) { setError(errorMessage(cause)); } },[service]);
  useEffect(()=>{void reloadRollbacks();},[reloadRollbacks]);
  const exportFile=async()=>{setBusy(true);setError('');try{const text=await service.exportBackup();const stamp=new Date().toISOString().replace(/[:.]/g,'-');await saveBackupFile(text,`blockcolc-backup-${stamp}.json`);setNotice('备份已导出。');}catch(cause){setError(errorMessage(cause));}finally{setBusy(false);}};
  const chooseFile=async(file:File|undefined)=>{setPreview(null);setImportText(null);setError('');setNotice('');if(!file)return;if(file.size>MAX_BACKUP_BYTES){setError('备份文件不能超过 10 MB。');return;}setBusy(true);try{const text=await file.text();const next=await service.previewImport(text);setImportText(text);setPreview(next);}catch(cause){setError(`无法读取备份：${errorMessage(cause)}`);}finally{setBusy(false);}};
  const confirmImport=async()=>{if(!importText||!preview)return;setBusy(true);setError('');try{await service.replaceFromImport(importText);setPreview(null);setImportText(null);setNotice('导入完成，已创建回滚备份。');onChanged();await reloadRollbacks();}catch(cause){setError(`导入失败：${errorMessage(cause)}`);}finally{setBusy(false);}};
  const restore=async()=>{if(!restoreTarget)return;setBusy(true);setError('');try{await service.restoreRollback(restoreTarget.id);setRestoreTarget(null);setNotice('已恢复备份，并创建恢复前回滚点。');onChanged();await reloadRollbacks();}catch(cause){setError(`恢复失败：${errorMessage(cause)}`);}finally{setBusy(false);}};
  return <section className="backup-panel" aria-labelledby="backup-title"><div><h2 id="backup-title">本地备份</h2><p>导入前自动创建回滚备份；导入是完整替换，不合并数据。</p></div><div className="backup-actions"><button type="button" onClick={()=>void exportFile()} disabled={busy}><Download/>导出 JSON</button><label className="file-button"><FileUp/>选择备份<input aria-label="选择备份 JSON 文件" type="file" accept="application/json,.json" onChange={event=>void chooseFile(event.target.files?.[0])} disabled={busy}/></label></div>{error&&<p className="backup-error" role="alert"><AlertTriangle/>{error}</p>}{notice&&<p className="backup-notice" role="status">{notice}</p>}{preview&&<div className="import-preview"><h3>导入预览</h3><dl><div><dt>导出时间</dt><dd>{new Date(preview.exportedAt).toLocaleString('zh-CN')}</dd></div><div><dt>项目</dt><dd>{preview.summary.projectCount} 个{preview.summary.activeProjectTitle?` · 当前：${preview.summary.activeProjectTitle}`:''}</dd></div><div><dt>专注记录</dt><dd>{preview.summary.completedFocusCount} 完成 / {preview.summary.interruptedFocusCount} 中断</dd></div><div><dt>进度汇报</dt><dd>{preview.summary.progressReportCount} 条</dd></div></dl><button className="danger-action backup-confirm" type="button" onClick={()=>void confirmImport()} disabled={busy}><Upload/>确认替换本地数据</button></div>}<div className="rollback-list"><div className="rollback-heading"><h3><History/>可恢复备份</h3><button type="button" onClick={()=>void reloadRollbacks()} disabled={busy}>刷新</button></div>{rollbacks.length===0?<p>尚无回滚备份。</p>:<ul>{rollbacks.map(backup=><li key={backup.id}><div><strong>{rollbackReason(backup.reason)}</strong><span>{new Date(backup.createdAt).toLocaleString('zh-CN')} · {backup.summary?.projectCount??0} 个项目</span></div><button type="button" onClick={()=>setRestoreTarget(backup)} disabled={busy}>恢复</button></li>)}</ul>}</div>{restoreTarget&&<BackupConfirmDialog title="恢复这份备份？" confirmLabel="恢复备份" pending={busy} onCancel={()=>setRestoreTarget(null)} onConfirm={()=>void restore()}><p>当前本地数据会被完整替换，并自动创建恢复前的回滚点。</p></BackupConfirmDialog>}</section>;
}
function rollbackReason(reason: unknown) { const type=typeof reason==='string'?reason:(reason as {type?:string}).type; return type==='before-import'?'导入前备份':type==='before-delete-active-project'?'删除任务前备份':'恢复前备份'; }
function errorMessage(cause:unknown){return cause instanceof Error?cause.message:'发生未知错误，请重试。';}
function BackupConfirmDialog({title,confirmLabel,pending,onCancel,onConfirm,children}:{title:string;confirmLabel:string;pending:boolean;onCancel:()=>void;onConfirm:()=>void;children:ReactNode}){const cancelRef=useRef<HTMLButtonElement>(null);useEffect(()=>{cancelRef.current?.focus();const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!pending)onCancel();};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[onCancel,pending]);return <div className="dialog-backdrop" role="presentation"><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="backup-confirm-title"><h2 id="backup-confirm-title">{title}</h2>{children}<div className="dialog-actions"><button ref={cancelRef} disabled={pending} onClick={onCancel}>取消</button><button className="danger-action" disabled={pending} onClick={onConfirm}><Upload/>{confirmLabel}</button></div></div></div>;}

function AboutDialog({onClose}:{onClose:()=>void}){
  const [checking,setChecking]=useState(false);const [updateResult,setUpdateResult]=useState('');const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{closeRef.current?.focus();const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose]);
  const check=async()=>{setChecking(true);setUpdateResult('');try{const response=await fetch(`${REPOSITORY_URL.replace('github.com','api.github.com/repos')}/releases/latest`,{headers:{Accept:'application/vnd.github+json'}});if(!response.ok)throw new Error(String(response.status));const release=await response.json() as {tag_name?:string;html_url?:string};const latest=(release.tag_name??'').replace(/^v/,'');if(!/^\d+\.\d+\.\d+$/.test(latest))throw new Error('invalid release');setUpdateResult(compareVersions(latest,APP_VERSION)>0?`发现新版本 ${latest}，可前往 GitHub 下载。`:`当前已是最新版本 ${APP_VERSION}。`);}catch{setUpdateResult('暂时无法检查更新，请确认网络后重试。');}finally{setChecking(false);}};
  return <div className="dialog-backdrop" role="presentation"><section className="confirm-dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title"><button ref={closeRef} className="dialog-close" aria-label="关闭关于页面" onClick={onClose}><X/></button><Info className="about-icon"/><h2 id="about-title">方块钟 Blockcolc</h2><p className="about-version">版本 {APP_VERSION}</p><p>本地优先的专注计时器。任务、专注记录、蓝图和资源包默认只保存在你的设备上。</p><dl><div><dt>项目仓库</dt><dd><a href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub <ExternalLink/></a></dd></div><div><dt>隐私</dt><dd>无账号、无云同步、无后台分析</dd></div><div><dt>许可</dt><dd>开源许可与第三方组件信息见项目仓库</dd></div></dl><p className="legal-note">本应用不是 Minecraft 官方产品，未获 Mojang Studios 或 Microsoft 认可或关联。Minecraft 是其权利人的商标。</p><button className="check-update" type="button" disabled={checking} onClick={()=>void check()}><RefreshCw className={checking?'is-spinning':''}/>{checking?'正在检查':'手动检查更新'}</button>{updateResult&&<p className="update-result" role="status">{updateResult}</p>}</section></div>;
}

function CompletionCeremony({title,onClose}:{title:string;onClose:()=>void}){const button=useRef<HTMLButtonElement>(null);useEffect(()=>{button.current?.focus();},[]);return <div className="ceremony-backdrop" role="presentation"><section className="completion-ceremony" role="dialog" aria-modal="true" aria-labelledby="ceremony-title"><div className="ceremony-rays"/><Trophy/><span>主体建筑完成</span><h2 id="ceremony-title">{title}</h2><p>这项长期工作已经在聚落中留下完整建筑。</p><button ref={button} onClick={onClose}>回到聚落</button></section></div>;}

function compareVersions(left:string,right:string):number{const a=left.split('.').map(Number);const b=right.split('.').map(Number);for(let index=0;index<3;index+=1){if(a[index]!==b[index])return(a[index]??0)-(b[index]??0);}return 0;}
function lastSuccessfulSession(history:ReturnType<ApplicationService['snapshot']>['focusHistory']){for(let index=history.length-1;index>=0;index-=1){const session=history[index]!;if(session.status==='completed'||session.status==='completed-early')return session;}return undefined;}
function buildingMemory(state:ReturnType<ApplicationService['snapshot']>,projectId:string){const sessions=state.focusHistory.filter(session=>session.projectId===projectId);const last=sessions[sessions.length-1];return{minutes:Math.round(sessions.reduce((sum,session)=>sum+session.actualDurationMs,0)/60000),successfulRounds:sessions.filter(session=>session.status==='completed'||session.status==='completed-early').length,lastDate:last?focusSessionLocalDate(last):null};}

function focusHeatmapStats(state:ReturnType<ApplicationService['snapshot']>) {
  const today=localDateOf(new Date(),state.calendar.timeZone);
  const weekday=(new Date(`${today}T12:00:00Z`).getUTCDay()+6)%7;
  const firstDate=addLocalDays(today,-weekday-25*7);
  const millisecondsByDate=effectiveFocusMillisecondsByDate(state.focusHistory);
  const weeks=Array.from({length:26},(_,weekIndex)=>({days:Array.from({length:7},(_,dayIndex)=>{
    const date=addLocalDays(firstDate,weekIndex*7+dayIndex);
    const minutes=Math.round((millisecondsByDate.get(date)??0)/60000);
    return {date,minutes,future:date>today,level:focusHeatmapLevel(minutes)};
  })}));
  const monthMarkers=weeks.flatMap((week,index)=>{
    const first=index===0?week.days[0]:undefined;
    const monthStart=week.days.find(day=>day.date.slice(-2)==='01');
    const day=monthStart??first;
    return day?[{column:index+1,label:new Intl.DateTimeFormat('zh-CN',{month:'short',timeZone:'UTC'}).format(new Date(`${day.date}T12:00:00Z`))}]:[];
  });
  const months=monthMarkers.map((month,index)=>({...month,span:(monthMarkers[index+1]?.column??27)-month.column})).filter(month=>month.span>=2);
  const allDays=weeks.flatMap(week=>week.days).filter(day=>!day.future);
  return {weeks,months,totalMinutes:allDays.reduce((sum,day)=>sum+day.minutes,0),activeDays:allDays.filter(day=>day.minutes>0).length};
}

function formatFocusMinutes(minutes:number){return minutes>=60?`${Math.floor(minutes/60)} 小时${minutes%60?` ${minutes%60} 分钟`:''}`:`${minutes} 分钟`;}
function heatmapDateLabel(date:string){const [year,month,day]=date.split('-');return `${year}年${Number(month)}月${Number(day)}日`;}

function loadPreferences():FocusPreferences {
  try {
    const value=JSON.parse(localStorage.getItem(PREFERENCES_KEY)??'null');
    if(value&&Number.isFinite(value.focusMinutes)&&Number.isFinite(value.breakMinutes)){
      const legacy=value.visualExperiment;
      const lightingQuality:VoxelLightingQuality=value.lightingQuality==='performance'||value.lightingQuality==='balanced'||value.lightingQuality==='cinematic'||value.lightingQuality==='auto'?value.lightingQuality:legacy==='water'||legacy==='mist-beam'?'cinematic':'auto';
      const constructionOutlineVisibility:ConstructionOutlineVisibility=value.constructionOutlineVisibility==='off'||value.constructionOutlineVisibility==='all'||value.constructionOutlineVisibility==='current'?value.constructionOutlineVisibility:'current';
      return{focusMinutes:clamp(value.focusMinutes,1,180),habitFocusMinutes:clamp(value.habitFocusMinutes??value.focusMinutes,1,180),habitTargetRounds:clamp(value.habitTargetRounds??10,10,30),breakMinutes:clamp(value.breakMinutes,0,60),lightingQuality,constructionOutlineVisibility};
    }
  } catch {}
  return{focusMinutes:45,habitFocusMinutes:45,habitTargetRounds:10,breakMinutes:5,lightingQuality:'auto',constructionOutlineVisibility:'current'};
}
function loadRoundPlan(projectId:string):RoundPlan|null { try{return parseRoundPlan(JSON.parse(localStorage.getItem(ROUND_PLAN_KEY)??'null'),projectId);}catch{return null;} }
function clamp(value:number,min:number,max:number){return Math.min(max,Math.max(min,Math.round(value)));}
function constructionStage(progress:number){if(progress<=0)return'施工阶段：场地准备';if(progress<1800)return'施工阶段：地基';if(progress<3800)return'施工阶段：框架与地板';if(progress<6500)return'施工阶段：墙体';if(progress<8800)return'施工阶段：屋顶';return progress<10000?'施工阶段：门窗与收尾':'建筑已完成';}
function periodStats(state:ReturnType<ApplicationService['snapshot']>,period:'week'|'month'|'year'){const now=new Date();const start=new Date(now);let count=7;let label='本周';if(period==='week'){const day=(now.getDay()+6)%7;start.setDate(now.getDate()-day);start.setHours(0,0,0,0);}else if(period==='month'){start.setDate(1);start.setHours(0,0,0,0);count=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();label='本月';}else{start.setMonth(0,1);start.setHours(0,0,0,0);count=12;label='本年';}const relevant=state.focusHistory.filter(session=>Date.parse(focusSessionEndedAt(session))>=start.getTime());const completed=relevant.filter(session=>session.status==='completed');const early=relevant.filter(session=>session.status==='completed-early');const successful=[...completed,...early];const interrupted=relevant.filter(session=>session.status==='interrupted');const minutes=Math.round(relevant.reduce((sum,session)=>sum+session.actualDurationMs,0)/60000);const days=new Set(relevant.filter(session=>session.actualDurationMs>0).map(focusSessionLocalDate));const bucketMilliseconds=Array.from({length:count},()=>0);for(const session of relevant){const date=new Date(focusSessionEndedAt(session));const index=period==='year'?date.getMonth():period==='month'?date.getDate()-1:Math.floor((date.getTime()-start.getTime())/86400000);if(index>=0&&index<bucketMilliseconds.length)bucketMilliseconds[index]!+=session.actualDurationMs;}const buckets=bucketMilliseconds.map(value=>Math.round(value/60000));const reasonCounts=new Map<string,number>();for(const session of interrupted){const key=session.interruptionReason==='app-switch-limit'?'integrity-limit':session.interruptionCategory??'unclassified';reasonCounts.set(key,(reasonCounts.get(key)??0)+1);}const labels=new Map([...INTERRUPTION_OPTIONS.filter(item=>item.value!==null).map(item=>[item.value!,item.label] as const),['integrity-limit','切屏次数上限'],['unclassified','未记录']]);const reasons=[...reasonCounts].map(([value,countValue])=>({value,label:labels.get(value)??value,count:countValue})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'zh-CN'));return{completed:completed.length,early:early.length,interrupted:interrupted.length,minutes,activeDays:days.size,streak:plannedFocusStreak(state),rate:relevant.length?Math.round(successful.length/relevant.length*100):0,buckets,max:Math.max(1,...buckets),label,reasons};}

function plannedFocusStreak(state:ReturnType<ApplicationService['snapshot']>):number {
  const successfulDates=new Set(state.focusHistory.filter(session=>session.status!=='interrupted').map(session=>localDateOf(session.completedAt,state.calendar.timeZone)));
  const today=localDateOf(new Date(),state.calendar.timeZone);
  let cursor=today;let streak=0;
  for(let scanned=0;scanned<3660;scanned+=1){
    if(!isPlannedFocusDay(cursor,state.calendar)){cursor=addLocalDays(cursor,-1);continue;}
    if(successfulDates.has(cursor)){streak+=1;cursor=addLocalDays(cursor,-1);continue;}
    if(cursor===today){cursor=addLocalDays(cursor,-1);continue;}
    break;
  }
  return streak;
}
