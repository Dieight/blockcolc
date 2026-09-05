# Android 恢复与 Live Update 验证矩阵

> 适用版本：V26 起
> 真相来源：领域层持久化的绝对 `endsAt`；通知与流体云只是系统呈现，不是计时真相。

本矩阵把自动化、ADB 可观察证据和 OnePlus 人工视觉确认分开。自动化通过不等于 OEM 流体云视觉通过；系统强制停止后通知被移除也不得记为应用缺陷或伪造成成功。

## 自动门禁

| 边界 | 自动检查 | 通过条件 |
| --- | --- | --- |
| 相同休息重复调度 | Capacitor 单测 + Android JVM 单测 | Web 进程内相同 key 不重复调度；进程重建后原生层从活动通知读取 key，不 `cancel/notify` |
| 休息计划变化 | Capacitor 单测 + JVM helper | 新 `endsAt`、轮次或下一任务产生不同 key，并更新 ID `42002` |
| 通知 ID 分离 | Capacitor 单测 | Live Update=`42002`，到点提醒=`42003`；相同 ID 不互相撤销 |
| 到点恢复 | Domain/Application 单测 | 前台 UI 不运行时仍以持久化 `endsAt` 完成或进入待汇报状态 |
| 跳过休息 | MainActivity/JVM + Web E2E | action 清除 `42002/42003`，前台收到一次 skip，计划进入 ready 或结束 |
| promotion 拒绝 | JVM/API 守卫 | 返回真实 `supported/allowed/promoted`，拒绝时保留普通持续通知 |
| 注意力回调合并 | Android JVM + Capacitor 单测 | 通知栏与 Home 往返在任意 pause/focus 顺序下各只发出一组 background/foreground；foreground 不覆盖 background 时间戳 |

## PJX110 真机矩阵

每一行都记录 APK SHA-256、设备序列号、Android 构建、开始/结束绝对时间、通知 ID、应用进程 PID（若存在）和结果。视觉项必须由用户确认。

| 场景 | 操作 | 业务预期 | 系统呈现预期 | 证据 |
| --- | --- | --- | --- | --- |
| 前台休息 | 完成多轮计划的非末轮 | 计划为 `break`，倒计时取自 `breakEndsAt` | Live Update 与到点 alarm 均存在 | UI + `dumpsys notification` |
| Home 后台 | 休息时按 Home，等待 5 秒后返回 | 剩余时间连续，不增加/丢失轮次 | 同一 `42002` 不闪退重发 | 录屏 + logcat `show skipped=same-break` |
| 锁屏 | 休息时锁屏再解锁 | `breakEndsAt` 不变 | 锁屏卡/流体云按系统能力显示 | 锁屏照片 + dumpsys |
| 息屏专注/休息 | 分别在普通专注、马拉松专注与休息中息屏 | `endsAt` 不变，后台无逐秒 Web 定时器 | ID `42002` 为 `PUBLIC` + `stopwatch` 且通知栏倒计时正确；PJX110 息屏层已确认读取新镂空番茄与专注/休息状态，但固定两行模板忽略 chronometer，不显示剩余时间 | 用户息屏照片 + dumpsys `vis=PUBLIC/category=stopwatch` |
| 通知栏停留 | 专注时下拉通知栏停留超过 3 秒再收起 | 只增加一次退出计数 | 不取消或重发 ID `42002` | UI 计数 + logcat `BlockcolcLifecycle` |
| Home 往返 | 专注时按 Home 停留超过 3 秒后返回 | 只增加一次退出计数 | ID `42002` 保持原记录 | UI 计数 + logcat `BlockcolcLifecycle` |
| 最近任务划走 | 休息时从最近任务划走 | 重开后按 `breakEndsAt` 恢复或结算 | 若 OEM 把划走实现为强制停止，系统可移除通知；不得承诺常驻 | 录屏 + `am force-stop`/进程证据 |
| 可恢复进程回收 | Home 后用系统回收 WebView/进程，再从桌面打开 | 状态从 IndexedDB 恢复；相同休息计划不闪烁 | 活动 `42002` 的 break key 命中并跳过重发 | logcat + UI |
| 通知点击 | 点击休息通知主体 | 打开现有任务，保持休息阶段 | 不产生第二条通知 | UI + dumpsys |
| 跳过休息 | 点击通知“跳过休息” | 打开应用并进入下一轮 ready，或末轮结束 | `42002/42003` 均清除 | UI + dumpsys |
| 到点 | 保持后台直到休息结束 | 重开后进入下一轮 ready；末轮则计划结束 | `42002` timeout，`42003` 到点提醒一次 | 时间戳 + dumpsys |
| promotion 关闭 | 系统设置关闭实时通知 | 业务行为完全相同 | 降级为普通持续通知，设置页显示真实受限状态 | 设置截图 + capability |
| 通知权限拒绝 | 关闭应用通知权限 | 业务行为完全相同 | 不显示通知；应用只提示 best-effort 受限 | 设置截图 + UI |

## ADB 取证命令

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb -s <serial> shell dumpsys notification --noredact | Select-String '42002|42003|com.blockcolc.app'
& $adb -s <serial> logcat -d -s BreakLiveUpdate:I BlockcolcLifecycle:I BlockcolcStartup:I BlockcolcRender:I '*:S'
& $adb -s <serial> shell dumpsys activity processes com.blockcolc.app
```

启动/内存对比统一在屏幕已解锁、应用可见且未清除应用数据的条件下运行；脚本会拒绝安全锁屏状态，避免把隐藏 WebGL 页面当成可比较的首帧：

```powershell
powershell -ExecutionPolicy Bypass -File tools/Measure-AndroidStartup.ps1 -Serial <serial> -Iterations 3
```

不要用 `pm clear`、卸载应用或清除 IndexedDB 来模拟进程回收；这些操作会删除用户真相，验证的是全新安装而不是恢复。
