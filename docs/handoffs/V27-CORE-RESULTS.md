# V27 核心重构检查点

## 当前执行范围

**收尾状态（2026-09-09 复核）：R1～R5 核心编排重构已完成并通过最终冻结树 Web 回归。** 413 项相关单测、全仓类型/版本检查通过；完整 Web 120 passed / 2 既有 skipped。这不是 V27 全部完成或 Android 发布验收；真机、OEM 和另行 UI 设计继续独立跟踪。

2026-09-08 用户要求直接重构底层，暂不继续 UI 返修。主目录核心持有 App.tsx；本轮未启动其他 agent，不编辑 UI 工作树、CSS、原生出口或私人伴侣。既有 dirty tree（包括 UI versionCode 34、schema12、导出草稿）保留。没有提交、APK 构建、安装或发布动作。

## R0 基线

- HEAD：`b46cba0250924cc3a07a51d7d89cf4cfd39be98a`；它不是完整源码，主树有已修改与未跟踪源码/测试。
- 本轮接手 App.tsx SHA-256：`ED1A35D51742D25399375000F8350DBF446BDCE80600AAAC92FC18FFADE13769`。
- 接手 Web 单测：`npm test -w @tomato-clock/web`，117/117，exit 0。
- 本轮不覆盖此前的未提交 UI/领域/平台修改；版本保持 `2.0.0/34`，未自行增加版本。
- 当前 ADB：使用本地 SDK 的 adb.exe，`devices -l` 无设备。裸 adb 不在 PATH，已以 SDK 明确路径复查。

## R2：轮次上下文已接线、定向验证通过

- `round-plan-store.ts`：现有键读写、严格写入、同步控制器；持有 plan / savedPlan / error，写成功才采用新保存状态。恢复保存失败可显示领域推导的 plan，但 savedPlan 不变，警告保留。
- `use-round-plan.ts`：唯一 React 状态适配与宿主切换。App 不再直接维护 planRef、setPlanState 或恢复兜底写入口。
- `round-plan.ts` 的排程与恢复算法、领域 schema、备份、极简首次提交三段边界不变。普通开始仍保持原有先领域提交后附加上下文的次序。
- 7 项新增测试：旧键读取/损坏/读取权限、写入先于发布、set/remove 异常、恢复与已保存状态分离、删除失败、跨宿主马拉松。
- `npm run typecheck`：全仓 exit 0；domain 144、application 67、storage 27、Web 124，共 362 项单测通过。`npm run version:check` exit 0。
- `node tools/run-web-e2e.mjs --production tests/minimal-focus-continuity.spec.ts tests/minimal-achievement-entry.spec.ts tests/v22-marathon-lane.spec.ts tests/v24-marathon-settle.spec.ts tests/v5-focus-flow.spec.ts --project=mobile-chromium --workers=1 --output=artifacts/core-refactor-r2`：33/33、3.4 分钟、exit 0。产物相对 Web 根目录：`apps/web/artifacts/core-refactor-r2`。
- 该次冻结 App SHA-256：`D24177F0110E038ECCF914D0935416607D50C4F403A99A0FB5F94164B9B8A637`；测试期间未修改源码。

## 不可达路径清理：已删除并验证类型/单测

全仓 Web 源码与测试符号搜索确认：未导出的旧 WorldScreen 没有调用者；旧 WorldCanvas / ProgressReport / loadRoundPlan / lastSuccessfulSession 只被该死路径引用。删除这些声明，保留实际 WorldScreenV7 / WorldCanvasV7 及全部现行 JSX。孤立宿主汇报清理改走同一 RoundPlanStore，App 不再直接写轮次存储键。删除后 Web 类型检查和 124 项单测 exit 0；随后 R3a 浏览器流程亦通过。

## R3a：命令结果已接线、定向验证通过

- `command-feedback.ts` 从真实 ApplicationResult 解释消息和仪式；保存原事件优先级、提前完成三种文案、通知“去设置”动作，超限计数不改成 Toast。
- `command-runner.ts` 保留成就 before/after 时机、成功后刷新、领域拒绝原样返回、持久化异常原样抛出；不增加命令队列或通知失败重试。历史替换仍走 App 的静默成就基线。
- 9 项新增测试；Web 类型检查与 133 项单测 exit 0。初次新测试的 reportId/错误码 fixture 拼写已修正后重跑，不放宽生产类型。
- `node tools/run-web-e2e.mjs --production tests/focus-regressions.spec.ts tests/v22-integrity-ended.spec.ts tests/minimal-achievement-entry.spec.ts tests/v5-focus-flow.spec.ts --project=mobile-chromium --workers=1 --output=artifacts/core-refactor-r3a`：23/23、2.5 分钟、exit 0；同次源码保持不变。
- 该次 App SHA-256：`D4C0E731A72768106774B1C48690838B6B52650989F6B06ECE21A89AD7D4FD4D`。

## 后续门禁

R1～R5 已完成并通过下方最终合并树完整 Web 回归。首轮失败记录保留，不拼接其局部通过作为最终成功。Android 完整正式发布门禁与真机仍未完成；性能优化必须另有实际测量。

## R1 / R3b：视图与生命周期消费已接线、定向验证通过

- `focus-view-state.ts`：显式 nowMs 输入，复用既有 reconcileRoundPlan / canPresentMinimalFocus；集中 setup/idle/focus/break/ready/report、极简/完整、工作台阻塞和权威 endsAt。8 项新测试含冻结输入、过期休息、临时退出、旧计划不盖过活动计时、已删除宿主的汇报恢复。
- `application-lifecycle.ts` / `use-application-lifecycle.ts`：只消费处理后的事件与 pageshow；先记录后刷新、清理幂等、卸载后的异步 resume 不再刷新旧消费者。5 项新测试。bootstrap 仍拥有唯一原生订阅，原有 before/after 回执生成未改；本片不声称修复其排队差值风险或完成 OnePlus 真机退出提示验收。
- Web typecheck 与 146/146 单测 exit 0。
- `node tools/run-web-e2e.mjs --production tests/minimal-focus-continuity.spec.ts tests/focus-regressions.spec.ts tests/v22-integrity-ended.spec.ts --project=mobile-chromium --workers=1 --output=artifacts/core-refactor-view-lifecycle`：11/11、1.4 分钟、exit 0。
- 该次 App SHA-256：`E65B874D3B104100C7AB9BB981FC8086A5928B499600695C14833742723718EA`；bootstrap：`98F7F844F604023C80F5E40B668C0A5F56B3EEC70832AB56A07198991090BA13`。

## R4：专注流程已接线、定向验证通过

- `focus-flow.ts` / `use-focus-flow.ts` 持有 confirm/start/finishBreak/skipBreak/cancel/interrupt/early/afterReport/afterMarathonReport；App 保留 UI 显隐和各自的提交前计划回调，避免恢复已推进后再加一轮。
- 保留普通固定、习惯固定、普通马拉松、deferred 的差异。极简首次提交继续使用既有 starter，普通开始仍先领域后上下文；本机写失败不取消已提交计时。控制器新增局部双提交门，领域串行队列不变。
- 操作在调用时读取当前快照、计划和偏好；异步结果按提交结果/最新快照解释，时间由注入 nowMs 提供。普通汇报显式带入提交前计划；没有新 schema 或新的排程公式。
- App 内原有 `Promise<any>` 命令端口统一为 `Promise<ApplicationResult>`。
- 14 项新测试运行真实 ApplicationService 与内存 CAS 仓库；Web 类型检查与 160/160 单测 exit 0。
- `node tools/run-web-e2e.mjs --production tests/minimal-focus-continuity.spec.ts tests/minimal-achievement-entry.spec.ts tests/v17-continuity.spec.ts tests/v21-marathon.spec.ts tests/v22-marathon-lane.spec.ts tests/v24-marathon-settle.spec.ts tests/v5-focus-flow.spec.ts --project=mobile-chromium --workers=1 --output=artifacts/core-refactor-r4`：42 passed / 1 既有 skipped，6.3 分钟，exit 0。

## R5b：渲染宿主已接线、定向验证通过

- `WorldCanvasV7.tsx` 持有常驻 3D 宿主与 HUD；`voxel-runtime.ts` 共享加载 Promise/蓝图目录，`world-projection.ts` 保留原纯适配算法。保持 JSX、初始化依赖和现行相机/场景/材料含义。
- `renderer-generation.ts` 显式管理延迟启动、创建、初始化、ready/error 和幂等销毁。旧实例的资源包结果不再先写共享缓存后检查取消；资源刷新也绑定捕获的实例，不能沿着最新 ref 改到新实例。没有地形、Shader、atlas 或 Bloom 改动。
- 新增 7 项生命周期测试。Web 类型检查与 167 项单测 exit 0；全仓版本/类型检查、domain 144/application 67/storage 27 通过，同阶段共 405 项。
- 定向生产 R5：building-memory、navigation-cache、world-coordinate-setting 共 5 项，45.6 秒，exit 0；移动端过滤未收集 responsive-qa/v2-world-interaction，因此不记成这两项通过。
- 新增 canvas generation 与 DOM 驻留断言：切页和坐标设置后 create=1/rebuild=1；该次热切换最大 48.8ms。不能推导为整体性能 A/B 提升。
- R5b 冻结 App SHA-256：`8B9B245436335E41019A9455BB18526590ECDE22526EAD65A943ADEBE2843357`；WorldCanvas：`499AF97817507DB1AE37926CB23EC94C2EDECE5F722C08C03F9CC7ED50CD9A36`。

## 首轮合并树完整 Web 回归：失败已定位

- `npm run test:web:release` 收集 122 项；core 36 passed/1 skipped（242.8 秒）、visual 32 passed（157.2 秒），renderer 53 项中 1 个失败、1 个既有跳过（589.7 秒、exit 1）。
- 归档：`artifacts/test-gates/web-release/2026-09-08T09-43-19-113Z.json`；失败 trace/error-context 已复制到 `artifacts/core-refactor-r5-failure` 并逐文件比较 SHA-256。
- 唯一失败是 visual-flow 的旧完整性设置契约：关闭后期待禁用数字框，但已确认 DF-A1-02 规则和当前 SettingsScreen 都是隐藏两行。只修改测试：关闭/重载均不出现，重新开启仍保留上限 5 和阈值 3；不修改设置实现或撤回 UI。
- 初次修正上限断言后的定向生产用例 1/1、6.7 秒、exit 0。随后补齐准确的阈值标签及恢复值断言，纳入 R5a/最终合并树重新验证，不能拿前次结果替代后续测试源码。

## R5a：手势与展示所有权已接线、定向验证通过

- `immersive-controls.ts` / hook 只持有双击、提示、显隐与 timer，不接收领域命令端口；每个 timer 有明确所有者。会话切换/卸载清理未完成 reveal/hide/fade，避免旧回调影响新会话；支持 effect 重建。
- 8 项新测试覆盖按钮忽略、450ms/48px 边界、250ms 延迟、3800ms 提示、5000ms 自动隐藏与180ms退出、极简空闲/休息、跨会话和 dispose/重新 setup。
- `WorldScreenV7`、`FocusPlanSheets`、`FocusReports`、`FocusTimer`、`EndFocusDialog`、`HabitBuildingSelection` 和共享 `BlueprintPicker` 已独立成文件；格式化和蓝图适配另有单一模块。App 保留组合、常驻路由、顶层恢复及创建流程；新模块没有反向导入 App。
- 各展示组件保持原 JSX/class/aria/props；不改最新步进式结束时间 UI、绿玻璃、计时语义或 schema12。分包没有变成首次点击再加载。
- Web typecheck 与 175 项单测 exit 0。定向生产命令：`node tools/run-web-e2e.mjs --production tests/minimal-achievement-entry.spec.ts tests/minimal-focus-continuity.spec.ts tests/focus-regressions.spec.ts tests/v22-integrity-ended.spec.ts tests/responsive-qa.spec.ts tests/navigation-cache.spec.ts tests/visual-flow.spec.ts:440 --workers=1 --output=artifacts/core-refactor-r5a`，19/19、2.4 分钟、exit 0。包含完整五视口及横屏安全区；热切换最大 31.6ms。
- 对比抽出前后 9 个组件/辅助模块正文：移除 export 差异及 WorldScreen 未使用参数后完全相同，无 JSX/class/aria 顺手改写。
- 独立生产预览矩阵 `artifacts/core-refactor-r5-matrix.cjs`：5 视口 × 浅深 × 空闲/活动，共 20/20、exit 0。检验真实主题、横向溢出、世界可见、沉浸面板在视口内、generation=1 与 rebuild 不增加；截图/results.json 在 `artifacts/core-refactor-r5-matrix`，实际查看涵盖五视口、双主题及两状态的 10 张代表截图。独立预览已停止。
- 最终完整重跑已完成，见下节。R6 不在无 A/B 证据时强行增加新订阅系统。Android 仍需设备，显著改动后再次查 ADB 为空；没有本轮 APK/提交/发布。

## 最终冻结树验收：通过

- `npm run version:check`、`npm run typecheck`：exit 0，版本仍为 2.0.0/34。
- `npm test -w @tomato-clock/domain -w @tomato-clock/application -w @tomato-clock/storage-indexeddb -w @tomato-clock/web`：144 + 67 + 27 + 175 = 413 项通过，exit 0。
- `npm run test:web:release`：122 项全部执行完成，120 passed / 2 既有 skipped，exit 0。core：36 pass/1 skip、202.3 秒；visual：32 pass、96.5 秒；renderer：52 pass/1 skip、500.7 秒。三组共 799.5 秒，不含启动准备。
- 完整报告：`artifacts/test-gates/web-release/2026-09-08T14-36-52-152Z.json`。跳过项为旧 top-right reveal 用例与发布组主动交由真机/定向 GPU 门禁的 selected-building drag 用例；没有新增 skip 或放宽 timeout。
- 验证结束后及 2026-09-09 收尾前，两次运行 `node artifacts/core-refactor-verify-source.cjs`，对 HEAD、完整 binary diff、全部未跟踪源码内容重新计算并与报告比较，均 exit 0：`d2bf6aaaa591b56217106001bc088527f5ae630e468bdc3faa48b74d94d36957`。
- App SHA-256：`A9A0BC6A48FECCE32E2F8DE81949DEFC5744EC295ACE9B4C985FEE63A3B7984A`；WorldScreen：`78FF6B8EBF2B4B0CAB6B7E4407C5447A43CF2CCA2F6208DECA1D6E3E0D842314`。最终结果写回只修改文档，不修改已经验证的运行源码。
- 格式检查另外记录：`git diff --check` 提示 App.tsx 文件末尾空行；为保持冻结源码没有在门禁中重写。该格式提醒不是测试通过声明的一部分。

## 交回边界

- ARCH-27-01 本轮 R1～R5 完成；后续 UI 可分别修改计划、汇报、计时、蓝图与沉浸展示组件，不必重新耦合轮次存储/领域命令/渲染初始化。
- PERF-27-01 仅确认已测路径没有额外创建/重建，未完成同机交错 A/B；R6 订阅重构不触发。
- RECOVERY-27-01 的 OnePlus 五秒提示真机验收、OriginOS 准入/设备、私人伴侣与完整 Android 发布门禁仍是独立遗留项。本轮不改变领域 schema12、备份、最新 UI 或发布版本。
- 用户下一步意图是讨论新的 UI 改版点子；先讨论并确认范围，不预先实现新设计。
