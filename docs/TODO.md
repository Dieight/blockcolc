# Blockcolc 当前工作入口

正式基线：v2.1.0 / 43，已发布：[GitHub Release](https://github.com/Dieight/blockcolc/releases/tag/v2.1.0)。
当前阶段：v2.1.0 工作包已关闭；下一版尚未立项。用户认可本版天气表现，较小的天气打磨留待下一版，不作为当前紧急修复自动开工。
本版记录：[正式交付工作包](versions/V43.md)、[开发工作包](versions/2.1.0-development.md)。
V43 按用户明确要求，以同轮私人包体验作为公开标准版验收，免重复全量与第二次人工体验。公开标准 APK 已重建并与上轮标准验证包逐字节一致，发布资产回读摘要一致；正式 Prepare/Install/Accept 流程没有伪称完成，例外证据保存在本地 `artifacts/release/v2.1.0/release-evidence.json`。

以下是 v2.1.0 已关闭的开发与验证记录，仅供追溯，不构成当前待办或新的执行授权。
历史中央检查点：[小构件首轮冻结](../artifacts/v2.1.0/integration/small-components-evidence.json)类型检查、定点纯测试456/456、稳定浏览器38/38、材质组7/7通过；诊断14/17的三例失败保留。独立反例证实测试canvas漏了正式宿主已有的touch-action:none；只修测试宿主后的[最终冻结](../artifacts/v2.1.0/integration/small-components-native-touch-evidence.json)类型检查与整组诊断17/17通过，真实半圈输入无取消/页面缩放，三建筑另一侧、原创板近景及雨线已目视。两轮生产代码相同，但测试树不同，不合成全版门禁。后续R旋转及Q准备收口保留于[前包](../artifacts/v2.1.0/integration/next-lifecycle-rotation-package.md)，当前执行权见下文与版本工作包。JVM/OEM/完整版本门禁不由局部证据替代。
原双通道验证 APK 构建时仅留在本机、未由代理安装或上传；随后正式标准 APK 已单独发布。好友服务器持久会话另经用户当轮明确授权部署并完成线上验收。

最新本机测试候选：[v2.1.0 (43) 标准 APK](../artifacts/verification/v2.1.0/build-43-f6538ae0b1924872b7c50cb38ac8e6b5/Blockcolc-v2.1.0-verification.apk)，SHA-256 `a17500125f3f39f5ee18d2a181614bfb5b2483df0f7a1948ce517a3216957951`；[构建证据](../artifacts/verification/v2.1.0/build-43-f6538ae0b1924872b7c50cb38ac8e6b5/verification-evidence.json)。同轮私人包仅保存在私有工作区，SHA-256 `beba006c7a6513f7bb7e90d979580d213073a62f6a63ed7447591653876dba17`；两包同为 `com.blockcolc.app`、2.1.0 (43)、同一签名和交付轮次 `v2.1.0-build43-20260930-paired-user-test`。生产 Web 三组193项中190通过、3条件跳过，零重试；本机JAR四包组合补跑通过，诊断41/41，扩展25/25，工具/fixture/存储/核心循环、Android JVM/lint/release assemble通过。跳过项及OEM/真机边界未由自动化代签。旧(42)包保留为历史，不再作为本轮候选。

最新验收：R [独立补跑](../artifacts/v2.1.0/integration/2026-09-28-r-independent-02/evidence.json)原始报告1/1、六帧/恢复已审。Q implementation-02 [最终原始后测审计](../artifacts/v2.1.0/integration/quality-hot-switch-final-independent-audit.json)及[类型/73纯测/3例能力/六帧审计](../artifacts/v2.1.0/integration/quality-final-validation-independent-audit.json)限域通过：5对/10action、零FULL read/atlas/world重建，636现存文件前后相同且root核过live；median110.75ms/p95 320.4ms是native click→当前世界帧，不是纯渲染或Android冷启动结论。[独立验收边界](../artifacts/v2.1.0/integration/quality-hot-switch-independent-review.md)保留真实GPU分配失败/context恢复/设备/旧夜景对照未测、历史352报告缺口与所有原失败。Q和只读冷审代理已完成释放，不保留旧执行权；本页后续更新不继承旧冻结。

## v2.1.0 已关闭实施范围

最新原创片 [final06 独立验收](../artifacts/v2.1.0/integration/original-components-final06-independent-review.md)限域接受：20 ID/49 state，run19的112定点纯测与类型、run23生产诊断1/1；root核过679候选/639现存/40删除冻结、19 dist文件、22原图/3同图附件副本/2原像素裁切及三路混合发光反例。不是全版门禁、原版像素等价或设备验收。公共文档更新与两份可恢复临时指针归档发生在该冻结审计之后，原失败全部保留。
默认冷测 run13 的逐页 revision 漂移已找到实际原因：内置奖励 raw/规范化字段顺序不同，每次重启多保存三次。注册入口幂等及实际 wrapper/pagehide 回归已修复；[postbuild01 独立验收](../artifacts/v2.1.0/integration/builtin-reward-postbuild01-independent-review.md)限域接受：19纯测/types0、单例五页固定完整事实、六附件逐字节匹配，680候选/640现存+40删除及19 dist构建后前后/live一致。root实际三次重启均零重复保存。原run01–13及所有失败保留，不宣称提速、全版或Android冷启动验收。

当前由 root 单独实施，不使用子代理。隐藏材质列表延后已完成[限域审查](../artifacts/v2.1.0/integration/cold-list-deferral-root-review.md)：JAR 五页冷测中位3537.4/3520.4ms、list 0；历史选择修订不同，仍不宣称量化提速。[提交地形缓存限域审查](../artifacts/v2.1.0/integration/submission-terrain-cache-root-review.md)在固定 Web 输入下前后各15/15，中位数普通推进1962.3→1205.7ms、马拉松1901.5→1215.4ms；非手机数据。当前(43)候选含这些源码及后续天气、阴影、镜头、原创告示牌和远景采样更改；同场景旧夜景亮度对照、真实动态摩尔纹与设备体验仍需人工审看。

VIS-02 本轮新增[蜡烛17 ID/272态限域审查](../artifacts/v2.1.0/integration/original-candle-root-review.md)：蜡体/烛芯/来源点亮规则和有效包优先路由已接线；该片阶段性voxel 368/368、合成包生产诊断1/1。下段床片为后续当前源码结果；不将阶段性计数相加成整版。
随后[床17 ID/272态限域审查](../artifacts/v2.1.0/integration/original-bed-root-review.md)也完成：普通床头/尾/枕面与草床贴地轮廓，旧片voxel整组369/369、床+蜡烛联合生产诊断2/2；后续苍白苔藓和告示牌另列，不把阶段计数相加为等价率。
本次由主代理独立完成[苍白苔藓地毯1 ID/162态限域审查](../artifacts/v2.1.0/integration/original-pale-moss-root-review.md)，并在(43)加入四类木质告示牌13木种、1456合法状态的静态轮廓及共享旋转组件；近景最近邻、远景mip内／级间线性采样。告示牌文字、草床流苏、其他未覆盖模型及动态摩尔纹仍属明确边界，不宣称80%–100%原版等价。

当前需求和文件执行权只在 v2.1.0 工作包维护。
下表为已关闭的[工程收口记录](maintenance/2026-09-27-workflow.md)，不重复执行。

| ID | 项目 | 实现 | 自动化 | 人工边界 |
|---|---|---|---|---|
| PROC-01 | 清理现行规则与历史记录 | 完成 | 引用与历史入口审查通过 | 无产品行为改变 |
| PROC-02 | 更新产品/架构/设计/私有规范 | 完成 | 契约与实际代码审查通过 | 沿已批准草案 |
| PROC-03 | 精简并改名专属 skill | 完成 | 格式及三类请求路由审查通过 | 保持授权边界 |
| PROC-04 | 交付升级预检及发布证据关联 | 完成 | 合成契约及公开环境验证通过 | 未交付 APK |
| PROC-05 | 资产摘要与包/文档命名 | 完成 | 类型、测试、派生资产与引用通过 | 保留发行兼容标识 |
| PROC-06 | 文件归档与目录迁移 | 完成 | 3,787 项归档及兼容入口通过 | 原材料与旧工作树保留 |

## 历史事项

- [2.0.0 历史记录](archive/v2.0.0/README.md)保留 F01–F20、R01–R23、同步与阶段验收，不因旧复选框未勾选重新开发。
- 用户确认正式版已完成，整体版本验收与每项独立设备证据分别记录，不补造通过。
- F04 的已发布静态兼容范围及非承诺见[现行兼容说明](../MINECRAFT-VISUAL-COMPATIBILITY.md)。
- 真正的新问题或明确延期事项等用户下一版定范围；旧“暂停”“待发布”不再作为当前指令。
- OriginOS 专属准入等外部条件不自动成为本轮执行任务。

## 状态规则

每项分开记录实现、自动化、交付和人工验收。
“已实现”不等于自动化通过，“已交付”不等于用户已接受。
自动化需最终退出码与可定位报告；验收需明确用户确认，不代签。
