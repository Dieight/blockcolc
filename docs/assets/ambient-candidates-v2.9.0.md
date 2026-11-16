# v2.9.0 环境音候选与压缩稿

日期：2026-10-18；采用决定补于 10-19。用户选定完整时长，三份 full-96 稿已接入正式播放路由；最终包内身份另见交付记录。当前运行资产见[录音记录](ambient-audio.md)。短循环与高码率稿仅供实验保留。

| 编号 | 原名／作者 | 来源 | 许可 |
| --- | --- | --- | --- |
| 1 | Calm ocean waves／SamsterBirdies | [578524](https://freesound.org/people/SamsterBirdies/sounds/578524/) | CC0 1.0 |
| 2 | Gentle small waves lapping on shore.wav／Alex_hears_things | [352356](https://freesound.org/people/Alex_hears_things/sounds/352356/) | CC0 1.0 |
| 4 | WoodThrushinMorningShawneeForestMay272012.wav／kvgarlic | [156826](https://freesound.org/people/kvgarlic/sounds/156826/) | CC0 1.0 |

许可在各来源页复核；[CC0 说明](https://creativecommons.org/publicdomain/zero/1.0/)。未复制 Blanket 的程序或编辑后音频，不把其程序许可套到这些独立录音上。

原件由用户登录下载后提供，工作区只读归档到 `artifacts/sounds/v290-candidates/originals/`，下载处原文件不变。最终输入名为：

- `578524__samsterbirdies__calm-ocean-waves.flac`
- `352356__alex_hears_things__gentle-small-waves-lapping-on-shore.wav`
- `156826__kvgarlic__woodthrushinmorningshawneeforestmay272012.wav`

这些不是构建时的外部目录依赖；选定完整稿已复制为工作区的 `calm-ocean.ogg`、`shore-waves.ogg`、`forest-birds.ogg`。原生解码仅打开选中录音；不封装 74MB 原件、短循环实验稿或音频工具。

处理工具为 `spikes/world-closeup/prepare-audio-candidates.py`：

```powershell
python spikes/world-closeup/prepare-audio-candidates.py <新输出目录> --originals artifacts/sounds/v290-candidates/originals
```

工具读取不可变输入并核对完整时长、前后摘要；保留立体声，重采样到 48kHz。1／2 取原件 20—98 秒，4 取 8—101 秒，做 3 秒等功率交叠，成品分别 75／75／90 秒。只在峰值需要时衰减，不为放大底噪做激进响度提升。输出同一 PCM 母带的 FLAC 参考和 Opus 96／128 kbps 试听，另输出不裁切的完整 96 kbps 文件。

最终[报告](../../artifacts/experiments/v2.9.0/audio-originals-final/report.json)包含逐源 SHA-256、准确字节、时长、取段、增益、接点和输出摘要；[早期浏览器检查](../../artifacts/verification/v2.9.0/audio-originals-browser-final/report.json)验证 9 份实验解码、双声道、循环时长和互斥播放，不代替新增完整资产的 App 验证。主观音质与手机原生播放仍由测试包体验确认。

此前从公开 HQ MP3 预览生成的 `audio-candidates-first/`、`audio-candidates-final/` 都保留，不能当最终无损输入。第一轮预览处理遇到下载仍在写入，摘要检查抓到变化；最终稿统一使用完整原件。早期现有雨声的格式对照在 `audio-codecs-first/`，不冒充这三份候选。
