<p align="center">
  <img src="apps/web/public/icons/blockcolc-512.png" width="128" height="128" alt="方块钟图标">
</p>

# 方块钟 / Blockcolc

Blockcolc 是本地优先的专注计时应用。把真实投入转化为方块建筑：
普通大型任务由小任务自报进度推进，习惯任务由有效专注轮次推进。

## 主要能力

- 普通、习惯、固定轮次、马拉松和极简专注，共用时间真相与沉浸表面。
- 多任务切换、每日目标、可选自动连续专注、离开保护和系统通知。
- 今日时间轴、热力图、任务投入、纪念建筑、小任务分布和本地成就。
- JSON 备份/恢复与原子回滚；中断前已投入的时间如实统计。
- Litematic 蓝图导入、真实预览及本地保存；Java 26.3 资源包的模型/纹理、
  染色、动画与受限特殊方块静态显示，不支持内容明确回退。
- 自然山谷、经典空岛、海洋小岛，昼夜光照、天气及环境装饰。
- 默认本地天气；可选现实天气，失败仍保持离线核心可用。

核心不要求账号或服务器。Android 是主要发布平台，Web 共用 React 界面与业务逻辑。
标准版不含私人同步上传模块；私人集成构筑不属于公开下载内容。

## 安装与运行

Android 安装包见 [Releases](https://github.com/Dieight/blockcolc/releases)。
本地需要 Node.js 20.19 或更高，Android 工具链使用 JDK 21 与 Android SDK。

```powershell
npm install
npm run dev -w @blockcolc/web
```

Web 构建：`npm run build -w @blockcolc/web`。
Android 本地调试：`npm run android:sync -w @blockcolc/android`，
然后 `npm run android:assemble -w @blockcolc/android`。
测试与签名交付使用 [验证策略](docs/TESTING.md)，不要把 debug 包当正式候选。

## 数据与版权

本地任务与资源默认保存在本机。标准版不上传任务或统计；
用户显式开启现实天气时按设置请求位置与天气，不上传任务内容。
用户导入资源在本机校验，受限方块实体只恢复已支持的静态信息，不模拟完整 Minecraft 游戏。

Minecraft 是 Mojang Studios 的商标。本项目与 Mojang Studios 或 Microsoft 无关联，
不附带未经授权的原版纹理、字体、声音或模型。
已发行备份格式与数据库名保留兼容，不因项目改名重置用户数据。

## 技术与来源

项目源码采用 [Apache-2.0](LICENSE)。主要依赖和用途如下；各依赖仍按各自许可使用。

| 技术 | 用途 | 上游 |
| --- | --- | --- |
| TypeScript、React | 共享业务与 Android/Web 界面 | [TypeScript](https://github.com/microsoft/TypeScript)、[React](https://github.com/facebook/react) |
| Three.js / WebGL | 方块世界、实例绘制、光照和天气 | [Three.js](https://github.com/mrdoob/three.js) |
| Capacitor、Kotlin | Android 宿主、通知、生命周期、定位和文件桥接 | [Capacitor](https://github.com/ionic-team/capacitor)、[Kotlin](https://github.com/JetBrains/kotlin) |
| IndexedDB | 本地任务、资源和恢复快照 | [MDN 文档](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) |
| SunCalc 2.0.2 | 太阳/月亮位置、月相与亮边角度计算 | [SunCalc](https://github.com/mourner/suncalc)、[BSD-2-Clause 许可](apps/web/public/licenses/suncalc.txt) |
| fflate | 本地 ZIP/GZIP 解压，用于资源包和 Litematic | [fflate](https://github.com/101arrowz/fflate) |
| Lucide | 界面图标 | [Lucide](https://github.com/lucide-icons/lucide) |
| Vite、Vitest、Playwright | 构建、单元测试和浏览器交互验证 | [Vite](https://github.com/vitejs/vite)、[Vitest](https://github.com/vitest-dev/vitest)、[Playwright](https://github.com/microsoft/playwright) |

现实天气使用 [和风天气 API](https://dev.qweather.com/docs/)，由用户选择开启，离线时回退本地天气。
世界生成和装饰布局由项目实现，参考 Minecraft 的方块形态与环境构成；
不是 Minecraft 世界生成器，也不随包分发其原版资源。用户导入的材质包与蓝图按原作者许可使用。
视觉参考见 [设计来源](docs/assets/design-sources.md)；补充蓝图见[来源与稳定 ID](docs/assets/local-blueprints.md)。
SunCalc 的版权声明和完整许可随应用保留，可在关于页单独查看；它不是 Blockcolc 的项目许可。

## 工程入口

- [当前产品规则](BLOCKCOLC.md)
- [当前工作范围](docs/TODO.md)
- [架构](ARCHITECTURE.md)与[设计](DESIGN.md)
- [验证与交付](docs/TESTING.md)
- [工作区维护](docs/WORKSPACE-MAINTENANCE.md)
- [版本记录](docs/versions/README.md)

部分内部规范按既有本机 Git 排除策略维护；源码获取者如未携带本地规范，
以随源码提供的 AGENTS、产品文件、测试工具与版本文档为准。
