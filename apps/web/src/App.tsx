import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ApplicationCommand, ApplicationService } from '@tomato-clock/application';
import type { FocusInterruptionCategory, ImportedBlueprintStage, ImportedBlueprintV1, WorldEnvironmentStyle } from '@tomato-clock/domain';
import type { LitematicImportResult } from '@tomato-clock/litematic';
import { addLocalDays, isPlannedFocusDay, localDateOf, projectProgressBasisPoints } from '@tomato-clock/domain';
import { AlertTriangle, BarChart3, Check, Clock3, Download, ExternalLink, FileUp, Hammer, History, Info, ListTodo, Map as MapIcon, RefreshCw, RotateCcw, Settings, Square, TreePine, Trophy, Upload, X } from 'lucide-react';
import type { BlueprintCatalogEntry, BlueprintV1, VoxelRenderer, VoxelVisualExperiment, WorldSnapshot } from '@tomato-clock/voxel';
import type { ResourcePackRepository } from '@tomato-clock/resource-pack-indexeddb';
import { TasksScreen } from './TaskManagement';
import { ResourcePackPanel } from './ResourcePackPanel';
import { ChoiceMenu } from './ChoiceMenu';
import { LITEMATIC_MAX_COMPRESSED_BYTES, readBrowserFileBytes, saveBackupFile } from './browser-adapters';
import { APPLICATION_STATE_CHANGED_EVENT } from './bootstrap';
import { effectiveFocusMillisecondsByDate, focusSessionEndedAt, focusSessionLocalDate } from './focus-stats';
import { parseRoundPlan, reconcileRoundPlan, roundPlansEqual, type RoundPlan } from './round-plan';

type Tab = 'world' | 'tasks' | 'stats' | 'settings';
interface FocusPreferences { focusMinutes: number; habitFocusMinutes: number; habitTargetRounds: number; breakMinutes: number; visualExperiment: VoxelVisualExperiment }
type ImportRole = 'building' | 'decoration';
interface ProjectSetupDraft { kind: 'finite' | 'habit'; title: string; subtasksText: string; blueprintId: string; habitTargetRounds: number; imported: LitematicImportResult | null; packCompatibility: { name: string; textured: number; fallback: number; total: number } | null; importRole: ImportRole }
const PREFERENCES_KEY = 'blockcolc-focus-preferences-v1';
const ROUND_PLAN_KEY = 'blockcolc-round-plan-v1';
const APP_VERSION = '1.1.0';
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
  const content = creatingProject
    ? <ProjectSetup run={run} resourcePacks={resourcePacks} buildingBlueprints={state.buildingBlueprintResources} existingProjects={[]} draft={setupDraft} onDraftChange={updateSetupDraft} onCancel={discardProjectSetup} onCreated={completeProjectSetup}/>
    : !active
      ? tab === 'settings' ? <SettingsScreen service={service} resourcePacks={resourcePacks} state={state} run={run} refresh={refresh} preferences={preferences} onPreferencesChange={value=>{setPreferences(value);localStorage.setItem(PREFERENCES_KEY,JSON.stringify(value));}}/> : tab === 'stats' ? <StatsScreen state={state}/> : <ProjectSetup run={run} resourcePacks={resourcePacks} buildingBlueprints={state.buildingBlueprintResources} existingProjects={state.projects.filter(project=>project.status==='paused')} draft={setupDraft} onDraftChange={updateSetupDraft} onCreated={()=>{setProjectDraft(null);setTab('world');}}/>
      : tab === 'world' ? <WorldScreenV7 service={service} resourcePacks={resourcePacks} run={run} refresh={refresh} preferences={preferences} focusedProjectId={worldFocusProjectId} onFocusWorldProject={setWorldFocusProjectId} onClearWorldFocus={()=>setWorldFocusProjectId(null)} onOpenTasks={()=>setTab('tasks')}/> : tab === 'tasks' ? <TasksScreen active={active} state={state} run={run} onCreateProject={beginProjectSetup} onViewProject={viewProjectInWorld}/> : tab === 'stats' ? <StatsScreen state={state}/> : <SettingsScreen service={service} resourcePacks={resourcePacks} state={state} run={run} refresh={refresh} preferences={preferences} onPreferencesChange={value=>{setPreferences(value);localStorage.setItem(PREFERENCES_KEY,JSON.stringify(value));}}/>;
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
  const titleInput=useRef<HTMLInputElement>(null);const tasksInput=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{let active=true;void import('@tomato-clock/platform-capacitor').then(platform=>{if(active)setNativePicker(platform.isCapacitorNative());});return()=>{active=false;};},[]);
  const importedEntry:BlueprintCatalogEntry|undefined=imported?{id:imported.blueprint.id,displayName:imported.preview.name,description:`本地 Litematic · Minecraft 数据版本 ${imported.preview.minecraftDataVersion}`,footprint:{width:imported.preview.dimensions.width,depth:imported.preview.dimensions.depth},complexity:imported.preview.nonAirBlockCount>3000?'detailed':'moderate',blueprint:imported.blueprint}:undefined;
  const libraryEntries:BlueprintCatalogEntry[]=buildingBlueprints.map(resource=>({id:resource.id,displayName:resource.blueprint.title,description:`本地建筑蓝图 · ${new Date(resource.importedAt).toLocaleDateString('zh-CN')} 导入`,footprint:{width:resource.blueprint.bounds.maxX-resource.blueprint.bounds.minX+1,depth:resource.blueprint.bounds.maxZ-resource.blueprint.bounds.minZ+1},complexity:resource.blueprint.voxels.length>3000?'detailed':'moderate',blueprint:resource.blueprint as BlueprintV1}));
  const options=importedEntry?[...catalog,...libraryEntries,importedEntry]:[...catalog,...libraryEntries];
  const selected=options.find(option=>option.id===blueprintId)??options[0];
  const submit=async(e:FormEvent)=>{e.preventDefault();if(importRole==='decoration')return;const currentTitle=titleInput.current?.value??'';if(!currentTitle.trim()||!selected||!Number.isInteger(habitTargetRounds)||habitTargetRounds<10||habitTargetRounds>30)return;const importedBlueprint=selected.blueprint.id.startsWith('builtin-')?null:toImportedBlueprint(selected.blueprint);const subtasks=(tasksInput.current?.value??'').split('\n').map(x=>x.trim()).filter(Boolean).map(title=>({title}));const command:ApplicationCommand=kind==='habit'?{type:'CreateHabitProject',title:currentTitle.trim(),blueprintId:selected.blueprint.id,importedBlueprint,targetRounds:habitTargetRounds}:{type:'CreateProject',title:currentTitle.trim(),blueprintId:selected.blueprint.id,importedBlueprint,subtasks};const result=await run(command);if(result?.ok)onCreated?.();};
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
      <span className="eyebrow">继续建造</span><h2>已有任务</h2>
      {existingProjects.map(project => <button type="button" key={project.id} onClick={() => void resume(project.id)}><span><strong>{project.title}</strong><small>{project.kind === 'habit' ? `习惯 · ${project.habit?.awaitingNextBuilding ? '等待选择下一建筑' : `${project.habit?.completedFocusSessionIds.length ?? 0} / ${project.habit?.targetRounds ?? 10} 轮`}` : `${Math.round(projectProgressBasisPoints(project) / 100)}% · ${project.subtasks.length} 个小任务`}</small></span><span>切换</span></button>)}
    </div>}
    <form onSubmit={submit}>
      <header className="setup-heading"><span className="eyebrow">新的建筑</span><h1>{onCancel ? '新增任务' : '建立你的第一项任务'}</h1><p>{kind === 'habit' ? '每次专注都会推进习惯建筑，完成后继续选择下一座。' : '每项大型任务会在村落中留下自己的一栋建筑。'}</p></header>
      <div className="setup-kind" role="group" aria-label="任务类型"><button type="button" aria-pressed={kind === 'finite'} onClick={() => onDraftChange({ kind: 'finite' })}>普通大型任务</button><button type="button" aria-pressed={kind === 'habit'} onClick={() => onDraftChange({ kind: 'habit' })}>习惯任务</button></div>
      <div className="setup-fields">
        <label>{kind === 'habit' ? '习惯名称' : '大型任务'}<NativeImeTextEntry targetRef={titleInput} name="projectTitle" defaultValue={draft.title} onValueChange={title => onDraftChange({ title })}/></label>
        {kind === 'finite' ? <label>拆成小任务，每行一项<NativeImeTextEntry targetRef={tasksInput} name="subtasks" rows={5} defaultValue={draft.subtasksText} onValueChange={subtasksText => onDraftChange({ subtasksText })}/></label> : <div className="habit-target-summary"><span>每座建筑</span><strong>{habitTargetRounds} 轮专注</strong><small>统一在设置中调整；创建后，本周期内不会改变。</small></div>}
      </div>
      {selected ? <BlueprintPicker resourcePacks={resourcePacks} options={options} selected={selected} onSelect={id => onDraftChange({ blueprintId: id, ...(!imported || id !== imported.blueprint.id ? { importRole: 'building' } : {}) })} importControl={importControl}/> : <div className="blueprint-loading" role="status">正在准备建筑预览...</div>}
      <div className="setup-actions">{onCancel && <button type="button" onClick={onCancel}>取消</button>}{importRole === 'decoration' && imported ? <button className="primary setup-submit" type="button" disabled={importing || Boolean(decorationLimitError)} onClick={() => void addDecoration()}>加入装饰池</button> : <button className="primary setup-submit" type="submit" disabled={!selected || importing || !Number.isInteger(habitTargetRounds) || habitTargetRounds < 10 || habitTargetRounds > 30}>开始建造</button>}</div>
    </form>
  </section>;
}

function NativeImeTextEntry({targetRef,name,defaultValue,rows,onValueChange}:{targetRef:{current:HTMLInputElement|null}|{current:HTMLTextAreaElement|null};name:string;defaultValue:string;rows?:number;onValueChange?:(value:string)=>void}) { const host=useRef<HTMLSpanElement>(null);const initialValue=useRef(defaultValue);const valueChangeRef=useRef(onValueChange);valueChangeRef.current=onValueChange;useLayoutEffect(()=>{const element=rows===undefined?document.createElement('input'):document.createElement('textarea');element.name=name;element.required=true;element.value=initialValue.current;element.dataset.imeDiagnostic=name;if(element instanceof HTMLTextAreaElement)element.rows=rows??5;targetRef.current=element as never;host.current?.append(element);const report=(event:Event)=>{const input=event as InputEvent & {isComposing?:boolean;data?:string};const current=element as HTMLInputElement|HTMLTextAreaElement;console.info('[tomato-ime]',JSON.stringify({field:name,type:event.type,inputType:input.inputType??null,isComposing:input.isComposing??false,dataLength:input.data?.length??0,valueLength:current.value.length,selectionStart:current.selectionStart,selectionEnd:current.selectionEnd,time:performance.now()}));};const retain=()=>valueChangeRef.current?.(element.value);const events=['compositionstart','compositionupdate','compositionend','beforeinput','input','focus','blur','select','keyup'];events.forEach(type=>element.addEventListener(type,report));element.addEventListener('input',retain);return()=>{retain();element.removeEventListener('input',retain);events.forEach(type=>element.removeEventListener(type,report));if(targetRef.current===element)targetRef.current=null;element.remove();};},[name,rows,targetRef]);return <span className="native-ime-entry" ref={host}/>; }

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
  return <div className={session?'world-screen is-focusing':'world-screen'}><WorldCanvas service={service} resourcePacks={resourcePacks} visualExperiment={preferences.visualExperiment} constructionFeedback={constructionFeedback}/><section className="focus-panel">{!session&&<><div className="project-heading"><div><span className="eyebrow">正在建造</span><h1>{active.project.title}</h1></div><div className="build-percent">{Math.round(active.building.completionBasisPoints/100)}%</div></div><div className="meter"><i style={{width:`${active.building.completionBasisPoints/100}%`}}/></div><div className="construction-stage">{constructionStage(active.building.completionBasisPoints)}</div></>}
    {pending.length>0 ? <ProgressReport active={active} run={run} onSubmitted={afterReport}/> : <>{session?<div className="focus-task-context"><span>本轮任务</span><strong>{subtask.title}</strong></div>:<ChoiceMenu label="本次专注" value={selectedId} disabled={!!plan} onChange={setSelected} options={active.project.subtasks.map(s=>({id:s.id,label:s.title,detail:`${Math.round(s.progressBasisPoints/100)}%`}))}/>}<div className={isBreak?'session-kind rest':'session-kind'}>{isBreak?(plan?.endAfterBreak?'任务已完成 · 休息时间':'休息时间'):session?`第 ${(plan?.completedRounds??0)+1} / ${plan?.totalRounds??1} 轮专注`:plan?.status==='ready'?`准备第 ${plan.completedRounds+1} / ${plan.totalRounds} 轮`:preferences.breakMinutes===0?`每轮 ${preferences.focusMinutes} 分钟专注 · 不休息`:`每轮 ${preferences.focusMinutes} 分钟专注 + ${preferences.breakMinutes} 分钟休息`}</div>{session&&state.focusIntegrityPolicy.enabled&&<div className={session.integrity.effectiveExcursions>0?'focus-integrity-warning active':'focus-integrity-warning'}><AlertTriangle/>有效离开 {session.integrity.effectiveExcursions} / {state.focusIntegrityPolicy.maxEffectiveExcursions} 次</div>}{integrityFailure&&<div className="focus-integrity-ended" role="alert"><AlertTriangle/>本轮专注因达到离开应用次数上限而结束。下次可以从这里继续。</div>}<FocusTimer endsAt={timerEndsAt} fallbackMs={preferences.focusMinutes*60000} onElapsed={session?reconcile:finishBreak}/>{!session&&!plan&&<div className="duration" aria-label="专注轮次">{[1,2,3,4].map(n=><button key={n} className={rounds===n?'selected':''} onClick={()=>setRounds(n)}>{n} 轮</button>)}</div>}{isBreak?<button className="primary secondary-action" onClick={()=>{if(plan?.endAfterBreak)setPlan(null);else{const {breakEndsAt:_breakEndsAt,...withoutBreak}=plan!;setPlan({...withoutBreak,status:'ready'});}}}>跳过休息</button>:plan?.status==='ready'?<button className="primary" onClick={()=>void startFocus()}><Clock3/>开始下一轮</button>:<button className={session?'destructive primary':'primary'} onClick={()=>void(session?setEnding(true):startFocus())}>{session?<><Square/>结束本次专注</>:<><Clock3/>开始 {rounds} 轮</>}</button>}</>}
    {ending&&session&&(
      <EndFocusDialog taskTitle={subtask.title} onClose={()=>setEnding(false)} onInterrupt={interruptFocus} onCompleteEarly={completeEarly}/>
    )}
  </section></div>; }

function WorldScreenV7({ service, resourcePacks, run, refresh, preferences, focusedProjectId, onFocusWorldProject, onClearWorldFocus, onOpenTasks }: {
  service: ApplicationService;
  resourcePacks: ResourcePackRepository;
  run: (command: ApplicationCommand) => Promise<any>;
  refresh: () => void;
  preferences: FocusPreferences;
  focusedProjectId: string | null;
  onFocusWorldProject: (projectId: string) => void;
  onClearWorldFocus: () => void;
  onOpenTasks: () => void;
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
  useEffect(() => {
    if (!roundPlansEqual(plan, reconciledPlan)) setPlan(reconciledPlan);
  }, [plan, reconciledPlan, setPlan]);
  const selectedId = reconciledPlan?.subtaskId ?? selected;
  const subtask = active.project.subtasks.find((item) => item.id === selectedId) ?? active.project.subtasks[0]!;
  const timerEndsAt = session?.endsAt ?? (isBreak ? reconciledPlan?.breakEndsAt : undefined);
  const today = localDateOf(new Date(), state.calendar.timeZone);
  const dailyGoal = state.dailyGoals.find((goal) => goal.date === today);
  const completedToday = state.focusHistory.filter((item) => item.status === 'completed' && item.completedLocalDate === today).length;
  const dailySummary = dailyGoal?.enabled ? `今日 ${completedToday} / ${dailyGoal.targetPomodoros} 轮` : `今日已完成 ${completedToday} 轮`;

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
  const planSummary = `${reconciledPlan?.totalRounds ?? rounds} 轮 · 每轮 ${focusMinutes} 分钟${preferences.breakMinutes > 0 ? ` · 休息 ${preferences.breakMinutes} 分钟` : ''}`;

  return <div className={session ? 'world-screen is-focusing' : pending.length > 0 ? 'world-screen has-report' : habitAwaiting ? 'world-screen is-choosing-habit-building' : 'world-screen'}>
    <WorldCanvasV7 service={service} resourcePacks={resourcePacks} visualExperiment={preferences.visualExperiment} environmentStyle={state.worldSettings.environmentStyle} worldSeed={state.worldSettings.worldSeed} terrainGenerationVersion={state.worldSettings.terrainGenerationVersion} constructionFeedback={constructionFeedback} focusedProjectId={focusedProjectId} onSelectProject={onFocusWorldProject} onClearWorldFocus={onClearWorldFocus}/>
    <section className="focus-panel v7-focus-panel">
      {!session && <div className="workbench-heading">
        <div><span className="eyebrow">今天继续建造</span><h1>{active.project.title}</h1></div>
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
        {session && state.focusIntegrityPolicy.enabled && <div className={session.integrity.effectiveExcursions > 0 ? 'focus-integrity-warning active' : 'focus-integrity-warning'}><AlertTriangle/>有效离开 {session.integrity.effectiveExcursions} / {state.focusIntegrityPolicy.maxEffectiveExcursions} 次</div>}
        {integrityFailure && <div className="focus-integrity-ended" role="alert"><AlertTriangle/>本轮专注因达到离开应用次数上限而结束。下次可以从这里继续。</div>}
         <FocusTimer endsAt={timerEndsAt} fallbackMs={focusMinutes * 60000} onElapsed={session ? reconcile : finishBreak}/>
        {isBreak ? <button className="primary secondary-action" onClick={() => { if (reconciledPlan?.endAfterBreak) setPlan(null); else { const { breakEndsAt: _breakEndsAt, ...withoutBreak } = reconciledPlan!; setPlan({ ...withoutBreak, status: 'ready' }); } }}>跳过休息</button>
          : reconciledPlan?.status === 'ready' ? <button className="primary" onClick={() => void startFocus()}><Clock3/>开始下一轮</button>
            : <button className={session ? 'destructive primary' : 'primary'} onClick={() => void (session ? setEnding(true) : startFocus())}>{session ? <><Square/>结束本次专注</> : <><Clock3/>开始 {reconciledPlan?.totalRounds ?? rounds} 轮</>}</button>}
      </>}
      {ending && session && (
         <EndFocusDialog taskTitle={isHabit ? active.project.title : subtask!.title} habit={isHabit} onClose={() => setEnding(false)} onInterrupt={interruptFocus} onCompleteEarly={completeEarly}/>
      )}
      {planOpen && !session && (isHabit
        ? <HabitFocusPlanSheet rounds={rounds} focusMinutes={preferences.habitFocusMinutes} breakMinutes={preferences.breakMinutes} locked={Boolean(reconciledPlan)} onRoundsChange={setRounds} onClose={() => setPlanOpen(false)}/>
        : <FocusPlanSheet subtasks={active.project.subtasks} selectedId={reconciledPlan?.subtaskId ?? selected!} rounds={rounds} focusMinutes={preferences.focusMinutes} breakMinutes={preferences.breakMinutes} locked={Boolean(reconciledPlan)} onSelect={setSelected} onRoundsChange={setRounds} onClose={() => setPlanOpen(false)}/>)}
    </section>
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
    displayName: resource.blueprint.title,
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

const WorldCanvasV7 = memo(function WorldCanvasV7({service,resourcePacks,visualExperiment,environmentStyle,worldSeed,terrainGenerationVersion,constructionFeedback=0,focusedProjectId,onSelectProject,onClearWorldFocus}:{service:ApplicationService;resourcePacks:ResourcePackRepository;visualExperiment:VoxelVisualExperiment;environmentStyle:WorldEnvironmentStyle;worldSeed:string;terrainGenerationVersion:2;constructionFeedback?:number;focusedProjectId:string|null;onSelectProject:(projectId:string)=>void;onClearWorldFocus:()=>void}) {
  const ref=useRef<HTMLCanvasElement>(null); const renderer=useRef<VoxelRenderer|null>(null); const catalog=useBlueprintCatalog(); const world=service.worldProjection(); const state=service.snapshot(); const importedRef=useRef(new Map<string,BlueprintV1>()); const focusRef=useRef(focusedProjectId); const selectRef=useRef(onSelectProject);
  importedRef.current=new Map(world.projects.flatMap(project=>project.building.importedBlueprint?[[project.building.blueprintId,project.building.importedBlueprint as BlueprintV1]]:[])); focusRef.current=focusedProjectId; selectRef.current=onSelectProject;
  const decorationDates=decorationDatesByProject(state); const snapshotKey=world.projects.map(project=>`${project.project.id}:${project.building.blueprintId}:${project.building.completionBasisPoints}:${project.building.conditionBasisPoints}:${project.isActive}:${project.settlementIndex}:${(decorationDates.get(project.project.id)??[]).join(',')}:${project.importedDecorations.map(reward=>`${reward.rewardId}@${reward.localPosition.x},${reward.localPosition.z},${reward.rotationQuarterTurns}`).join(';')}`).join('|'); const snapshots=useMemo(()=>toVoxelWorlds(world.projects,state),[snapshotKey]); const summary=world.projects.map(project=>`${project.project.title}，${project.building.importedBlueprint?.title??blueprintName(catalog,project.building.blueprintId)}，${project.isActive?'正在建造':project.project.status==='paused'?'暂停建造':'纪念建筑'}，建造进度 ${Math.round(project.building.completionBasisPoints/100)}%，保存状况 ${conditionLabel(project.building.conditionBasisPoints)}`).join('；'); const focusedTitle=world.projects.find(project=>project.project.id===focusedProjectId)?.project.title;
  useEffect(()=>{let cancelled=false;let current:VoxelRenderer|null=null;void loadVoxelModule().then(async({createVoxelRenderer,resolveBuiltinBlueprint})=>{if(cancelled||!ref.current)return;current=createVoxelRenderer(ref.current,{resolveBlueprint:id=>importedRef.current.get(id)??resolveBuiltinBlueprint(id),resourcePackAtlasMaximumSize:resourcePackAtlasMaximumSizeForTest(),visualExperiment,environmentStyle,worldSeed,terrainGenerationVersion,onSelectProject:projectId=>selectRef.current(projectId)});renderer.current=current;current.setReducedMotion(matchMedia('(prefers-reduced-motion: reduce)').matches);current.setWorlds(toVoxelWorlds(service.worldProjection().projects,service.snapshot()));current.focusProject(focusRef.current);const pack=await resourcePacks.getActive();if(!cancelled&&current)await current.setResourcePack(pack?{id:pack.id,manifest:pack.manifest}:null);}).catch(error=>console.error('Voxel world initialization failed',error));return()=>{cancelled=true;current?.dispose();if(renderer.current===current)renderer.current=null;};},[service,resourcePacks,visualExperiment,environmentStyle,worldSeed,terrainGenerationVersion]);
  useEffect(()=>{renderer.current?.setWorlds(snapshots);},[snapshots]);
  useEffect(()=>{renderer.current?.focusProject(focusedProjectId);},[focusedProjectId]);
  const focusedProject=world.projects.find(project=>project.project.id===focusedProjectId);
  return <figure className={focusedProjectId?'world is-project-focused':'world'}><canvas ref={ref} role="img" aria-label="项目建筑世界" aria-describedby="world-summary"/><figcaption id="world-summary" className="sr-only">林边聚落，共 {world.projects.length} 栋建筑。{summary}</figcaption><div className="world-hud"><span>{focusedTitle?`正在查看 · ${focusedTitle}`:`林边聚落 · ${world.projects.length} 栋`}</span><div className="world-hud-actions">{focusedProjectId&&<button title="返回完整聚落" aria-label="返回完整聚落" onClick={onClearWorldFocus}><MapIcon/></button>}<button title="重置视角" aria-label="重置视角" onClick={()=>renderer.current?.resetCamera()}><RotateCcw/></button></div></div>{focusedProject&&<div className="world-building-details" role="status"><div><strong>{focusedProject.project.title}</strong><span>{focusedProject.project.status==='monument'?'纪念建筑':focusedProject.isActive?'正在建造':'暂停建造'} · {conditionLabel(focusedProject.building.conditionBasisPoints)}</span></div><b>{Math.round(focusedProject.building.completionBasisPoints/100)}%</b></div>}{constructionFeedback>0&&<div key={constructionFeedback} className="construction-feedback" role="status"><Hammer/><span>材料已送达，继续建造</span><i/><i/><i/></div>}</figure>;
});

function FocusTimer({endsAt,fallbackMs,onElapsed}:{endsAt?:string;fallbackMs:number;onElapsed:()=>void}) { const [now,setNow]=useState(Date.now()); const elapsed=useRef(false); useEffect(()=>{if(!endsAt)return;elapsed.current=false;const tick=()=>{const next=Date.now();setNow(next);if(next>=Date.parse(endsAt)&&!elapsed.current){elapsed.current=true;onElapsed();}};tick();const timer=window.setInterval(tick,250);return()=>clearInterval(timer);},[endsAt,onElapsed]);const remaining=endsAt?Math.max(0,Date.parse(endsAt)-now):fallbackMs;const mins=Math.floor(remaining/60000).toString().padStart(2,'0');const secs=Math.floor((remaining%60000)/1000).toString().padStart(2,'0');return <div className="timer" role="timer" aria-label={`剩余 ${mins} 分 ${secs} 秒`}>{mins}:{secs}</div>; }

const WorldCanvas = memo(function WorldCanvas({service,resourcePacks,visualExperiment,constructionFeedback=0}:{service:ApplicationService;resourcePacks:ResourcePackRepository;visualExperiment:VoxelVisualExperiment;constructionFeedback?:number}) {
  const ref=useRef<HTMLCanvasElement>(null); const renderer=useRef<VoxelRenderer|null>(null); const catalog=useBlueprintCatalog(); const world=service.worldProjection(); const state=service.snapshot(); const importedRef=useRef(new Map<string,BlueprintV1>()); importedRef.current=new Map(world.projects.flatMap(project=>project.building.importedBlueprint?[[project.building.blueprintId,project.building.importedBlueprint as BlueprintV1]]:[])); const decorationDates=decorationDatesByProject(state); const snapshotKey=world.projects.map(project=>`${project.project.id}:${project.building.blueprintId}:${project.building.completionBasisPoints}:${project.building.conditionBasisPoints}:${project.isActive}:${project.settlementIndex}:${(decorationDates.get(project.project.id)??[]).join(',')}:${project.importedDecorations.map(reward=>`${reward.rewardId}@${reward.localPosition.x},${reward.localPosition.z},${reward.rotationQuarterTurns}`).join(';')}`).join('|'); const snapshots=useMemo(()=>toVoxelWorlds(world.projects,state),[snapshotKey]); const summary=world.projects.map(project=>`${project.project.title}，${project.building.importedBlueprint?.title??blueprintName(catalog,project.building.blueprintId)}，${project.isActive?'正在建造':project.project.status==='paused'?'暂停建造':'纪念建筑'}，建造进度 ${Math.round(project.building.completionBasisPoints/100)}%，保存状况 ${conditionLabel(project.building.conditionBasisPoints)}`).join('；');
  useEffect(()=>{let cancelled=false;let current:VoxelRenderer|null=null;void loadVoxelModule().then(async({createVoxelRenderer,resolveBuiltinBlueprint})=>{if(cancelled||!ref.current)return;const snapshot=service.snapshot();current=createVoxelRenderer(ref.current,{resolveBlueprint:id=>importedRef.current.get(id)??resolveBuiltinBlueprint(id),resourcePackAtlasMaximumSize:resourcePackAtlasMaximumSizeForTest(),visualExperiment,environmentStyle:snapshot.worldSettings.environmentStyle,worldSeed:snapshot.worldSettings.worldSeed,terrainGenerationVersion:snapshot.worldSettings.terrainGenerationVersion});renderer.current=current;current.setReducedMotion(matchMedia('(prefers-reduced-motion: reduce)').matches);current.setWorlds(toVoxelWorlds(service.worldProjection().projects,snapshot));const pack=await resourcePacks.getActive();if(!cancelled&&current)await current.setResourcePack(pack?{id:pack.id,manifest:pack.manifest}:null);}).catch(error=>console.error('Voxel world initialization failed',error));return()=>{cancelled=true;current?.dispose();if(renderer.current===current)renderer.current=null;};},[service,resourcePacks,visualExperiment,state.worldSettings.environmentStyle,state.worldSettings.worldSeed,state.worldSettings.terrainGenerationVersion]);
  useEffect(()=>{renderer.current?.setWorlds(snapshots);},[snapshots]);
  return <figure className="world"><canvas ref={ref} role="img" aria-label="项目建筑世界" aria-describedby="world-summary"/><figcaption id="world-summary" className="sr-only">林边聚落，共 {world.projects.length} 栋建筑。{summary}</figcaption><div className="world-hud"><span>林边聚落 · {world.projects.length} 栋</span><button title="重置视角" aria-label="重置视角" onClick={()=>renderer.current?.resetCamera()}><RotateCcw/></button></div>{constructionFeedback>0&&<div key={constructionFeedback} className="construction-feedback" role="status"><Hammer/><span>材料已送达，继续建造</span><i/><i/><i/></div>}</figure>;
});
function toVoxelWorlds(projects:ReturnType<ApplicationService['worldProjection']>['projects'],state?:ReturnType<ApplicationService['snapshot']>):WorldSnapshot[] { const dates=state?decorationDatesByProject(state):new Map<string,string[]>();return projects.map(project=>({projectId:project.project.id,blueprintId:project.building.blueprintId,buildingCompletionBasisPoints:project.building.completionBasisPoints,buildingConditionBasisPoints:project.building.conditionBasisPoints,isMonument:project.project.status==='monument',settlementIndex:project.settlementIndex,decorationDates:dates.get(project.project.id)??[],importedDecorations:project.importedDecorations.map(reward=>({...reward,blueprint:reward.blueprint as BlueprintV1}))})); }
function decorationDatesByProject(state:ReturnType<ApplicationService['snapshot']>):Map<string,string[]> { const result=new Map<string,string[]>();const importedDates=new Set(state.decorationRewards.map(reward=>reward.date));for(const goal of state.dailyGoals){if(!goal.reachedAt||importedDates.has(goal.date))continue;const session=state.focusHistory.find(candidate=>candidate.status==='completed'&&candidate.completedAt===goal.reachedAt);if(!session)continue;const dates=result.get(session.projectId)??[];dates.push(goal.date);result.set(session.projectId,dates);}return result; }
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

function StatsScreen({state}:{state:ReturnType<ApplicationService['snapshot']>}) {
  const week=periodStats(state,'week');
  const heatmap=focusHeatmapStats(state);
  return <section className="page stats-page">
    <span className="eyebrow">本地统计</span><h1>专注轨迹</h1>
    <FocusHeatmap heatmap={heatmap}/>
    <section className="stats-overview" aria-labelledby="stats-overview-title">
      <div className="stats-section-heading"><div><h2 id="stats-overview-title">本周</h2><p>从周一到今天的记录</p></div><span>{formatFocusMinutes(week.minutes)}</span></div>
      <div className="stats-grid">
        <div><strong>{week.minutes}</strong><span>有效专注分钟</span></div>
        <div><strong>{week.completed}</strong><span>完整轮次</span></div>
        <div><strong>{week.early}</strong><span>提前完成</span></div>
        <div><strong>{week.activeDays}</strong><span>活跃天数</span></div>
      </div>
      <div className="stats-detail-line" aria-label="本周记录详情"><span><b>{week.streak}</b> 连续计划日</span><span><b>{week.interrupted}</b> 次中断</span><span><b>{week.rate}%</b> 完成率</span></div>
    </section>
    <section className="interruption-summary" aria-labelledby="interruption-summary-title"><h2 id="interruption-summary-title">本周中断原因</h2>{week.reasons.length===0?<p>这个周期没有已归类的中断。</p>:<ul>{week.reasons.map(reason=><li key={reason.value}><span>{reason.label}</span><strong>{reason.count}</strong></li>)}</ul>}</section>
    <p className="muted stats-note">热力图按实际专注时长统计，完整、提前完成和中断前的有效时间都会计入。</p>
  </section>;
}

function FocusHeatmap({heatmap}:{heatmap:ReturnType<typeof focusHeatmapStats>}) {
  return <section className="focus-heatmap-card" aria-labelledby="focus-heatmap-title">
    <div className="stats-section-heading"><div><h2 id="focus-heatmap-title">近 26 周</h2><p>按有效专注分钟着色</p></div><span>{formatFocusMinutes(heatmap.totalMinutes)}</span></div>
    <div className="focus-heatmap-scroll"><div className="focus-heatmap" role="img" aria-label={`近 26 周有效专注热力图，共 ${heatmap.totalMinutes} 分钟，${heatmap.activeDays} 个活跃日`}>
      <div className="focus-heatmap-months" aria-hidden="true">{heatmap.months.map(month=><span key={month.column} style={{gridColumn:month.column}}>{month.label}</span>)}</div>
      <div className="focus-heatmap-content"><div className="focus-heatmap-weekdays" aria-hidden="true"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span></span></div><div className="focus-heatmap-grid">{heatmap.weeks.flatMap(week=>week.days.map(day=><span key={day.date} className={`focus-heatmap-cell heat-level-${day.level}${day.future?' is-future':''}`} title={`${heatmapDateLabel(day.date)}：有效专注 ${day.minutes} 分钟`}/>))}</div></div>
    </div></div>
    <div className="focus-heatmap-legend" aria-hidden="true"><span>少</span>{[0,1,2,3,4].map(level=><i key={level} className={`heat-level-${level}`}/>)}<span>多</span></div>
  </section>;
}
function SettingsScreen({service,resourcePacks,state,run,refresh,preferences,onPreferencesChange}:{service:ApplicationService;resourcePacks:ResourcePackRepository;state:ReturnType<ApplicationService['snapshot']>;run:(c:ApplicationCommand)=>Promise<unknown>;refresh:()=>void;preferences:FocusPreferences;onPreferencesChange:(value:FocusPreferences)=>void}) { const date=localDateOf(new Date(),state.calendar.timeZone); const goal=state.dailyGoals.find(g=>g.date===date); const update=(key:'focusMinutes'|'habitFocusMinutes'|'habitTargetRounds'|'breakMinutes',value:number)=>onPreferencesChange({...preferences,[key]:value});return <section className="page"><span className="eyebrow">本地偏好</span><h1>设置</h1><div className="setting time-setting"><div><b>普通任务专注</b><small>下一轮普通任务开始时生效</small></div><label><DeferredNumberInput ariaLabel="普通任务专注分钟" min={1} max={180} value={preferences.focusMinutes} onCommit={value=>update('focusMinutes',value)}/> 分钟</label></div><div className="setting time-setting"><div><b>习惯任务专注</b><small>下一轮习惯任务开始时生效</small></div><label><DeferredNumberInput ariaLabel="习惯任务专注分钟" min={1} max={180} value={preferences.habitFocusMinutes} onCommit={value=>update('habitFocusMinutes',value)}/> 分钟</label></div><div className="setting time-setting"><div><b>每座习惯建筑轮数</b><small>当前建筑完成后，下一座建筑使用新值</small></div><label><DeferredNumberInput ariaLabel="每座习惯建筑轮数" min={10} max={30} value={preferences.habitTargetRounds} onCommit={value=>update('habitTargetRounds',value)}/> 轮</label></div><div className="setting time-setting"><div><b>每轮休息</b><small>两类任务共用；设为 0 可关闭休息</small></div><label><DeferredNumberInput ariaLabel="每轮休息分钟" min={0} max={60} value={preferences.breakMinutes} onCommit={value=>update('breakMinutes',value)}/> 分钟</label></div><FocusIntegritySetting policy={state.focusIntegrityPolicy} run={run}/><PlannedFocusDaysSetting state={state} run={run}/><div className="setting"><div><b>今日总目标</b><small>{goal?.enabled?`${goal.targetPomodoros} 次专注`:'未开启'} · 在任务页调整</small></div></div><div className="setting"><div><b>建筑腐败</b><small>{state.decayPolicy.enabled?'已开启':'默认关闭'}</small></div><button onClick={()=>void run(state.decayPolicy.enabled?{type:'DisableDecay'}:{type:'EnableDecay',damagePerMissedPlannedDayBasisPoints:500,gracePlannedDays:3})}>{state.decayPolicy.enabled?'关闭':'开启'}</button></div><div className="setting environment-style-setting"><div><b>聚落环境</b><small>只改变外围地形，不移动道路和建筑</small></div><div className="visual-experiment-control" role="group" aria-label="聚落环境">{([['natural-valley','自然山谷'],['classic-island','经典空岛']] as const).map(([value,label])=><button key={value} aria-pressed={state.worldSettings.environmentStyle===value} onClick={()=>void run({type:'ConfigureWorldEnvironment',environmentStyle:value})}>{label}</button>)}</div></div><div className="setting visual-experiment-setting"><div><b>高画质实验</b><small>仅高画质档显示，效果互斥</small></div><div className="visual-experiment-control" role="group" aria-label="高画质实验">{([['none','关闭'],['water','水面'],['mist-beam','薄雾']] as const).map(([value,label])=><button key={value} aria-pressed={preferences.visualExperiment===value} onClick={()=>onPreferencesChange({...preferences,visualExperiment:value})}>{label}</button>)}</div></div><BuildingBlueprintPanel resources={state.buildingBlueprintResources} run={run}/><ResourcePackPanel repository={resourcePacks}/><BackupPanel service={service} onChanged={refresh}/></section>; }

function BuildingBlueprintPanel({resources,run}:{resources:ReturnType<ApplicationService['snapshot']>['buildingBlueprintResources'];run:(c:ApplicationCommand)=>Promise<unknown>}) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [nativePicker,setNativePicker]=useState(false);const [remove,setRemove]=useState<string|null>(null);const [candidate,setCandidate]=useState<LitematicImportResult|null>(null);const [role,setRole]=useState<ImportRole>('building');
  useEffect(()=>{void import('@tomato-clock/platform-capacitor').then(platform=>setNativePicker(platform.isCapacitorNative()));},[]);
  const parse=async(bytes:Uint8Array)=>{setBusy(true);setError('');try{const {parseLitematic}=await loadLitematicModule();setCandidate(await parseLitematic(bytes));setRole('building');}catch(cause){setError(litematicErrorMessage(cause));}finally{setBusy(false);}};
  const nativeImport=async()=>{try{const {pickNativeLitematicFile}=await import('@tomato-clock/platform-capacitor');const file=await pickNativeLitematicFile(LITEMATIC_MAX_COMPRESSED_BYTES);if(file)await parse(file.bytes);}catch(cause){setError(litematicErrorMessage(cause));}};
  const save=async()=>{if(!candidate)return;const blueprint=toImportedBlueprint(candidate.blueprint);const limit=role==='decoration'?decorationBlueprintLimitError(blueprint):resources.length>=12?'建筑蓝图库最多保存 12 份，请先删除一份。':'';if(limit){setError(limit);return;}setBusy(true);setError('');try{const result=await run(role==='building'?{type:'ImportBuildingBlueprint',blueprint}:{type:'ImportDecorationBlueprint',blueprint});if(!(typeof result==='object'&&result!==null&&'ok' in result&&result.ok===true)){setError('无法保存这份蓝图。');return;}setCandidate(null);}catch(cause){setError(cause instanceof Error?cause.message:'无法保存这份蓝图。');}finally{setBusy(false);}};
  return <section className="building-blueprint-panel" aria-labelledby="building-blueprint-title"><header><span className="eyebrow">本机蓝图</span><h2 id="building-blueprint-title">建筑蓝图库</h2><p>建筑蓝图最多保存 12 份。导入后选择用途；建筑可用于未来新任务预览，装饰会进入每日奖励池。</p></header>{nativePicker?<button type="button" className="litematic-file" disabled={busy} onClick={()=>void nativeImport()}><FileUp/><span>{busy?'正在解析...':'导入 .litematic'}</span></button>:<label className="litematic-file"><FileUp/><span>{busy?'正在解析...':'导入 .litematic'}</span><input className="sr-only" type="file" accept=".litematic,application/octet-stream" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.currentTarget.value='';if(file)void readBrowserFileBytes(file).then(parse).catch(cause=>setError(litematicErrorMessage(cause)));}}/></label>}{candidate&&<div className="imported-blueprint-role"><strong>{candidate.preview.name}</strong><small>{candidate.preview.dimensions.width} x {candidate.preview.dimensions.height} x {candidate.preview.dimensions.depth} · {candidate.preview.nonAirBlockCount.toLocaleString('zh-CN')} 方块</small><div className="import-role" role="group" aria-label="导入蓝图用途"><button type="button" aria-pressed={role==='building'} onClick={()=>setRole('building')}>大型任务建筑</button><button type="button" aria-pressed={role==='decoration'} onClick={()=>setRole('decoration')}>每日奖励装饰</button></div><div className="dialog-actions"><button type="button" disabled={busy} onClick={()=>setCandidate(null)}>取消</button><button type="button" className="primary" disabled={busy} onClick={()=>void save()}>{role==='building'?'保存到建筑蓝图库':'加入每日奖励装饰池'}</button></div></div>}{error&&<p className="import-error" role="alert">{error}</p>}{resources.length>0&&<ul className="building-blueprint-list">{resources.map(resource=><li key={resource.id}><div><strong>{resource.blueprint.title}</strong><small>{resource.blueprint.bounds.maxX-resource.blueprint.bounds.minX+1} x {resource.blueprint.bounds.maxZ-resource.blueprint.bounds.minZ+1} 方块 · {resource.blueprint.voxels.length.toLocaleString('zh-CN')} 方块</small></div><button type="button" disabled={busy} onClick={()=>setRemove(resource.id)}>删除</button></li>)}</ul>}{remove&&<div className="dialog-backdrop" role="presentation"><div className="confirm-dialog" role="alertdialog" aria-modal="true"><h2>从蓝图库删除？</h2><p>不会改变使用这份蓝图创建的已有大型任务。</p><div className="dialog-actions"><button disabled={busy} onClick={()=>setRemove(null)}>取消</button><button className="danger-action" disabled={busy} onClick={()=>{setBusy(true);void run({type:'DeleteBuildingBlueprint',blueprintId:remove}).finally(()=>{setBusy(false);setRemove(null);});}}>删除蓝图</button></div></div></div>}</section>;
}

const WEEKDAY_OPTIONS=[{value:1,label:'一'},{value:2,label:'二'},{value:3,label:'三'},{value:4,label:'四'},{value:5,label:'五'},{value:6,label:'六'},{value:0,label:'日'}] as const;
function PlannedFocusDaysSetting({state,run}:{state:ReturnType<ApplicationService['snapshot']>;run:(c:ApplicationCommand)=>Promise<unknown>}){
  const plannedCount=7-state.calendar.restWeekdays.length;
  const toggle=(day:number)=>{const isRest=state.calendar.restWeekdays.includes(day);if(!isRest&&plannedCount===1)return;const restWeekdays=isRest?state.calendar.restWeekdays.filter(value=>value!==day):[...state.calendar.restWeekdays,day].sort((a,b)=>a-b);void run({type:'ConfigureCalendar',timeZone:state.calendar.timeZone,restWeekdays});};
  return <div className="setting planned-days-setting"><div><b>计划专注日</b><small>连续记录会跳过未选中的休息日</small></div><div className="planned-days" role="group" aria-label="计划专注日">{WEEKDAY_OPTIONS.map(day=>{const active=!state.calendar.restWeekdays.includes(day.value);return <button key={day.value} aria-pressed={active} disabled={active&&plannedCount===1} onClick={()=>toggle(day.value)}>{day.label}</button>;})}</div></div>;
}

function FocusIntegritySetting({policy,run}:{policy:ReturnType<ApplicationService['snapshot']>['focusIntegrityPolicy'];run:(c:ApplicationCommand)=>Promise<unknown>}) {
  const [draft,setDraft]=useState(policy); const [pending,setPending]=useState(false); const draftRef=useRef(policy); const queue=useRef<Promise<void>>(Promise.resolve()); const pendingCount=useRef(0);
  useEffect(()=>{if(pendingCount.current===0){draftRef.current=policy;setDraft(policy);}},[policy.enabled,policy.maxEffectiveExcursions]);
  const configure=(next:typeof policy)=>{draftRef.current=next;setDraft(next);pendingCount.current+=1;setPending(true);queue.current=queue.current.then(async()=>{await run({type:'ConfigureFocusIntegrity',...next});}).catch(()=>{draftRef.current=policy;setDraft(policy);}).finally(()=>{pendingCount.current-=1;if(pendingCount.current===0)setPending(false);});};
  return <div className="setting integrity-setting" aria-busy={pending}><div><b>专注完整性</b><small>离开应用超过 3 秒才计数；达到上限后本轮失败</small></div><div className="integrity-controls"><label className="switch-control"><input aria-label="开启专注完整性" type="checkbox" checked={draft.enabled} onChange={e=>configure({...draftRef.current,enabled:e.target.checked})}/>开启</label><label><DeferredNumberInput ariaLabel="允许有效离开次数" min={1} max={5} value={draft.maxEffectiveExcursions} disabled={!draft.enabled} onCommit={value=>configure({...draftRef.current,maxEffectiveExcursions:value})}/> 次</label></div></div>;
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
  return <section className="backup-panel" aria-labelledby="backup-title"><div><span className="eyebrow">数据与备份</span><h2 id="backup-title">本地备份</h2><p>导入会先创建回滚备份，再完整替换当前数据，不会合并。</p></div><div className="backup-actions"><button type="button" onClick={()=>void exportFile()} disabled={busy}><Download/>导出 JSON</button><label className="file-button"><FileUp/>选择备份<input aria-label="选择备份 JSON 文件" type="file" accept="application/json,.json" onChange={event=>void chooseFile(event.target.files?.[0])} disabled={busy}/></label></div>{error&&<p className="backup-error" role="alert"><AlertTriangle/>{error}</p>}{notice&&<p className="backup-notice" role="status">{notice}</p>}{preview&&<div className="import-preview"><h3>导入预览</h3><dl><div><dt>导出时间</dt><dd>{new Date(preview.exportedAt).toLocaleString('zh-CN')}</dd></div><div><dt>项目</dt><dd>{preview.summary.projectCount} 个{preview.summary.activeProjectTitle?` · 当前：${preview.summary.activeProjectTitle}`:''}</dd></div><div><dt>专注记录</dt><dd>{preview.summary.completedFocusCount} 完成 / {preview.summary.interruptedFocusCount} 中断</dd></div><div><dt>进度汇报</dt><dd>{preview.summary.progressReportCount} 条</dd></div></dl><button className="danger-action backup-confirm" type="button" onClick={()=>void confirmImport()} disabled={busy}><Upload/>确认替换本地数据</button></div>}<div className="rollback-list"><div className="rollback-heading"><h3><History/>可恢复备份</h3><button type="button" onClick={()=>void reloadRollbacks()} disabled={busy}>刷新</button></div>{rollbacks.length===0?<p>尚无回滚备份。</p>:<ul>{rollbacks.map(backup=><li key={backup.id}><div><strong>{rollbackReason(backup.reason)}</strong><span>{new Date(backup.createdAt).toLocaleString('zh-CN')} · {backup.summary?.projectCount??0} 个项目</span></div><button type="button" onClick={()=>setRestoreTarget(backup)} disabled={busy}>恢复</button></li>)}</ul>}</div>{restoreTarget&&<BackupConfirmDialog title="恢复这份备份？" confirmLabel="恢复备份" pending={busy} onCancel={()=>setRestoreTarget(null)} onConfirm={()=>void restore()}><p>当前本地数据会被完整替换，并自动创建恢复前的回滚点。</p></BackupConfirmDialog>}</section>;
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

function focusHeatmapStats(state:ReturnType<ApplicationService['snapshot']>) {
  const today=localDateOf(new Date(),state.calendar.timeZone);
  const weekday=(new Date(`${today}T12:00:00Z`).getUTCDay()+6)%7;
  const firstDate=addLocalDays(today,-weekday-25*7);
  const millisecondsByDate=effectiveFocusMillisecondsByDate(state.focusHistory);
  const weeks=Array.from({length:26},(_,weekIndex)=>({days:Array.from({length:7},(_,dayIndex)=>{
    const date=addLocalDays(firstDate,weekIndex*7+dayIndex);
    const minutes=Math.round((millisecondsByDate.get(date)??0)/60000);
    return {date,minutes,future:date>today,level:minutes===0?0:minutes<30?1:minutes<60?2:minutes<120?3:4};
  })}));
  const months=weeks.flatMap((week,index)=>{
    const first=index===0?week.days[0]:undefined;
    const monthStart=week.days.find(day=>day.date.slice(-2)==='01');
    const day=monthStart??first;
    return day?[{column:index+1,label:new Intl.DateTimeFormat('zh-CN',{month:'short',timeZone:'UTC'}).format(new Date(`${day.date}T12:00:00Z`))}]:[];
  });
  const allDays=weeks.flatMap(week=>week.days).filter(day=>!day.future);
  return {weeks,months,totalMinutes:allDays.reduce((sum,day)=>sum+day.minutes,0),activeDays:allDays.filter(day=>day.minutes>0).length};
}

function formatFocusMinutes(minutes:number){return minutes>=60?`${Math.floor(minutes/60)} 小时${minutes%60?` ${minutes%60} 分`:''}`:`${minutes} 分钟`;}
function heatmapDateLabel(date:string){const [year,month,day]=date.split('-');return `${year}年${Number(month)}月${Number(day)}日`;}

function loadPreferences():FocusPreferences { try{const value=JSON.parse(localStorage.getItem(PREFERENCES_KEY)??'null');if(value&&Number.isFinite(value.focusMinutes)&&Number.isFinite(value.breakMinutes)){const visualExperiment:VoxelVisualExperiment=value.visualExperiment==='water'||value.visualExperiment==='mist-beam'?value.visualExperiment:'none';return{focusMinutes:clamp(value.focusMinutes,1,180),habitFocusMinutes:clamp(value.habitFocusMinutes??value.focusMinutes,1,180),habitTargetRounds:clamp(value.habitTargetRounds??10,10,30),breakMinutes:clamp(value.breakMinutes,0,60),visualExperiment};}}catch{}return{focusMinutes:45,habitFocusMinutes:45,habitTargetRounds:10,breakMinutes:5,visualExperiment:'none'}; }
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
