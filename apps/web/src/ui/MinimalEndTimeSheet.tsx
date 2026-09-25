import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';


/**
 * 极简模式"专注到"结束时间 Sheet（待接线）。
 *
 * 只读纯展示：小时/分钟草稿、校验结果与 busy 全部来自 props；步进回调只提交
 * 用户意图（±1 小时/±1 分钟，字段内循环），onClose 仅关闭（取消不启动也不
 * 改写计划），onSubmit 由接线层校验并提交。排程算法与跨日最终判断归核心。
 *
 * 用户回滚指示（DF-UI-07 复核）：结束时间统一回点按步进选择器（与马拉松计划
 * 单同一 .time-stepper 材质），不再使用键盘输入字段；今天/明天切换随之移除，
 * 跨日由与马拉松一致的"过去时刻落明天"语义处理。
 *
 * 键盘与关闭契约（A4-01～A4-03、A5-01）：
 * - 焦点生命周期只属于开/关：挂载时一次性迁入第一个步进按钮并保存触发源，
 *   卸载时返回触发源；键盘处理读取 refs 里的最新 busy/onClose，不因重渲染
 *   或 busy 变化重设焦点（不要求调用方 useCallback）。
 * - Tab/Shift+Tab 循环约束在 Sheet 内；busy 时所有控件禁用，Tab 兜底聚焦
 *   Sheet 容器，不出层、不触发背景动作；busy 回落（含错误后）全部恢复。
 * - Escape 关闭（busy 时忽略）；busy 时遮罩点击与关闭按钮同样锁定。
 */
export function MinimalEndTimeSheet({ hourDraft, minuteDraft, invalidReason, busy, onHourChange, onMinuteChange, onClose, onSubmit }: {
  /** 结束小时草稿（接线层持有的字符串数字）。 */
  hourDraft: string;
  /** 结束分钟草稿（同上）。 */
  minuteDraft: string;
  /** 接线层给出的校验错误（无效、过近、超出现有计划边界）；null 表示可提交。 */
  invalidReason: string | null;
  busy: boolean;
  onHourChange: (hour: string) => void;
  onMinuteChange: (minute: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const openerRef = useRef<Element | null>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  busyRef.current = busy;
  onCloseRef.current = onClose;
  const digits = (value: string) => /^\d+$/.test(value.trim());
  const hour = digits(hourDraft) ? Number(hourDraft.trim()) : 0;
  const minute = digits(minuteDraft) ? Number(minuteDraft.trim()) : 0;
  const displayTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  // 步进在 0..23/0..59 内循环；确认按钮永远拿到合法草稿。
  const stepHour = (delta: number) => onHourChange(String((((hour + delta) % 24) + 24) % 24));
  const stepMinute = (delta: number) => onMinuteChange(String((((minute + delta) % 60) + 60) % 60));
  const canSubmit = !busy && invalidReason === null;

  useEffect(() => {
    // Focus lifecycle belongs to open/close only (A4-01): save the opener once,
    // move focus in once; the keydown handler reads refs for the latest state.
    openerRef.current = document.activeElement;
    sheetRef.current?.querySelector<HTMLButtonElement>('.time-stepper button')?.focus();
    const sheet = sheetRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !sheet) return;
      const focusable = [...sheet.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (focusable.length === 0) {
        // Busy fallback (A4-03): keep Tab inside the sheet on its container.
        event.preventDefault();
        sheet.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      const inside = sheet.contains(current);
      // A5-01: the fallback-focused container itself sits on both boundaries —
      // Tab moves to the first control, Shift+Tab to the last, so focus can
      // never fall through to the background after a busy cycle.
      if (event.shiftKey && (current === first || current === sheet || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || current === sheet || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return <div className="dialog-backdrop minimal-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (!busyRef.current && event.target === event.currentTarget) onCloseRef.current(); }}>
    <section className="minimal-end-sheet" role="dialog" aria-modal="true" aria-labelledby="minimal-end-title" ref={sheetRef} tabIndex={-1}>
      <div className="sheet-heading"><div><span className="eyebrow">极简模式</span><h2 id="minimal-end-title">专注到</h2></div><button type="button" className="dialog-close" aria-label="关闭专注到" disabled={busy} onClick={onClose}><X/></button></div>
      <div className="marathon-end-picker" role="group" aria-label="结束时间">
        <div className="time-stepper"><span>时</span><button type="button" aria-label="减少结束小时" disabled={busy} onClick={() => stepHour(-1)}>−</button><strong aria-label="结束小时">{displayTime.slice(0, 2)}</strong><button type="button" aria-label="增加结束小时" disabled={busy} onClick={() => stepHour(1)}>+</button></div>
        <span className="time-colon" aria-hidden="true">:</span>
        <div className="time-stepper"><span>分</span><button type="button" aria-label="减少结束分钟" disabled={busy} onClick={() => stepMinute(-1)}>−</button><strong aria-label="结束分钟">{displayTime.slice(3)}</strong><button type="button" aria-label="增加结束分钟" disabled={busy} onClick={() => stepMinute(1)}>+</button></div>
      </div>
      <p className={`plan-sheet-note${invalidReason ? ' is-invalid' : ''}`}>{invalidReason ?? '全部轮次结束后，统一提交进度。'}</p>
      <button type="button" className="primary" disabled={!canSubmit} onClick={onSubmit}>{`开始 · 至 ${displayTime}`}</button>
    </section>
  </div>;
}
