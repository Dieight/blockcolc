import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useBackLayer } from '../back-layer';

export interface AchievementEntry {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  unit: string;
  /** A2-01: 解锁事实与日期解耦——核心投影允许"已解锁、日期未知"。 */
  unlocked: boolean;
  /** 可选展示日期（ISO）；为 null 时只显示"已解锁"，组件不得以当前时间补日期。 */
  unlockedAt: string | null;
}

/**
 * V27 成就墙展示组件。
 *
 * 只读纯展示：条目由调用方给入，本组件不持有解锁事实、不重算口径、不写入
 * 领域状态。批量提示由统计页的展示回执层驱动，本组件只负责可访问浮层。
 *
 * 材料契约：普通内容实底，徽章不使用实时玻璃滤镜。
 */
export function AchievementsPanel({ entries, emptyHint = '还没有可展示的成就，继续专注会逐步点亮。' }: {
  entries: ReadonlyArray<AchievementEntry>;
  emptyHint?: string;
}) {
  return <section className="achievements-panel" aria-labelledby="achievements-title">
    <h2 id="achievements-title">成就</h2>
    <p className="achievements-intro">从第一天起的专注与建造记录。</p>
    {entries.length === 0
      ? <p className="achievements-empty" role="status">{emptyHint}</p>
      : <ul className="achievements-list">
        {entries.map((entry) => <li key={entry.id} className={entry.unlocked ? 'achievement unlocked' : 'achievement'}>
          <div className="achievement-copy"><strong>{entry.title}</strong><small>{entry.description}</small></div>
          {entry.unlocked
            ? <span className="achievement-unlocked"><Check/> {entry.unlockedAt ? new Date(entry.unlockedAt).toLocaleDateString('zh-CN') : '已解锁'}</span>
            : <span className="achievement-progress">
              <i className="achievement-meter" role="meter" aria-label={`进度 ${entry.progress} / ${entry.target} ${entry.unit}`} aria-valuemin={0} aria-valuemax={Math.max(entry.target, entry.progress)} aria-valuenow={Math.min(entry.progress, Math.max(entry.target, entry.progress))}><b style={{ width: `${Math.max(0, Math.min(100, entry.target > 0 ? (entry.progress / entry.target) * 100 : 0))}%` }}/></i>
              <small aria-hidden="true">{entry.progress} / {entry.target} {entry.unit}</small>
            </span>}
        </li>)}
      </ul>}
  </section>;
}

/**
 * UI-SMALL-01：统计页成就块收口。entries 未传（undefined）时不渲染任何块；
 * 空数组显示安静空态；传数组时只读渲染。不从 state 自行计算成就，App 只传
 * 只读投影。
 */
export function AchievementsSection({ entries }: { entries?: ReadonlyArray<AchievementEntry> }) {
  if (entries === undefined) return null;
  return <details className="achievements-disclosure">
    <summary><span>成就</span><small>{entries.filter(entry => entry.unlocked).length} / {entries.length} 已解锁</small></summary>
    <AchievementsPanel entries={entries}/>
  </details>;
}

/** One non-blocking batch dialog for historical and newly unlocked entries. */
export function AchievementUnlockDialog({ entries, error, onDismiss }: {
  entries: ReadonlyArray<AchievementEntry>;
  error?: string;
  onDismiss: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useBackLayer(true, () => { onDismiss(); return true; });
  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onDismiss(); return; }
      if (event.key !== 'Tab') return;
      const root = closeRef.current?.closest('[role="dialog"]');
      if (!(root instanceof HTMLElement)) return;
      const focusable = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const next = focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length] ?? focusable[0];
      event.preventDefault(); next.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus.current?.focus({ preventScroll: true }); };
  }, [onDismiss]);
  return <div className="achievement-unlock-layer" data-entry-animation="unlock" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) onDismiss(); }}>
    <section className="achievement-unlock-dialog" role="dialog" aria-modal="true" aria-labelledby="achievement-unlock-title">
      <span className="eyebrow">专注与建造的记录</span>
      <h2 id="achievement-unlock-title">新的成就</h2>
      <p>这些事实已经满足。关闭后只会在新的成就出现时再次提示。</p>
      <ul>{entries.map(entry => <li key={entry.id}><Check/><div><strong>{entry.title}</strong><small>{entry.description}</small><span>{entry.unlockedAt ? `获得于 ${new Date(entry.unlockedAt).toLocaleString('zh-CN')}` : '获得时间未知（历史记录无法推导）'}</span></div></li>)}</ul>
      {error && <p className="achievement-unlock-error" role="alert">{error}</p>}
      <button ref={closeRef} type="button" className="primary" onClick={onDismiss}>全部关闭</button>
    </section>
  </div>;
}
