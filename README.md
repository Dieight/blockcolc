<p align="center">
  <img src="apps/web/public/icons/blockcolc-512.png" width="128" height="128" alt="方块钟图标">
</p>

# 方块钟 / Blockcolc

方块钟是一款本地优先的专注计时应用。它把一个大型任务表现为一栋方块建筑：你手动拆分任务、完成专注轮次并汇报进度，建筑会随之逐步建成。

## 主要功能

- 以“专注 + 休息”为一轮，默认 45 分钟专注、5 分钟休息，时长和轮次数均可调整。
- 创建和切换多个大型任务，并将每个大型任务拆分为可执行的小任务。
- 每次专注结束后自行确认完成情况，进度会反映在对应建筑上。
- 支持每日目标、连续专注、建筑腐败与加速修复机制。
- 提供近 26 周有效专注分钟热力图、本周回顾，以及本地 JSON 备份与恢复；中断前已经投入的时间也会如实计入有效分钟。
- 可限制专注期间切出应用的次数，超过设定值时判定本次专注失败。
- 支持导入 Minecraft Java 版 `.litematic` 蓝图，并可选择作为主任务建筑或每日奖励装饰。
- 支持导入兼容的 Java 版资源包，在设备性能允许时显示方块材质、复杂几何、昼夜光照与阴影。

所有任务、计时和资源数据默认保存在本机。核心流程离线可用，不需要注册账号或连接服务器。

## 平台

- Android：主要发布平台，通过 Capacitor 容器运行。
- Web：共享同一套 React 界面与业务逻辑，可作为本地 Web 应用运行。

Android 安装包可从 [Releases](https://github.com/Dieight/blockcolc/releases) 下载。

## 本地运行

需要 Node.js 20.19 或更高版本。

```powershell
npm install
npm run dev -w @tomato-clock/web
```

构建 Web 应用：

```powershell
npm run build -w @tomato-clock/web
```

构建 Android debug APK 还需要 Android Studio、Android SDK 和 JDK 21：

```powershell
npm run android:sync -w @tomato-clock/android
npm run android:assemble -w @tomato-clock/android
```

## 数据与兼容性

方块钟不会上传用户任务、统计、蓝图或资源包。导入内容在浏览器或 Android WebView 内解析；不支持的方块会使用安全的替代外观，实体、方块实体和计划刻不会被重建。

Minecraft 是 Mojang Studios 的商标。本项目与 Mojang Studios 或 Microsoft 没有关联，也不附带 Minecraft 原版纹理或其他受版权保护的游戏资源。
