# Blockcolc 工作区与历史保全

主实体目录为 `C:\Codex\blockcolc`；`C:\Codex\tomato-clock` 保留为指向主目录的 junction。
它用于兼容已保存的项目、旧脚本和历史产物路径，不是第二份代码。
Git 主工作树与现有独立工作树须同时保持可访问，不凭名字归档有未提交改动的工作树。

## 分区

| 区域 | 内容和维护规则 |
|---|---|
| 根目录 / apps / packages / integration / tools | 当前产品规范、实现、配置和被调用工具 |
| docs/TODO.md | 唯一当前任务入口；关闭任务留历史，不从旧交接续跑 |
| docs/archive | 旧规范、版本工作包、交接及手动探针；原文不追改产品名称 |
| docs/assets | 批准来源、派生链、完整摘要；整理前检查消费者，不误删源图 |
| artifacts/release、verification、history_apk | 已交付 APK、版本/签名/摘要及正式证据，保留原路径和字节 |
| artifacts/test-gates | runner 的结构化报告，正式证据索引仍需可定位 |
| artifacts/archive | 本地旧截图、视频、性能轨迹和试验报告的压缩归档，不上传源码仓库 |
| litematic、resourcepacks_test、外部原始资源 | 用户输入及合法测试样本；不是可随手删除的构建缓存 |
| 私有工作区 | 私有集成、部署工具、配置与独立证据；不进入公开仓库 |

原有 `.git/info/exclude` 的本地边界保持不变：部分内部规范、资源、凭据及产物不受 Git 跟踪。
不能用强制添加或修改忽略规则把它们无意公开。

## 整理顺序

1. 核对当前任务、进程、消费者和正式证据引用，确定精确目标。
2. 活跃回归 spec、共享 fixture、正式门禁和通用工具继续保留；过时手动 probe 归档到 docs/archive。
3. 截图/视频/轨迹等放入本地 ZIP，逐文件核对条目数、长度与 SHA-256 后才移除散落原件。
4. 保存原路径映射、归档摘要与保护项校验；正式 APK、发行证据、原始用户资源和密钥不随归档移动。
5. 输出清理结果与恢复方法；不把整理当成发布、安装或下一版开发授权。

2026-09-27 本轮清单在 `artifacts/archive/2026-09-27/cleanup-manifest.json`；
混合 APK 目录只归档旧截图/轨迹，补充清单为同目录 `mixed-screens-manifest.json`，APK 和安装证据原地保留。
旧 JPEG 与 trace 解包产物另见 `legacy-jpeg-and-trace.manifest.json`；三个 ZIP 合计保全 3,787 个文件，均逐条验证后才移除原件。
ZIP 内条目使用原仓库相对路径，恢复时解压到一个新的临时目录，再按清单挑选复制，避免覆盖当前实现。
规范归档见 [2.0.0 历史索引](archive/v2.0.0/README.md)；工具验收见[本轮工作包](maintenance/2026-09-27-workflow.md)。

## 名称兼容

现行产品和 npm scope 使用 Blockcolc / `@blockcolc/*`，专属 skill 使用 `blockcolc-product-design`。
发行过的备份格式、IndexedDB 库名、Android 包名/签名不做文字替换；变更这些标识需要显式迁移与旧数据恢复测试。
历史证据中的旧目录和旧称保留；旧 skill 原文只在 `.agents/skill-archives` 留存，不再注册为当前 skill。
