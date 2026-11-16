# v3.0.0 原生世界素材

原生迁移沿用当前原创视觉，不把 MC 客户端 JAR、用户下载的材质包或导入蓝图封入通用运行资源。包内蓝图和来源仍见既有素材记录；迁移验收见 [P3 工作包](../versions/3.0.0-p3.md)。

## 原创像素与模型

- `apps/native-android/tools/export-original-materials.mjs` 在构建时读取现行 `original-materials.ts` 和 `fallback-visual.ts`，导出颜色／响应元数据与 24 份原创 RGBA 纹理。文件以内容摘要命名，记录源代码摘要；原生读取器核验大小和内容，只在需要时加载像素。导出器及 JS 运行时不打入资源目录。
- 原创非立方体的注册 ID 由构建提取，状态、组件盒面及朝向在 Kotlin 中计算，不封装 TS 逐状态输出。花草、小麦、细节模型和连片玻璃沿用本项目已采用的原创几何／像素规则；细节像素随原始状态在原生生成。
- 测试导出的模型、样式和上传摘要只进入测试资源。它们用于比较两种实现，不作为运行时模型，也不代表外部资源包或世界画面已经验收。

## Three.js 派生代码

原生的单段立方体面排列、UV、花草非索引法线及平面上传属性构造改写自当前项目使用的 Three.js，对应 `CuboidGeometry`、`OriginalFlowers` 和 `NativePlanarGeometry` 的相关方法。`NativePrecipitationGeometry` 的四边雨滴采用 `CylinderGeometry` 的封顶、法线和 UV 排列，雪花沿用同一立方体来源；`NativeSkyGeometry` 的球面及天体平面分别改写当前的 `SphereGeometry` 和 `PlaneGeometry`。保留原属性排列与 Float32 舍入点，不复制整套 Three.js 运行时。

许可为 MIT，版权为 `Copyright © 2010-2025 three.js authors`。完整声明随 `world-core/src/main/resources/licenses/three-mit.txt` 打包；后续原生关于页的完整许可入口按同一记录接入，不用一条模糊的技术栈链接代替声明。文件内容来源为当前依赖的 `node_modules/three/LICENSE`。

## SunCalc 天文计算

`NativeEphemeris` 改写当前依赖 SunCalc 2.x 的太阳／月亮位置及月相照明计算，保留 TT／UT、折射和月球视差的原有约定。`export-native-environment.mjs` 只把 Meeus 的两组固定系数导出到 `native-ephemeris-series.json`，记录当前 `node_modules/suncalc/index.js` 摘要；不是按日期或坐标穷举的结果表。Kotlin 运行时计算任意合法输入，源函数的对照结果仅进入测试资源。

许可为 BSD-2-Clause，版权为 `Copyright (c) 2026, Volodymyr Agafonkin`。构建将当前依赖的完整 `LICENSE` 原文复制为 `licenses/suncalc-bsd.txt`，与核心资源一起打包；关于页的完整声明入口仍须接入。原件位于 `node_modules/suncalc/LICENSE`。
