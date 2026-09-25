/**
 * UI-SMALL-02：极简模式偏好行（待接线，纯展示）。
 *
 * 复用已验收的设置行与 iOS switch 视觉；checked 与 aria-checked 一致；
 * 切换值从当前状态取反（不读 event.target.checked，A1 教训）；disabled 时
 * 不发回调。不写 localStorage/service，不改 app-types、偏好模块或 App；
 * SettingsScreen 的运行接线归核心。
 */
export function MinimalModeSettingRow({ enabled, disabled = false, onChange }: {
  enabled: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return <div className="setting-row">
    <div className="setting-name"><span>极简模式</span><small>启动直接进入沉浸计时</small></div>
    <label className="switch-control ios-switch">
      <input
        aria-label="开启极简模式"
        type="checkbox"
        checked={enabled}
        aria-checked={enabled}
        disabled={disabled}
        onChange={() => { if (!disabled) onChange(!enabled); }}
      />
    </label>
  </div>;
}
