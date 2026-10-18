# 2026-10-14 工作区整理

本轮只整理 blockcolc 相关目录，未碰其他项目。整理阶段没有删除历史文件、清理用户数据或改写 APK；两个脏工作树均完整保留。

两个旧工作树地址也保留 junction，避免旧聊天、工具和历史引用失效；实体已统一放在 `blockcolc-worktrees`，不是留下第二份代码。

| 原位置 | 现位置 | 处理 |
| --- | --- | --- |
| `C:/Codex/blockcolc-ui-v27` | `C:/Codex/blockcolc-worktrees/ui-v27` | `git worktree move`；HEAD、未提交 diff、status 与未跟踪文件摘要一致 |
| `C:/Codex/blockcolc-performance-baseline-270` | `C:/Codex/blockcolc-worktrees/performance-baseline-270` | 同上；保留基线探针等已有改动 |
| `C:/Codex/artifacts/blockcolc-audit-20261013-8cb1fc1f` | `C:/Codex/blockcolc/artifacts/reviews/2026-10/audit-20261013-8cb1fc1f` | 逐文件数量、长度、SHA-256 一致；旧路径保留 junction |
| `C:/Codex/artifacts/blockcolc-fixes-ui-20261013` | `C:/Codex/blockcolc/artifacts/reviews/2026-10/fixes-ui-20261013` | 同上 |
| `C:/Codex/artifacts/blockcolc-ui-test-20261014` | `C:/Codex/blockcolc/artifacts/reviews/2026-10/ui85-20261014` | 同上；不更改 /85 报告或配对摘要 |

原始清单：[workspace-manifest.json](../../artifacts/maintenance/2026-10-14/workspace-manifest.json)。执行脚本及日志同目录；迁移后已核对 `git worktree list`。主仓库、私有工作区、发布/验证 APK、`history_apk`、`liquid_glass`、蓝图和录音原件均留原地。`C:/Codex/docs/tomato-clock/history/` 的早期产品文档作为原始历史继续保留，不参与当前产品要求。

恢复：旧路径通过 junction 已可直接访问，一般无需搬回。确需恢复实体位置时，先核对清单并确认没有运行进程，只移除相应 junction，再用 `git worktree move` 迁回；不要直接复制 `.git` 文件或递归处理链接目标。证据同样保留旧路径入口。

/85 UI 回退前的源码快照另存 `artifacts/verification/v2.8.0/before-ui-rollback-20261014/`。活动测试中只移除被明确撤销的 `ui-workspace85.spec.ts`，原件在该快照中；中文输入与保存测试移入当前 `v280-ui-and-ime.spec.ts`，不沿用旧布局断言。

## 追加：Codex 外层目录和散落文件

用户进一步要求整理 `C:/Codex` 下所有 blockcolc 相关目录与文件。除本轮前述工作树和近期证据，继续处理旧发布、设备记录、MC 参考、服务器部署包、早期文档、停用的项目 skill，以及六份历史 Git 配置。

结果：追加迁移 **27 项、126 个文件、682,096,341 字节**（约 650.5 MiB）。最终复核退出 0；全部原始 SHA-256、文件长度及兼容路径回读一致。应用目录的前后 diff 摘要一致，私有文件明细未进入主仓库清单，没有文件删除或任何构建/发布。

公共历史资料统一归入 `artifacts/archive/codex-20261014/`；服务器和配置统一归入私有工作区同名归档。完整分类入口见 [Codex 根目录导航](../../../BLOCKCOLC-WORKSPACE.md)。

| 类别 | 归档子目录 | 范围 |
| --- | --- | --- |
| 旧发布与说明 | `releases/v1.1.0`、`releases/v1.1.1` | 远端回读 APK、验证副本、散落 APK 和发布说明 |
| 设备记录 | `device/` | V12、v1.1.0、v1.1.1 与原创材质的截图及日志 |
| MC 材质调研 | `materials/minecraft-26.2/` | 原调研 JAR、审计脚本、版本信息和纹理参考 |
| 浏览器回归 | `reviews/` | 原外层 v2.6.0 雨雪密度检查 |
| 早期产品文档 | `documents/tomato-clock/` | through-v1.1.2 历史原文 |
| 停用专属 skill | `retired-skills/` | 2026-09-27、10-01 两次归档原件 |
| 旧工具和日志 | `tools/`、`logs/` | GitHub API 发布辅助脚本和 V12 Web 日志 |
| 私有服务器 | 私有归档 `server/` | 三轮门禁、部署镜像和构建上下文 |
| 停用临时 Git 配置 | 私有归档 `inactive-git-config/` | 六份根目录 `.gitconfig-*`；迁移前核对未被当前进程配置引用，未修改或应用全局配置 |

目录保留 junction，散落历史 APK 保留硬链接；没有活跃引用的旧说明、工具、日志和临时配置只留规范归档位置。所有迁移逐文件对比数量、长度和 SHA-256，并回读兼容入口；不删除重复 APK 或重复镜像。清单和执行日志位于 `artifacts/maintenance/2026-10-14/codex-scope-*`；私有文件的完整清单单独保存在私有工作区。

最终清单：[codex-scope-manifest.json](../../artifacts/maintenance/2026-10-14/codex-scope-manifest.json)，回读结果：[codex-scope-verify.log](../../artifacts/maintenance/2026-10-14/codex-scope-verify.log)。首次清单对单文件集合的计数和大小汇总不正确，已按完整文件清单重新计算，并再次核对所有归档及兼容入口；原清单以 `*-first-pass-manifest.json` 保留，原始文件摘要未变。

`artifacts/pelican-skyride`、共享活跃 skill、Codex 历史修复工具与备份、OpenCode 运行目录、其他项目与通用 Python 数据/测试目录未移动。现有应用源码、当前 APK、蓝图、录音、`liquid_glass` 和主私有模块路径不变，本次仅做文件整理，不跑应用测试、不出包。
