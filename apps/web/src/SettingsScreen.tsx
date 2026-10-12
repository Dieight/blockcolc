import { t, appLocale, useI18n } from './i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ApplicationCommand, ApplicationService, NotificationCapability } from '@blockcolc/application';
import type { ResourcePackRepository } from '@blockcolc/resource-pack-indexeddb';
import type { BreakLiveUpdateCapability } from '@blockcolc/platform-capacitor';
import { MAX_BACKUP_BYTES } from '@blockcolc/storage-indexeddb';
import { AlertTriangle, Download, FileUp, History, Upload } from 'lucide-react';
import { PixelChevron as ChevronDown, PixelReset as RefreshCw, PixelClose as X } from './ui/PixelIcon';
import { readBackupFileText, saveBackupFile } from './browser-adapters';
import { ResourcePackPanel } from './ResourcePackPanel';
import { TextToggle } from './ui/TextToggle';
import type { FocusPreferences } from './app-types';
import { MinimalModeSettingRow } from './ui/MinimalModeSettingRow';
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
import { BlueprintLibrary } from './BlueprintLibrary';
import { AmbientAudioSettings } from './AmbientAudioSettings';


export function SettingsScreen({active,service,resourcePacks,state,run,refresh,preferences,onPreferencesChange,worldWeather,worldDebug,onWorldDebugChange,onConfigureEnvironment,onConfigureOutline,onReplayTutorial}:{active:boolean;service:ApplicationService;resourcePacks:ResourcePackRepository;state:ReturnType<ApplicationService['snapshot']>;run:(c:ApplicationCommand)=>Promise<unknown>;refresh:()=>void;preferences:FocusPreferences;onPreferencesChange:(value:FocusPreferences)=>void;worldWeather:WorldWeatherView;worldDebug?:WorldDebugSettings;onWorldDebugChange?:(value:WorldDebugSettings)=>void;onReplayTutorial?:()=>void;onConfigureOutline?:(visibility:FocusPreferences["constructionOutlineVisibility"])=>Promise<void>;onConfigureEnvironment?:(environment:typeof state.worldSettings.environmentStyle)=>Promise<unknown>}) {
  useI18n();
  const [glassPreview,setGlassPreview]=useState<number|null>(null);
  const update=(key:'focusMinutes'|'habitFocusMinutes'|'habitTargetRounds'|'breakMinutes',value:number)=>onPreferencesChange({...preferences,[key]:value});
  return <section className="page settings-page">
    <header className="settings-head"><h1>{t("设置")}</h1><p>{t("专注节奏、聚落外观与本地数据。")}</p></header>
    <section className="settings-group" aria-labelledby="settings-group-timing">
      <h2 id="settings-group-timing">{t("计时")}</h2>
      <div className="settings-list">
        <MinimalModeSettingRow enabled={preferences.minimalMode === true} onChange={enabled => onPreferencesChange({...preferences, minimalMode: enabled})}/>
        <div className="setting-row">
          <div className="setting-name"><span>{t("普通任务专注（分钟）")}</span></div>
          <label className="number-field"><DeferredNumberInput ariaLabel={t("普通任务专注分钟")} min={1} max={180} value={preferences.focusMinutes} onCommit={value=>update('focusMinutes',value)}/></label>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>{t("习惯任务专注（分钟）")}</span></div>
          <label className="number-field"><DeferredNumberInput ariaLabel={t("习惯任务专注分钟")} min={1} max={180} value={preferences.habitFocusMinutes} onCommit={value=>update('habitFocusMinutes',value)}/></label>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>{t("每座习惯建筑（轮）")}</span></div>
          <label className="number-field"><DeferredNumberInput ariaLabel={t("每座习惯建筑轮数")} min={10} max={30} value={preferences.habitTargetRounds} onCommit={value=>update('habitTargetRounds',value)}/></label>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>{t("每轮休息（分钟）")}</span><small>{t("0 表示不休息")}</small></div>
          <label className="number-field"><DeferredNumberInput ariaLabel={t("每轮休息分钟")} min={0} max={60} value={preferences.breakMinutes} onCommit={value=>update('breakMinutes',value)}/></label>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>{t("自动连续专注")}</span><small>{t("休息结束自动开始下一轮，锁屏时也按计划继续")}</small></div>
          <label className="switch-control ios-switch"><input aria-label={t("自动连续专注")} type="checkbox" checked={preferences.autoContinueFocus} onChange={()=>onPreferencesChange({...preferences,autoContinueFocus:!preferences.autoContinueFocus})}/></label>
        </div>
      </div>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-protection">
      <h2 id="settings-group-protection">{t("专注保护")}</h2>
      <div className="settings-list">
        <FocusIntegritySetting policy={state.focusIntegrityPolicy} run={run}/>
        <PlannedFocusDaysSetting calendar={state.calendar} run={run}/>
        <BackgroundHealthSetting active={active}/>
      </div>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-notice">
      <h2 id="settings-group-notice">{t("提醒")}</h2>
      <div className="settings-list">
        <NotificationHealthSetting service={service}/>
        <BreakLiveUpdateSetting/>
        <div className="setting-row">
          <div className="setting-name"><span>{t("返回专注提醒")}</span><small>{t("极简或马拉松休息结束且还有轮次时提醒回来专注")}</small></div>
          <label className="switch-control ios-switch"><input aria-label={t("开启返回专注提醒")} type="checkbox" checked={preferences.returnToFocusReminders} onChange={()=>onPreferencesChange({...preferences,returnToFocusReminders:!preferences.returnToFocusReminders})}/></label>
        </div>
      </div>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-appearance">
      <h2 id="settings-group-appearance">{t("外观")}</h2>
      <div className="settings-list">
        <div className="setting-row toggle-row">
          <div className="setting-name"><span>{t("深色模式")}</span><small>{t("跟随系统或手动指定")}</small></div>
          <TextToggle ariaLabel={t("深色模式")} value={preferences.themeMode} options={[{value:'light',label:t("浅色")},{value:'dark',label:t("深色")},{value:'system',label:t("跟随系统")}]} onChange={value=>onPreferencesChange({...preferences,themeMode:value})}/>
        </div>
        <div className="setting-row toggle-row"><div className="setting-name"><span>{t("界面语言")}</span></div>
          <TextToggle ariaLabel={t("界面语言")} value={preferences.language??'zh-CN'} options={[{value:'zh-CN',label:'简体中文'},{value:'en',label:'English'}]} onChange={language=>onPreferencesChange({...preferences,language})}/>
        </div>
        <div className="setting-row toggle-row"><div className="setting-name"><span>{t("界面字体")}</span><small>{t("立即生效，无需重启")}</small></div>
          <TextToggle ariaLabel={t("界面字体")} value={preferences.fontStyle??'pixel'} options={[{value:'pixel',label:t("像素")},{value:'system',label:t("原字体")}]} onChange={fontStyle=>onPreferencesChange({...preferences,fontStyle})}/>
        </div>
        <details className="glass-transparency-setting">
          <summary className="setting-row glass-transparency-row" aria-label={t("沉浸计时玻璃，通透度 {0}%", preferences.focusGlassTransparency)}>
            <div className="setting-name"><span>{t("沉浸计时玻璃")}</span><small>{t("仅调整计时面板，点击调节")}</small></div>
            <span className="glass-transparency-value">{glassPreview===null?`${preferences.focusGlassTransparency}%`:t("预计 {0}%", glassPreview)}<ChevronDown aria-hidden="true"/></span>
          </summary>
          <div className="glass-transparency-expanded">
          <div className="glass-transparency-control">
            <PhysicalSlider label={t("液态玻璃通透程度")} value={preferences.focusGlassTransparency} onPreviewChange={setGlassPreview} onChange={focusGlassTransparency=>onPreferencesChange({...preferences,focusGlassTransparency})}/>
          </div>
          </div>
        </details>
      </div>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-world">
      <h2 id="settings-group-world">{t("世界")}</h2>
      <div className="settings-list">
        <div className="setting-row toggle-row">
          <div className="setting-name"><span>{t("聚落环境")}</span><small>{t("回到计时页更新地形")}</small></div>
          <TextToggle ariaLabel={t("聚落环境")} value={state.worldSettings.environmentStyle} options={[{value:'classic-island',label:t("空岛")},{value:'natural-valley',label:t("山谷")},{value:'ocean-island',label:t("海岛")},{value:'mosaic-coast',label:t("海岸")}]} onChange={value=>onConfigureEnvironment?onConfigureEnvironment(value):run({type:'ConfigureWorldEnvironment',environmentStyle:value})}/>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>{t("同步现实天气")}</span><small>{t("位置仅存本机；定位暂失时使用缓存，关闭即清除")}</small><WorldWeatherSettingsStatus enabled={preferences.realWeatherEnabled} view={worldWeather}/></div>
          <label className="switch-control ios-switch"><input aria-label={t("同步现实天气")} type="checkbox" checked={preferences.realWeatherEnabled} onChange={()=>onPreferencesChange({...preferences,realWeatherEnabled:!preferences.realWeatherEnabled})}/></label>
        </div>
        <div className="setting-row toggle-row">
          <div className="setting-name"><span>{t("光影质量")}</span><small>{t("回到计时页应用；高档位更耗电")}</small></div>
          <TextToggle ariaLabel={t("光影质量")} value={preferences.lightingQuality} options={[{value:'auto',label:t("自动")},{value:'performance',label:t("流畅")},{value:'balanced',label:t("均衡")},{value:'cinematic',label:t("精致")}]} onChange={value=>onPreferencesChange({...preferences,lightingQuality:value})}/>
        </div>
        <WorldColorSetting value={preferences.worldColorAdjustment} onChange={value=>onPreferencesChange({...preferences,worldColorAdjustment:value})}/>
        <div className="setting-row toggle-row">
          <div className="setting-name"><span>{t("施工轮廓")}</span><small>{t("未建部分的显示范围")}</small></div>
          <TextToggle ariaLabel={t("施工轮廓")} value={preferences.constructionOutlineVisibility} options={[{value:'off',label:t("关闭")},{value:'current',label:t("当前")},{value:'all',label:t("全部")}]} onChange={value=>{if(onConfigureOutline)void onConfigureOutline(value);else onPreferencesChange({...preferences,constructionOutlineVisibility:value});}}/>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>{t("建筑腐败")}</span><small>{t("错过的计划日会风化建筑，专注可修复")}</small></div>
          {/* A1 返修：受控开关的事件值在 React 19 下可能读到回填后的 props 值，
              统一从当前状态取反，不读 event.target.checked。 */}
          <label className="switch-control ios-switch"><input aria-label={t("开启建筑腐败")} type="checkbox" checked={state.decayPolicy.enabled} onChange={()=>void run(state.decayPolicy.enabled?{type:'DisableDecay'}:{type:'EnableDecay',damagePerMissedPlannedDayBasisPoints:500,gracePlannedDays:3})}/></label>
        </div>
      </div>
    </section>
    <section className="settings-group" aria-labelledby="settings-group-advanced">
      <h2 id="settings-group-advanced">{t("高级")}</h2>
      <div className="settings-list">
        <div className="setting-row">
          <div className="setting-name"><span>{t("自动检查并下载")}</span><small>{t("启动时检查新版")}</small></div>
          <label className="switch-control ios-switch"><input aria-label={t("自动检查并下载")} type="checkbox" checked={preferences.autoCheckUpdates === true} onChange={()=>onPreferencesChange({...preferences,autoCheckUpdates:!preferences.autoCheckUpdates})}/></label>
        </div>
          <div className="setting-row">
            <div className="setting-name"><span>{t("渐进启动")}</span><small>{t("先打开计时，世界稍后就绪；下次启动生效")}</small></div>
            <label className="switch-control ios-switch"><input aria-label={t("渐进启动")} type="checkbox" checked={preferences.progressiveStartup === true} onChange={()=>onPreferencesChange({...preferences,progressiveStartup:!preferences.progressiveStartup})}/></label>
          </div>
        {onReplayTutorial&&<div className="setting-row"><div className="setting-name"><span>{t("新手教程")}</span></div><button type="button" className="settings-text-action" onClick={onReplayTutorial}>{t("重新查看")}</button></div>}
        <div className="setting-row">
          <div className="setting-name"><span>{t("显示世界坐标")}</span><small>{t("点按地形时显示 x、z 与高度，便于定位世界问题")}</small></div>
          <label className="switch-control ios-switch"><input aria-label={t("显示世界坐标")} type="checkbox" checked={preferences.showWorldCoordinates} onChange={()=>onPreferencesChange({...preferences,showWorldCoordinates:!preferences.showWorldCoordinates})}/></label>
        </div>
      </div>
    </section>
    {worldDebug && onWorldDebugChange && <WorldDebugSettingsPanel value={worldDebug} onChange={onWorldDebugChange}/>}
    <AmbientAudioSettings preferences={preferences} onChange={onPreferencesChange}/>
    <section className="settings-group"><h2>{t('便签')}</h2><div className="settings-list"><div className="setting-row"><div className="setting-name"><span>{t('简易便签')}</span><small>{t('任务页与极简面板共用清单')}</small></div><label className="switch-control ios-switch"><input type="checkbox" aria-label={t('简易便签')} checked={preferences.quickNotesEnabled===true} onChange={()=>onPreferencesChange({...preferences,quickNotesEnabled:!preferences.quickNotesEnabled})}/></label></div></div></section>
    <BlueprintLibrary state={state} resourcePacks={resourcePacks} run={run}/>
    <ResourcePackPanel active={active} repository={resourcePacks}/>
    <BackupPanel service={service} onChanged={refresh} changeToken={state}/>
  </section>;
}

function NotificationHealthSetting({service}:{service:ApplicationService}) {
  useI18n();
  const [capability,setCapability]=useState<NotificationCapability|null>(null);const [failed,setFailed]=useState(false);const [loading,setLoading]=useState(true);const [native,setNative]=useState(false);
  const refresh=useCallback(()=>{setLoading(true);const started=performance.now();void service.notificationCapability().then(async next=>{await finishRefreshFeedback(started);setCapability(next);setFailed(false);}).catch(async()=>{await finishRefreshFeedback(started);setFailed(true);}).finally(()=>setLoading(false));},[service]);
  useEffect(refresh,[refresh]);
  useEffect(()=>{void import('@blockcolc/platform-capacitor').then(platform=>setNative(platform.isCapacitorNative())).catch(()=>{});},[]);
  const openSystemSettings=()=>{void import('@blockcolc/platform-capacitor').then(async platform=>{const opened=await platform.openSystemNotificationSettings();if(opened)window.setTimeout(refresh,1500);}).catch(()=>{});};
  const status=failed?t("暂时无法读取系统提醒状态"):!capability&&loading?t("正在读取系统提醒状态"):capability?.permission==='granted'?(capability.precision==='exact'?t("提醒可用 · 精准提醒已开启"):t("提醒可用 · 锁屏时可能略有延迟")):capability?.permission==='prompt'?t("首次开始专注时请求通知权限"):capability?.permission==='denied'?t("系统通知已关闭"):t("当前平台不提供系统通知");
  return <div className="setting-row notification-health"><div className="setting-name"><span>{t("专注结束提醒")}</span><small>{status}</small></div><div className="notification-actions">{native&&capability?.permission==='denied'&&<button type="button" className="settings-text-action" onClick={openSystemSettings}>{t("打开系统设置")}</button>}<button type="button" className="settings-text-action" aria-label={t("刷新通知状态")} title={t("刷新通知状态")} disabled={loading} aria-busy={loading} onClick={refresh}><RefreshCw/></button></div></div>;
}

function BreakLiveUpdateSetting() {
  useI18n();
  const [native,setNative]=useState(false);const [capability,setCapability]=useState<BreakLiveUpdateCapability|null>(null);const [loading,setLoading]=useState(false);const [failed,setFailed]=useState(false);
  const refresh=useCallback(()=>{void import('@blockcolc/platform-capacitor').then(async platform=>{const isNative=platform.isCapacitorNative();setNative(isNative);if(!isNative)return;setLoading(true);const started=performance.now();try{const next=await platform.getBreakLiveUpdateCapability();await finishRefreshFeedback(started);setCapability(next);setFailed(false);}catch{await finishRefreshFeedback(started);setFailed(true);}finally{setLoading(false);}}).catch(()=>setFailed(true));},[]);
  useEffect(refresh,[refresh]);
  if(!native)return null;
  const openSettings=()=>{void import('@blockcolc/platform-capacitor').then(async platform=>{const opened=await platform.openBreakLiveUpdateSettings();if(opened)window.setTimeout(refresh,1500);}).catch(()=>setFailed(true));};
  const status=failed?t("暂时无法读取系统实时通知状态"):!capability&&loading?t("正在读取系统实时通知状态"):capability?.originOs?(capability.originOsSceneAllowed?t("原子岛场景已授权"):t("需在 vivo 系统授权原子岛场景；当前使用普通通知")):!capability?.supported?t("当前系统仅提供普通持续通知"):capability.allowed?t("已开启 · 专注与休息会显示在流体云、锁屏和通知抽屉"):t("系统未允许实时通知，专注与休息倒计时会退化到通知栏");
  return <div className="setting-row notification-health live-update-health"><div className="setting-name"><span>{t("专注与休息实时状态")}</span><small>{status}</small></div><div className="notification-actions">{capability?.supported&&capability.settingsAvailable&&!capability.allowed&&<button type="button" className="settings-text-action" onClick={openSettings}>{t("开启实时通知")}</button>}<button type="button" className="settings-text-action" aria-label={t("刷新实时通知状态")} title={t("刷新实时通知状态")} disabled={loading} aria-busy={loading} onClick={refresh}><RefreshCw/></button></div></div>;
}

function FocusIntegritySetting({policy,run}:{policy:ReturnType<ApplicationService['snapshot']>['focusIntegrityPolicy'];run:(c:ApplicationCommand)=>Promise<unknown>}) {
  useI18n();
  const [draft,setDraft]=useState(policy); const [pending,setPending]=useState(false); const [error,setError]=useState(''); const draftRef=useRef(policy); const committedRef=useRef(policy); const queue=useRef<Promise<void>>(Promise.resolve()); const pendingCount=useRef(0);
  useEffect(()=>{if(pendingCount.current===0){committedRef.current=policy;draftRef.current=policy;setDraft(policy);}},[policy.enabled,policy.maxEffectiveExcursions,policy.excursionThresholdSeconds]);
  // DF-UI-02: sends the full policy (DF-CORE-01 contract — a missing field
  // keeps the stored value, so the UI always posts the complete snapshot) and
  // surfaces save failures instead of silently reverting.
  const configure=(next:typeof policy)=>{draftRef.current=next;setDraft(next);setError('');pendingCount.current+=1;setPending(true);queue.current=queue.current.then(async()=>{const result=await run({type:'ConfigureFocusIntegrity',...next});if(typeof result==='object'&&result!==null&&'ok' in result&&result.ok===false){const raw=(result as unknown as {message?:unknown}).message;setError(typeof raw==='string'&&raw!==''?raw:t("设置未保存。"));draftRef.current=committedRef.current;setDraft(committedRef.current);}else if(typeof result==='object'&&result!==null&&'ok' in result&&result.ok===true){committedRef.current=next;}}).catch((cause:unknown)=>{setError(cause instanceof Error?cause.message:t("设置未保存。"));draftRef.current=committedRef.current;setDraft(committedRef.current);}).finally(()=>{pendingCount.current-=1;if(pendingCount.current===0)setPending(false);});};
  return <>
    <div className="setting-row integrity-setting" aria-busy={pending}>
      <div className="setting-name"><span>{t("专注完整性")}</span><small>{t("离开超")}{' '}{draft.excursionThresholdSeconds} {t("秒计次，达上限本轮失败")}</small></div>
      <label className="switch-control ios-switch"><input aria-label={t("开启专注完整性")} type="checkbox" checked={draft.enabled} onChange={()=>configure({...draftRef.current,enabled:!draftRef.current.enabled})}/></label>
    </div>
    {/* DF-A1-02: while integrity is off the two numeric rows stay hidden; the
     * drafts survive inside the component state and reappear with their saved
     * values when the switch is turned back on. */}
    {draft.enabled && <>
      <div className="setting-row integrity-numeric-row" aria-busy={pending}>
        <div className="setting-name"><span>{t("有效离开上限（次）")}</span><small>{t("一轮内达到该次数即失败")}</small></div>
        <label className="number-field"><DeferredNumberInput ariaLabel={t("允许有效离开次数")} min={1} max={5} value={draft.maxEffectiveExcursions} disabled={pending} onCommit={value=>configure({...draftRef.current,maxEffectiveExcursions:value})}/></label>
      </div>
      <div className="setting-row integrity-numeric-row" aria-busy={pending}>
        <div className="setting-name"><span>{t("离开阈值（秒）")}</span><small>{t("回到前台时离开超过该秒数才计入")}</small></div>
        <label className="number-field"><DeferredNumberInput ariaLabel={t("离开阈值秒数")} min={1} max={60} value={draft.excursionThresholdSeconds} disabled={pending} onCommit={value=>configure({...draftRef.current,excursionThresholdSeconds:value})}/></label>
      </div>
    </>}
    {error && <p className="plan-sheet-note is-invalid" role="alert">{error}</p>}
  </>;
}

function DeferredNumberInput({ariaLabel,min,max,value,disabled=false,onCommit}:{ariaLabel:string;min:number;max:number;value:number;disabled?:boolean;onCommit:(value:number)=>void}) {
  useI18n();
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
  useI18n();
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
  const chooseFile=async(file:File|undefined)=>{if(!file||!beginAction('preview'))return;setPreview(null);setImportText(null);try{const text=await readBackupFileText(file);const next=await service.previewImport(text);setImportText(text);setPreview(next);}catch(cause){const code=typeof cause==='object'&&cause!==null&&'code' in cause?String((cause as {code:unknown}).code):'';setError(code==='BACKUP_TOO_LARGE'?t("备份文件不能超过 {0} MiB。", MAX_BACKUP_BYTES/(1024*1024)):t("无法读取备份：{0}", errorMessage(cause)));}finally{endAction();}};
  const confirmImport=async()=>{if(!importText||!preview||!beginAction('import'))return;try{await service.replaceFromImport(importText);setPreview(null);setImportText(null);setNotice(t("导入完成，已创建回滚备份。"));onChanged();await reloadRollbacks();}catch(cause){setError(t("导入失败：{0}", errorMessage(cause)));}finally{endAction();}};
  const restore=async()=>{if(!restoreTarget||!beginAction('restore'))return;try{await service.restoreRollback(restoreTarget.id);setRestoreTarget(null);setNotice(t("已恢复备份，并创建恢复前回滚点。"));onChanged();await reloadRollbacks();}catch(cause){setError(t("恢复失败：{0}", errorMessage(cause)));}finally{endAction();}};
  const exportDaily = async (id:string) => { if(!beginAction(`daily-export:${id}`))return; try { await saveBackupFile(await service.exportDailyBackup(id), `blockcolc-daily-${id}.json`); } catch(cause) { setError(errorMessage(cause)); } finally { endAction(); } };
  const restoreDaily = async () => { if(!dailyTarget || !beginAction('daily-restore'))return; try { await service.restoreDailyBackup(dailyTarget.id); setDailyTarget(null); setNotice(t("留档已恢复，原数据保留为回滚点。")); onChanged(); await reloadRollbacks(); } catch(cause) { setError(t("恢复失败：{0}", errorMessage(cause))); } finally { endAction(); } };
  return <section className="backup-panel" aria-labelledby="backup-title">
    <div><h2 id="backup-title">{t("本地备份")}</h2><p>{t("导入前留回滚点；完整替换，不合并。")}</p></div>
    <div className="backup-actions">
      <button type="button" className="circle-busy" onClick={() => void exportFile()} disabled={busy} aria-busy={pendingAction === 'export'}><Download/>{pendingAction === 'export' ? t("正在导出…") : t("导出 JSON")}</button>
      <label className="file-button" aria-busy={pendingAction === 'preview'}><FileUp/>{pendingAction === 'preview' ? t("正在读取…") : t("选择备份")}<input aria-label={t("选择备份 JSON 文件")} type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; void chooseFile(file); }} disabled={busy}/></label>
    </div>
    {error && <p className="backup-error" role="alert"><AlertTriangle/>{error}</p>}
    {notice && <p className="backup-notice" role="status">{notice}</p>}
    {preview && <div className="import-preview"><h3>{t("导入预览")}</h3><dl>
      <div><dt>{t("导出时间")}</dt><dd>{new Date(preview.exportedAt).toLocaleString(appLocale())}</dd></div>
      <div><dt>{t("项目")}</dt><dd>{preview.summary.projectCount} {t("个")}{preview.summary.activeProjectTitle ? t(" · 当前：{0}", preview.summary.activeProjectTitle) : ''}</dd></div>
      <div><dt>{t("专注记录")}</dt><dd>{preview.summary.completedFocusCount} {t("完成 /")}{' '}{preview.summary.interruptedFocusCount} {t("中断")}</dd></div>
      <div><dt>{t("进度汇报")}</dt><dd>{preview.summary.progressReportCount} {t("条")}</dd></div>
    </dl><button className="danger-action backup-confirm" type="button" onClick={() => void confirmImport()} disabled={busy} aria-busy={pendingAction === 'import'}><Upload/>{pendingAction === 'import' ? t("正在替换…") : t("确认替换本地数据")}</button></div>}
    <div className="rollback-list"><div className="rollback-heading"><h3><History/>{t("可恢复备份")}</h3><button type="button" aria-label={t("刷新可恢复备份")} aria-busy={refreshingBackups} onClick={() => void reloadRollbacks()} disabled={busy || refreshingBackups}><span className="refresh-motion"><RefreshCw/></span>{t("刷新")}</button></div>
      {rollbacks.length === 0 ? <p>{t("尚无回滚备份。")}</p> : <ul>{rollbacks.map(backup => <li key={backup.id}><div><strong>{rollbackReason(backup.reason)}</strong><span>{new Date(backup.createdAt).toLocaleString(appLocale())} · {backup.summary?.projectCount ?? 0} {t("个项目")}</span></div><button type="button" onClick={() => setRestoreTarget(backup)} disabled={busy}>{t("恢复")}</button></li>)}</ul>}
    </div>
    {daily && <details className="daily-backup-history"><summary>{t("每日合并备份")}<span>{daily.backups.length} {t("份 ·")}{' '}{(daily.storedBytes / 1048576).toFixed(1)} MiB</span></summary>
      <p>{t("仅保留一份，每日合并变化并复用未变内容。上限 200 MiB；导出是完整备份，操作回滚另存。")}</p>
      {daily.backups.length === 0 ? <p>{t("还没有留档，次日会自动保存。")}</p> : <ul>{daily.backups.map(backup => <li key={backup.id}>
        <div><strong>{backup.date}</strong><span>{new Date(backup.createdAt).toLocaleString(appLocale())} {t("保存 ·")}{' '}{backup.summary.projectCount} {t("个项目")}</span></div>
        <div className="daily-backup-actions"><button type="button" className="circle-busy" disabled={busy} aria-busy={pendingAction === `daily-export:${backup.id}`} onClick={() => void exportDaily(backup.id)}>{pendingAction === `daily-export:${backup.id}` ? t("正在导出…") : t("导出")}</button><button type="button" disabled={busy} onClick={() => setDailyTarget(backup)}>{t("恢复留档")}</button></div>
      </li>)}</ul>}
    </details>}
    {restoreTarget && <BackupConfirmDialog title={t("恢复这份备份？")} confirmLabel={t("恢复备份")} pending={busy} onCancel={() => setRestoreTarget(null)} onConfirm={() => void restore()}><p>{t("当前数据会被完整替换，并保留恢复前回滚点。")}</p></BackupConfirmDialog>}
    {dailyTarget && <BackupConfirmDialog title={t("恢复 {0} 留档？", dailyTarget.date)} confirmLabel={t("恢复留档")} pending={busy} onCancel={() => setDailyTarget(null)} onConfirm={() => void restoreDaily()}><p>{t("恢复当时保存的完整记录；当前数据会先保留为回滚点。")}</p></BackupConfirmDialog>}
  </section>;
}
function rollbackReason(reason: unknown) { const type=typeof reason==='string'?reason:(reason as {type?:string}).type; return type==='before-import'?t("导入前备份"):type==='before-delete-active-project'?t("删除任务前备份"):t("恢复前备份"); }
function errorMessage(cause:unknown){return cause instanceof Error?cause.message:t("发生未知错误，请重试。");}
function BackupConfirmDialog({title,confirmLabel,pending,onCancel,onConfirm,children}:{title:string;confirmLabel:string;pending:boolean;onCancel:()=>void;onConfirm:()=>void;children:ReactNode}){
  useI18n();const cancelRef=useRef<HTMLButtonElement>(null);useBackLayer(true,()=>{if(!pending)onCancel();return true;});useEffect(()=>{cancelRef.current?.focus();const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!pending)onCancel();};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[onCancel,pending]);return <div className="dialog-backdrop" role="presentation"><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="backup-confirm-title"><h2 id="backup-confirm-title">{title}</h2>{children}<div className="dialog-actions"><button ref={cancelRef} disabled={pending} onClick={onCancel}>{t("取消")}</button><button className="danger-action" disabled={pending} aria-busy={pending} onClick={onConfirm}><Upload/>{pending?t("正在恢复…"):confirmLabel}</button></div></div></div>;}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
