import type { WorldDebugSettings } from './world-debug';
import { debugTimeLabel, parseDebugTime } from './world-debug';

export function WorldDebugSettingsPanel({ value, onChange }: {
  value: WorldDebugSettings;
  onChange: (next: WorldDebugSettings) => void;
}) {
  const update = (patch: Partial<WorldDebugSettings>) => onChange({ ...value, ...patch });
  return <section className="settings-group world-debug-settings" aria-labelledby="settings-group-debug">
    <h2 id="settings-group-debug">画面调试</h2>
    <div className="settings-list">
      <div className="setting-row">
        <div className="setting-name"><span>临时调试世界</span><small>仅改变画面；关闭恢复正常，不影响专注与历史记录</small></div>
        <label className="switch-control ios-switch"><input type="checkbox" aria-label="临时调试世界" checked={value.enabled} onChange={() => update({ enabled: !value.enabled })}/></label>
      </div>
      {value.enabled && <>
        <div className="setting-row">
          <label className="setting-name" htmlFor="world-debug-weather"><span>天气</span></label>
          <select id="world-debug-weather" value={value.weather} onChange={event => update({ weather: event.target.value as WorldDebugSettings['weather'] })}>
            <option value="normal">正常天气</option><option value="clear">晴</option><option value="cloudy">多云</option><option value="rain">小雨</option><option value="storm">雷雨</option><option value="snow">雪</option><option value="mist">雾</option>
          </select>
        </div>
        <div className="setting-row">
          <div className="setting-name"><span>时间</span><label className="world-debug-follow"><input type="checkbox" checked={value.timeMinutes !== null} onChange={() => update({ timeMinutes: value.timeMinutes === null ? 720 : null })}/>指定时间</label></div>
          {value.timeMinutes !== null ? <input className="world-debug-time" aria-label="世界调试时间" type="time" value={debugTimeLabel(value.timeMinutes)} onChange={event => { const minutes = parseDebugTime(event.target.value); if (minutes !== null) update({ timeMinutes: minutes }); }}/>
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
