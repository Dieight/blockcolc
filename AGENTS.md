# AGENTS.md

本文件约束在本仓库内工作的所有 AI/编程代理。项目名：Blockcolc（方块钟），Node.js monorepo（npm workspaces），本地优先的专注计时 + 方块建造世界应用。

## 语言规则（最高优先级）

- 与用户（人类）的所有交流、工具调用的 `description`/注释、进度叙述、最终回答，一律使用**简体中文**。
- 代码、类名、变量名保持英文。
- Git 提交信息沿用仓库现有惯例：标题英文（如 `Release v1.3.2`），正文可用英文要点。

## 关键文档

- `DESIGN.md` / `PROJECT.md` / `ARCHITECTURE.md` / `TESTING.md`：分别为视觉契约、工作日志、工程契约、测试说明（前两者被 gitignore，仅本地）。
- `docs/versions/V*.md`：每个版本的工作包（需求 ID、状态、证据）。
- `docs/QA-BASELINES.md` / `docs/DECISIONS.md`：QA 基线与决策记录。
- `CHANGELOG.md`：用户可见的发布说明（发布时更新）。

## 代码约定

- UI 不引入组件库；权威状态在 `packages/application` 的 `ApplicationService`，UI 由 `service.snapshot()` + `version` 计数驱动。
- `apps/web/src/styles-overrides.css` 只允许追加 `/* V18 ... */` 这类版本块，不覆盖历史规则。
- `ApplicationService.snapshot()/activeProjectProjection()/worldProjection()` 是按状态 epoch 缓存的**共享只读副本**，禁止任何消费方修改返回值。
- 世界渲染器的初始化必须推迟到首次绘制之后（rAF + setTimeout），禁止在切页渲染阶段做深拷贝或重初始化。

## 验证与发布（skill gate）

- 每次改动：`npm run typecheck`、`npm test`、相关 E2E（`npm run test:e2e -w @tomato-clock/web -- --workers=1 <specs>`）。
- 每个版本必须在授权真机（OnePlus PJX110，adb 序列号 `a50247d1`）上完成人工验收；候选 APK 在每个边界（构建→拷贝→装机→GitHub 重下载）核对 SHA-256。
- 版本号提升与正式发布必须得到用户**明确授权**；日常开发不提升版本号。
- 发布流程：改 `version.json` → `node tools/sync-version.mjs --write` → 更新 `CHANGELOG.md` 与 `docs/versions/V*.md` → 全部 stage → `.\tools\Prepare-Release.ps1`（跑全部门禁并装机）→ 用户授权后 `.\tools\Publish-Release.ps1 -ConfirmPublish -ReleaseNotesPath <path>`（提交、打 tag、GitHub Release、重下载校验）。
- Git push 直连 GitHub 偶发 SSL reset；失败时用 `git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push` 重试。

## 视觉核验

- 本模型无法直接读图：真机截图用 `D:\vision-desc.ps1`（DashScope qwen-vl-max）辅助描述，但以 DOM 测量（`getComputedStyle`/offset）为权威，不盲信视觉模型。
- 截图可转成 base64 SVG 放进 DSH Web GUI 的 `dist/shots/` 目录，通过 `/shots/<name>.svg` 给用户查看。
