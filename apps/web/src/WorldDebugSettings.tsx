import { t, useI18n } from './i18n';
import type { WorldDebugSettings } from './world-debug';
import { debugTimeLabel } from './world-debug';
import { ChoiceMenu } from './ChoiceMenu';
import { MinimalClockGesture } from './ui/MinimalClockGesture';
import { Reveal } from './ui/Reveal';
import { PhysicalSlider } from './ui/PhysicalSlider';
import {previewCelebration} from './celebrations';

const WEATHER_CHOICES = [
  { id: 'normal', label: "正常天气" }, { id: 'clear', label: "晴" },
  { id: 'cloudy', label: "多云" }, { id: 'rain', label: "小雨" },
  { id: 'storm', label: "雷雨" }, { id: 'snow', label: "雪" }, { id: 'mist', label: "雾" },
] as const;

export function WorldDebugSettingsPanel({ value, onChange, embedded=false }: {
  value: WorldDebugSettings;
  onChange: (next: WorldDebugSettings) => void;
  embedded?: boolean;
}) {
  useI18n();
  const update = (patch: Partial<WorldDebugSettings>) => onChange({ ...value, ...patch });
  const debugDate=new Date();debugDate.setHours(Math.floor((value.timeMinutes??720)/60),(value.timeMinutes??720)%60,0,0);
  const content=<>
      <div className="setting-row">
        <div className="setting-name"><span>{t("画面调试")}</span><small>{t("关闭后恢复；不改变专注记录")}</small></div>
        <label className="switch-control ios-switch"><input type="checkbox" aria-label={t("临时调试世界")} checked={value.enabled} onChange={() => update({ enabled: !value.enabled })}/></label>
      </div>
      <Reveal open={value.enabled} overflowVisible>
        <div className="setting-row"><div className="setting-name"><span>{t('落成彩纸')}</span><small>{t('仅预览，不发放奖励')}</small></div><button type="button" className="settings-text-action" aria-label={t('播放落成彩纸')} onClick={()=>previewCelebration()}>{t('播放')}</button></div>
        <div className="setting-row"><div className="setting-name"><span>{t('目标达成彩纸')}</span><small>{t('仅预览，不发放奖励')}</small></div><button type="button" className="settings-text-action" aria-label={t('播放目标彩纸')} onClick={()=>previewCelebration(true)}>{t('播放')}</button></div>
        <div className="setting-row">
          <div className="setting-name"><span>{t("天气")}</span></div>
          <div id="world-debug-weather" className="world-debug-weather">
            <ChoiceMenu label={t("调试天气")} value={value.weather} options={WEATHER_CHOICES.map(option=>({...option,label:t(option.label)}))} floating
              onChange={weather => update({ weather: weather as WorldDebugSettings['weather'] })}/>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>{t("时间")}</span><small>{t(value.timeMinutes === null ? '正常时间' : '指定时间')}</small></div>
          <div className="setting-row-end">
          {value.timeMinutes !== null && <div className="world-debug-time"><MinimalClockGesture clockOnly ariaLabel={t("世界调试时间")} confirmation="button" value={debugDate.getTime()} clockText={debugTimeLabel(value.timeMinutes)} busy={false}
            onChange={instant=>update({timeMinutes:instant===null?null:new Date(instant).getHours()*60+new Date(instant).getMinutes()})}/></div>
          }
          <label className="switch-control ios-switch"><input type="checkbox" aria-label={t('指定时间')} checked={value.timeMinutes !== null} onChange={() => update({ timeMinutes: value.timeMinutes === null ? 720 : null })}/></label>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>{t("腐败")}</span><small>{t(value.decayAmount === null ? '正常腐败' : '指定程度')}</small></div>
          <div className="setting-row-end">{value.decayAmount !== null && <output className="setting-value">{Math.round(value.decayAmount*100)}%</output>}
            <label className="switch-control ios-switch"><input type="checkbox" aria-label={t('指定程度')} checked={value.decayAmount !== null} onChange={() => update({ decayAmount: value.decayAmount === null ? 0.5 : null })}/></label>
          </div>
        </div>
        <Reveal open={value.decayAmount !== null} overflowVisible><div className="world-debug-decay"><PhysicalSlider label={t('世界调试腐败程度')} value={Math.round((value.decayAmount??0)*100)} commitOnRelease onChange={amount=>update({decayAmount:amount/100})}/></div></Reveal>
      </Reveal>
  </>;
  return embedded?<div className="settings-inner-group world-debug-settings">{content}</div>:<section className="settings-group world-debug-settings" aria-labelledby="settings-group-debug"><h2 id="settings-group-debug">{t('画面调试')}</h2><div className="settings-list">{content}</div></section>;
}
