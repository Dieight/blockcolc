import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ApplicationCommand, ApplicationService, NotificationCapability } from '@tomato-clock/application';
import type { ImportedBlueprintStage, ImportedBlueprintV1 } from '@tomato-clock/domain';
import type { LitematicImportResult } from '@tomato-clock/litematic';
import type { BlueprintV1 } from '@tomato-clock/voxel';
import type { ResourcePackRepository } from '@tomato-clock/resource-pack-indexeddb';
import type { BreakLiveUpdateCapability } from '@tomato-clock/platform-capacitor';
import { MAX_BACKUP_BYTES } from '@tomato-clock/storage-indexeddb';
import { AlertTriangle, Check, Download, FileUp, History, Pencil, RefreshCw, Upload, X } from 'lucide-react';
import { LITEMATIC_MAX_COMPRESSED_BYTES, readBackupFileText, readBrowserFileBytes, saveBackupFile } from './browser-adapters';
import { ResourcePackPanel } from './ResourcePackPanel';
import { TextToggle } from './ui/TextToggle';
import type { FocusPreferences } from './app-types';
import { MinimalModeSettingRow } from './ui/MinimalModeSettingRow';
import { BlueprintPreview } from './BlueprintPreview';
import { WorldWeatherSettingsStatus } from './WorldWeatherStatus';
import type { WorldWeatherView } from './use-world-weather';

type ImportRole = 'building' | 'decoration';
let litematicModulePromise: Promise<typeof import('@tomato-clock/litematic')> | null = null;
function loadLitematicModule() { litematicModulePromise ??= import('@tomato-clock/litematic'); return litematicModulePromise; }

export function SettingsScreen({service,resourcePacks,state,run,refresh,preferences,onPreferencesChange,worldWeather}:{service:ApplicationService;resourcePacks:ResourcePackRepository;state:ReturnType<ApplicationService['snapshot']>;run:(c:ApplicationCommand)=>Promise<unknown>;refresh:()=>void;preferences:FocusPreferences;onPreferencesChange:(value:FocusPreferences)=>void;worldWeather:WorldWeatherView}) {
  const update=(key:'focusMinutes'|'habitFocusMinutes'|'habitTargetRounds'|'breakMinutes',value:number)=>onPreferencesChange({...preferences,[key]:value});
  return <section className="page settings-page">
    <header className="settings-head"><h1>设置</h1><p>专注节奏、聚落外观与本地数据。</p></header>
    <section className="settings-group" aria-labelledby="settings-group-timing">
      <h2 id="settings-group-timing">计时</h2>
      <div className="settings-list">
        <MinimalModeSettingRow enabled={preferences.minimalMode === true} onChange={enabled => onPreferencesChange({...preferences, minimalMode: enabled})}/>
        <div className="setting-row">
          <div className="setting-name"><span>普通任务专注（分钟）</span></div>
          <label className="number-field"><DeferredNumberInput ariaLabel="普通任务专注分钟" min={1} max={180} value={preferences.focusMinutes} onCommit={value=>update('focusMinutes',value)}/></label>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>习惯任务专注（分钟）</span></div>
          <label className="number-field"><DeferredNumberInput ariaLabel="习惯任务专注分钟" min={1} max={180} value={preferences.habitFocusMinutes} onCommit={value=>update('habitFocusMinutes',value)}/></label>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>每座习惯建筑（轮）</span></div>
          <label className="number-field"><DeferredNumberInput ariaLabel="每座习惯建筑轮数" min={10} max={30} value={preferences.habitTargetRounds} onCommit={value=>update('habitTargetRounds',value)}/></label>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>每轮休息（分钟）</span><small>0 表示不休息</small></div>
          <label className="number-field"><DeferredNumberInput ariaLabel="每轮休息分钟" min={0} max={60} value={preferences.breakMinutes} onCommit={value=>update('breakMinutes',value)}/></label>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>自动连续专注</span><small>休息结束自动开始下一轮，锁屏时也按计划继续</small></div>
          <label className="switch-control ios-switch"><input aria-label="自动连续专注" type="checkbox" checked={preferences.autoContinueFocus} onChange={()=>onPreferencesChange({...preferences,autoContinueFocus:!preferences.autoContinueFocus})}/></label>
        </div>
      </div>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-protection">
      <h2 id="settings-group-protection">专注保护</h2>
      <div className="settings-list">
        <FocusIntegritySetting policy={state.focusIntegrityPolicy} run={run}/>
        <PlannedFocusDaysSetting state={state} run={run}/>
      </div>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-notice">
      <h2 id="settings-group-notice">提醒</h2>
      <div className="settings-list">
        <NotificationHealthSetting service={service}/>
        <BreakLiveUpdateSetting/>
        <div className="setting-row">
          <div className="setting-name"><span>返回专注提醒</span><small>极简或马拉松休息结束且还有轮次时提醒回来专注</small></div>
          <label className="switch-control ios-switch"><input aria-label="开启返回专注提醒" type="checkbox" checked={preferences.returnToFocusReminders} onChange={()=>onPreferencesChange({...preferences,returnToFocusReminders:!preferences.returnToFocusReminders})}/></label>
        </div>
      </div>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-appearance">
      <h2 id="settings-group-appearance">外观</h2>
      <div className="settings-list">
        <div className="setting-row toggle-row">
          <div className="setting-name"><span>深色模式</span><small>跟随系统或手动指定</small></div>
          <TextToggle ariaLabel="深色模式" value={preferences.themeMode} options={[{value:'light',label:'浅色'},{value:'dark',label:'深色'},{value:'system',label:'跟随系统'}]} onChange={value=>onPreferencesChange({...preferences,themeMode:value})}/>
        </div>
        <div className="setting-row glass-transparency-row">
          <div className="setting-name"><span>沉浸计时玻璃</span><small>只调节专注与极简计时面板；计划单、任务列表、设置及世界提示保持固定清晰度</small></div>
          <label className="glass-transparency-control">
            <input aria-label="液态玻璃通透程度" type="range" min="0" max="100" step="5" value={preferences.focusGlassTransparency} style={{'--range-progress':`${preferences.focusGlassTransparency}%`} as CSSProperties} onChange={event=>onPreferencesChange({...preferences,focusGlassTransparency:Number(event.target.value)})}/>
            <span>{preferences.focusGlassTransparency}%</span>
          </label>
        </div>
      </div>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-world">
      <h2 id="settings-group-world">世界</h2>
      <div className="settings-list">
        <div className="setting-row toggle-row">
          <div className="setting-name"><span>聚落环境</span><small>只改变外围地形</small></div>
          <TextToggle ariaLabel="聚落环境" value={state.worldSettings.environmentStyle} options={[{value:'natural-valley',label:'自然山谷'},{value:'classic-island',label:'经典空岛'},{value:'ocean-island',label:'海洋小岛'}]} onChange={value=>void run({type:'ConfigureWorldEnvironment',environmentStyle:value})}/>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>同步现实天气</span><small>开启后获取位置；上次坐标仅存本机，定位暂失时使用；关闭时清除</small><WorldWeatherSettingsStatus enabled={preferences.realWeatherEnabled} view={worldWeather}/></div>
          <label className="switch-control ios-switch"><input aria-label="同步现实天气" type="checkbox" checked={preferences.realWeatherEnabled} onChange={()=>onPreferencesChange({...preferences,realWeatherEnabled:!preferences.realWeatherEnabled})}/></label>
        </div>
        <div className="setting-row toggle-row">
          <div className="setting-name"><span>光影质量</span><small>更高档位增加耗电</small></div>
          <TextToggle ariaLabel="光影质量" value={preferences.lightingQuality} options={[{value:'auto',label:'自动'},{value:'performance',label:'流畅'},{value:'balanced',label:'均衡'},{value:'cinematic',label:'精致'}]} onChange={value=>onPreferencesChange({...preferences,lightingQuality:value})}/>
        </div>
        <div className="setting-row toggle-row">
          <div className="setting-name"><span>施工轮廓</span><small>未建部分的显示范围</small></div>
          <TextToggle ariaLabel="施工轮廓" value={preferences.constructionOutlineVisibility} options={[{value:'off',label:'关闭'},{value:'current',label:'当前'},{value:'all',label:'全部'}]} onChange={value=>onPreferencesChange({...preferences,constructionOutlineVisibility:value})}/>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>建筑腐败</span><small>错过的计划日会风化建筑，专注可修复</small></div>
          {/* A1 返修：受控开关的事件值在 React 19 下可能读到回填后的 props 值，
              统一从当前状态取反，不读 event.target.checked。 */}
          <label className="switch-control ios-switch"><input aria-label="开启建筑腐败" type="checkbox" checked={state.decayPolicy.enabled} onChange={()=>void run(state.decayPolicy.enabled?{type:'DisableDecay'}:{type:'EnableDecay',damagePerMissedPlannedDayBasisPoints:500,gracePlannedDays:3})}/></label>
        </div>
      </div>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-advanced">
      <h2 id="settings-group-advanced">高级</h2>
      <div className="settings-list">
        <div className="setting-row">
          <div className="setting-name"><span>显示世界坐标</span><small>点按地形时显示 x、z 与高度，便于定位世界问题</small></div>
          <label className="switch-control ios-switch"><input aria-label="显示世界坐标" type="checkbox" checked={preferences.showWorldCoordinates} onChange={()=>onPreferencesChange({...preferences,showWorldCoordinates:!preferences.showWorldCoordinates})}/></label>
        </div>
      </div>
    </section>
    <BuildingBlueprintPanel resources={state.buildingBlueprintResources} resourcePacks={resourcePacks} run={run}/>
    <ResourcePackPanel repository={resourcePacks}/>
    <BackupPanel service={service} onChanged={refresh} changeToken={state}/>
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

function BreakLiveUpdateSetting() {
  const [native,setNative]=useState(false);const [capability,setCapability]=useState<BreakLiveUpdateCapability|null>(null);const [loading,setLoading]=useState(false);const [failed,setFailed]=useState(false);
  const refresh=useCallback(()=>{void import('@tomato-clock/platform-capacitor').then(async platform=>{const isNative=platform.isCapacitorNative();setNative(isNative);if(!isNative)return;setLoading(true);setFailed(false);try{setCapability(await platform.getBreakLiveUpdateCapability());}catch{setFailed(true);}finally{setLoading(false);}}).catch(()=>setFailed(true));},[]);
  useEffect(refresh,[refresh]);
  if(!native)return null;
  const openSettings=()=>{void import('@tomato-clock/platform-capacitor').then(async platform=>{const opened=await platform.openBreakLiveUpdateSettings();if(opened)window.setTimeout(refresh,1500);}).catch(()=>setFailed(true));};
  const status=failed?'暂时无法读取系统实时通知状态':loading?'正在读取系统实时通知状态':!capability?.supported?'当前系统仅提供普通持续通知':capability.allowed?'已开启 · 专注与休息会显示在流体云、锁屏和通知抽屉':'系统未允许实时通知，专注与休息倒计时会退化到通知栏';
  return <div className="setting-row notification-health live-update-health"><div className="setting-name"><span>专注与休息实时状态</span><small>{status}</small></div><div className="notification-actions">{capability?.supported&&capability.settingsAvailable&&!capability.allowed&&<button type="button" className="settings-text-action" onClick={openSettings}>开启实时通知</button>}<button type="button" className="settings-text-action" aria-label="刷新实时通知状态" title="刷新实时通知状态" disabled={loading} onClick={refresh}><RefreshCw className={loading?'is-spinning':''}/></button></div></div>;
}

function BuildingBlueprintPanel({resources,resourcePacks,run}:{resources:ReturnType<ApplicationService['snapshot']>['buildingBlueprintResources'];resourcePacks:ResourcePackRepository;run:(c:ApplicationCommand)=>Promise<unknown>}) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [nativePicker,setNativePicker]=useState(false);const [remove,setRemove]=useState<string|null>(null);const [candidate,setCandidate]=useState<LitematicImportResult|null>(null);const [role,setRole]=useState<ImportRole>('building');const [renaming,setRenaming]=useState<string|null>(null);const renameInput=useRef<HTMLInputElement>(null);
  const previewSource=useMemo(()=>candidate?{id:candidate.blueprint.id,displayName:candidate.preview.name,blueprint:candidate.blueprint}:null,[candidate]);
  useEffect(()=>{void import('@tomato-clock/platform-capacitor').then(platform=>setNativePicker(platform.isCapacitorNative()));},[]);
  const parse=async(bytes:Uint8Array)=>{setBusy(true);setError('');try{const {parseLitematic}=await loadLitematicModule();setCandidate(await parseLitematic(bytes));setRole('building');}catch(cause){setError(litematicErrorMessage(cause));}finally{setBusy(false);}};
  const nativeImport=async()=>{try{const {pickNativeLitematicFile}=await import('@tomato-clock/platform-capacitor');const file=await pickNativeLitematicFile(LITEMATIC_MAX_COMPRESSED_BYTES);if(file)await parse(file.bytes);}catch(cause){setError(litematicErrorMessage(cause));}};
  const save=async()=>{if(!candidate)return;const blueprint=toImportedBlueprint(candidate.blueprint);const limit=role==='decoration'?decorationBlueprintLimitError(blueprint):resources.length>=12?'建筑蓝图库最多保存 12 份，请先删除一份。':'';if(limit){setError(limit);return;}setBusy(true);setError('');try{const result=await run(role==='building'?{type:'ImportBuildingBlueprint',blueprint}:{type:'ImportDecorationBlueprint',blueprint});if(!(typeof result==='object'&&result!==null&&'ok' in result&&result.ok===true)){setError('无法保存这份蓝图。');return;}setCandidate(null);}catch(cause){setError(cause instanceof Error?cause.message:'无法保存这份蓝图。');}finally{setBusy(false);}};
  const beginRename=(id:string)=>{setRenaming(id);setError('');};
  const rename=async()=>{if(!renaming)return;const displayName=(renameInput.current?.value??'').trim();if(!displayName){setError('蓝图名称不能为空。');return;}setBusy(true);setError('');try{const result=await run({type:'RenameBuildingBlueprint',blueprintId:renaming,displayName});if(typeof result==='object'&&result!==null&&'ok' in result&&result.ok===true)setRenaming(null);else setError('无法修改蓝图名称。');}catch(cause){setError(cause instanceof Error?cause.message:'无法修改蓝图名称。');}finally{setBusy(false);}};
  return <section className="building-blueprint-panel" aria-labelledby="building-blueprint-title"><header><h2 id="building-blueprint-title">建筑蓝图库</h2><p>最多 12 份；建筑用于任务预览，装饰进入每日奖励池。</p></header>{nativePicker?<button type="button" className="litematic-file" disabled={busy} onClick={()=>void nativeImport()}><FileUp/><span>{busy?'正在解析...':'导入 .litematic'}</span></button>:<label className="litematic-file"><FileUp/><span>{busy?'正在解析...':'导入 .litematic'}</span><input className="sr-only" type="file" accept=".litematic,application/octet-stream" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.currentTarget.value='';if(file)void readBrowserFileBytes(file).then(parse).catch(cause=>setError(litematicErrorMessage(cause)));}}/></label>}{candidate&&<div className="imported-blueprint-role"><strong>{candidate.preview.name}</strong><small>{candidate.preview.dimensions.width} x {candidate.preview.dimensions.height} x {candidate.preview.dimensions.depth} · {candidate.preview.nonAirBlockCount.toLocaleString('zh-CN')} 方块</small>{previewSource&&<BlueprintPreview resourcePacks={resourcePacks} source={previewSource}/>}<div className="import-role" role="group" aria-label="导入蓝图用途"><button type="button" aria-pressed={role==='building'} onClick={()=>setRole('building')}>大型任务建筑</button><button type="button" aria-pressed={role==='decoration'} onClick={()=>setRole('decoration')}>每日奖励装饰</button></div><div className="dialog-actions"><button type="button" disabled={busy} onClick={()=>setCandidate(null)}>取消</button><button type="button" className="primary" disabled={busy} onClick={()=>void save()}>{role==='building'?'保存到建筑蓝图库':'加入每日奖励装饰池'}</button></div></div>}{error&&<p className="import-error" role="alert">{error}</p>}{resources.length>0&&<ul className="building-blueprint-list">{resources.map(resource=><li key={resource.id}><div className="blueprint-library-copy">{renaming===resource.id?<input ref={renameInput} autoFocus aria-label={`重命名“${resource.displayName}”`} maxLength={80} defaultValue={resource.displayName} disabled={busy} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&event.keyCode!==229)void rename();if(event.key==='Escape')setRenaming(null);}}/>:<strong>{resource.displayName}</strong>}<small>{resource.blueprint.bounds.maxX-resource.blueprint.bounds.minX+1} x {resource.blueprint.bounds.maxZ-resource.blueprint.bounds.minZ+1} 方块 · {resource.blueprint.voxels.length.toLocaleString('zh-CN')} 方块</small></div><div className="blueprint-library-actions">{renaming===resource.id?<><button type="button" className="blueprint-rename" aria-label="保存蓝图名称" disabled={busy} onClick={()=>void rename()}><Check/></button><button type="button" className="blueprint-rename-cancel" aria-label="取消重命名" disabled={busy} onClick={()=>setRenaming(null)}><X/></button></>:<><button type="button" className="blueprint-rename" aria-label={`重命名“${resource.displayName}”`} disabled={busy} onClick={()=>beginRename(resource.id)}><Pencil/></button><button type="button" className="blueprint-delete" disabled={busy} onClick={()=>setRemove(resource.id)}>删除</button></>}</div></li>)}</ul>}{remove&&<div className="dialog-backdrop" role="presentation"><div className="confirm-dialog" role="alertdialog" aria-modal="true"><h2>从蓝图库删除？</h2><p>不会改变使用这份蓝图创建的已有大型任务。</p><div className="dialog-actions"><button disabled={busy} onClick={()=>setRemove(null)}>取消</button><button className="danger-action" disabled={busy} onClick={()=>{setBusy(true);void run({type:'DeleteBuildingBlueprint',blueprintId:remove}).finally(()=>{setBusy(false);setRemove(null);});}}>删除蓝图</button></div></div></div>}</section>;
}

const WEEKDAY_OPTIONS=[{value:1,label:'一'},{value:2,label:'二'},{value:3,label:'三'},{value:4,label:'四'},{value:5,label:'五'},{value:6,label:'六'},{value:0,label:'日'}] as const;
function PlannedFocusDaysSetting({state,run}:{state:ReturnType<ApplicationService['snapshot']>;run:(c:ApplicationCommand)=>Promise<unknown>}){
  const plannedCount=7-state.calendar.restWeekdays.length;
  const toggle=(day:number)=>{const isRest=state.calendar.restWeekdays.includes(day);if(!isRest&&plannedCount===1)return;const restWeekdays=isRest?state.calendar.restWeekdays.filter(value=>value!==day):[...state.calendar.restWeekdays,day].sort((a,b)=>a-b);void run({type:'ConfigureCalendar',timeZone:state.calendar.timeZone,restWeekdays});};
  return <div className="setting-row toggle-row"><div className="setting-name"><span>计划专注日</span><small>连续记录跳过休息日</small></div><div className="planned-days" role="group" aria-label="计划专注日">{WEEKDAY_OPTIONS.map(day=>{const active=!state.calendar.restWeekdays.includes(day.value);return <button key={day.value} aria-pressed={active} disabled={active&&plannedCount===1} onClick={()=>toggle(day.value)}>{day.label}</button>;})}</div></div>;
}

function FocusIntegritySetting({policy,run}:{policy:ReturnType<ApplicationService['snapshot']>['focusIntegrityPolicy'];run:(c:ApplicationCommand)=>Promise<unknown>}) {
  const [draft,setDraft]=useState(policy); const [pending,setPending]=useState(false); const [error,setError]=useState(''); const draftRef=useRef(policy); const committedRef=useRef(policy); const queue=useRef<Promise<void>>(Promise.resolve()); const pendingCount=useRef(0);
  useEffect(()=>{if(pendingCount.current===0){committedRef.current=policy;draftRef.current=policy;setDraft(policy);}},[policy.enabled,policy.maxEffectiveExcursions,policy.excursionThresholdSeconds]);
  // DF-UI-02: sends the full policy (DF-CORE-01 contract — a missing field
  // keeps the stored value, so the UI always posts the complete snapshot) and
  // surfaces save failures instead of silently reverting.
  const configure=(next:typeof policy)=>{draftRef.current=next;setDraft(next);setError('');pendingCount.current+=1;setPending(true);queue.current=queue.current.then(async()=>{const result=await run({type:'ConfigureFocusIntegrity',...next});if(typeof result==='object'&&result!==null&&'ok' in result&&result.ok===false){const raw=(result as unknown as {message?:unknown}).message;setError(typeof raw==='string'&&raw!==''?raw:'设置未保存。');draftRef.current=committedRef.current;setDraft(committedRef.current);}else if(typeof result==='object'&&result!==null&&'ok' in result&&result.ok===true){committedRef.current=next;}}).catch((cause:unknown)=>{setError(cause instanceof Error?cause.message:'设置未保存。');draftRef.current=committedRef.current;setDraft(committedRef.current);}).finally(()=>{pendingCount.current-=1;if(pendingCount.current===0)setPending(false);});};
  return <>
    <div className="setting-row integrity-setting" aria-busy={pending}>
      <div className="setting-name"><span>专注完整性</span><small>离开超 {draft.excursionThresholdSeconds} 秒计次，达上限本轮失败</small></div>
      <label className="switch-control ios-switch"><input aria-label="开启专注完整性" type="checkbox" checked={draft.enabled} onChange={()=>configure({...draftRef.current,enabled:!draftRef.current.enabled})}/></label>
    </div>
    {/* DF-A1-02: while integrity is off the two numeric rows stay hidden; the
     * drafts survive inside the component state and reappear with their saved
     * values when the switch is turned back on. */}
    {draft.enabled && <>
      <div className="setting-row integrity-numeric-row" aria-busy={pending}>
        <div className="setting-name"><span>有效离开上限（次）</span><small>一轮内达到该次数即失败</small></div>
        <label className="number-field"><DeferredNumberInput ariaLabel="允许有效离开次数" min={1} max={5} value={draft.maxEffectiveExcursions} disabled={pending} onCommit={value=>configure({...draftRef.current,maxEffectiveExcursions:value})}/></label>
      </div>
      <div className="setting-row integrity-numeric-row" aria-busy={pending}>
        <div className="setting-name"><span>离开阈值（秒）</span><small>回到前台时离开超过该秒数才计入</small></div>
        <label className="number-field"><DeferredNumberInput ariaLabel="离开阈值秒数" min={1} max={60} value={draft.excursionThresholdSeconds} disabled={pending} onCommit={value=>configure({...draftRef.current,excursionThresholdSeconds:value})}/></label>
      </div>
    </>}
    {error && <p className="plan-sheet-note is-invalid" role="alert">{error}</p>}
  </>;
}

function DeferredNumberInput({ariaLabel,min,max,value,disabled=false,onCommit}:{ariaLabel:string;min:number;max:number;value:number;disabled?:boolean;onCommit:(value:number)=>void}) {
  const [draft,setDraft]=useState(String(value));
  // Editing is state rather than a ref so the commit boundary participates in
  // React's render/effect cycle. If persistence rejects a commit but the
  // parent callback swallows the error (the toast still reports it), leaving
  // the boundary restores the last persisted prop instead of leaving a false
  // draft on screen. While editing, external preference changes never clobber
  // a middle-position edit.
  const [editing,setEditing]=useState(false);
  useEffect(()=>{if(!editing)setDraft(String(value));},[value,editing]);
  const commit=()=>{setEditing(false);const next=draft.trim()===''?value:normalizedIntegerDraft(draft,min,max);setDraft(String(next));if(next!==value)onCommit(next);};
  return <input aria-label={ariaLabel} type="number" inputMode="numeric" min={min} max={max} step="1" disabled={disabled} value={draft} onFocus={()=>setEditing(true)} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.nativeEvent.isComposing||event.keyCode===229)return;if(event.key==='Enter')event.currentTarget.blur();if(event.key==='Escape'){event.preventDefault();setDraft(String(value));}}}/>;
}

function normalizedIntegerDraft(draft:string,minimum:number,maximum:number):number {
  if(!/^\d+$/.test(draft))return minimum;
  const value=Number(draft);
  return Number.isSafeInteger(value)?clamp(value,minimum,maximum):minimum;
}

function BackupPanel({service,onChanged,changeToken}:{service:ApplicationService;onChanged:()=>void;changeToken:ReturnType<ApplicationService['snapshot']>}) {
  const [preview,setPreview]=useState<Awaited<ReturnType<ApplicationService['previewImport']>>|null>(null);
  const [importText,setImportText]=useState<string|null>(null);
  const [rollbacks,setRollbacks]=useState<Awaited<ReturnType<ApplicationService['listRollbackBackups']>>>([]);
  const [restoreTarget,setRestoreTarget]=useState<Awaited<ReturnType<ApplicationService['listRollbackBackups']>>[number]|null>(null);
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const reloadRollbacks=useCallback(async()=>{ try { setRollbacks(await service.listRollbackBackups()); } catch (cause) { setError(errorMessage(cause)); } },[service]);
  // The settings route stays mounted while hidden. Reload when application
  // state changes so rollbacks created from another route are visible on the
  // first warm switch back to settings.
  useEffect(()=>{void reloadRollbacks();},[reloadRollbacks,changeToken]);
  const exportFile=async()=>{setBusy(true);setError('');try{const text=await service.exportBackup();const stamp=new Date().toISOString().replace(/[:.]/g,'-');await saveBackupFile(text,`blockcolc-backup-${stamp}.json`);setNotice('备份已导出。');}catch(cause){setError(errorMessage(cause));}finally{setBusy(false);}};
  const chooseFile=async(file:File|undefined)=>{setPreview(null);setImportText(null);setError('');setNotice('');if(!file)return;setBusy(true);try{const text=await readBackupFileText(file);const next=await service.previewImport(text);setImportText(text);setPreview(next);}catch(cause){const code=typeof cause==='object'&&cause!==null&&'code' in cause?String((cause as {code:unknown}).code):'';setError(code==='BACKUP_TOO_LARGE'?`备份文件不能超过 ${MAX_BACKUP_BYTES/(1024*1024)} MiB。`:`无法读取备份：${errorMessage(cause)}`);}finally{setBusy(false);}};
  const confirmImport=async()=>{if(!importText||!preview)return;setBusy(true);setError('');try{await service.replaceFromImport(importText);setPreview(null);setImportText(null);setNotice('导入完成，已创建回滚备份。');onChanged();await reloadRollbacks();}catch(cause){setError(`导入失败：${errorMessage(cause)}`);}finally{setBusy(false);}};
  const restore=async()=>{if(!restoreTarget)return;setBusy(true);setError('');try{await service.restoreRollback(restoreTarget.id);setRestoreTarget(null);setNotice('已恢复备份，并创建恢复前回滚点。');onChanged();await reloadRollbacks();}catch(cause){setError(`恢复失败：${errorMessage(cause)}`);}finally{setBusy(false);}};
  return <section className="backup-panel" aria-labelledby="backup-title"><div><h2 id="backup-title">本地备份</h2><p>导入前自动创建回滚备份；导入是完整替换，不合并数据。</p></div><div className="backup-actions"><button type="button" onClick={()=>void exportFile()} disabled={busy}><Download/>导出 JSON</button><label className="file-button"><FileUp/>选择备份<input aria-label="选择备份 JSON 文件" type="file" accept="application/json,.json" onChange={event=>void chooseFile(event.target.files?.[0])} disabled={busy}/></label></div>{error&&<p className="backup-error" role="alert"><AlertTriangle/>{error}</p>}{notice&&<p className="backup-notice" role="status">{notice}</p>}{preview&&<div className="import-preview"><h3>导入预览</h3><dl><div><dt>导出时间</dt><dd>{new Date(preview.exportedAt).toLocaleString('zh-CN')}</dd></div><div><dt>项目</dt><dd>{preview.summary.projectCount} 个{preview.summary.activeProjectTitle?` · 当前：${preview.summary.activeProjectTitle}`:''}</dd></div><div><dt>专注记录</dt><dd>{preview.summary.completedFocusCount} 完成 / {preview.summary.interruptedFocusCount} 中断</dd></div><div><dt>进度汇报</dt><dd>{preview.summary.progressReportCount} 条</dd></div></dl><button className="danger-action backup-confirm" type="button" onClick={()=>void confirmImport()} disabled={busy}><Upload/>确认替换本地数据</button></div>}<div className="rollback-list"><div className="rollback-heading"><h3><History/>可恢复备份</h3><button type="button" onClick={()=>void reloadRollbacks()} disabled={busy}>刷新</button></div>{rollbacks.length===0?<p>尚无回滚备份。</p>:<ul>{rollbacks.map(backup=><li key={backup.id}><div><strong>{rollbackReason(backup.reason)}</strong><span>{new Date(backup.createdAt).toLocaleString('zh-CN')} · {backup.summary?.projectCount??0} 个项目</span></div><button type="button" onClick={()=>setRestoreTarget(backup)} disabled={busy}>恢复</button></li>)}</ul>}</div>{restoreTarget&&<BackupConfirmDialog title="恢复这份备份？" confirmLabel="恢复备份" pending={busy} onCancel={()=>setRestoreTarget(null)} onConfirm={()=>void restore()}><p>当前本地数据会被完整替换，并自动创建恢复前的回滚点。</p></BackupConfirmDialog>}</section>;
}
function rollbackReason(reason: unknown) { const type=typeof reason==='string'?reason:(reason as {type?:string}).type; return type==='before-import'?'导入前备份':type==='before-delete-active-project'?'删除任务前备份':'恢复前备份'; }
function errorMessage(cause:unknown){return cause instanceof Error?cause.message:'发生未知错误，请重试。';}
function BackupConfirmDialog({title,confirmLabel,pending,onCancel,onConfirm,children}:{title:string;confirmLabel:string;pending:boolean;onCancel:()=>void;onConfirm:()=>void;children:ReactNode}){const cancelRef=useRef<HTMLButtonElement>(null);useEffect(()=>{cancelRef.current?.focus();const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!pending)onCancel();};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[onCancel,pending]);return <div className="dialog-backdrop" role="presentation"><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="backup-confirm-title"><h2 id="backup-confirm-title">{title}</h2>{children}<div className="dialog-actions"><button ref={cancelRef} disabled={pending} onClick={onCancel}>取消</button><button className="danger-action" disabled={pending} onClick={onConfirm}><Upload/>{confirmLabel}</button></div></div></div>;}

function toImportedBlueprint(blueprint: BlueprintV1): ImportedBlueprintV1 {
  return { ...blueprint, voxels: blueprint.voxels.map((voxel) => ({ ...voxel, stage: stageForBuildOrder(voxel.buildOrder) })) };
}
function stageForBuildOrder(value: number): ImportedBlueprintStage {
  return value < 1_800 ? 'foundation' : value < 3_800 ? 'frame' : value < 6_500 ? 'walls' : value < 8_800 ? 'roof' : 'details';
}
function decorationBlueprintLimitError(blueprint: BlueprintV1): string {
  const width = blueprint.bounds.maxX - blueprint.bounds.minX + 1;
  const height = blueprint.bounds.maxY - blueprint.bounds.minY + 1;
  const depth = blueprint.bounds.maxZ - blueprint.bounds.minZ + 1;
  if (width > 12 || depth > 12 || height > 16) return `这份蓝图为 ${width} x ${height} x ${depth}，奖励装饰上限为 12 x 12 x 16。`;
  if (blueprint.voxels.length > 2_000) return `这份蓝图含 ${blueprint.voxels.length.toLocaleString('zh-CN')} 个方块，奖励装饰上限为 2,000 个。`;
  return '';
}
function litematicErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  if (code === 'INPUT_TOO_LARGE' || code === 'NBT_TOO_LARGE' || code === 'LIMIT_EXCEEDED') return '图纸超过安全限制：文件 64 MB、占地 96 x 96、高度 256、最多 300,000 个方块。';
  if (code === 'NOT_GZIP' || code === 'INVALID_GZIP' || code === 'INVALID_NBT' || code === 'INVALID_LITEMATIC') return '无法读取这份 .litematic，请确认文件完整且由 Litematica 导出。';
  return error instanceof Error ? error.message : '图纸导入失败，请换一份文件重试。';
}
function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
