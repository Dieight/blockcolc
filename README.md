<p align="center">
  <img src="apps/web/public/icons/blockcolc-512.png" width="128" height="128" alt="方块钟图标">
</p>

# 方块钟 / Blockcolc

[简体中文](README.md) · [English](README.en.md)

Blockcolc 是本地优先的 Android 专注计时应用。普通任务按汇报的小任务进度建造，习惯任务按有效专注轮次建造。3.0 起，计时、存储、界面和世界渲染都在原生 Android 应用内运行。

## 主要能力

- 固定轮次、按结束时间、极简时钟和沉浸专注。可开启自动接续、计划结束后加时、离开保护和系统提醒。
- 每日目标、专注热力图和任务投入。纪念建筑保留完成记录，成就可解锁书房陈设。
- 四种聚落、室内书房视角、动物、昼夜与天气。纸雕画质适合性能较低的设备。
- 建筑蓝图库汇集原生、奖励和导入内容，支持 `.litematic` 预览与导入。兼容 Minecraft Java 26.3 资源包的模型、纹理、染色和动画，部分方块实体支持静态显示。
- JSON 导入导出、每日合并备份和操作回滚。可开启账户，在设备间同步记录与偏好，使用云端备份或分享专注状态。
- 简体中文与 English，像素、系统和混合字体。可选便签、日期倒计时、自然录音与随天气播放的雨声。

## 安装与运行

从 [GitHub Releases](https://github.com/Dieight/blockcolc/releases) 下载 Android APK。现有用户可以先导出一份 JSON，再用同签名 APK 覆盖升级。想体验测试版，可以在「设置 → 高级与数据 → 加入 Beta 测试」开启测试版更新通道。

本地构建使用 Node.js 24、JDK 21、Android SDK 35 和 Filament 1.56.0 的 `matc`。

```powershell
npm ci
.\apps\android\android\gradlew.bat -p apps/native-android :app:assembleDebug '-PmatcPath=C:\dev\filament\bin\matc.exe'
```

原生模块、环境配置与离线验证见[原生工程说明](apps/native-android/README.md)。旧 Web 和 Android 工程保留作迁移对照及回退依据，当前 Android APK 由原生工程构建。

## 数据与版权

默认离线使用。登录后可同步任务、专注记录和可同步的设备偏好，导入的材质包和音频保存在本机。好友功能可以单独开启，并选择分享状态、任务、起止时间或每日投入。现实天气也需手动开启。 [云服务条款及隐私说明](services/cloud/policy/zh-CN.md)

用户导入的资源在本机校验。方块实体中受支持的信息用于静态展示。

Minecraft 是 Mojang Studios 的商标。本项目与 Mojang Studios 或 Microsoft 无关联，
不附带未经授权的原版纹理、字体、声音或模型。
已发行备份格式与数据库名保留兼容，不因项目改名重置用户数据。

## 技术与来源

项目源码采用 [Apache-2.0](LICENSE)。主要依赖和用途如下；各依赖仍按各自许可使用。

| 技术 | 用途 | 上游 |
| --- | --- | --- |
| Kotlin、Jetpack Compose | 原生界面、计时及 Android 系统集成 | [Kotlin](https://kotlinlang.org/) · [Compose](https://developer.android.com/compose) |
| Filament、OpenGL ES | 方块世界、阴影、透明材质和同帧液态玻璃 | [Filament](https://github.com/google/filament) |
| SQLite、Node.js | 本地记录与回滚，以及可选的账号、好友和云备份服务 | [SQLite](https://www.sqlite.org/) · [Node.js](https://nodejs.org/) |
| Fusion Pixel | 中英文像素字体 | [Fusion Pixel](https://github.com/TakWolf/fusion-pixel-font) |
| TypeScript、React、Three.js | 旧客户端、迁移对照及现有资源生成工具 | [TypeScript](https://github.com/microsoft/TypeScript) · [React](https://github.com/facebook/react) · [Three.js](https://github.com/mrdoob/three.js) |
| SunCalc 2.0.2 | 太阳/月亮位置、月相与亮边角度计算 | [SunCalc](https://github.com/mourner/suncalc)、[BSD-2-Clause 许可](apps/web/public/licenses/suncalc.txt) |
| lunar-typescript 1.8.6 | 离线农历节日日期换算 | [lunar-typescript](https://github.com/6tail/lunar-typescript)、[MIT 许可](apps/web/public/licenses/lunar-typescript/LICENSE.txt) |
| fflate | 本地 ZIP/GZIP 解压，用于资源包和 Litematic | [fflate](https://github.com/101arrowz/fflate) |
| Lucide | 界面图标 | [Lucide](https://github.com/lucide-icons/lucide) |
| Vite、Vitest、Playwright | 构建、单元测试和浏览器交互验证 | [Vite](https://github.com/vitejs/vite)、[Vitest](https://github.com/vitest-dev/vitest)、[Playwright](https://github.com/microsoft/playwright) |

现实天气使用 [和风天气 API](https://dev.qweather.com/docs/)，由用户选择开启，离线时回退本地天气。
世界生成和装饰布局由项目实现，参考 Minecraft 的方块形态与环境构成；
不是 Minecraft 世界生成器，也不随包分发其原版资源。用户导入的材质包与蓝图按原作者许可使用。
视觉参考见 [设计来源](docs/assets/design-sources.md)；补充蓝图见[来源与稳定 ID](docs/assets/local-blueprints.md)。
自然录音的处理方式和雨声许可见[音频来源](docs/assets/ambient-audio.md)。
SunCalc 的版权声明和完整许可随应用保留，可在关于页单独查看；它不是 Blockcolc 的项目许可。

## 工程入口

- [当前产品规则](BLOCKCOLC.md)
- [当前工作范围](docs/TODO.md)
- [验证与交付](docs/TESTING.md)
- [工作区维护](docs/WORKSPACE-MAINTENANCE.md)
- [版本记录](docs/versions/README.md)
