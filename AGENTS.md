# AGENTS.md

本文件约束在本仓库内工作的所有 AI/编程代理。项目名：Blockcolc（方块钟），Node.js monorepo（npm workspaces），本地优先的专注计时 + 方块建造世界应用。

## 语言规则（最高优先级）

- 与用户（人类）的所有交流、工具调用的 `description`/注释、进度叙述、最终回答，一律使用**简体中文**。
- 代码、类名、变量名保持英文。
- Git 提交信息沿用仓库现有惯例：标题英文（如 `Release v1.3.2`），正文可用英文要点。
- GitHub Release 说明（`release-notes.md`）使用**简体中文**（可附简短英文摘要）；`CHANGELOG.md` 沿用英文。
- 调用 `gh` 指定提交时永远使用完整 SHA（`git rev-parse <ref>`），缩写 SHA 会被 API 以 422 拒绝。

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
- 每个版本必须在授权真机上完成人工验收（OnePlus PJX110 `a50247d1` 与小米 22011211C `8LN7KRR4UCV4S8OJ`，以当时接入的设备为准）；候选 APK 在每个边界（构建→拷贝→装机→GitHub 重下载）核对 SHA-256。
- **设备占用检查**：任何真机验收/发布脚本在启动应用前会检查前台应用，设备被占用时拒绝执行（发布脚本可用 `-AllowBusyDevice` 显式豁免）。手动验收连点前先跑 `.\tools\Precheck-Device.ps1`，横屏或前台是第三方应用时禁止 tap。
- 版本号提升与正式发布必须得到用户**明确授权**；日常开发不提升版本号。
- 发布流程：改 `version.json` → `node tools/sync-version.mjs --write` → 更新 `CHANGELOG.md` 与 `docs/versions/V*.md` → 全部 stage → `.\tools\Prepare-Release.ps1`（跑全部门禁并装机）→ 用户授权后 `.\tools\Publish-Release.ps1 -ConfirmPublish -ReleaseNotesPath <path>`（提交、打 tag、GitHub Release、重下载校验）。
- **CI 绿色门槛**：`Publish-Release.ps1` 默认要求发布前 HEAD 的 CI 运行已 success，并等待发布提交自己的 CI 运行结束并记入 evidence；红色分支禁止发布，确认为环境性偶发的失败须用 `-AllowRedCi` 豁免并记录原因。
- 发布后运行 `.\tools\Audit-Release.ps1` 做完整性审计（version.json ↔ git tag ↔ GitHub Release/Latest）；`Publish-Release.ps1` 已内置。
- Git push 直连 GitHub 偶发 SSL reset；本仓库已配置本地代理（`git config http.proxy http://127.0.0.1:7897`，https 同理），失效时用 `git -c http.proxy=... -c https.proxy=... push` 重试。

## CI 抖动处理手册

- GitHub runner 的 WebGL 是软件渲染，且镜像缺中文字体。渲染/布局用例在 CI 偶发失败时，按此顺序处理，**不要先改产品代码**：
  1. 看失败用例是否与字体度量相关（中文文本换行/溢出）→ CI 已装 `fonts-noto-cjk`，检查该步骤是否仍在；本地用 `run-web-e2e.mjs` 复跑（不要直接 `npx playwright`，会因未起 vite 得到 `ERR_CONNECTION_REFUSED` 假失败）。
  2. 时序敏感断言（假时钟快进后截图对比）→ 改为步进 + `expect.poll`，参照雨丝用例的修法。
  3. 本地两次全量 66/66 通过 + 真机通过 → 判定环境偶发，可 `-AllowRedCi` 发布并记录；CI 失败时 workflow 会保留 `test-results` 产物供下载诊断。
- 需要跳过用例时沿用 `v11` 手势用例的 `test.skip(Boolean(process.env.CI))` 惯例，并在注释说明真机/本地 GPU 覆盖。

## 视觉核验（信任阶梯）

1. **DOM 测量**（`getComputedStyle`/offset/滚动值）为权威；
2. **像素对比**：`.\tools\compare-shot.ps1 -A <a.png> -B <b.png>` 输出尺寸与平均通道差，判断"页面是否真的变了/变了多少"；
3. **视觉模型**（`D:\vision-desc.ps1`，DashScope qwen-vl-max）只做辅助描述，会胡编，不可单独采信。
- 截图前先确认设备前台应用与方向（`Precheck-Device.ps1`）；截图可转成 base64 SVG 放进 DSH Web GUI 的 `dist/shots/` 目录，通过 `/shots/<name>.svg` 给用户查看。
