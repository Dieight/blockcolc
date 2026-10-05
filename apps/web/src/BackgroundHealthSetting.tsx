import { useEffect, useRef, useState } from 'react';
import type { BackgroundHealth } from '@blockcolc/platform-capacitor';
import { PixelReset } from './ui/PixelIcon';
import { finishRefreshFeedback } from './refresh-feedback';

export function processExitLabel(reason: number): string {
  return ({ 0: '原因未提供', 1: '正常退出', 2: '进程收到系统信号', 3: '系统内存回收',
    4: '应用崩溃', 5: '原生崩溃', 6: '应用无响应', 7: '启动失败', 8: '权限变更',
    9: '资源用量超限', 10: '用户或系统停止', 11: '用户停止', 12: '依赖进程退出',
    13: '其他系统原因', 14: '系统冻结进程', 15: '包状态变更', 16: '应用更新',
  } as Record<number, string>)[reason] ?? '其他系统原因';
}

export function BackgroundHealthSetting({ active }: { active: boolean }) {
  const [health, setHealth] = useState<BackgroundHealth | null>(null);
  const [action, setAction] = useState<'refresh' | 'open' | null>(null);
  const busy = action !== null;
  const [error, setError] = useState('');
  const mounted = useRef(false), pending = useRef(false);
  const refresh = async () => {
    if (pending.current) return;
    pending.current = true; setAction('refresh'); const started=performance.now();
    try {
      const { readBackgroundHealth } = await import('@blockcolc/platform-capacitor');
      const next = await readBackgroundHealth();
      await finishRefreshFeedback(started);
      if (mounted.current) {setHealth(next);setError('');}
    } catch { await finishRefreshFeedback(started); if (mounted.current) setError('暂未读到系统状态'); }
    finally { pending.current = false; if (mounted.current) setAction(null); }
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (active) void refresh(); }, [active]);
  if (!health) return error ? <p role="status">{error}</p> : null;
  const last = health.exitHistory.find(item => item.process === 'app');
  const open = async () => {
    if (pending.current) return;
    pending.current = true; setAction('open'); setError('');
    try { const { openSystemBatterySettings } = await import('@blockcolc/platform-capacitor'); await openSystemBatterySettings(); }
    catch { setError('未能打开系统电源设置'); }
    finally { pending.current = false; if (mounted.current) setAction(null); }
  };
  return <div className="setting-row background-health">
    <div className="setting-name"><span>后台运行</span>
      <small>{health.batteryOptimizationsIgnored ? '已放宽标准省电限制' : '受系统省电策略管理'}{health.powerSaveMode ? ' · 省电模式开启' : ''}</small>
      <details><summary>上次退出</summary><p>{last ? `${processExitLabel(last.reason)} · ${new Date(last.timestampMs).toLocaleString('zh-CN')}` : '系统未提供退出记录'}
        {health.rendererExitAtMs > 0 && <><br/>{health.rendererCrashed ? 'WebView 渲染进程崩溃' : 'WebView 渲染进程被回收'}</>}
        </p></details>
      {error && <small role="alert">{error}</small>}
    </div>
    <div className="notification-actions"><button className="settings-text-action" type="button" disabled={busy} aria-busy={action === 'open'} onClick={() => void open()}>电源设置</button>
      <button className="settings-text-action" type="button" aria-label="刷新后台状态" disabled={busy} aria-busy={action === 'refresh'} onClick={() => void refresh()}><PixelReset size={18}/></button>
    </div>
  </div>;
}
