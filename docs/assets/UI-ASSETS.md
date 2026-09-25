# 方块钟 UI 视觉资产清单（V27 UI-27-07）

> 维护人：UI agent；建立于 2026-09-05，A1 返修轮更新。
> 规则：文件型资产跨目录复制必须比对 SHA-256；程序/包提供的图标按真实来源版本记录，不为每个调用点伪造独立母版；只有确认无引用的重复资产才删除（删除属集成/核心权限，UI 轮只列建议）。
> **完整摘要**：正文中截断的哈希仅用于人读对照；机器可读的完整 SHA-256 清单在 [`ui-assets-manifest.json`](./ui-assets-manifest.json)（A1-07），交接比较以该文件为准。
> **引用链核对（A1-07）**：`mipmap-anydpi-v26/ic_launcher.xml` → background `@color/ic_launcher_background` + foreground `@mipmap/ic_launcher_foreground`（PNG 密度集）；通知图标引用点唯一（`BreakLiveUpdatePlugin.java:124`）。

## 1. 启动图标（App icon）

| 项 | 值 |
| --- | --- |
| 稳定标识 | `blockcolc-icon-source` |
| 用途 | Android 自适应启动图标 + PWA 图标的唯一母版 |
| 母版 | `apps/android/icon-source/blockcolc-icon-source.png`（SHA-256 `F6FB34816E1040B9…`） |
| 生成方式 | `tools/build-adaptive-icon-source.py`（仓库现行事实，不从截图临摹） |
| 派生物 | `apps/android/android/app/src/main/res/mipmap-*/ic_launcher*.png`（如 `mipmap-xxxhdpi/ic_launcher_foreground.png` `4A35BBFFCB873B05…`）、`res/drawable-v24/ic_launcher_foreground.xml`、`res/drawable/ic_launcher_background.xml`、`res/values/ic_launcher_background.xml` |
| 安全区 | 自适应图标内容按 Android 安全区（前景 66/108）留白，由生成脚本保证 |
| 回退 | `mipmap-anydpi-v26/ic_launcher.xml` 引用前景/背景 drawable；旧设备回退 mipmap 位图 |
| 本轮变更 | 无（保留已通过真机验证的母版） |

## 2. PWA / Web 图标

| 项 | 值 |
| --- | --- |
| 稳定标识 | `blockcolc-192` / `blockcolc-512` |
| 源文件 | `apps/web/public/icons/blockcolc-192.png`（`EFC56C947919C04A…`）、`blockcolc-512.png`（`7CD6192A55D5F94B…`） |
| 派生关系 | 与启动图标同一母版体系（README 头像亦引用 512） |
| 使用位置 | `apps/web/index.html`（favicon、apple-touch-icon → 192）、`public/manifest.webmanifest`（192/512，`purpose: any maskable`） |
| 回退 | 无图标时浏览器通用图标；无其他重复资产 |

## 3. 通知单色图标

| 项 | 值 |
| --- | --- |
| 稳定标识 | `ic_stat_tomato_outline` |
| 用途 | 专注/休息系统通知小图标（纯白镂空番茄剪影；V26 经 OnePlus 真机验证，OxygenOS 显式要求不以应用图标替代） |
| 文件 | `apps/android/android/app/src/main/res/drawable/ic_stat_tomato_outline.xml`（vector XML，代码定义，无外部许可负担） |
| 引用 | `BreakLiveUpdatePlugin.java:124`（Live Update 流程唯一引用点） |
| **孤儿资产** | `res/drawable/ic_stat_blockcolc.xml` 全仓（Java/TS）已无任何引用，为 v1.11.0 换装前的旧图标。**建议集成阶段删除**；UI 轮不代删 |
| 回退 | 无 |

## 4. 启动画面（Splash）

| 项 | 值 |
| --- | --- |
| 稳定标识 | `splash` |
| 文件 | `res/drawable/splash.png` + `drawable-{land,port}-{m,h,xh,xxh,xxxh}dpi/splash.png`（基底 `drawable/splash.png` `5CF98B4451BD99B2…`） |
| 来源 | Capacitor Splash Screen 插件约定目录；生成来源未在仓库内记录——**待核心/集成确认是否由图标母版派生**，确认前不声称派生关系 |
| 使用位置 | Android 启动画面（`activity_main.xml` / Capacitor splash 配置） |
| 本轮变更 | 无 |

## 5. UI 界面图标

| 项 | 值 |
| --- | --- |
| 稳定标识 | `lucide-react` 图标体系 |
| 来源 | npm 包 `lucide-react@^0.468.0`（ISC 许可，来源随依赖锁定文件审计，V26 工作包已含第三方候选审计惯例） |
| 规范 | 线宽/配色跟随 `currentColor` 与 token（`--focus`/`--ink`/`--muted`）；尺寸按用途：行内 16px（`settings-text-action svg`）、按钮 18px（`project-switcher-actions svg`、choice-menu 18px）、导航 21px（`bottom-nav svg`）、警示 17px（integrity warning）；触控命中区永远落在 ≥44px 的按钮/label 上，图标本身不承载命中区 |
| 使用位置 | 全部 React 界面（App/TaskManagement/StatsScreen/SettingsScreen/面板组件） |
| 回退 | 无位图回退；图标缺失即组件缺失，随构建失败暴露 |
| 禁止 | 在同一功能内混用 emoji/占位符/其他图标风格（交接 §UI-27-07） |

## 6. 世界内容（体素材质与蓝图）

| 项 | 值 |
| --- | --- |
| 稳定标识 | 内置蓝图目录 `BUILTIN_BLUEPRINT_CATALOG` |
| 来源 | `packages/voxel/src/blueprint.ts` 代码定义（原创，随源码许可） |
| 资源包 | 用户本地导入（`.zip`），不在仓库分发；兼容范围见 `MINECRAFT-VISUAL-COMPATIBILITY.md`；不兼容内容原创回退（`packages/voxel/src/fallback-visual.ts`） |
| 体素材质生成 | 程序化（`resource-textures.ts` 等），无文件型资产 |
| 本轮变更 | 无（替换/扩展属核心渲染工作包） |

## 7. 变更说明（提交给核心/集成）

1. 删除孤儿 `res/drawable/ic_stat_blockcolc.xml`（无引用，见 §3）。
2. 确认 `splash.png` 的生成来源（是否应纳入 `build-adaptive-icon-source.py` 输出）并补记到本清单 §4。
3. 无其他资产替换需求；启动图标母版与通知番茄保持已验收状态。
