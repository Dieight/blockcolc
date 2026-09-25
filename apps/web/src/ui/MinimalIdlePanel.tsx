/**
 * V27 MINI-27-01 极简模式展示组件。
 *
 * 只读纯展示：时间、草稿、校验结果与 busy 状态全部由 props 提供，回调只提交
 * 用户意图（打开 Sheet / 提交结束时间 / 返回完整模式）。不保存偏好、不访问
 * service、不启动倒计时；沉浸操作带的直边几何与通透度映射归现有沉浸层。
 *
 * DF-UI-05: the full-mode exit is revealed by the shared double-tap gesture
 * (`exitVisible`), starts visually veiled but stays keyboard/AT reachable.
 *
 * DF-A1-04: the idle clock is rendered by the host through the same
 * FocusTimer slot the running session uses; this component only owns the
 * action band, which keeps the running band's geometry.
 */
export function MinimalIdlePanel({ busy = false, exitVisible = true, onStartFocus, onExitMinimal }: {
  busy?: boolean;
  /** DF-UI-05: false = the exit sits veiled until the double-tap reveals it. */
  exitVisible?: boolean;
  onStartFocus: () => void;
  onExitMinimal: () => void;
}) {
  return <section className="minimal-idle-actions" aria-label="极简专注模式">
    {/* DF-UI-05: themed liquid-glass start action. */}
    <button type="button" className="primary minimal-start" disabled={busy} onClick={onStartFocus}>开始专注</button>
    <button type="button" className={`minimal-exit${exitVisible ? '' : ' is-veiled'}`} disabled={busy} onClick={onExitMinimal}>返回完整模式</button>
  </section>;
}
