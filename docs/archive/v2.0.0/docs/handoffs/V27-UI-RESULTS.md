# V27 UI RESULTS（2026-09-07，主树 2.0.0/30 工作区）

> 最新补充：实际代码已到2.0.0/32。接手复测Web types与117单测exit0，独立源码定向E2E17pass/1既有skip、2.5分钟exit0；原两条focus-regressions超时此次通过。极简开始按钮方案已获用户确认但**尚未实现**，执行V27-MINIMAL-START-BUTTON.md；本报告以下30版本证据保留为历史，不当作32全量验收。

本文补齐 UI-27-05～08 要求的页面对照与证据汇总。证据分三档：**实测**（本轮定向探针/E2E exit 0）、**部分**（有实现与部分证据，留真机项）、**待验**（需真机或用户复验）。截图在 `apps/web/test-results/ui-shots/`。

## 0. 本轮（用户五点指示 + DF-A2-01）改动与验证

1. **极简专注运行态复用共用沉浸 UI**：删除"返回完整模式"运行按钮与专注期间临时退出页面；运行态与各模式共用同一沉浸渲染。验证：`stepper-probe`（极简专注中无返回按钮 PASS）、`minimal-achievement-entry` E2E（断言运行中 `toHaveCount(0)`）。
2. **极简空闲页三元素**：删除"极简模式/准备专注"行；时钟（复用 `.timer` 槽 clock 模式）+ 液态玻璃开始按钮 + 双击显隐返回按钮，整组上下居中、按钮组距时间 14px。验证：`idle-three-probe` **6/6 PASS**（含居中差 ≤2px、间隙 14px、veiled 初始）。
3. **液态玻璃统一**：外观设置"沉浸计时毛玻璃"更名**"液态玻璃"**，其通透度滑杆现驱动**全部**玻璃材质（世界 HUD、设置卡、计划单/极简单 sheet、极简开始按钮）——tokens 的 world/settings/sheet 三组玻璃 background alpha 与 backdrop blur 全部接入 `--glass-alpha-scale`/`--glass-blur-scale`，App 每渲染注入。验证：`glass-scale-probe`（0%→0.65/0.75，100%→0.3/0.5，滑杆生效 PASS）。深浅两主题同改。
4. **结束时间统一回滚点按步进器**（用户明确不再用键盘输入）：普通/习惯两个计划单与极简"专注到"全部使用同一 `.time-stepper` 材质；极简的今天/明天切换随之移除，跨日沿用马拉松"过去时刻落明天"语义。**DF-A2-01（99:99 显示与 23:59 排程分离）随键盘输入模式撤销而消解**：步进器在 0..23/0..59 内循环，不存在越界草稿；`clear-draft-probe`/`hit-diag` 等输入类探针删除，代之以 `stepper-probe`。
5. 验证：`stepper-probe` **10/10 PASS**（计划单步进/预览一致/确认恒可用；极简单同材质/主按钮时间/无 input/真实提交）；`df-feedback-probe` **14/14**；E2E 定向 **23 passed**（v21 7（HEAD stepper 版恢复）+v22 5+minimal 3+settings 4+focus-regressions 3+switch 若干）；Vitest **17 文件全过**；typecheck exit 0。

## 1. 页面对照表

| 页面 | 材质/布局 | 交互 | 证据 | 档 |
|---|---|---|---|---|
| 设置 | 液态玻璃卡（settings-glass tokens，受滑杆统一控制）、行高 44px、七日单行完整 | 完整性开关行/数值行条件渲染、液态玻璃滑杆、极简偏好行 | settings-layout E2E 4/4；planned-days-dfa1 4/4；glass-scale-probe | 实测 |
| 任务创建 | ProjectSetup 双入口（首建/追加）、按钮 ≥44px | 蓝图选择、习惯切换 | 历史定向 E2E（v10 等） | 部分（本轮未重截） |
| 统计 | 成就面板/收口段（UI-SMALL-01 只读接口） | 成就解锁展示 | minimal-achievement E2E（成就断言） | 实测（基本流） |
| 计时（完整） | 沉浸带 + workbench；heading 极简入口（44px，idle 临时退出后可见） | 开始/调整计划/切换任务 | df-feedback-probe（DF-UI-08 三项） | 实测 |
| 计划汇报（马拉松） | 统一汇报文案"全部轮次结束后，统一提交进度。" | 提交推进 | minimal-achievement E2E（汇报→提交→回极简） | 实测 |
| 建筑记忆 | 蓝图库文案组垂直居中（DF-UI-04） | 查看记忆 | CSS 实现 + 审计 DF-A1 通过 | 部分（真实长蓝图名待真机） |
| 极简空闲 | 三元素居中（本轮新结构） | 双击显隐返回、键盘可达 | idle-three-probe 6/6；df-feedback 5 项 | 实测 |
| 极简专注 | 复用共用沉浸 UI（本轮收敛） | 共用 controls 显隐 | stepper-probe + E2E | 实测 |
| 极简单/计划单 | 同一 `.time-stepper` 材质（本轮回滚） | 步进/确认/焦点契约 | stepper-probe 10/10；v21/v22 E2E | 实测 |

## 2. 已知未完成（如实标注，不关闭）

- **真机项**：OnePlus 按住开关（DF-UI-03 无蓝底/旋钮居中）、真实长蓝图名两行、200% 系统 fontScale、锁屏/后台/最近任务（RECOVERY/MINI 真机矩阵）——需设备在位。
- **深色/减少动态**：tokens 双主题已改，本轮截图以浅色为主；`prefers-reduced-motion` 块保留（A1 审计通过），减少动态专项截图未重跑。
- **完整返回栈走查**（UI-27-01）与 toast 动作在业务警告流的去设置验证（UI-27-02）：实现存在，本轮未逐页重走。
- **启动性能/预加载**：DF-UI-09 只回滚动画，不涉及预加载撤回；性能归 PERF-27-01（core 队列）。
- **发布门禁**：本轮构建为**测试包**（2.0.0/30 正式签名），正式候选按 `Prepare-Release.ps1` 全量门禁另行冻结（V27 发布顺序第 2 条）。

## 3. 基线既有失败（非本轮回归，两树对照确认）

- voxel `ocean-island` 混合 LOD；`v11-world-environment` 两项（轻点选中/拖拽）。渲染套件其余 51/53 通过（DF-A2 前全量记录）。


## 4. 2006-09-07 四点指示与极简收尾（2.0.0/33 工作区）

- 运行态面板高度占位（.minimal-exit-placeholder 44px），不因删除返回按钮变矮；专注/极简复用共用沉浸 UI。
- 极简休息页三行：第一行'休息中'、上下居中剩余休息时间、双击显隐（键盘可达）跳过休息按钮（保留 secondary-action 主题色 rgb(39,103,73)）。
- 极简提交遇'已有专注计划'：仅当挡路计划 status==='ready' 时自动清理重试一次；进行中/休息/待汇报不自动清。
- 结束时间移除日期切换后，prepare 传 day=undefined，与马拉松一致的'过去时刻落明天'（marathonEndInstant 保证）。
- 极简开始按钮：浅淡绿玻璃/深绿字、深深绿玻璃/浅白绿字，滑杆联动但有实底下限，minimal-start-v32-probe 全过。
