# blockcolc 规则整理 · 第二稿

2026-10-01。根据你对首稿的四点反馈重写，仍待审查，正式文件尚未替换。首稿保留作对照，下一版开发尚未开始。

## 这次改了什么

AGENTS 增加文件用途表，明确任何 AI 都按归属更新。同一决定在对应文件维护，别处给链接。采用的产品决定写回产品、架构或设计文件，版本记录保留实施经过和出处。

专属 skill 从新规则中移除。现有检查方法并入 TESTING，视觉要求留在 DESIGN，设计来源单独保存。批准后把 skill 整个目录移到注册目录之外的历史归档，连同 metadata 和支持文件保留；不会建立替代 skill。

每版新建的文档分为开发记录、交付工作包、发布说明，另有按需使用的调研模板。长期规范继续维护原文件。模板说明写明创建时机、生成位置和内容，不要求立项时创建所有空白文件。

语言改为直接说文件、动作和结果。“产品真相”“权威入口”等说法改成业务数据和文档位置，保留真正需要的 schema、CAS、manifest 和输入指纹等术语，以及原有数值、默认值和条件。

## 保留与删减

| 内容 | 本稿处理 |
| --- | --- |
| 原始数据、已有改动、升级安装、私有隔离 | 保留，实际工作中容易出错且影响大 |
| 独立执行、长测试等完成、已过门禁按影响复用 | 保留，继续按你的明确要求执行 |
| 测试中断却报通过、用弱断言换通过 | 保留明确要求 |
| 伴侣 App、曾拒绝的设计框架和工具选择 | 移出日常规则，用当前实现形态说明，原始取舍仍可追溯 |
| 页码、第三页等逐项禁令 | 用“两页、直接滑动、保持高度”说明当前交互 |
| 材质包不支持项的重复枚举 | 归已有兼容说明，不扩大兼容承诺 |
| 存储、恢复、计时、导入上限和界面尺寸 | 保留当前要求，主要改写句子 |

按内容和实际误操作风险取舍，没有按“不要”“不能”这些词机械删除。当前功能范围与历史一次性方案分别处理。

## 写作参考

这次额外查阅了 [blader/humanizer](https://github.com/blader/humanizer/blob/main/SKILL.md) 和 [syw2039/humanizer-zh](https://github.com/syw2039/humanizer-zh/blob/main/SKILL.md)。参考的是减少重复解释、空泛动词和机械排比，同时保留事实及文体。没有安装或调用这些 skill，也没有采用检测器评分、强制词汇黑名单或故意写错的办法。

[Google 技术文档语气指南](https://developers.google.com/style/tone)和其 [Markdown 指南](https://github.com/google/styleguide/blob/gh-pages/docguide/style.md)帮助确定了语气：直接、易读，技术资料保持准确，表格只用于确实需要比较的内容。[Codex 官方 AGENTS 文档](https://learn.chatgpt.com/docs/agent-configuration/agents-md)用于核对规则入口；本稿不修改 config 或全局指令。

这些是编辑参考，不是新执行规则，也不声称能识别或绕过 AI 检测。

## 完整文件

相对引用按将来的目标目录解释。以下 `.proposed.md` 和 `.template.md` 文件只是审查副本。

| 将来位置 | 草案 |
| --- | --- |
| AGENTS.md | [工作约定](AGENTS.proposed.md) |
| BLOCKCOLC.md | [产品](BLOCKCOLC.proposed.md) |
| ARCHITECTURE.md | [架构](ARCHITECTURE.proposed.md) |
| DESIGN.md | [视觉与交互](DESIGN.proposed.md) |
| docs/TESTING.md | [验证与交付](TESTING.proposed.md) |
| docs/TODO.md | [当前任务](TODO.proposed.md) |
| 私有工作区 AGENTS.md | [私有规则](private-AGENTS.proposed.md) |
| docs/WORKSPACE-MAINTENANCE.md | [工作区维护](WORKSPACE-MAINTENANCE.proposed.md) |
| docs/versions/README.md | [版本索引](versions-README.proposed.md) |
| docs/assets/design-sources.md | [由 skill 迁出的来源记录](design-sources.proposed.md) |
| docs/templates/README.md | [模板用法与文件归属](templates-README.proposed.md) |
| docs/templates/version-development.md | [开发记录模板](version-development.template.md) |
| docs/templates/version-work-packet.md | [交付工作包模板](version-work-packet.template.md) |
| docs/templates/release-notes.md | [发布说明模板](release-notes.template.md) |
| docs/templates/research-note.md | [调研模板（按需）](research-note.template.md) |

## 批准后怎样应用

先保存原文件快照和旧 TODO，再逐个替换，移出 skill 注册目录。旧 TODO 另存为 `docs/TODO.history-2026-10-01.md`，原相对链接保持可用。版本、素材、协议和原始测试记录不随规则整理删除。

需同步更新 AGENTS、TESTING、DESIGN 和工作区维护中的现行 skill 引用。历史记录中的名称保留；新模板不再含“批量委派”。更新后复查引用及工作包工具兼容，不跑应用全量。

首稿提出的发布工具对齐仍待确认：现有工具要求标准包设备记录，尚未支持你已批准的同轮私人包验收路径。本稿保留你的交付约定，暂不修改工具；改造要单独验证，不以填写虚假记录解决。详细建议仍在 [首稿](../REVIEW.md)。

## 本轮检查

- 文档结构和按目标目录解释的引用检查通过，包括新模板及来源记录。
- 交付模板用合成工作包调用现有需求表校验函数：待验证被拒绝，完成且有可定位证据被接受，缺证据和越界引用被拒绝；四项结果符合预期。这只验证模板读取，不代表应用测试、用户验收或发布工具改造完成。
- 17 个现行规范、模板、skill 支持文件、发布工具和版本输入的摘要均未变；主仓库跟踪文件无修改。skill 目前仍在原位，批准后再移出注册目录。
- 仅新增审查副本和本机合成检查文件，未跑应用全量、构建 APK、操作设备或推送。
- [检查记录](../../../../artifacts/rules-review-20261001/revision-2/verification.json)保存在本机 ignored artifacts。
