# v2.4.0 启动图标

2026-10-03 使用内置 `image_gen` 生成并按用户反馈修改，未使用 CLI 或外部图像服务。最终选择切面像素番茄钟：红色果皮完整包住浅色表盘，表盘略凹，保留原轮廓、侧视和叶柄。用户审看圆形、圆角方形和方形桌面裁切后确认「可以，继续全量和构建」。

批准母版：[blockcolc-pixel-tomato-approved-20261003.png](../../apps/android/icon-source/blockcolc-pixel-tomato-approved-20261003.png)。完整 SHA-256：`B29148C46FCC9FDB4E6CAE31981688AA4C37BF4B91BBB657A8DA9B4F844CF0E2`，639,483 字节。方向草案和上版批准母版均保留，状态见 [资产 manifest](ui-assets-manifest.json)。

Android 各密度与 PWA 图标共用这份母版。既有生成器只处理透明度、裁切和尺寸；半透明导出边缘不参与主体定位，不重绘图案。已审看 16–192px 缩略图和三种裁切，`check-ui-assets --check` 验证派生资源逐字节一致。复现命令见 [UI 资产](UI-ASSETS.md)。

## 最终修改提示词

输入是保留的切面方向草案；明确只改左侧材质和表盘深度，不再改形状。此前候选提示词与未采用图保留在 `artifacts/v2.4.0/20261003-blueprint50/`，不属于应用资源。

```text
Edit THIS ORIGINAL cutaway voxel tomato timer icon. User wants a very specific material/depth correction, NOT another silhouette redesign. PRESERVE the original outer silhouette, perspective, proportions, pixel blocks, green leaf crown, coral-red right and bottom shell, clock hand positions, and transparent background. CHANGE the LEFT EXTERIOR SIDE: the current white/blue-gray exposed left shell and protruding pale outer slabs must become coral-red TOMATO SKIN matching the right and bottom shell. Complete a continuous red outer skin around the entire ivory face, so the WHITE CLOCK IS WRAPPED IN RED TOMATO SKIN. The white clock face must be visibly RECESSED into the tomato, behind the front edge of the red rim: a shallow deliberate one-voxel-deep inset, with readable inner red side-wall shading and a clean pale dial surface. Keep the same overall cutaway shape and angled view; do not make it rounder, more square, wider, or front-facing. Exterior visible side surfaces are red, interior central dial is ivory, hands stay navy and unobstructed, leaves stay sage green. Color accents, broad block facets and existing style unchanged. Genuinely transparent background, clean alpha, no drop shadow, no stray particles. No text, numbers, tick marks, extra decoration, or mockup. One refined production icon.
```
