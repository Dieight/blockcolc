# Blockcolc 测试策略

> 最后更新：2026-08-31

目标是尽快回答“这次改动是否正确”，而不是在每次编辑后重放所有历史用户流程。测试选择以改动爆炸半径为准。

## 测试层级

| 层级 | 用途 | 默认命令 |
| --- | --- | --- |
| L0 定点 | 当前文件、包或单一行为 | 对应 workspace 的 Vitest，或指定 Playwright spec / `--grep` |
| L1 快速门禁 | 提交前的版本、类型和非穷举稳定单元测试 | `npm run test:fast` |
| L2 Web smoke | 核心创建、导航、计时恢复和当前 3D 环境 | `npm run test:web:smoke` |
| L3 稳定回归 | 所有长期产品契约，不含诊断探针 | `npm run test:e2e -w @tomato-clock/web` |
| L4 发布门禁 | 扩展单测、单 worker Web 回归及发布脚本内的存储、集成、Android 门禁 | `npm run test:unit:full`、`npm run test:web:release` 或发布准备脚本 |

## APK 两阶段流程

### 阶段 A：真机验证构筑

- 目标是尽快把当前改动交给用户验收。按改动爆炸半径运行定点单测、对应 E2E、必要的类型检查、Web 生产构建和 Android 受影响门禁，不重复完整历史回归。
- 允许使用正式签名生成可覆盖安装的 APK，但文件名、目录和证据必须明确标记 `verification`；它只是验收载体，不是正式发布候选，不能上传、打 tag 或直接改名发布。
- 验证证据至少记录当前工作树差异指纹、APK SHA-256、包名、版本、签名证书和安装设备上的 APK SHA-256。只要源码、依赖、构建配置或生成资产变化，旧验证结果即失效。
- 默认命令：先运行本轮列出的受影响测试，再运行 `powershell -ExecutionPolicy Bypass -File tools/Build-Verification-Apk.ps1`；需要覆盖正在使用的已授权真机时显式传入 `-AllowBusyDevice`。

### 阶段 B：正式发布准备

- 只在用户完成真机验收并明确确认可发布后进入。冻结并暂存验收通过的完整源码，运行 `tools/Prepare-Release.ps1` 的全量 L4 门禁，再从同一最终暂存树重新构建正式发布候选。
- 阶段 A 的增量结果不能抵扣阶段 B 的任何完整门禁，也不能把验证 APK 直接提升为发布候选。若正式候选与已验收验证 APK 的哈希不同，至少重新安装正式候选并完成发布前 smoke；若源码树不同，则必须重新走真机验收。
- 因此该拆分会缩短每轮“修改 → 上机”的反馈时间，同时把测试完整性保留在真正发布之前；代价是最终发布时仍必须等待一次完整门禁和正式候选构建。

## 按改动选择

- 纯 Domain/Application 改动：受影响包测试；提交前再跑 `test:fast`。
- 单个 UI 行为：相关 Web 单测加一个指定 spec；影响主流程时再跑 smoke。
- 计时、恢复、存储 schema 或跨项目状态：相关单测、对应 E2E、稳定回归。
- Three.js/地形/材质：Voxel 单测、对应渲染 spec；改变共享渲染管线时跑稳定回归。
- Android 原生桥接：相关 JVM 测试、Capacitor sync 和受影响真机流程。
- 真机验证 APK：受影响测试、必要构建门禁和签名/安装完整性；它不能作为发布候选。
- 正式发布候选：完整发布门禁，不能用 smoke 或验证 APK 结果代替。

## 增量验证与全量基线

- 最近一次全量门禁已经成功结束，并且后续改动范围清晰时，日常反馈轮可以只运行受影响测试与必要的类型/单元检查。
- 只改测试用例时，至少运行被修改的 spec 或测试文件；若改到测试收集、共享 fixture、runner 配置或发布脚本，还要运行受影响的上层套件。
- 只改边界清晰的小块产品代码时，运行直接单测、对应 E2E；若触及创建、计时、恢复、持久化或共享渲染管线，再补 Web smoke 或稳定回归。
- “受影响测试通过”只是增量检查点，不会覆盖最近一次全量结果，也不能生成新的正式发布证据。
- 全量门禁失败、被中断、没有最终进程退出码，或最终候选暂存树又发生变化时，都必须重新完整运行。测试日志只跑到某个计数不算通过。
- 正式签名的“发布候选”始终以最终暂存树执行一次完整发布准备脚本；正式签名的“真机验证 APK”仍只是增量验收载体，不能把上一棵树的全量结果拼接成新候选。

长时间全量运行的观察节奏：启动时确认一次，之后约每 10 分钟检查并汇报一次，结束时读取最终报告和退出码。除非进程需要输入、提前失败或出现明确异常，不按单条测试高频轮询或播报。

指定一个 Web spec：

```powershell
npm run test:e2e -w @tomato-clock/web -- tests/v24-ocean.spec.ts --project=mobile-chromium
```

按标题筛选：

```powershell
npm run test:e2e -w @tomato-clock/web -- --grep "marathon" --project=mobile-chromium
```

## 稳定回归与诊断测试

- 默认 `playwright.config.ts` 只收集长期产品回归。
- probe、diag、measure、voidscan 以及 `*.diagnostic.spec.ts` 由 `playwright.diagnostics.config.ts` 单独收集。
- Web 诊断命令：`npm run test:web:diagnostics`。
- Voxel 诊断命令：`npm run test:diagnostics -w @tomato-clock/voxel`。
- Voxel 的大规模地形/缝隙穷举使用 `*.extended.test.ts`，由 `npm run test:extended` 和发布准备脚本运行，不进入每次编辑的快速门禁。
- 只有 `expect(true)`、打印坐标、截图找洞或测量临时位置的测试不得进入默认单元测试或 E2E。
- 临时诊断在问题关闭后应删除；若仍有复用价值，使用 `.diagnostic` 命名并保留在手动套件。

## 版本化测试规则

现有 `v2-*` 到 `v24-*` 文件测试的是今天仍应成立的能力，并不会启动或构建旧版本应用。它们的版本号只是历史来源标签。

从下一项工作开始：

- 新测试以能力命名，例如 `marathon-settlement.spec.ts`，不再创建 `v25-*.spec.ts`。
- 修复 BUG 时优先把断言放入对应能力文件；不要为每个版本复制完整流程。
- 旧版本文件在相关能力再次修改时逐步改名或合并，不做一次性大规模重排。
- 已被产品决定明确取代的行为应删除旧断言，而不是同时保留新旧两套互斥预期。

## 防止文档数字漂移

测试总数通过 Playwright/Vitest 的 `--list` 或实际运行结果生成，不在架构和设计规范里手写长期累计数字。版本发布结果写入对应 `docs/versions/VNN.md` 或机器生成的发布证据。
