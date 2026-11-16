# v3.0.0 原生环境录音

原生预览沿用现行完整录音，不重新裁切、变速或合成。来源与处理记录仍由[环境录音素材](ambient-audio.md)维护；原文件和用户下载原件保留。

| 包内文件 | 作者与来源 | 用途 |
| --- | --- | --- |
| `forest-birds.ogg` | kvgarlic，[156826](https://freesound.org/people/kvgarlic/sounds/156826/) | 清晨林中鸟鸣，主音轨 |
| `shore-waves.ogg` | Alex_hears_things，[352356](https://freesound.org/people/Alex_hears_things/sounds/352356/) | 贴岸小浪，主音轨 |
| `rain-light.ogg` | barkenov，[640655](https://freesound.org/people/barkenov/sounds/640655/) | 细雨音层 |
| `rain-heavy.ogg` | barkenov，[255900](https://freesound.org/people/barkenov/sounds/255900/) | 大雨音层 |

四份录音沿用 CC0 1.0，完整声明从现行 `apps/web/public/licenses/ambient-audio.txt` 复制到原生 `licenses/ambient-audio.txt`。两个主音轨互斥；雨声按天气强度混合，可叠加主音轨。

`apps/native-android/tools/prepare-native-audio.mjs` 从工作区复制四份已压缩的完整录音和媒体通知图标，并生成逐项来源摘要。播放器沿用当前 Android Java 的解码、音频焦点、首尾淡化、随机留白及双雨声策略；原生宿主只适配包身份、状态回执和空服务退出，不引入 Capacitor。该构建入口不读取下载目录或工作区外的音频。

目前复用的播放源仍在旧 Android 目录中。正式切换时与其他平台代码一起归入共享源，更新构建引用；不在 P3 中改动现行正式 App。用户导入录音另存于本应用的私有目录，不复制进 APK、领域备份或私有同步。实际解码、系统文件入口、通知和恢复的验证记录写在 [P3](../versions/3.0.0-p3.md)，素材清单不代表这些流程已全部通过。

导入验证另有六份四秒样本，均由上述贴岸小浪派生，原始完整录音不变。PCM/WAV、MP3、AAC/M4A、FLAC、Vorbis/Ogg 和 Opus/Ogg 位于 `apps/native-android/app/src/androidTest/assets/p3-audio-formats/`，只进入仪器测试 APK；同目录清单保留源摘要、编码器版本和各文件摘要。它们用于元数据、解码、流式来源和失败恢复检查，不是新增内置白噪音。格式选择参考 [Android 媒体格式表](https://developer.android.com/media/platform/supported-formats)，实际设备覆盖以 P3 记录为准，不由该表推定所有编码参数均已验过。
