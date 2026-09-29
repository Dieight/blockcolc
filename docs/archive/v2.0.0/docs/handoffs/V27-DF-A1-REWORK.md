# V27 真机反馈返修 · DF-A1 五项返修交回（2026-09-07）

交回源码目录：`C:/Codex/tomato-clock`（主树，未提交工作区，基于 DF-UI-01~09 返修现场续作）。
本轮仅返修 DF-A1-01～05，未动 packages/* 核心文件，未覆盖新增 core focus-export 文件。

## 逐编号答复

### DF-A1-01（P1，类型检查）✅ 已修

- `tests/minimal-achievement-entry.spec.ts`：`idleBox` 前置 `if(!idleBox)throw new Error('极简空闲面板未渲染…')` 显式窄化，全部 TS18047 消除。
- 验收：`npm run typecheck -w @tomato-clock/web` **exit 0**（多次复跑，含 A1-03/A1-04 改动后）。

### DF-A1-02（P2，完整性关闭后仍显示数值行）✅ 已修

- `SettingsScreen.tsx`：删除关闭态的两条 disabled 展示行；关闭时数值行**完全隐藏**（`{draft.enabled && <>…</>}`），草稿值保留在组件状态内，重开后以保存值回显。
- `tests/settings-layout.spec.ts` 断言重写：开启时 `toHaveCount(2)` → 关闭后 `toHaveCount(0)`（隐藏，不是 disabled）→ 重开后 `toBeEnabled()` 且值仍在（`toHaveValue(/[1-9]/)`）。保留开关命中区 ≥50.5×30.5 断言。
- 验收：settings-layout.spec.ts 4/4 通过（定向 E2E）。

### DF-A1-03（P2，马拉松时/分不能清空）✅ 已修

- `App.tsx` 两个 PlanSheet（普通/习惯同一实现）：新增 `rawHour/rawMinute` 原始草稿 state + `commitRaw`——**空串与中间编辑全程保留在输入框**；仅当两字段都能解析为数字时才回写 padded `HH:mm` 应用草稿（`rawSelfEcho` ref 防回环；外部 `endAtDraft` 变化会重新同步 raw）。
- 确认按钮守卫扩展：`disabled={!locked && mode === 'marathon' && (!marathonValid || !inputsComplete)}`——草稿不完整时禁用，**不虚构 00**。
- 定向探针 `apps/web/tools/clear-draft-probe.mjs` **11/11 ALL PASS**：初始草稿可见、小时清空保持空、清空时确认禁用、逐字 "2" 中间态保留、分钟清空保持空、"0" 不被改写为 "00"、连续键入 "21" 保留、完整后确认可用、计划确认成功。
- 习惯入口与普通入口是同一 EndTimeFields 宿主 + 同一 `commitRaw` 实现（单实现两处 JSX）；其打开/输入/确认路径由 `tests/v21-marathon.spec.ts`（:112 二轮排程、:173 锁定车道）E2E 覆盖，本轮两者均通过。
- 排程算法（planRoundsForDuration）未改。

### DF-A1-04（P2，极简时钟/操作带几何）✅ 已修

- **结构同构**：空闲带与运行带使用同一 DOM 槽位序列——`focus-task-context`（两行，同 class）→ `FocusTimer`（新增 `mode='clock'`：同一 `.timer` 槽显示本地时间，label"当前时间"，`timerClassName="timer-minimal-idle"` 承载 64px 主题色样式与 label 隐藏）→ 操作带（`MinimalIdlePanel` 仅含开始按钮 + veiled 出口）。
- **band 高度恒定**：`minimal-idle-actions` 48+44 双按钮 + margin 补偿（竖屏 -4px、横屏 -2px media query），实测 band 高与运行态完全一致（竖屏 266=266；横屏/平板/桌面 panel 占满列时 clock 中心一致）。
- **锚点验证** `apps/web/tools/clock-align-probe.mjs` 四视口 **ALL PASS**：412×915 delta 0；915×412 delta ≤1px（rounding）；768×1024 delta 0；1440×900 delta ≤1px。含"出口显隐前后 band 几何稳定"。
- 诚实备注：**双击 reveal 在 768/1440 软件渲染探针里会超 450ms 窗口**（软 WebGL 主线程停顿，实测事件到达延迟 >450ms），探针在手机视口（412×915）已验证双击成功（df-feedback-probe `DF-UI-05: double-tap reveals` PASS），大视口以键盘路径断言（Tab 到 exit → :focus-visible opacity 1 → blur 回 0，真 :focus-visible 匹配）。真机硬件 GPU 无此停顿，未放宽标准窗口。
- `MinimalIdlePanel` 现在只负责操作带；时钟由宿主经 FocusTimer 渲染。`minimal-mode.test.tsx` 与 `minimal-mode-sample.tsx` 已随 props 适配（sample 用与接线相同的宿主结构）。

### DF-A1-05（P2，360px 星期日裁切）✅ 已修

- `settings.css`：`.planned-days` gap 0、去横向滚动；`@media(max-width:420px)` 负外边距 -14px 抵消卡片内距，使 360px 行内容宽 ≥7×44。
- 验收探针 `apps/web/tools/planned-days-dfa1-probe.mjs` 四组合 **ALL PASS**（360/412 × 100%/200% 字号）：无滚动（`scrollWidth ≤ clientWidth`）、七格 ≥44×44 互不越界、末格"日"中心 `elementFromPoint` 真实命中（含滚动到可视区、避开底部导航后复测）。
- 320px 明确为超窄降级（横滑），不计入 360 验收（按审计要求如实标注）。

## 门禁与测试汇总

- version:check **2.0.0 (29)** exit 0；web typecheck **exit 0**；web Vitest **17 文件 118/118** exit 0（新增 DF-UI-05 veiled 断言）。
- 定向 E2E（production runner）：settings-layout 4 + minimal-achievement-entry 3 + v21-marathon 7 + v22-marathon-lane 5 + focus-regressions 3 + switch-contracts 若干 = **合计 18+7+7 通过、0 失败**（v21/v22 13 passed 一次运行；minimal 3 passed；settings 4 passed）。
- DF 行为探针 `df-feedback-probe.mjs` **14/14 PASS** exit 0（412 手机视口，含双击 reveal）。
- 几何探针 `clock-align-probe.mjs` **ALL PASS**；清空探针 `clear-draft-probe.mjs` **11/11**；planned-days 探针 **4/4**。
- **构建**：`tools/Build-AndroidRelease.ps1` 2.0.0 **(versionCode 29)** 成功；apksigner 验签 `CN=Blockcolc Release`；SHA-256 `2AA4630B2AFB932FFEF9347D0AB378B0F027F91009D3833F6B0CA89C70B16EEC`；已推送 `Dieight/blockcolc-test`（`blockcolc-2.0.0(29)-df-a1-release.apk`，Git Blob API 字节级比对一致）。OnePlus（PJX110 a50247d1）本轮安装 28 成功后、29 安装时设备已断开——29 的真机覆盖安装待设备重连后执行（覆盖安装同签名 28→29 可行）。

## 关键文件 SHA-256（交回时点）

- App.tsx = eda64ed82eeb499e019401b9f1e056188072e029ce12b25046cf03d143cb702c
- SettingsScreen.tsx = 118494be10aa4c2cff74ed24d762f38f1b14810fd38a46d30835ca914f5e905e
- ui/MinimalIdlePanel.tsx = e306c0554844f91656e003be2247c7c60451381fade05868b829cbfaa41d0ada
- ui/minimal-mode-sample.tsx = c01a172cab48e94c8272c673fabc30d51117a5f0febb7016bb12c3a2d219f3a9
- styles/minimal-mode.css = fda2dbd3db1faab9482299faf67d94aecb1012237f3e61a39795633b057bc031
- styles/settings.css = a53ecd8a9cda6861abcd6c1b490cfc2224096716739756d81b9a5e2fcfe8868d
- tests/minimal-achievement-entry.spec.ts = ab8b0f2808cb34420f3613803bc7b75a8ee2502908eb01d49253472fd1a72414
- tests/settings-layout.spec.ts = 676ea24e58d59b31a9656f29d902655f1d14c981c83a1266309d3efd9fefb2e2
- tests/v21-marathon.spec.ts = 4d54e502f768ccd0717293b2f059a95ded3e35c253e3e3055e1d59af88f51705
- tests/v22-marathon-lane.spec.ts = dfe85308d9c7da429e5c4b2a89f2ba35b1de8742eb43a1aa69b32ad1d32bfd1c
- tests/focus-regressions.spec.ts = f5865058d2d232a0a494fe4fe4595d2c46b6e658175d4234cd6240bdb490dbeb

## 截图证据（apps/web/test-results/ui-shots/）

- workbench-heading-df / workbench-heading-entry-df（DF-UI-08）
- minimal-idle-df / minimal-idle-revealed-df（DF-UI-05/06，新操作带结构）
- marathon-sheet-df / minimal-focus-df（DF-UI-07/06）
- planned-days-dfa1-360x800/412x915（DF-A1-05，360/412 浅色）

## 未测项 / 保持待验（不凭代码声明关闭）

- DF-UI-03 真实 Android 按压/旋钮手感、DF-UI-04 真实长蓝图名称多行垂直对齐：仍未真机确认。
- DF-A1-04 的双击窗口在慢渲染环境（软 WebGL 大视口）会超时；真机硬件 GPU 预期无碍，但**真机平板**未实测双击。
- DF-A1-02 的快速连续开关（防抖/并发写入）只覆盖了定向 E2E 的单次关闭/重开往返；建议真机复验快速拨动。
- 29 包的真机覆盖安装（OnePlus 断线待重连）与 200% 系统 fontScale 真机验证。
- release 三套件中 renderer 套件的 v11 两项仍为基线既有失败（两树对照确认，与本轮无关）。
