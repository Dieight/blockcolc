import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ApplicationCommand, ApplicationService, NotificationCapability } from '@blockcolc/application';
import type { ImportedBlueprintStage, ImportedBlueprintV1 } from '@blockcolc/domain';
import { MAX_BUILDING_BLUEPRINTS } from '@blockcolc/domain';
import type { LitematicImportResult } from '@blockcolc/litematic';
import type { BlueprintV1 } from '@blockcolc/voxel';
import type { ResourcePackRepository } from '@blockcolc/resource-pack-indexeddb';
import type { BreakLiveUpdateCapability } from '@blockcolc/platform-capacitor';
import { MAX_BACKUP_BYTES } from '@blockcolc/storage-indexeddb';
import { AlertTriangle, Download, FileUp, History, Upload } from 'lucide-react';
import { PixelCheck as Check, PixelChevron as ChevronDown, PixelEdit as Pencil, PixelReset as RefreshCw, PixelClose as X } from './ui/PixelIcon';
import { LITEMATIC_MAX_COMPRESSED_BYTES, readBackupFileText, readBrowserFileBytes, saveBackupFile } from './browser-adapters';
import { ResourcePackPanel } from './ResourcePackPanel';
import { TextToggle } from './ui/TextToggle';
import type { FocusPreferences } from './app-types';
import { MinimalModeSettingRow } from './ui/MinimalModeSettingRow';
import { BlueprintPreview } from './BlueprintPreview';
import { WorldWeatherSettingsStatus } from './WorldWeatherStatus';
import type { WorldWeatherView } from './use-world-weather';
import { WorldDebugSettingsPanel } from './WorldDebugSettings';
import type { WorldDebugSettings } from './world-debug';
import { PlannedFocusDaysSetting } from './PlannedFocusDaysSetting';
import { BackgroundHealthSetting } from './BackgroundHealthSetting';
import { WorldColorSetting } from './WorldColorSetting';
import { PhysicalSlider } from './ui/PhysicalSlider';
import { finishRefreshFeedback, paintPendingFeedback } from './refresh-feedback';
import { DAILY_BACKUP_CHANGED } from './use-daily-backup';
import { useBackLayer } from './back-layer';

type ImportRole = 'building' | 'decoration';
let litematicModulePromise: Promise<typeof import('@blockcolc/litematic')> | null = null;
function loadLitematicModule() { litematicModulePromise ??= import('@blockcolc/litematic'); return litematicModulePromise; }

export function SettingsScreen({active,service,resourcePacks,state,run,refresh,preferences,onPreferencesChange,worldWeather,worldDebug,onWorldDebugChange,onConfigureEnvironment}:{active:boolean;service:ApplicationService;resourcePacks:ResourcePackRepository;state:ReturnType<ApplicationService['snapshot']>;run:(c:ApplicationCommand)=>Promise<unknown>;refresh:()=>void;preferences:FocusPreferences;onPreferencesChange:(value:FocusPreferences)=>void;worldWeather:WorldWeatherView;worldDebug?:WorldDebugSettings;onWorldDebugChange?:(value:WorldDebugSettings)=>void;onConfigureEnvironment?:(environment:typeof state.worldSettings.environmentStyle)=>Promise<unknown>}) {
  const [glassPreview,setGlassPreview]=useState<number|null>(null);
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
        <PlannedFocusDaysSetting calendar={state.calendar} run={run}/>
        <BackgroundHealthSetting active={active}/>
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
        <div className="setting-row toggle-row"><div className="setting-name"><span>界面字体</span><small>立即生效，无需重启</small></div>
          <TextToggle ariaLabel="界面字体" value={preferences.fontStyle??'pixel'} options={[{value:'pixel',label:'像素'},{value:'system',label:'原字体'}]} onChange={fontStyle=>onPreferencesChange({...preferences,fontStyle})}/>
        </div>
        <details className="glass-transparency-setting">
          <summary className="setting-row glass-transparency-row" aria-label={`沉浸计时玻璃，通透度 ${preferences.focusGlassTransparency}%`}>
            <div className="setting-name"><span>沉浸计时玻璃</span><small>仅调整计时面板，点击调节</small></div>
            <span className="glass-transparency-value">{glassPreview===null?`${preferences.focusGlassTransparency}%`:`预计 ${glassPreview}%`}<ChevronDown aria-hidden="true"/></span>
          </summary>
          <div className="glass-transparency-expanded">
          <div className="glass-transparency-control">
            <PhysicalSlider label="液态玻璃通透程度" value={preferences.focusGlassTransparency} onPreviewChange={setGlassPreview} onChange={focusGlassTransparency=>onPreferencesChange({...preferences,focusGlassTransparency})}/>
          </div>
          </div>
        </details>
      </div>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-world">
      <h2 id="settings-group-world">世界</h2>
      <div className="settings-list">
        <div className="setting-row toggle-row">
          <div className="setting-name"><span>聚落环境</span><small>只改变外围地形</small></div>
          <TextToggle ariaLabel="聚落环境" value={state.worldSettings.environmentStyle} options={[{value:'natural-valley',label:'自然山谷'},{value:'classic-island',label:'经典空岛'},{value:'ocean-island',label:'海洋小岛'},{value:'mosaic-coast',label:'万象海岸'}]} onChange={value=>onConfigureEnvironment?onConfigureEnvironment(value):run({type:'ConfigureWorldEnvironment',environmentStyle:value})}/>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>同步现实天气</span><small>位置仅存本机；定位暂失时使用缓存，关闭即清除</small><WorldWeatherSettingsStatus enabled={preferences.realWeatherEnabled} view={worldWeather}/></div>
          <label className="switch-control ios-switch"><input aria-label="同步现实天气" type="checkbox" checked={preferences.realWeatherEnabled} onChange={()=>onPreferencesChange({...preferences,realWeatherEnabled:!preferences.realWeatherEnabled})}/></label>
        </div>
        <div className="setting-row toggle-row">
          <div className="setting-name"><span>光影质量</span><small>更高档位增加耗电</small></div>
          <TextToggle ariaLabel="光影质量" value={preferences.lightingQuality} options={[{value:'auto',label:'自动'},{value:'performance',label:'流畅'},{value:'balanced',label:'均衡'},{value:'cinematic',label:'精致'}]} onChange={value=>onPreferencesChange({...preferences,lightingQuality:value})}/>
        </div>
        <WorldColorSetting value={preferences.worldColorAdjustment} onChange={value=>onPreferencesChange({...preferences,worldColorAdjustment:value})}/>
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
    {worldDebug && onWorldDebugChange && <WorldDebugSettingsPanel value={worldDebug} onChange={onWorldDebugChange}/>}
    <BuildingBlueprintPanel resources={state.buildingBlueprintResources} resourcePacks={resourcePacks} run={run}/>
    <ResourcePackPanel active={active} repository={resourcePacks}/>
    <BackupPanel service={service} onChanged={refresh} changeToken={state}/>
  </section>;
}

function NotificationHealthSetting({service}:{service:ApplicationService}) {
  const [capability,setCapability]=useState<NotificationCapability|null>(null);const [failed,setFailed]=useState(false);const [loading,setLoading]=useState(true);const [native,setNative]=useState(false);
  const refresh=useCallback(()=>{setLoading(true);const started=performance.now();void service.notificationCapability().then(async next=>{await finishRefreshFeedback(started);setCapability(next);setFailed(false);}).catch(async()=>{await finishRefreshFeedback(started);setFailed(true);}).finally(()=>setLoading(false));},[service]);
  useEffect(refresh,[refresh]);
  useEffect(()=>{void import('@blockcolc/platform-capacitor').then(platform=>setNative(platform.isCapacitorNative())).catch(()=>{});},[]);
  const openSystemSettings=()=>{void import('@blockcolc/platform-capacitor').then(async platform=>{const opened=await platform.openSystemNotificationSettings();if(opened)window.setTimeout(refresh,1500);}).catch(()=>{});};
  const status=failed?'暂时无法读取系统提醒状态':!capability&&loading?'正在读取系统提醒状态':capability?.permission==='granted'?(capability.precision==='exact'?'提醒可用 · 精准提醒已开启':'提醒可用 · 锁屏时可能略有延迟'):capability?.permission==='prompt'?'首次开始专注时请求通知权限':capability?.permission==='denied'?'系统通知已关闭':'当前平台不提供系统通知';
  return <div className="setting-row notification-health"><div className="setting-name"><span>专注结束提醒</span><small>{status}</small></div><div className="notification-actions">{native&&capability?.permission==='denied'&&<button type="button" className="settings-text-action" onClick={openSystemSettings}>打开系统设置</button>}<button type="button" className="settings-text-action" aria-label="刷新通知状态" title="刷新通知状态" disabled={loading} aria-busy={loading} onClick={refresh}><RefreshCw/></button></div></div>;
}

function BreakLiveUpdateSetting() {
  const [native,setNative]=useState(false);const [capability,setCapability]=useState<BreakLiveUpdateCapability|null>(null);const [loading,setLoading]=useState(false);const [failed,setFailed]=useState(false);
  const refresh=useCallback(()=>{void import('@blockcolc/platform-capacitor').then(async platform=>{const isNative=platform.isCapacitorNative();setNative(isNative);if(!isNative)return;setLoading(true);const started=performance.now();try{const next=await platform.getBreakLiveUpdateCapability();await finishRefreshFeedback(started);setCapability(next);setFailed(false);}catch{await finishRefreshFeedback(started);setFailed(true);}finally{setLoading(false);}}).catch(()=>setFailed(true));},[]);
  useEffect(refresh,[refresh]);
  if(!native)return null;
  const openSettings=()=>{void import('@blockcolc/platform-capacitor').then(async platform=>{const opened=await platform.openBreakLiveUpdateSettings();if(opened)window.setTimeout(refresh,1500);}).catch(()=>setFailed(true));};
  const status=failed?'暂时无法读取系统实时通知状态':!capability&&loading?'正在读取系统实时通知状态':!capability?.supported?'当前系统仅提供普通持续通知':capability.allowed?'已开启 · 专注与休息会显示在流体云、锁屏和通知抽屉':'系统未允许实时通知，专注与休息倒计时会退化到通知栏';
  return <div className="setting-row notification-health live-update-health"><div className="setting-name"><span>专注与休息实时状态</span><small>{status}</small></div><div className="notification-actions">{capability?.supported&&capability.settingsAvailable&&!capability.allowed&&<button type="button" className="settings-text-action" onClick={openSettings}>开启实时通知</button>}<button type="button" className="settings-text-action" aria-label="刷新实时通知状态" title="刷新实时通知状态" disabled={loading} aria-busy={loading} onClick={refresh}><RefreshCw/></button></div></div>;
}

function BuildingBlueprintPanel({resources,resourcePacks,run}:{resources:ReturnType<ApplicationService['snapshot']>['buildingBlueprintResources'];resourcePacks:ResourcePackRepository;run:(c:ApplicationCommand)=>Promise<unknown>}) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [nativePicker,setNativePicker]=useState(false);const [remove,setRemove]=useState<string|null>(null);const [candidate,setCandidate]=useState<LitematicImportResult|null>(null);const [role,setRole]=useState<ImportRole>('building');const [renaming,setRenaming]=useState<string|null>(null);const renameInput=useRef<HTMLInputElement>(null);
  const previewSource=useMemo(()=>candidate?{id:candidate.blueprint.id,displayName:candidate.preview.name,blueprint:candidate.blueprint}:null,[candidate]);
  useEffect(()=>{void import('@blockcolc/platform-capacitor').then(platform=>setNativePicker(platform.isCapacitorNative()));},[]);
  const parse=async(bytes:Uint8Array)=>{setBusy(true);setError('');try{const {parseLitematic}=await loadLitematicModule();setCandidate(await parseLitematic(bytes));setRole('building');}catch(cause){setError(litematicErrorMessage(cause));}finally{setBusy(false);}};
  const nativeImport=async()=>{try{const {pickNativeLitematicFile}=await import('@blockcolc/platform-capacitor');const file=await pickNativeLitematicFile(LITEMATIC_MAX_COMPRESSED_BYTES);if(file)await parse(file.bytes);}catch(cause){setError(litematicErrorMessage(cause));}};
  const save=async()=>{if(!candidate)return;const blueprint=toImportedBlueprint(candidate.blueprint);const limit=role==='decoration'?decorationBlueprintLimitError(blueprint):resources.length>=MAX_BUILDING_BLUEPRINTS?`最多保存 ${MAX_BUILDING_BLUEPRINTS} 份，请先删除一份。`:'';if(limit){setError(limit);return;}setBusy(true);setError('');try{const result=await run(role==='building'?{type:'ImportBuildingBlueprint',blueprint}:{type:'ImportDecorationBlueprint',blueprint});if(!(typeof result==='object'&&result!==null&&'ok' in result&&result.ok===true)){setError('无法保存这份蓝图。');return;}setCandidate(null);}catch(cause){setError(cause instanceof Error?cause.message:'无法保存这份蓝图。');}finally{setBusy(false);}};
  const beginRename=(id:string)=>{setRenaming(id);setError('');};
  const rename=async()=>{if(!renaming)return;const displayName=(renameInput.current?.value??'').trim();if(!displayName){setError('蓝图名称不能为空。');return;}setBusy(true);setError('');try{const result=await run({type:'RenameBuildingBlueprint',blueprintId:renaming,displayName});if(typeof result==='object'&&result!==null&&'ok' in result&&result.ok===true)setRenaming(null);else setError('无法修改蓝图名称。');}catch(cause){setError(cause instanceof Error?cause.message:'无法修改蓝图名称。');}finally{setBusy(false);}};
  return <section className="building-blueprint-panel" aria-labelledby="building-blueprint-title"><header><h2 id="building-blueprint-title">建筑蓝图库</h2><p>最多 {MAX_BUILDING_BLUEPRINTS} 份 · 任务建筑与每日奖励</p></header>{nativePicker?<button type="button" className="litematic-file" disabled={busy} onClick={()=>void nativeImport()}><FileUp/><span>{busy?'正在解析...':'导入 .litematic'}</span></button>:<label className="litematic-file"><FileUp/><span>{busy?'正在解析...':'导入 .litematic'}</span><input className="sr-only" type="file" accept=".litematic,application/octet-stream" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.currentTarget.value='';if(file)void readBrowserFileBytes(file).then(parse).catch(cause=>setError(litematicErrorMessage(cause)));}}/></label>}{candidate&&<div className="imported-blueprint-role"><strong>{candidate.preview.name}</strong><small>{candidate.preview.dimensions.width} x {candidate.preview.dimensions.height} x {candidate.preview.dimensions.depth} · {candidate.preview.nonAirBlockCount.toLocaleString('zh-CN')} 方块</small>{previewSource&&<BlueprintPreview resourcePacks={resourcePacks} source={previewSource}/>}<div className="import-role" role="group" aria-label="导入蓝图用途"><button type="button" aria-pressed={role==='building'} onClick={()=>setRole('building')}>大型任务建筑</button><button type="button" aria-pressed={role==='decoration'} onClick={()=>setRole('decoration')}>每日奖励装饰</button></div><div className="dialog-actions"><button type="button" disabled={busy} onClick={()=>setCandidate(null)}>取消</button><button type="button" className="primary" disabled={busy} onClick={()=>void save()}>{role==='building'?'保存到建筑蓝图库':'加入每日奖励装饰池'}</button></div></div>}{error&&<p className="import-error" role="alert">{error}</p>}{resources.length>0&&<ul className="building-blueprint-list">{resources.map(resource=><li key={resource.id}><div className="blueprint-library-copy">{renaming===resource.id?<input ref={renameInput} autoFocus aria-label={`重命名“${resource.displayName}”`} maxLength={80} defaultValue={resource.displayName} disabled={busy} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&event.keyCode!==229)void rename();if(event.key==='Escape')setRenaming(null);}}/>:<strong>{resource.displayName}</strong>}<small>{resource.blueprint.bounds.maxX-resource.blueprint.bounds.minX+1} x {resource.blueprint.bounds.maxZ-resource.blueprint.bounds.minZ+1} 方块 · {resource.blueprint.voxels.length.toLocaleString('zh-CN')} 方块</small></div><div className="blueprint-library-actions">{renaming===resource.id?<><button type="button" className="blueprint-rename" aria-label="保存蓝图名称" disabled={busy} onClick={()=>void rename()}><Check/></button><button type="button" className="blueprint-rename-cancel" aria-label="取消重命名" disabled={busy} onClick={()=>setRenaming(null)}><X/></button></>:<><button type="button" className="blueprint-rename" aria-label={`重命名“${resource.displayName}”`} disabled={busy} onClick={()=>beginRename(resource.id)}><Pencil/></button><button type="button" className="blueprint-delete" disabled={busy} onClick={()=>setRemove(resource.id)}>删除</button></>}</div></li>)}</ul>}{remove&&<div className="dialog-backdrop" role="presentation"><div className="confirm-dialog" role="alertdialog" aria-modal="true"><h2>从蓝图库删除？</h2><p>不会改变使用这份蓝图创建的已有大型任务。</p><div className="dialog-actions"><button disabled={busy} onClick={()=>setRemove(null)}>取消</button><button className="danger-action" disabled={busy} onClick={()=>{setBusy(true);void run({type:'DeleteBuildingBlueprint',blueprintId:remove}).finally(()=>{setBusy(false);setRemove(null);});}}>删除蓝图</button></div></div></div>}</section>;
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
  const [daily, setDaily] = useState<Awaited<ReturnType<ApplicationService['listDailyBackups']>>>(null);
  const [dailyTarget, setDailyTarget] = useState<NonNullable<typeof daily>['backups'][number] | null>(null);
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const actionRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [refreshingBackups, setRefreshingBackups] = useState(false);
  const reloadOwner = useRef(0);
  const beginAction = (action: string) => {
    if (actionRef.current) return false;
    actionRef.current = true; setBusy(true); setPendingAction(action); setError(''); setNotice(''); return true;
  };
  const endAction = () => { actionRef.current = false; setBusy(false); setPendingAction(null); };
  const reloadRollbacks=useCallback(async()=>{
    const owner = ++reloadOwner.current; const started=performance.now(); setRefreshingBackups(true);
    try { await paintPendingFeedback(); const [list, history] = await Promise.all([service.listRollbackBackups(), service.listDailyBackups()]); await finishRefreshFeedback(started); if (owner === reloadOwner.current) { setRollbacks(list); setDaily(history); } }
    catch (cause) { if (owner === reloadOwner.current) setError(errorMessage(cause)); }
    finally { await finishRefreshFeedback(started); if (owner === reloadOwner.current) setRefreshingBackups(false); }
  },[service]);
  // The settings route stays mounted while hidden. Reload when application
  // state changes so rollbacks created from another route are visible on the
  // first warm switch back to settings.
  useEffect(()=>{void reloadRollbacks();},[reloadRollbacks,changeToken]);
  useEffect(() => { const changed = (event: Event) => { const detail = (event as CustomEvent<{error:string|null}>).detail; if(detail.error)setError(detail.error); void reloadRollbacks(); }; window.addEventListener(DAILY_BACKUP_CHANGED, changed); return () => window.removeEventListener(DAILY_BACKUP_CHANGED, changed); }, [reloadRollbacks]);
  const exportFile=async()=>{if(!beginAction('export'))return;try{const text=await service.exportBackup();const stamp=new Date().toISOString().replace(/[:.]/g,'-');await saveBackupFile(text,`blockcolc-backup-${stamp}.json`);}catch(cause){setError(errorMessage(cause));}finally{endAction();}};
  const chooseFile=async(file:File|undefined)=>{if(!file||!beginAction('preview'))return;setPreview(null);setImportText(null);try{const text=await readBackupFileText(file);const next=await service.previewImport(text);setImportText(text);setPreview(next);}catch(cause){const code=typeof cause==='object'&&cause!==null&&'code' in cause?String((cause as {code:unknown}).code):'';setError(code==='BACKUP_TOO_LARGE'?`备份文件不能超过 ${MAX_BACKUP_BYTES/(1024*1024)} MiB。`:`无法读取备份：${errorMessage(cause)}`);}finally{endAction();}};
  const confirmImport=async()=>{if(!importText||!preview||!beginAction('import'))return;try{await service.replaceFromImport(importText);setPreview(null);setImportText(null);setNotice('导入完成，已创建回滚备份。');onChanged();await reloadRollbacks();}catch(cause){setError(`导入失败：${errorMessage(cause)}`);}finally{endAction();}};
  const restore=async()=>{if(!restoreTarget||!beginAction('restore'))return;try{await service.restoreRollback(restoreTarget.id);setRestoreTarget(null);setNotice('已恢复备份，并创建恢复前回滚点。');onChanged();await reloadRollbacks();}catch(cause){setError(`恢复失败：${errorMessage(cause)}`);}finally{endAction();}};
  const exportDaily = async (id:string) => { if(!beginAction(`daily-export:${id}`))return; try { await saveBackupFile(await service.exportDailyBackup(id), `blockcolc-daily-${id}.json`); } catch(cause) { setError(errorMessage(cause)); } finally { endAction(); } };
  const restoreDaily = async () => { if(!dailyTarget || !beginAction('daily-restore'))return; try { await service.restoreDailyBackup(dailyTarget.id); setDailyTarget(null); setNotice('留档已恢复，原数据保留为回滚点。'); onChanged(); await reloadRollbacks(); } catch(cause) { setError(`恢复失败：${errorMessage(cause)}`); } finally { endAction(); } };
  return <section className="backup-panel" aria-labelledby="backup-title">
    <div><h2 id="backup-title">本地备份</h2><p>导入前留回滚点；完整替换，不合并。</p></div>
    <div className="backup-actions">
      <button type="button" className="circle-busy" onClick={() => void exportFile()} disabled={busy} aria-busy={pendingAction === 'export'}><Download/>{pendingAction === 'export' ? '正在导出…' : '导出 JSON'}</button>
      <label className="file-button" aria-busy={pendingAction === 'preview'}><FileUp/>{pendingAction === 'preview' ? '正在读取…' : '选择备份'}<input aria-label="选择备份 JSON 文件" type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; void chooseFile(file); }} disabled={busy}/></label>
    </div>
    {error && <p className="backup-error" role="alert"><AlertTriangle/>{error}</p>}
    {notice && <p className="backup-notice" role="status">{notice}</p>}
    {preview && <div className="import-preview"><h3>导入预览</h3><dl>
      <div><dt>导出时间</dt><dd>{new Date(preview.exportedAt).toLocaleString('zh-CN')}</dd></div>
      <div><dt>项目</dt><dd>{preview.summary.projectCount} 个{preview.summary.activeProjectTitle ? ` · 当前：${preview.summary.activeProjectTitle}` : ''}</dd></div>
      <div><dt>专注记录</dt><dd>{preview.summary.completedFocusCount} 完成 / {preview.summary.interruptedFocusCount} 中断</dd></div>
      <div><dt>进度汇报</dt><dd>{preview.summary.progressReportCount} 条</dd></div>
    </dl><button className="danger-action backup-confirm" type="button" onClick={() => void confirmImport()} disabled={busy} aria-busy={pendingAction === 'import'}><Upload/>{pendingAction === 'import' ? '正在替换…' : '确认替换本地数据'}</button></div>}
    <div className="rollback-list"><div className="rollback-heading"><h3><History/>可恢复备份</h3><button type="button" aria-label="刷新可恢复备份" aria-busy={refreshingBackups} onClick={() => void reloadRollbacks()} disabled={busy || refreshingBackups}><span className="refresh-motion"><RefreshCw/></span>刷新</button></div>
      {rollbacks.length === 0 ? <p>尚无回滚备份。</p> : <ul>{rollbacks.map(backup => <li key={backup.id}><div><strong>{rollbackReason(backup.reason)}</strong><span>{new Date(backup.createdAt).toLocaleString('zh-CN')} · {backup.summary?.projectCount ?? 0} 个项目</span></div><button type="button" onClick={() => setRestoreTarget(backup)} disabled={busy}>恢复</button></li>)}</ul>}
    </div>
    {daily && <details className="daily-backup-history"><summary>每日合并备份 <span>{daily.backups.length} 份 · {(daily.storedBytes / 1048576).toFixed(1)} MiB</span></summary>
      <p>仅保留一份，每日合并变化并复用未变内容。上限 200 MiB；导出是完整备份，操作回滚另存。</p>
      {daily.backups.length === 0 ? <p>还没有留档，次日会自动保存。</p> : <ul>{daily.backups.map(backup => <li key={backup.id}>
        <div><strong>{backup.date}</strong><span>{new Date(backup.createdAt).toLocaleString('zh-CN')} 保存 · {backup.summary.projectCount} 个项目</span></div>
        <div className="daily-backup-actions"><button type="button" className="circle-busy" disabled={busy} aria-busy={pendingAction === `daily-export:${backup.id}`} onClick={() => void exportDaily(backup.id)}>{pendingAction === `daily-export:${backup.id}` ? '正在导出…' : '导出'}</button><button type="button" disabled={busy} onClick={() => setDailyTarget(backup)}>恢复留档</button></div>
      </li>)}</ul>}
    </details>}
    {restoreTarget && <BackupConfirmDialog title="恢复这份备份？" confirmLabel="恢复备份" pending={busy} onCancel={() => setRestoreTarget(null)} onConfirm={() => void restore()}><p>当前数据会被完整替换，并保留恢复前回滚点。</p></BackupConfirmDialog>}
    {dailyTarget && <BackupConfirmDialog title={`恢复 ${dailyTarget.date} 留档？`} confirmLabel="恢复留档" pending={busy} onCancel={() => setDailyTarget(null)} onConfirm={() => void restoreDaily()}><p>恢复当时保存的完整记录；当前数据会先保留为回滚点。</p></BackupConfirmDialog>}
  </section>;
}
function rollbackReason(reason: unknown) { const type=typeof reason==='string'?reason:(reason as {type?:string}).type; return type==='before-import'?'导入前备份':type==='before-delete-active-project'?'删除任务前备份':'恢复前备份'; }
function errorMessage(cause:unknown){return cause instanceof Error?cause.message:'发生未知错误，请重试。';}
function BackupConfirmDialog({title,confirmLabel,pending,onCancel,onConfirm,children}:{title:string;confirmLabel:string;pending:boolean;onCancel:()=>void;onConfirm:()=>void;children:ReactNode}){const cancelRef=useRef<HTMLButtonElement>(null);useBackLayer(true,()=>{if(!pending)onCancel();return true;});useEffect(()=>{cancelRef.current?.focus();const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!pending)onCancel();};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[onCancel,pending]);return <div className="dialog-backdrop" role="presentation"><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="backup-confirm-title"><h2 id="backup-confirm-title">{title}</h2>{children}<div className="dialog-actions"><button ref={cancelRef} disabled={pending} onClick={onCancel}>取消</button><button className="danger-action" disabled={pending} aria-busy={pending} onClick={onConfirm}><Upload/>{pending?'正在恢复…':confirmLabel}</button></div></div></div>;}

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
