import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MinimalIdlePanel } from './MinimalIdlePanel';
import { MinimalEndTimeSheet } from './MinimalEndTimeSheet';
import { MinimalModeSettingRow } from './MinimalModeSettingRow';
import '../styles/index.css';

// MINI-27-01 可运行独立样例（仅开发）：最小接线演示。组件的值与回调都在
// 本地，不访问 service、不写偏好；接线归核心。
// A3-04: 样例显式应用 data-theme（URL 参数 ?theme=dark），深色截图才有效。
const urlTheme = new URLSearchParams(window.location.search).get('theme');
if (urlTheme === 'dark' || urlTheme === 'light') document.documentElement.dataset.theme = urlTheme;

function Sample() {
  // A5: a real per-second clock re-renders the tree during editing, matching
  // the wired-up minute clock; ?busy=1 / ?invalid=1 simulate wiring scenarios.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  const query = new URLSearchParams(window.location.search);
  const initialBusy = query.get('busy') === '1';
  const forcedInvalid = query.get('invalid') === '1';
  const [sheetOpen, setSheetOpen] = useState(initialBusy);
  const [busy, setBusy] = useState(initialBusy);
  const [hourDraft, setHourDraft] = useState('18');
  const [minuteDraft, setMinuteDraft] = useState('00');
  const [day, setDay] = useState<'today' | 'tomorrow'>('today');
  const hour = Number(hourDraft);
  const minute = Number(minuteDraft);
  const invalid = forcedInvalid ? '结束时间过近' : (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59
    ? '结束时间无效，请输入 0-23 时与 0-59 分。'
    : null);
  const [minimalEnabled, setMinimalEnabled] = useState(false);
  return <main style={{ minHeight: '100dvh', background: 'var(--app-bg)', paddingTop: 40 }}>
    {/* DF-A1-04: the sample mirrors the wired band — host renders the shared .timer slot, MinimalIdlePanel owns the action band. */}
    <div className="focus-task-context"><span>极简模式</span><strong>准备专注</strong></div>
    <div className="timer timer-minimal-idle" role="timer" aria-label={`当前时间 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`}>
      <span className="timer-label">当前时间</span>
      <strong className="timer-value">{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</strong>
    </div>
    <MinimalIdlePanel busy={busy} onStartFocus={() => setSheetOpen(true)} onExitMinimal={() => {}}/>
    <section style={{ maxWidth: 420, margin: '0 auto 20px' }}>
      <MinimalModeSettingRow enabled={minimalEnabled} onChange={setMinimalEnabled}/>
      <MinimalModeSettingRow enabled disabled onChange={setMinimalEnabled}/>
    </section>
{sheetOpen && <MinimalEndTimeSheet hourDraft={hourDraft} minuteDraft={minuteDraft} invalidReason={invalid} busy={busy}
      onHourChange={setHourDraft} onMinuteChange={setMinuteDraft}
      onClose={() => setSheetOpen(false)}
      onSubmit={() => { setBusy(true); setTimeout(() => setBusy(false), 1500); }}/>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Sample/>);
