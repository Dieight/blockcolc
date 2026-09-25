# V27 真机反馈返修（2026-09-06，当前最高优先级）

## 核心交付结果（2026-09-06）

DF-CORE-01 已实现并完成定向验证，UI 数值行尚待接入。主目录 C:/Codex/tomato-clock 是本次核心源码源，不从旧 UI 树覆盖它。
核心生产文件：packages/domain/src/model.ts、domain.ts、validation.ts。辅助测试：packages/domain/test/integrity-threshold.test.ts（15 条）、domain.test.ts、validation.test.ts、deferred-settlement.test.ts；packages/application/test/application-service.test.ts；packages/storage-indexeddb/test/backup-safety.test.ts、e2e/indexeddb.spec.ts；apps/web/src/BuildingMemoryPanel.test.ts 仅当前 schema fixture 两处更新，不改展示。
全仓 typecheck exit 0；domain 144、application 54、storage 27、Web 117 单测通过；version:check 2.0.0/27 exit 0。真实 Chromium IndexedDB 1/1，5.8 秒，exit 0；production Web 定向 focus-regressions + v22-integrity-ended 4/4，1.2 分钟，exit 0，产物 apps/web/artifacts/integrity-threshold-core。15 条新领域测试覆盖 1/3/15/60 秒边界、重复返回、禁用保值、非法输入零变更、旧 schema 11 延后会话迁移、豁免、到点优先及保存策略即时生效。应用测试覆盖保存失败不采用新配置；存储测试覆盖旧校验备份迁移与自定义阈值导出/重载。
没有跑新整套发布门禁，也没有构建/安装本轮 APK。ADB 已确认 PJX110 a50247d1 在线、当前已安装 2.0.0/27；等 UI 集成完成再交同一返修包，不用旧安装证明新代码。由于 schema 12 是真实存储变更，UI 集成必须包含核心三文件和迁移，不能再拿 schema 11 旧树覆盖升级后的数据。production test 构建有既有 chunk >500KB 和混合导入警告，不属于本轮性能验收结论。

用户已在 UI agent 完成的测试构筑上真机试用。本轮不重复旧接线工作，不覆盖其测试/构建产物，不授权发布。此契约覆盖旧交接顶部的等待核心接线状态。

## 所有权与交付
- UI agent：SettingsScreen、展示组件/CSS、App.tsx 的布局和展示交互、受影响 UI/E2E、DESIGN.md。不得改领域计数、原生注意力、备份或马拉松排程/结算算法。
- 核心：packages/domain、application、storage 的离开阈值、迁移和测试，产品事实/版本包/本交接。核心本轮不编辑 App.tsx 与 SettingsScreen。
- 先基于已验证的集成源码返修；独立 UI 树缺核心代码时只受控导入核心变更，不整树覆盖主目录。当前本机未发现可直接发消息的 UI task，文件是交接入口，不声称已通知或已开工。

## UI 返修清单
1. DF-UI-01 计划专注日改为与输入框类似的圆角矩形；七项单行等宽填满，不换行。减少内距/间隔，实际命中区仍至少 44×44，不得重叠；验证 360/412px 和放大字号，极窄视口不得把按钮偷偷压窄。
2. DF-UI-02 专注完整性单独开关行；开启后才展示“有效离开上限”和“离开阈值”两个独立数值行。关闭保留两个数值，重开恢复；使用领域 snapshot 和 ConfigureFocusIntegrity，不另写 localStorage。输入保持可清空的草稿与保存失败提示。
3. DF-UI-03 修正 iOS 开关白圆与椭圆轨道垂直对齐；按压不能出现整块系统蓝色背景，保留键盘 focus-visible。检查 checked/unchecked、按住、浅深、禁用。
4. DF-UI-04 修正列表多行文字组在背景中的垂直居中，尤其导入蓝图名称/尺寸。检查长中文英文、两行与放大字体。
5. DF-UI-05 极简空闲开始按钮使用有主题色的液态玻璃；返回完整模式默认隐藏，复用结束专注的双击显示/隐藏与返回层级，不能新增计时副作用。键盘/辅助技术仍有可达退出路径。
6. DF-UI-06 极简专注不显示面板下方建筑进度，复用其他模式沉浸结构；空闲时钟中心与运行时钟一致，其余按钮重新排布，不能通过改变整个操作带几何实现。
7. DF-UI-07 极简与普通马拉松共用结束时间输入展示组件，可同步润色。保留今天/明天、可清空逐字编辑、IME、busy/error 焦点约束；只共享展示，沿用既有核心校验与不同调用语义。
8. DF-UI-08 完整计时页“进入极简”移到大型任务名旁、紧邻前往任务页的小按钮；视觉小按钮但命中区 44×44，长标题不遮挡。
9. DF-UI-09 冷启动动画回到 v1.11.0 fe4798186f9b97b86e86752e16c6179c1f37e8b0 的三个方块起伏效果。仅移植动画相关规则；不得回滚 V26 页面并行预加载、一次加载、恢复与世界初始化时序。

## 核心接口（DF-CORE-01）
FocusIntegrityPolicy 新增 excursionThresholdSeconds：整数 1..60，默认 3。
ConfigureFocusIntegrity 接受同名可选字段；缺省保留当前值（旧调用不重置用户配置），新 UI 应发完整策略。
以回到前台时保存的策略判定 elapsedMs > excursionThresholdSeconds * 1000，等于不计数。沿用原有设置可即时更新行为，不新增活动会话锁定。
schema 12 保存该字段；schema 11 及更早严格迁移补 3，既有 deferredSettlement 不变。当前 schema 缺字段/非法值拒绝，未知字段继续拒绝。备份封装不变；旧 App 不保证读新备份。
原生层不再加一份阈值判断，锁屏/息屏/系统界面/多窗口豁免、完成优先、一次往返只计一次均保持。

## 验收与构建
UI 交回真实集成流程：改阈值→重载/导出恢复→边界内外往返；关闭/重开值保留；极简启动/取消时间单/休息/继续/临时退出重进/最终统一汇报与成就静默规则。
五视口×浅深截图与交互、200% 字号、实际输入/焦点、按压、返回、真实命中区；截图不能替代行为测试。
核心交回边界/迁移/持久化失败证据后，UI 再按既有正式签名 2.0.0 测试包流程验证构建。版本码以当前已安装版本确认升级，不擅自发布或代签验收。APK 各边界比较 SHA-256/包名/版本/签名，不以旧构筑哈希代表新源码。
