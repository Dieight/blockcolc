# blockcolc 工作区维护

主目录为 `C:/Codex/blockcolc`；`C:/Codex/tomato-clock` 是兼容旧路径的 junction，指向同一份代码。历史工作树统一放在 `C:/Codex/blockcolc-worktrees/`，私有模块独立留在 `C:/Codex/blockcolc-relay-private/`。已有独立工作树继续保留，整理前检查未提交改动。

仓库中的 `artifacts/` 由 junction 指向 `D:/blockcolc-android/workspace-artifacts/blockcolc`，原引用照常使用。根 `node_modules/` 同样在 D 盘；其工作区包链接仍指向 C 盘的当前源码。归档时遇到 junction，当作链接单独处理，不能跟进去搬动目标目录。

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
| artifacts/reviews/YYYY-MM | 近期审计、界面原型和迭代测试原始证据 |
| artifacts/archive/codex-20261014 | Codex 外层归拢的旧发布、设备记录、材质参考、历史文档、停用 skill 和工具 |
| 用户素材目录和外部输入目录 | 原始蓝图、资源包及合法测试样本 |
| 私有工作区 | 私有实现、配置、部署工具和证据 |
| `D:/blockcolc-android/` | 迁移验证用 Android SDK 镜像、AVD 数据、下载与临时文件；Gradle 构建继续使用原 C 盘 SDK |

按现有 Git 忽略边界维护。公开前检查将提交的文件，内部规范、凭据、用户素材和产物不强制加入源码仓库。

模拟器镜像与可写磁盘留在 D 盘。Android Studio 默认 AVD 目录只保留指向 D 盘的登记文件；关闭自动快照，按需要保留一台运行实例。清理前先核对 emulator／qemu 进程及数据用途，不删除正在运行的虚拟磁盘。

## 整理与恢复

先确认精确目标、使用者和证据引用。仍在使用的 spec、fixture 和工具保留；过时手动 probe 放入 `docs/archive`。

截图、视频和轨迹可压成 ZIP，保存原路径映射，逐条核对数量、长度与 SHA-256 后再移除散落文件。报告写清归档位置和恢复方法。历史 APK、正式证据和用户原件默认保持原地；用户明确要求分类整理时可迁移实体，核对原字节并保留需要的旧路径入口。私有实现、配置和密钥仍只进入私有工作区。

恢复时先解压到临时目录，再按清单挑选需要的文件，避免覆盖当前改动。

实验过程 APK 只保留到该轮采样、报告回收和设备恢复核对结束；之后删掉同一包的过程副本和硬链接，保留源码快照、构建参数、摘要、原始输入和报告。需要重跑时按原快照重新构建，另记新产物摘要。已交付测试包、正式版本及仍用于恢复设备的原包单独保留。运行中的包用 `apps/native-android/tools/Save-ExperimentApk.ps1` 固定字节，不与 Gradle 输出建立硬链接。

2026-09-27 归档清单位于 `artifacts/archive/2026-09-27/`，包括 `cleanup-manifest.json`、`mixed-screens-manifest.json` 和 `legacy-jpeg-and-trace.manifest.json`。相关记录见 [维护记录](maintenance/2026-09-27-workflow.md)和 [v2.0.0 归档](archive/v2.0.0/README.md)。

2026-10-14 整理结果见 [本轮维护记录](maintenance/2026-10-14-workspace.md)。迁移清单、脏工作树 diff 和逐文件摘要位于 `artifacts/maintenance/2026-10-14/`；近期证据的旧路径保留 junction，历史引用仍可访问。旧工作树用 Git 正规迁移，当前路径以 `git worktree list` 为准。

2026-11-01 迁移实验清理释放约 21.1 GiB，历史包去重和原文件复核见 [维护记录](maintenance/2026-11-01-experiment-cleanup.md)。

2026-11-16 阶段提交、D 盘归档和过程 APK 清理见 [本轮记录](maintenance/2026-11-16-workspace-checkpoint.md)。

## 名称与旧文件

现行名称为 blockcolc，npm scope 为 `@blockcolc/*`。已发行的备份格式、数据库名、Android 包名和签名保留；确需修改时做迁移与旧数据恢复测试。

停用的项目 skill 归入 `artifacts/archive/codex-20261014/retired-skills/`，原 `C:/Codex/.agents/skill-archives/` 只保留兼容入口，不放回可发现的 skills 目录。共享的活跃设计 skill 不随项目归档移动。历史文档的名称和记录保留原样；日常工作从 AGENTS 和当前任务入口开始。
