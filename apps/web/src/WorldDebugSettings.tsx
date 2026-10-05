import type { WorldDebugSettings } from './world-debug';
import { debugTimeLabel } from './world-debug';
import { ChoiceMenu } from './ChoiceMenu';
import { MinimalClockGesture } from './ui/MinimalClockGesture';

const WEATHER_CHOICES = [
  { id: 'normal', label: '正常天气' }, { id: 'clear', label: '晴' },
  { id: 'cloudy', label: '多云' }, { id: 'rain', label: '小雨' },
  { id: 'storm', label: '雷雨' }, { id: 'snow', label: '雪' }, { id: 'mist', label: '雾' },
] as const;

export function WorldDebugSettingsPanel({ value, onChange }: {
  value: WorldDebugSettings;
  onChange: (next: WorldDebugSettings) => void;
}) {
  const update = (patch: Partial<WorldDebugSettings>) => onChange({ ...value, ...patch });
  const debugDate=new Date();debugDate.setHours(Math.floor((value.timeMinutes??720)/60),(value.timeMinutes??720)%60,0,0);
  return <section className="settings-group world-debug-settings" aria-labelledby="settings-group-debug">
    <h2 id="settings-group-debug">画面调试</h2>
    <div className="settings-list">
      <div className="setting-row">
        <div className="setting-name"><span>临时调试世界</span><small>关闭后恢复；不改变专注记录</small></div>
        <label className="switch-control ios-switch"><input type="checkbox" aria-label="临时调试世界" checked={value.enabled} onChange={() => update({ enabled: !value.enabled })}/></label>
      </div>
      {value.enabled && <>
        <div className="setting-row">
          <div className="setting-name"><span>天气</span></div>
          <div id="world-debug-weather" className="world-debug-weather">
            <ChoiceMenu label="调试天气" value={value.weather} options={WEATHER_CHOICES} floating
              onChange={weather => update({ weather: weather as WorldDebugSettings['weather'] })}/>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>时间</span><label className="world-debug-follow"><input type="checkbox" checked={value.timeMinutes !== null} onChange={() => update({ timeMinutes: value.timeMinutes === null ? 720 : null })}/>指定时间</label></div>
          {value.timeMinutes !== null ? <div className="world-debug-time"><MinimalClockGesture clockOnly ariaLabel="世界调试时间" confirmation="button" value={debugDate.getTime()} clockText={debugTimeLabel(value.timeMinutes)} busy={false}
            onChange={instant=>update({timeMinutes:instant===null?null:new Date(instant).getHours()*60+new Date(instant).getMinutes()})}/></div>
            : <span className="muted">正常时间</span>}
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>腐败</span><label className="world-debug-follow"><input type="checkbox" checked={value.decayAmount !== null} onChange={() => update({ decayAmount: value.decayAmount === null ? 0.5 : null })}/>指定程度</label></div>
          {value.decayAmount !== null ? <label className="world-debug-decay"><input aria-label="世界调试腐败程度" type="range" min="0" max="100" step="5" value={Math.round(value.decayAmount * 100)} onChange={event => update({ decayAmount: Number(event.target.value) / 100 })}/><span>{Math.round(value.decayAmount * 100)}%</span></label>
            : <span className="muted">正常腐败</span>}
        </div>
      </>}
    </div>
  </section>;
}
