# blockcolc 工作区维护

主目录为 `C:/Codex/blockcolc`；`C:/Codex/tomato-clock` 是兼容旧路径的 junction，指向同一份代码。已有独立工作树继续保留，整理前检查未提交改动。

## 文件位置

| 位置 | 内容 |
| --- | --- |
| 根目录、apps、packages、integration、tools | 当前规范、实现、配置和工具 |
| docs/TODO.md | 当前任务入口 |
| docs/versions、docs/releases、docs/research | 版本记录、发布说明和调研 |
| docs/templates | 按阶段创建版本文档的模板 |
| docs/archive | 旧规范、交接和手动探针 |
| docs/assets | 素材与设计来源 |
| artifacts/release、verification、history_apk | APK 与交付证据，保持原路径和字节 |
| artifacts/test-gates | 测试原报告 |
| artifacts/archive | 旧截图、视频和轨迹的本地归档 |
| 用户素材目录和外部输入目录 | 原始蓝图、资源包及合法测试样本 |
| 私有工作区 | 私有实现、配置、部署工具和证据 |

按现有 Git 忽略边界维护。公开前检查将提交的文件，内部规范、凭据、用户素材和产物不强制加入源码仓库。

## 整理与恢复

先确认精确目标、使用者和证据引用。仍在使用的 spec、fixture 和工具保留；过时手动 probe 放入 `docs/archive`。

截图、视频和轨迹可压成 ZIP，保存原路径映射，逐条核对数量、长度与 SHA-256 后再移除散落文件。报告写清归档位置和恢复方法。历史 APK、正式证据、用户原件和密钥保持原地。

恢复时先解压到临时目录，再按清单挑选需要的文件，避免覆盖当前改动。

2026-09-27 归档清单位于 `artifacts/archive/2026-09-27/`，包括 `cleanup-manifest.json`、`mixed-screens-manifest.json` 和 `legacy-jpeg-and-trace.manifest.json`。相关记录见 [维护记录](maintenance/2026-09-27-workflow.md)和 [v2.0.0 归档](archive/v2.0.0/README.md)。

## 名称与旧文件

现行名称为 blockcolc，npm scope 为 `@blockcolc/*`。已发行的备份格式、数据库名、Android 包名和签名保留；确需修改时做迁移与旧数据恢复测试。

停用的项目 skill 放在 `C:/Codex/.agents/skill-archives/`，不留在可发现的 skills 目录。历史文档的名称和记录保留原样；日常工作从 AGENTS 和当前任务入口开始。
