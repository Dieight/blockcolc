# v3.0.0 原生界面资源

原生迁移沿用已经采用的字形、品牌图案和英文词条，不另做图标或字体方案。它们已进入独立预览工程，完整页面和视觉验收仍在 [P3 工作包](../versions/3.0.0-p3.md)推进。

## 像素字体

- 来源仍为[现行字体记录](pixel-font-v2.5.6.md)中的 Fusion Pixel 12px 简体版本，原始 WOFF2 不变，SHA-256 为 `0ebd99e6f1e9b650a793a3f759c1c3dfa99f0c5b6502e78569b48ddb43767e40`。
- Android 使用 `apps/native-android/app/src/main/res/font/fusion_pixel_12px_zh_hans.otf`，SHA-256 为 `bdd90a3c8d1d3c16bf32648a82ecd02edea500017ceb4190da5bcd708d06e4b4`。
- `apps/native-android/tools/prepare-native-font.py --write` 仅转换容器，保留原有时间、名称和字形。不带参数时只验证：36,436 个字形的顺序、字符映射、轮廓、度量、名称及头部信息一致；不裁字，不另给英文合成细体或粗体。
- 四份完整许可保存在原生 `app/src/main/assets/licenses/fusion-pixel/`，与 Web 中的原件逐字节核对。原 OTF／WOFF2 名称和版权声明保留。

## 图标和文字

`apps/native-android/tools/export-native-ui-assets.mjs` 从当前 `PixelIcon.tsx` 提取 25 款 12 格字形；品牌使用同一个 `PixelBrand` 的 10 个路径，生成原生 VectorDrawable，不另画近似图。共用词条来自 `messages-en.ts`，目前为 1,368 条。生成物记录来源和依赖摘要，测试核对当前源文件。

用户写入的任务名、便签及导入元数据不作为翻译键。字形和词条由后台执行器在界面就绪前载入；绘制和切换语言不重新读文件。原生浅深主题沿用现行语义色，像素／系统字体共用字号角色。

二进制一致性和编译检查不能代替手机上的字重、可读性、布局和 IME 验收；这些结果分别记在 P3 工作包，不把资源转换算作完整 UI 已迁移。
