# V27 真机反馈返修审计

## 最新复审 DF-A2（2026-09-07）：前五项主路径修复，仍需一项输入边界返修

当前源码2.0.0/29，实际主树未提交实现；没有修改UI生产文件。前DF-A1-01/02/04/05及03的清空问题已通过复测。整体结论仍为**需返修**，不是正式候选全部验收。

- Web typecheck exit0，Web118/118单测exit0，版本一致性2.0.0(29) exit0。
- 同一源码Vite42931，定向mobile/1worker：12 passed/1既有skipped，2.3分钟exit0；不是production/full release gate。
- 五视口×浅深92PASS/0FAIL；九文件审计前后hash相同，无pageerror。360/412×100%/200%根字号实际命中补测全部通过；360容器314px，七按钮均≥44px，无裁切。
- 普通/习惯两入口清空后都保持空串且禁用确认。空闲与运行计时锚点/操作带相同，横屏/桌面数字中心误差≤1px。已目检412浅色空闲及915深色运行截图。
- 主App SHA256：eda64ed82eeb499e019401b9f1e056188072e029ce12b25046cf03d143cb702c；Settings：118494be10aa4c2cff74ed24d762f38f1b14810fd38a46d30835ca914f5e905e。
- 证据目录 apps/web/artifacts/df-ui-audit-20260907-a2/：results.json、extras.json、range.json、e2e-report.json、截图/trace。脚本沿用前审计但输出独立新目录；旧结果未覆盖。
- 复查ADB为空；开关真机按压、真实长蓝图名、完整启动性能及发布门禁仍未复验。没有本轮APK安装或线上发布。

### DF-A2-01 / P2：超界输入显示值与实际排程分离

App.tsx两个计划单的commitRaw把上游HH:mm clamp为23/59，但本地rawHour/rawMinute仍显示99，inputsComplete只验证数字，确认按钮依旧enabled。真实浏览器普通与习惯两条入口均复现：填99:99 → 页面仍99:99 → 摘要“到23:59” → 确认可点。不是仅HTML min/max理论风险，range.json有实际输出。

UI修复：草稿允许空串/逐字编辑，但合法性必须包含小时0..23、分钟0..59及整数；非法期间禁用确认并给出对应可读错误，不静默把显示99转成23传给核心。不改变既有次日语义/排程算法。覆盖两入口空串、0/00、23:59、24/60/99、负数、小数、外部draft变化和重新打开；确认显示与真正提交一致。仅修UI调用边界，保留已通过的几何与关闭态修复。

全部V27及伴侣/部署剩余工作的接续顺序、所有权和门禁见 [V27-REMAINING-HANDOFF.md](V27-REMAINING-HANDOFF.md)。下方DF-A1保留为历史。

# 历史：DF-A1（2026-09-07）

结论：**需返修，不能作为正式候选验收通过**。本轮仅审计，不修改 UI 生产实现；之后继续隔离的私有伴侣/服务核心。UI 下一轮先处理下列五项，不直接接新网页任务。

## 审计对象与证据

实际返修位于 C:/Codex/tomato-clock 未提交源码，HEAD b46cba0；旧 UI worktree 仍为 45c0e9f，不能以它代表本轮交付。独立端口 42931，Vite 源码运行；不覆盖 UI 的 test-results/dist。关键九文件前后 SHA-256 一致，清单在 apps/web/artifacts/df-ui-audit-20260907/results.json。App.tsx = 6f8cbeccad626139d4d3e348cf5e0c00baf985e5793b2952a902fa23154bfbc7；SettingsScreen.tsx = e899c352b4ffdd22fdd001e77c583d5aa223addf82f3d31cf02e1db285c2d859。

- Web typecheck：失败，8 条 TS18047，tests/minimal-achievement-entry.spec.ts 的 63/65 行，idleBox 可能为 null。命令后续执行的单测成功不抵消这个失败。
- Web Vitest：17 文件，117/117，exit 0。
- 独立定向 E2E：settings-layout + minimal-achievement-entry + v21-marathon，mobile-chromium/1 worker，12 passed + 1 既有 skipped，1.9 分钟，exit 0。JSON 和 trace 写入本审计目录。不属于 production 或完整发布门禁。
- 独立五视口 × 浅深行为探针：62 PASS / 30 FAIL，exit 1；30 失败是关闭后数值行、马拉松清空、计时居中三项各十次重复，不是 30 个独立产品问题。无 pageerror。
- 360/412 × 100%/200% 字号补测见 extras.json。初次探针只看按钮矩形与视口，漏掉祖先裁切；补测祖先 clientWidth/scrollWidth 和 elementFromPoint 修正这个误判，以本报告为准。
- 已目检 412 浅色 idle/running、412 深色 settings-off、915 浅色 idle 截图。不是所有状态全量视觉验收。
- ADB 当前无设备；未构建、安装、发布或完成真机复验。

## 必须返修

| 编号 | 优先级 | 实际问题与证据 | 修改边界与验收 |
| --- | --- | --- | --- |
| DF-A1-01 | P1 | Web 类型检查被新增测试阻断。minimal-achievement-entry.spec.ts:63/65 使用可空 idleBox 而无窄化，8 个 TS18047。 | 显式验证 boundingBox 后再用，不能靠跳过 tsc/排除测试掩盖。独立 typecheck exit 0。 |
| DF-A1-02 | P2 | DF-UI-02 要求关闭完整性后隐藏两条数值行，但 SettingsScreen.tsx:176–178 又渲染两条 disabled 行。五视口浅深关闭后 visibleOff 均为 2；settings-off-412x915-dark.png。现有 settings-layout 测试改成验证 disabled，正好把需求偏差算成通过。 | 移除关闭态数值展示但保留已保存的值；测试断言隐藏/不存在，重开值保持；继续测保存失败与快速开关。 |
| DF-A1-03 | P2 | DF-UI-07 的普通/习惯马拉松输入不支持清空。App.tsx:1090–1092、1144–1146 在空值 onChange 直接 return，又以数字转回受控值；真实 fill('') 后仍为 18。极简调用方可清空，不代表两个入口均正确。 | 各调用方持有原始时/分草稿，只在提交/既有确认边界解析；保留空串、00、中间编辑、IME，避免逐键 clamp 改写。普通和习惯两个入口均需定向测试，不改排程算法。 |
| DF-A1-04 | P2 | DF-UI-06 仅横向居中，纵向与操作带几何不一致。412×915：idle clock y=644/h=64，running y=723/h=64，中心相差79px；操作带 idle y=602/h=313，running y=649/h=266。915×412 相同操作带下 clock 中心差51.5px。 | 使用同一计时锚点/预留槽与稳定操作带几何，再布置其余按钮；不能只给 idle 加 grid align-content:center。断言稳定后的实际视口中心与 panel 几何，包含竖/横/平板/桌面以及显隐退出按钮。 |
| DF-A1-05 | P2 | DF-UI-01 的 360px 七日不能完整单行显示。settings.css:75–77 容器 clientWidth=286、scrollWidth=320；七个44px按钮加间隙超出34px。“日” x=313..357，而祖先右边界323，中心实际点不到；100%/200%均复现。412px可完整展示。隐藏滚动条不是七项等宽填满。 | 调整该行外层/卡片/内距使360px有足够宽度，保持七项完整可见且44×44互不重叠；不要强制横滚代替既定360验收。极窄视口降级另标明，不把360视为超窄豁免。断言包含祖先裁切与真实命中。 |

## 可以保留，但不外推为全部通过

- 完整性阈值 15 在关闭/重开后保持。
- 极简退出初始 opacity=0 / pointer-events=none，键盘 focus + Enter 可返回完整模式。
- 极简时间单可清空，空草稿禁用提交；普通马拉松连续输入21可用，但不能替代清空/中间态测试。
- 极简运行时建筑进度行确实消失。
- 既有核心流程/减少透明度定向 E2E 通过。
- 冷启动样式已出现旧版起伏 keyframes；本轮未做完整启动性能/时序复验。
- 新开始按钮截图仍偏白，当前实现是共享 sheet 材料加主题色文字；请对照“有主题色液态玻璃”的原要求进行最终视觉复核，本报告不把这条主观差异另列阻断项。
- DF-UI-03 的真实 Android 按压/旋钮、DF-UI-04 的真实长蓝图名称多行垂直对齐、本轮未在真机确认，保持待验，不凭代码声明关闭。

## 下一轮交回

保持 UI 对 App.tsx、SettingsScreen、样式与展示组件的所有权，不覆盖新增 core focus-export 文件。补测试时以原需求为断言，不能把不符行为写成通过条件。交回实际源码目录、关键文件哈希、typecheck exit、定向测试最终 exit/report、五视口关键截图和未测项。旧测试/构筑不能代表新源码。本轮无可调用 UI task，因此仅同步文件交接，不声称已通知另一个任务。
