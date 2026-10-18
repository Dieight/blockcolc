# blockcolc 当前任务

正式版本：[v2.7.0 / 84](releases/v2.7.0.md)，已发布；v2.6.0 / 61 历史记录保留。

## 当前

- /99：动物生命周期与数量已核对；完整门禁、同轮标准／私人包及隔离配对通过，按用户直接授权准备提交 CI 后发布。私人包只保留本地，未操作手机，见[工作包](versions/V99.md)。
- /98：用户批准的[动物系统](research/2.8.0-world-animals-integration.md)已接入，含鱼、陆地动物、鸟及停走／变速／自然转向；定点、配对与隔离核对完成，私人包本地待体验，见[工作包](versions/V98.md)。包含 /97 后的草／岩河岸返修，未跑全量、操作手机或上传。原[讨论稿](research/2.8.0-world-animals-proposal.md)、[实验](research/2.8.0-world-animals-experiment.md)、[/97](versions/V97.md)与旧 APK 保留，不代替本轮验证。
- 世界生成／地形：分块原型及扩建／全局失效实验完成，采用保持完整网格不变的数值分组优化，已包含在 /97；取舍、验证和下一步见[本轮记录](research/2.8.0-terrain-chunks.md)。此前的[共享地表](research/2.8.0-terrain-surfaces.md)与[生成审计](research/2.8.0-terrain-audit.md)保留。新版手机体验待进行。
- /96 上轮无探针私人包的 OnePlus 安装保留，本轮未操作手机。海岛／海岸同快照重建中位数约 0.83→0.60s／3.31→0.64s，冷启动改善较温和。见[原交付](versions/V96.md)与[实机记录](research/2.8.0-world-pipeline-device.md)。当时已恢复海岛、保留数据，未跑全量、上传或发布。外部材质冷启动几何持久化、较大页面挂载分片等未完成部分见实机记录末尾。
- /89 历史轮次：八项反馈的定点、成对构建与中文插入实机修复记录保留；当时的 /88 恢复不代表当前安装。本轮开始已确认设备为 /89，现由 /96 接续。[开发记录](versions/2.8.0-development.md)、[原交付](versions/V89.md)、[/88](versions/V88.md)、[/87](versions/V87.md)与 [/86](versions/V86.md)。
- /85 的备份、恢复后自动续轮授权、便签保存及新成就等非视觉改动保留；/85 的 UI 方案已撤销。[原审计修复](versions/2.7.0-audit-followup-20261013.md)、[历史 /85 测试包](versions/V85.md)与旧 Demo 均保留，不作为 v2.8.0 验证。
- 10 月 13 日收尾：火焰去掉固定双尖轮廓，改为自然上涌的像素火柱；/84 完成全量门禁、标准／私有配对核对并发布。验证及发布结果见 [V84](versions/V84.md) 与 [发布说明](releases/v2.7.0.md)。
- /83 历史轮次：2026-10-12 反馈、六项追加及新火焰参考已完成定点；两包核对及 OnePlus 覆盖安装记录保留，原待体验事项已由后续 /84 反馈与交付接续，不作为当前待办。[原记录](versions/2.7.0-feedback-20261012.md)、[交付工作包](versions/V83.md)。
- OnePlus 的首转、通知栏、海岸缓存、稳定旋转与后台矩阵均已完成，原数据及电池策略恢复。稳态 P95 约 42→25ms；无 V8 采样器复核未再现数百毫秒首转尖峰。ColorOS 默认后台仍会冻结，完全允许后台行为后 Home/锁屏通过；OriginOS 视觉暂无对应设备。[设备记录](research/2.7.0-device-performance.md)。
- /74 的原交付与暂停结论保留在[上一轮记录](versions/2.7.0-followup.md)和[交付工作包](versions/V74.md)，不覆盖历史结果。
- 规则整理已按批准的第二稿应用；旧文件快照和专属 skill 归档保留。
- v2.7.0 状态复制、建筑缓存与可选渐进启动的既有对照见 [开发记录](versions/2.7.0-development.md)和[实机测量](research/2.7.0-device-performance.md)。/70 的安装及旧基线仍保留在[上一轮交付](versions/V70.md)，不作为 /74 实机结果；完整门禁与发布进展统一见 [V84](versions/V84.md)。

新版本按 [模板](templates/README.md) 建开发记录，把当前链接放在这里。此处只留当前事项，不复制开发日志或测试计数。

## 历史

- v2.6.0：[开发](versions/2.6.0-development.md)、[交付与验证](versions/V61.md)、[发布说明](releases/v2.6.0.md)。
- v2.5.6：[交付与验证](versions/V55.md)、[发布说明](releases/v2.5.6.md)。
- v2.4.0：[开发](versions/2.4.0-development.md)、[交付](versions/V50.md)、[发布](releases/v2.4.0.md)。
- v2.3.0：[开发](versions/2.3.0-development.md)、[交付](versions/V46.md)、[发布](releases/v2.3.0.md)。
- v2.2.0：[开发](versions/2.2.0-development.md)、[交付](versions/V44.md)、[发布](releases/v2.2.0.md)。
- v2.1.0：[开发](versions/2.1.0-development.md)、[交付](versions/V43.md)。
- v2.0.0：[归档](archive/v2.0.0/README.md)。

应用本稿时，旧 TODO 全文另存同目录 `TODO.history-2026-10-01.md`，保留原相对链接。
