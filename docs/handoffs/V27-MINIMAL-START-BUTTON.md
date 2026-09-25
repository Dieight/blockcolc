# 极简开始按钮：已确认方案与最后收尾

2026-09-07，主目录当前代码2.0.0 / 32。用户已明确接受下述按钮方案，要求仅写入交接，由下一位AI实施。**本次没有修改按钮代码、没有构建或安装APK。**

## 0. 已实施（2026-09-07, 2.0.0/33）

已完成并验证，本文下述为当时的既定规格：

- tokens.css 新增 `--minimal-start-ink / --minimal-start-glass / --minimal-start-solid / --minimal-start-border`（浅：淡绿玻璃+深绿字 `#276749`；深：深绿玻璃+浅白绿字 `#7fd6a1`）。
- minimal-mode.css `.minimal-start` 改用局部绿材质；`[data-theme="dark"] .minimal-idle-actions .minimal-start{color:var(--minimal-start-ink)}` 覆盖 theme.css 的 `[data-theme=dark] .primary{color:#0c1410}` 压字问题；玻璃 alpha 随 `--glass-alpha-scale` 缩放、底层恒有 0.92 实底下限保证 ≥4.5:1；reduced-transparency 回退 `var(--minimal-start-solid)` 实底。
- 验证（`apps/web/tools/minimal-start-v32-probe.mjs` 全过）：浅/深文字绿系、48px/16px、blur、渐变+实底下限、对比度≥4.5:1、滑杆100%文字不变、200%字号不变、Tab 可达、reduced 规则存在。
- 未改布局/未加发光动画；领域/存储/计时/原生未动。

同期一并完成的收尾（2026-09-07）：极简休息页三行（`break-three-probe` 全过）、运行态面板高度占位、旧 ready 计划自动清理（仅 ready）、过去时刻落明天（minimal-focus prepare 传 day=undefined，单测更新）。


- 半透明的森林绿玻璃按钮，保留现有圆角矩形，不改为整行大按钮。
- 浅色：淡绿玻璃底＋深绿文字；深色：清晰可辨的深绿玻璃底＋浅白绿文字。
- 保留轻微边缘高光和背景模糊，不添加霓虹发光、呼吸/循环动画、多余图标或持续折射计算。
- 通透度继续跟随现有“液态玻璃”滑杆；只调材料，不降低文字opacity。底色透明度设可读性下限，100%端点也必须清楚可读。
- 保留当前按钮高度48px、圆角16px及自适应宽度；不要为了材料修改时钟、14px间距、三元素居中、面板尺寸或世界构图。
- 减少透明度/滤镜不支持时回退同主题的可读绿色实底，不回到低对比透明底。减少动态另行处理。
- 精确色值由实际背景对比度验证后确定，不把未经验证的hex当成验收结果。

## 2. 当前问题已定位

412×915实测按钮102×48。浅色接近白色普通按钮；深色文字计算值rgb(12,20,16)，在深绿底上几乎不可读。

- 展示：apps/web/src/ui/MinimalIdlePanel.tsx。
- 按钮规则：apps/web/src/styles/minimal-mode.css 的 .minimal-start，目前复用sheet材质。
- **深色文字被覆盖的具体来源**：apps/web/src/styles/theme.css 第20行 [data-theme="dark"] .primary { color:#0c1410 }，比单类 .minimal-start 优先级高。tokens.css中的dark focus-strong本身是浅绿，不能误以为只改这个变量就能解决。
- 全局玻璃scale：当前App.tsx约第521行的 --glass-alpha-scale / --glass-blur-scale，以及tokens.css材料。
- 参考截图：apps/web/artifacts/ui-finish-v32/button-light.png、button-dark.png。这是改前截图，不是方案效果图。

实施优先使用局部按钮语义token/主题规则，并验证最终级联。不要全局修改所有.primary文字、所有sheet或world材质来修一个按钮；不得追加版本号覆盖样式文件。没有必要改领域、存储、计时或原生代码。

## 3. 最小实施顺序

1. 在实际主树C:/Codex/tomato-clock检查最新diff，保留所有已有未提交改动。C:/Codex/blockcolc-ui-v27只有同步交接，不代表最新实现，禁止整树覆盖。
2. 局部完成浅深绿色材料及文字级联；保持位置、触控区域、双击返回、disabled和focus-visible行为。
3. 检查滑杆0/50/100%，浅深各自的明亮与夜间世界背景。文字至少4.5:1；不能只检测CSS字符串或单独算RGBA前景而忽略合成背景。通过保守底色下限保证移动背景下可读。
4. 五视口360×800、412×915、915×412、768×1024、1440×900；至少浅深关键截图，200%字号、键盘Tab/Enter、禁用、减少透明度与reduced-motion、真实触控命中区。不能让按钮变绿后又变小或移动时间组。
5. Web typecheck、Web单测、受影响极简入口/偏好保存失败/计划保存失败E2E；先用定向测试，不因一个按钮修改重复整套发布门禁。失败要有最终报告和exit。
6. 回写本文件、V27-UI-RESULTS及版本工作包：改了什么、截图、测试、未完成真机项。不要把文档确认方案当成已实现。
7. 若继续交付测试APK，按现有verification流程和授权，先确认是否需新版本码；不得覆盖历史产物、降级或清数据。正式发布仍需单独授权，每个APK边界比较SHA-256、包名、版本、签名。

## 4. 刚完成的接手复测，可作为改前基线

主树2.0.0/32：Web typecheck exit0，Web17文件117/117单测exit0。独立Vite42932源码E2E：focus-regressions、minimal-achievement-entry、settings-layout、switch-contracts、v21-marathon，mobile-chromium/1worker，**17 passed / 1既有skipped，2.5分钟，exit0**。原来留下的两条focus-regressions超时本次分别16.8秒与6.9秒通过，不据此改业务代码。

报告：apps/web/artifacts/ui-finish-v32/e2e-report.json；输出/trace同目录。不是production或完整发布门禁，也没有证明所有新休息/跨日/恢复分支。ADB最近检查为空，未构建/安装；测试端口收尾时停止，下次需自行启动。

## 5. 保留边界与另外的遗留

- 用户确认几条返修基本已实现，当前需要决策的最后一点就是此按钮；不要重新打开已撤销的键盘输入方案、添加运行态返回按钮或恢复旧空闲几何。最新UI实现采用结束时间步进器。
- 这次按钮交接不等于V27所有工程/真机/正式发布工作完成。全量队列仍见V27-REMAINING-HANDOFF.md；其旧DF-A2-01输入问题已被UI撤销键盘输入的新方案取代，不应要求恢复输入再修99:99。
- 接手检查发现但**尚未复现/判定**的非按钮风险：use-minimal-focus.ts按错误文案清计划再试可能缺严格的残留计划判断；结束时间UI移除日期选择后，核心仍传draft.day，需核对过去时刻落明天的实际行为。不要将本轮17条通过外推成这两项已验收，也不要顺手在按钮CSS补丁中重写它们。
- 伴侣与私人服务器仍是独立队列，不能因收尾UI按钮而发布私有源码、APK或部署未过门禁的服务。
