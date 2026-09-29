# V27 核心编排重构与接力实施方案

> 2026-09-09 · 执行状态：本方案 R1～R5 已实施并通过最终冻结树 Web 回归；R6 无 A/B 依据，不触发。实际结果见 V27-CORE-RESULTS.md；下文保留原计划供追溯。
> 关联：ARCH-27-01 / PERF-27-01 / RECOVERY-27-01 / DOC-27-01。
> 用户已于 2026-09-08 调整优先级，由核心持有 App.tsx 并先完成编排重构；现已交回。下一步讨论 UI 新方案，不自动实施或发布。真机/OEM/伴侣遗留仍独立跟踪。

## 1. 结论与下一步

不是重写底层。保留 TypeScript / React / Three.js / Capacitor，以及现有 DomainState、领域命令、CAS 保存和备份格式。
重构目标是把集中在 App.tsx 的应用编排拆成能独立验证、能逐片交接的单一职责模块，让 UI 修改不必同时理解生命周期、轮次恢复和渲染初始化。

执行顺序：
1. UI 仍在返修时，只做 R0 基线/行为盘点、R1 独立纯函数和特征测试准备；不接入或改写 App.tsx。
2. UI 交回后，先审查真机反馈的完整流程及阈值接线，再冻结一个集成检查点。
3. 一次只迁移一个所有权：R2 轮次上下文 → R3 命令结果/生命周期通知 → R4 专注控制器 → R5 壳层与渲染宿主。
4. 最后才根据测量做 R6 更新成本优化。订阅机制、缓存粒度和渲染性能不是本轮先验必须重写的项目。
5. 中途额度耗尽时，接手者从最后一个已验证切片继续，不同时展开几个未接线的框架。

成功标准不是 App.tsx 减少多少行，而是：真相来源唯一；副作用所有者唯一；失败/恢复可测试；流程不变；实际更新成本无回退。

## 2. 已核对的代码位置与已完成能力

主工作目录 C:/Codex/tomato-clock；UI 工作目录 C:/Codex/blockcolc-ui-v27。
编写时主树 HEAD 为 b46cba0250924cc3a07a51d7d89cf4cfd39be98a，UI 树 HEAD 为 45c0e9f067b36ba1c23c6133183d2bee151355d6；两边存在未提交改动，HEAD 不是完整源码基线。2026-09-07 主树 App.tsx 已出现 EndTimeFields 和 idleExitRevealed，说明返修内容正在进入文件；不能套用旧行号或覆盖旧副本。

| 已有位置 | 现在承担什么 | 后续处理 |
| --- | --- | --- |
| App / run / resumeVisibleFocus / refreshAfterReplacement | 命令结果、刷新、成就基线、仪式及消息 | R3 提取，保留返回/抛错和事件优先级 |
| WorldScreenV7 | 轮次上下文、开始/结束/汇报、提示手势、展示、世界适配 | R2/R4/R5 分片迁移，不整块换实现 |
| bootstrap.ts | 唯一平台生命周期订阅、应用处理后广播回执 | 先保留，再测试通知提取边界 |
| round-plan.ts | parseRoundPlan、planRoundsForDuration、reconcileRoundPlan | 继续作为既有纯算法源，不复制状态机 |
| minimal-focus.ts / use-minimal-focus.ts | 极简准备、串行首次开始、Sheet 草稿 | 已实现；复用，不再造一套 |
| marathon-settlement.ts | 已结算集合、剩余可汇报轮次 | 继续作为统一汇报的事实投影 |
| focus-preferences.ts / use-focus-preferences.ts | 本机偏好和保存失败 | 已提取，不重复拆建 |
| minimal-presentation.ts | 普通活动/待汇报优先于极简壳层 | R1 引用，不从偏好直接推断可进入 |
| achievement-notice.ts / application achievements | 只读成就、合并提示 | 只提取编排，不添加解锁表 |
| WorldCanvasV7 / BlueprintPicker | 渲染器创建、资源切换、相机和销毁 | R5 先搬职责，后谈优化 |

领域当前 schema 12：离开秒阈值已经完成，schema 11 及以前补 3 秒；deferredSettlement 语义保留。本文不得新增 schema 13、改存储键或重新设计历史记录。

App.tsx 还存在 WorldScreen、WorldCanvas、ProgressReport 等旧实现名字。它们是“待证明不可达”的清理候选，不凭名字直接删除；核对 JSX、导出、动态入口、测试入口后，单独做删除切片。

## 3. 不得改变的合同

- 真正的剩余时间是 endsAt - now。UI 定时器只能触发显示和到点核对，不得直接修改领域事实。
- ApplicationService 的串行执行、save → adopt → 通知副作用顺序保持；保存失败不暴露成功状态。不得在 UI 再建第二个领域命令队列。
- DomainState 是唯一业务事实；RoundPlan 是可丢失、可恢复的本机流程上下文，不是第二份 focusHistory。
- 固定普通专注、普通马拉松、普通习惯轮次、deferred 极简轮次的结算语义不能合并成一个“全部完成即建造”分支。
- deferred 只允许 marathon=true 且 subtaskId=null；全部完成后统一汇报，习惯分配初始为 0，单轮不能提前推进习惯建筑。
- 计划丢失但有已保存未汇报轮次时，恢复汇报；不能猜测剩余总轮数。宿主被删除/无可分配任务时仍能显式结束空分配。
- 临时退出极简只改呈现，不取消专注、不改本机开关、不改变宿主和当前会话 ID。
- 开关/次数/秒阈值仍保存于领域策略，阈值严格超过才计数；锁屏、系统界面等豁免和到点完成优先保持。
- 生命周期只有一个平台注意力来源；状态刷新通知不应再次调用 handleLifecycleEvent 或重新计数。
- 普通消息、成就提示、有效离开五秒提示、超限结束提示是不同通道。不能用一个全局 toast 统一替代。
- 初始加载/导入/回滚/历史恢复为安静成就基线；用户成功操作的新增解锁可合并延后展示。
- 本机偏好写失败不显示已保存；后台不运行空闲分钟时钟。隐藏页面保留挂载，不等于隐藏页面继续做所有展示工作。
- 世界和四主页面保持驻留及冷启动并行加载；不因拆文件改成点击后才加载，不能因 tab/key/极简开关重建世界。
- 建筑聚焦与记忆面板分开；关闭记忆不能重置相机，重置地图才清两者。
- 44px 命中区、IME、焦点/返回层级、减少动态、安全区及 UI 返修后的几何不因重构改变。
- 不做 Android 全原生、事件溯源、全局状态库迁移、数据库替换、Shader/地形重写、厂商新接口或包版本升级。

## 4. 目标模块与依赖方向

建议文件名是落地目标，不是允许创建空模块的数量指标。已有同责文件可直接复用。
依赖方向：展示 → Web 控制器/纯选择器 → ApplicationService → domain / ports。
渲染宿主只消费 world projection；domain 不 import Web/React；通用模块不能反向 import App.tsx。

| 目标 | 唯一负责 | 明确不负责 |
| --- | --- | --- |
| focus-view-state.ts | 从快照、已核对计划、偏好及临时呈现状态推导视图 | 保存、命令、timer、通知 |
| round-plan-store.ts + use-round-plan.ts | 现有键读取/严格写入、planRef 和可见副本 | 领域计数、改变排程公式 |
| command-feedback.ts + use-command-runner.ts | 解释成功结果、失败反馈、刷新及成就触发 | 执行领域规则、主动再保存 |
| use-application-lifecycle.ts | 消费已处理的回执、pageshow 接线和清理 | 第二次平台订阅/计数 |
| use-focus-flow.ts | 现有开始/继续/休息/结束操作及最新状态核对 | JSX、手势、世界初始化 |
| use-immersive-controls.ts | 双击显隐、淡出 timer、返回层级 | 开始/取消领域专注 |
| WorldScreenV7.tsx / WorldCanvasV7.tsx | 组合展示 / 渲染器生命周期 | 改领域快照、另造排程 |
| App.tsx | 最终组合、页面驻留、顶层边界 | 内嵌数百行轮次与渲染细节 |

第一阶段不强行把所有状态塞进 reducer。纯视图判定可用判别联合，流程控制器保留现有状态机函数，局部 UI 用局部 state。

## 5. R0：建立可接手基线（最先做）

输入：最新 UI 返修结果、本文、真机反馈交接、产品事实与最新 dirty tree。
步骤：
1. 记录两个目录的分支、HEAD、git status，列明未跟踪的源码/测试；关键源码 SHA-256 + binary diff + 未跟踪文件清单共同标识检查点。
2. 记录 UI 当前占用文件、暂停点、构建中的输出目录。未经交回不能读旧 HEAD 然后批量覆盖最新文件。
3. 先跑本切片测试基线，把已知失败、失败 trace、是否冷加载超时记录在独立结果中；不要放宽 timeout 来掩盖功能失败。
4. 用稳定函数/符号定位，而不是本文中的观察时行号。
5. 查证 App 的旧组件调用图；若确不可达，单独删除并验证。不要与控制器迁移混作一大块。
交付：docs/handoffs/V27-CORE-RESULTS.md 中的 R0 检查点（实施时新建，不预填通过）。
停止：源码在测试中变化、UI 尚占用待修改文件、基线出现未解释的新失败。先对齐，不把旧测试数量当作今天通过。

## 6. R1：先固定视图推导合同（可独立准备）

新增纯 deriveFocusViewState；输入须显式带入 nowMs、DomainState、RoundPlan|null、偏好和临时呈现标志。输出仅供渲染，不持久化。
优先复用 reconcileRoundPlan、unsettledMarathonSessions、canPresentMinimalFocus；不在第二个模块复制它们的规则。可以先只把 App 内相关派生表达式集中为纯函数，避免一次设计巨型 view model。

至少输出明确可区分的 idle / focus / break / ready / report，以及 minimal/full 呈现和所需 endsAt；setup/无宿主恢复边界仍由顶层处理。不是简单地给所有 report 状态压过活动会话；应对照现有合法场景，遇到不一致数据走恢复/阻止新开始，不猜测丢弃活动事实。

测试：
- 无项目首次设置；普通/习惯空闲；普通运行时偏好极简开启也不劫持会话。
- deferred 活动、休息、ready；临时退出/重进会话 ID 不变。
- 普通待汇报/统一汇报优先于极简空闲；被删宿主、空目标恢复可结束。
- 缺/坏 RoundPlan、已过期休息、当前活动会话与缓存计划不一致。
- 输入对象冻结后仍可运行且没有写入；同输入同 now 输出一致。
UI 忙时只交函数/测试，标“未接线”；UI 交回后再最小替换表达式。不允许以完成纯函数就宣称功能迁移完成。

## 7. R2：轮次上下文所有权（接线须等 App 交回）

RoundPlanStore 的建议端口：
- read(hostProjectId): RoundPlan|null，继续使用 parseRoundPlan 和现有读取降级。
- write(next: RoundPlan|null): void，失败必须抛出；不吞存储异常。
- Hook 持有当前值、最新引用和可见错误；新值先成功写存储，再更新 ref，再更新 React state。
继续使用 blockcolc-round-plan-v1；不改 schema、键和迁移语义，不新增跨标签页合并机制。

区分三种状态，不能统称“已保存计划”：
1. 领域已提交的活动会话；
2. localStorage 成功保存的流程上下文；
3. 存储失败时依据领域事实派生出的可见恢复视图。
第 3 种允许展示恢复事实，但必须保留错误，不能反向写为业务真相。

极简首次开始继续复用 createMinimalFocusStarter 的三段边界：
- 准备计划保存失败：不 dispatch。
- dispatch 保存失败：只撤回匹配的本次 ready 草稿，不能清掉后来出现的计划。
- 领域成功、附加 currentSessionId 保存失败：保留活动计时，显示警告，以已保存 ready + 活动 session 恢复；不能补发 CancelFocus“回滚”。

普通开始目前和极简的写入先后并非完全同形；提取时保留各自语义并测出失败点。若要统一为新的事务算法，必须另列修复任务，不夹在提取中。
取消/汇报成功后删除上下文失败也不能重新取消/重新汇报；按领域已结算事实去重并保留错误。
验收：成功/读取异常/写异常/remove 异常、切宿主、marathon 跨项目、重复点击、延迟 dispatch、重载恢复。
R2 完成后 setPlan 的持有者只能有一个；不能旧 effect 和新 hook 同时写键。

## 8. R3：命令结果与生命周期消费（两个小切片）

R3a 先提取纯 command-feedback(result)：
- 输入真实 ApplicationResult，输出要展示的提示/仪式意图；不运行 timer、不修改 service。
- 保留 App.run 当前事件优先级，尤其 app-switch-limit 清理普通消息、提前完成文案分支、通知警告的“去设置”。
- use-command-runner 保留 dispatch 返回值；领域拒绝结果照常返回，保存异常提示后仍抛出，不能默默变成成功/undefined。
- 成就 before/after 获取时机、refreshAfterReplacement 清队列与静默基线分别测试；不能从每一次重渲染计算并弹差异。
- 不让一个保存成功但通知失败的操作重试整个领域命令；通知 warning 与持久化 exception 分开。

R3b 再提取生命周期“消费”：
- bootstrap 仍持有唯一平台订阅，ApplicationService 仍串行处理；Hook 只接收处理完成后的回执和刷新。
- 五秒提示由已记录的事件驱动，root 保存信号后再刷新世界；重复 foreground、pageshow、tab 切换不能补弹。
- 已达到次数上限时 activeFocusSession 可能为 null，需覆盖该边界；计数提示与超限结束提示分别验证，不能凭 after.active 存在与否当作全部事件来源。
- 当前 bootstrap 在 service 队列外取 before/after 差值，可能存在排队竞态风险；这只是待特征测试的风险，不是已证实缺陷。若复现，单列修复：以同一次 ApplicationResult.events 中的 FocusExcursionRecorded 提取事实，保留用户已验收的两类提示语义。不得顺手改原生计数。
- effect 清理覆盖“异步订阅尚未完成就卸载”、重复挂载、旧 service 替换；处理通知的代码不要依赖关闭中的 Sheet 是否还挂载。

每小片独立验证，不能同时替换 bootstrap 广播、App 刷新和 World 显示三层而无中间检查点。

## 9. R4：专注流程控制器

前置：R1/R2/R3 已验证，UI 返修已接入。控制器只接收 ApplicationService 的窄端口、严格 plan store、最新 preferences 读取和注入 Clock；首轮迁移保持既有函数行为。
建议端口沿用实际类型：
- snapshot(): DomainState
- dispatch(command: ApplicationCommand): Promise<ApplicationResult>
- resume(): Promise<ApplicationResult>
- readPlan / writePlan / nowMs
由现有 service 适配，不复制仓库实现。控制器内部返回业务结果/展示意图，不 import UI 组件。

按操作顺序分别迁移：confirmPlan → startFocus → finishBreak/skipBreak → interruptFocus/completeEarly → cancelPlan → final report 后清理。
每迁移一个，删除 App 对应旧回调的业务实现；不长期双运行。移走 useCallback 后重新核查闭包：异步完成时必须读取最新快照，不拿点击前 state 推断刚提交结果。
控制器 busy 防重复点击是局部提交门，不替代 ApplicationService 队列；到点期间点击提前完成必须先恢复到点事实，不能记成提前/中断。
跳过休息保留现有 blockcolc-skip-break 事件和一次性请求键，仅消费匹配的当前休息；不新增自动开始下一轮。
最终汇报继续派发 ReportMarathonFocus，输入来自明确分配；不把展开卡片视为分配。

表驱动流程矩阵：
| 主体/模式 | 正常/提前 | 中断/超限 | 结束计划 |
| --- | --- | --- | --- |
| 普通固定 | 保留原逐轮汇报/提前完成行为 | 保留真实时长和现有继续策略 | 不伪造完成 |
| 普通马拉松 | 留待统一汇报 | 当前轮中断，已完成池保留 | 有池进入 report，无池清理 |
| 习惯固定/普通马拉松 | 每轮按旧规则推进习惯建筑 | 不推进建筑 | 不再提供已计入习惯的轮次 |
| deferred 普通/习惯宿主 | 都只记轮次 | 中断不进入可分配完成池 | 统一汇报，习惯从零分配 |

再与 0/非0休息、前后台、重载、宿主切换、保存失败组合覆盖关键分支，不强求全笛卡尔积重复慢 E2E。

## 10. R5：壳层、展示与渲染宿主

R5a：抽出组件/局部展示 hook，先保持原 JSX、class、aria、DOM 层级与稳定 key。
- use-immersive-controls 只管显隐和 timer；隐藏返回完整模式不能暗取消领域计时。
- 页面继续冷启动并行加载 + 挂载后 hidden。不要移为 tab 条件渲染或动态 key=version。
- 建筑记忆、关于、仪式、创建草稿的返回层级不变。
- 子组件输出类型不要退化为 Promise<any>；尽量沿用 ApplicationResult，同时不改变调用者错误处理。

R5b：WorldCanvasV7 先独立成文件并保留初始化依赖。
- 创建/资源包初始化/首帧 ready/销毁有独立 generation，旧异步结果不得更新新实例；失败也须退出永久加载。
- 初始化 create/dispose，与 setWorlds、setVisible、focusProject、沉浸区域、瞬时反馈分开。
- 只在实际场景/材料相关输入变化时更新；不能把整个 preferences 对象、UI message、当前 tab 加进重建依赖。
- 拆后保持鼠标/触摸相机、选中建筑、缩放、坐标、重置地图/视角、沉浸安全框、资源切换表现。
- 不在同一切片改几何生成、LOD、光影、atlas、Bloom 或实例缓冲格式。
- 先证明 UI 显隐/计时数字变化未增加 renderer create/dispose 与 world rebuild，再考虑减少 setWorlds。

## 11. R6：性能与订阅（有基线才选做）

先测 root/route 渲染次数、投影计算次数、world rebuild、首帧和热切换；做同机同数据交错 A/B。
先使用已有 epoch 缓存和稳定 props，必要时缩小选择器输入；不要一上来引入全局状态库。

若数据证明 version + root refresh 是瓶颈，再单列 ApplicationService subscribe/getSnapshot 提案：
- getSnapshot 在同 epoch 稳定，不能每次调用 clone 返回新引用造成循环。
- 快照通知表示已采用状态，不代表通知副作用已完成；业务结果提示仍走操作结果，不能由订阅猜测。
- import/rollback/resetMissingState/resume/外部 revision 重新加载都必须更新订阅，不能只覆盖 dispatch。
- 订阅不得参与保存事务或抛错影响已提交命令；一个监听者失败不能阻断其他监听者。
- 时间推进、跨日期、偏好和资源包是独立失效源，不能仅靠领域 epoch 让它们失去刷新。
- 读快照避免 render 期间写；退出订阅幂等，不偷偷添加原生事件源。
这部分未作实施定案，接手者没有测量证据就停在 R5，不以完成重构为由强上新订阅模型。

## 12. 验证命令与分层

从 C:/Codex/tomato-clock 执行；先核对 docs/TESTING.md 与当前 runner，不能在另一个 agent 正构建同一 dist 时并行跑构建。

每个接线切片：
- npm run version:check
- npm run typecheck
- npm test -w @tomato-clock/domain -w @tomato-clock/application -w @tomato-clock/storage-indexeddb -w @tomato-clock/web
- npm run test:web:release:check（新增/移动 E2E 时）

按影响选择现有 E2E：
- R2/R4：minimal-focus-continuity、minimal-achievement-entry、v17-continuity、v21-marathon、v22-marathon-lane、v24-marathon-settle、v5-focus-flow。
- R3：focus-regressions、v22-integrity-ended，加新增并发/回执应用单测；修改存储时运行 storage-indexeddb 的 test:e2e。
- R5：building-memory、world-coordinate-setting、responsive-qa，加最新 UI 返修用例和页面驻留/首帧诊断。
- 命令示例：node tools/run-web-e2e.mjs --production tests/minimal-focus-continuity.spec.ts tests/v22-marathon-lane.spec.ts --project=mobile-chromium --workers=1 --output=artifacts/core-refactor-r2
实际命令、退出码、报告路径和源码指纹都写交接；不得只记录“跑到了 N 个”。

R2/R3/R4 跨计时/存储/恢复，最终合并树需要稳定回归；正式发布仍完整 L4，不能用上述定向列表抵扣。R5 需五视口×浅深及真实焦点/手势，不止截图。
显著流程变更按仓库要求检查 ADB，正式签名验证包需同一源码、哈希比较和不清数据升级；没有新的构建/安装授权或未满足前置门禁时不擅自发布。设备忙按既有规则暂停安装。
本方案编写未执行新测试，不把 2026-09-06 的数字当作重构后的通过证据。

## 13. 接手、交回与中止规则

UI agent 接手核心时先把角色从“展示返修”切换为本文指定的核心切片负责人，在 V27-CORE-RESULTS.md 登记文件所有权。同一 App.tsx 同时只能一个实现者；本文是接力方案，不是让两边同时改公共文件的授权。
首次接手读：Tomato Clock.md → V27-DEVICE-FEEDBACK.md → 本文 → 最新结果检查点 → 当前 diff → 对应测试。
不要回到旧提交重做 minimal starter、成就、schema12；不要复制一整个工作树来同步。

每个检查点填写：
- 切片 ID / 未开始、实施中、已接线待测、已验证、阻塞；
- HEAD + dirty source fingerprint + 改动/未跟踪文件，当前负责人；
- 已迁走的符号、唯一新持有者、仍保留的旧代码和原因；
- 行为合同有无改变（若有，单列修复批准依据）；
- 精确命令、退出码、报告、未通过/未跑/人工项；
- 下一个唯一动作；正在运行的进程/输出目录；不得触碰的文件。
额度不足时即使只有半片，也写清“新模块未导入/旧实现仍运行”，不把待接线文件描述成完成。

停止条件：需要改变业务含义/schema/备份；遇到另一 agent 的重叠编辑；发现数据损失/重复结算；旧新行为差异无法解释；没有完整退出码；性能回退无法定位。
恢复方法：只撤回本切片的受控改动或修复前向问题，保留用户/其他 agent 改动；不得 git reset --hard、整文件 checkout 或清用户数据库。
提交、tag、发布仍按仓库 prepare/授权要求，本文不要求每片自动提交。

## 14. 可直接转交的任务文本

“先完成并交回 V27-DEVICE-FEEDBACK.md 的 UI 返修；若随后接手核心，阅读 V27-CORE-REFACTOR-PLAN.md 与最新 V27-CORE-RESULTS.md，从尚未完成的最小切片继续。先核对 dirty tree 和文件所有权，不覆盖 App.tsx 新 UI。保留 schema12、既有轮次/结算/生命周期和渲染合同；每次只接入一片，运行对应测试并记录退出码及源码指纹。不要直接重写 domain/storage/renderer，不添加新功能，不自动发布。遇到需要改变业务语义的差异先报告。”
