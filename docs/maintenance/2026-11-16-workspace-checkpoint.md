# 2026-11-16 阶段提交与磁盘整理

当前工作留在本地 `codex/native-p4-checkpoint-20261116`。v2.9.0、原生 P3/P4 和验证源码提交为 `9539f24`，账户、云同步和好友转发服务提交为 `e55b881`。保留原 `main`、其他工作树和用户的 `liquid_glass/` 素材。

- 将 `C:/Codex/blockcolc/artifacts` 迁到 `D:/blockcolc-android/workspace-artifacts/blockcolc`，保留原入口。按长度和 SHA-256 核对 406,605 个文件，约 103.48 GiB（硬链接去重后）。根依赖也在 D 盘，复核 npm 工作区指向当前源码。
- 按用户要求清除 2,291 个过程 APK 路径，包含迁移模块实验、整机对照和已结束的诊断包；D 盘清理前后多出约 109.8 GiB。最初约 68.1 GiB 的实验目录中，约 50.6 GiB 是 APK，其他主要是快照、轨迹、截图和报告。保留已交付和正式 APK、恢复设备所需的原包、原始输入及验证证据。
- 第一次跨盘移动误跟进历史 npm junction。已从归档字节恢复 1,086 个文件，另与冻结清单核对，1,443 个源码输入完全相同；仅两份生成的测试状态文件未恢复。后续归档逐条处理链接和原文件，核对完成才移除原副本。

本机清单在 `D:/blockcolc-android/maintenance/20261116/`：`artifacts-archive-resumed-manifest.json` 记录归档和链接映射，`source-recovery-verification.json` 记录源码核对，`process-apk-cleanup-result.json` 记录删除范围和保留的恢复原包。复验时选定所需源码快照和原输入，按对应构建回执重建本轮的包，无需恢复整批 APK。整理期间没有操作手机或发布。
