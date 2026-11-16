# 环境录音

更新于 2026-10-23。两通道使用同一组工作区资产。原始录音保留在 `artifacts/sounds/`，构建只使用 `apps/web/public/audio/`，不要求 Downloads 或音频处理工具存在。

| 成品 | 来源与处理 |
| --- | --- |
| 轻雨／大雨 / Light / heavy rain | barkenov 的 [Soft rain](https://freesound.org/people/barkenov/sounds/640655/)／[Hard rain](https://freesound.org/people/barkenov/sounds/255900/)，CC0；用户选定并提供完整 WAV，双层联动 |
| 贴岸小浪 / Gentle shore waves | Alex_hears_things，[352356](https://freesound.org/people/Alex_hears_things/sounds/352356/)，CC0；完整 WAV 原件转码 |
| 清晨林中鸟鸣 / Morning forest birds | kvgarlic，[156826](https://freesound.org/people/kvgarlic/sounds/156826/)，CC0；完整 WAV 原件转码 |

最初三份历史原录音 SHA-256（现用雨层另见下文）：

- 湖畔：`f1ddda55ae48056df3cc598480b7a75bc8f88629f9e8a0c7e75cf8ce9ba924fa`
- 鸟鸣：`fad300d9572129c0086ef549f2b47d7cdea0bb27fda5c2b15c79ede8c48d231f`
- 雨声：`31efcbe952a3989a9276774e2d7be61a2dc98fdd785a94d1435fc19cda9a84d1`

原有鸟鸣、雨声是 32 kHz 单声道 PCM16 WAV，文件接点交叠分别为 1.5 / 2.5 秒；历史工具为 `tools/prepare-ambient-recordings.py`，参数和低频衰减测量在 `artifacts/sounds/processed/processing-report.json`。原报告保留，不覆盖；旧工具改为输出到 `artifacts/sounds/legacy-processing/`，不再写运行目录或复活退役音频。当前四份均为完整立体声 Opus 96 kbps VBR；主录音原件、取舍及转码命令见[候选记录](ambient-candidates-v2.9.0.md)。

主录音的淡入淡出与每遍 12–30 秒随机留白由播放器处理，不裁切文件；雨声仍连续循环。Android 使用系统流式解码，Web 使用媒体元素，不同时预解码全部长录音。Android Opus／Ogg 支持见[平台格式表](https://developer.android.com/media/platform/supported-formats)，当前最低 API 23 高于其支持起点。

| 文件 | 时长 | SHA-256 |
| --- | ---: | --- |
| `rain-light.ogg` | 61.100 秒 | `02a5203cfe80d33a416de42cbc539efc34a9e1d42de63c5de04c60989c0beacb` |
| `rain-heavy.ogg` | 64.000 秒 | `3d2adb83a823843db29b604e363e9e87eabe77dff2c8ad0fabf1df3b2187457a` |
| `shore-waves.ogg` | 164.628 秒 | `ad54369a217a52b2cbe253b97947555835c8bf006ed65baf14301b9d43ca3b1d` |
| `forest-birds.ogg` | 132.481 秒 | `c63ca21a8022ba2562b2d7757674d08c94731a27ab361f49405905ad8538b816` |

表中是去除 Opus decoder pre-skip 后的内容时长；浏览器媒体元数据可能多报约 6.5ms，不能把它当作缺失或额外剪辑。

## 本轮雨声

两份原 WAV 保存在 `artifacts/sounds/rain-barkenov-20261023/`，下载处未改动：

- `640655__barkenov__soft-rain.wav`：16,168,120 字节，SHA-256 `f381f9062a747fc14dbb2c6441c7bac01ccaa5d33f72be11fde152a3b1cff35a`。
- `255900__barkenov__hard-rain.wav`：11,290,756 字节，SHA-256 `710dd124b452ba784e3eb586f430106e98447d70c3cfdf92c78cc9a38979a7c4`。

用户下载完成后再读取，未采用 `.crdownload` 或有损预览。原始响度差异较大，两遍 loudnorm 匹配到约 −22 LUFS、真实峰值上限 −2 dB，先做 50 Hz 高通；不剪辑、不降单声道，重采样 48 kHz，再用 libopus 96 kbps VBR。测量、实际参数和结果在同目录 `light/heavy-measure.log`、`light/heavy-encode.log`；原件摘要和时长可据此复算。完整成品共 1,447,206 字节，比旧雨声 PCM 少约 1.19 MiB。

雨强使用世界已有的 0—1 输入：小雨以轻雨层为主，中段 smoothstep 混合，重雨以大雨层为主；等功率比例和有界音量共同控制能量。微小波动保持目标，变化以时间常数 900ms 平滑跟随。主录音固定留余量，不随雨层开关改变。Web 用两个媒体元素，Android 用两个循环 MediaPlayer；不将完整录音读成大 PCM 缓冲。放晴先淡出再释放，调强度、音量或恢复音频焦点都不重开主录音。暂停独立于系统焦点，天气刷新不能恢复用户已暂停的声音。手机的响度和长听感受仍待测试包体验。

原 `rain.wav` 移至 `artifacts/sounds/retired-rain-20261023/rain.wav`，SHA-256 `7f333ae904983726c5dfc89ec497540304dbc748564c8189c288cb4ea8f74199`，可恢复。其 ezwa 原件和公有领域来源证据继续保留，但不与新雨层同时封装。

本轮按用户要求移除晨间鸟鸣与平静海浪，成品移到 `artifacts/sounds/retired-builtins-20261023/`，原始录音不动。两份旧成品摘要分别为 `e50eab7da7bbe54049315d2ee5b2faf92b7103994dc8c0468c22bccf6eb77bd7`、`c23bf738cd9382864fa17db8144a0171c00df8c9032c2ed58100678e86e7b0f8`。旧选择停播，不自动改播；导入音频及雨声开关保留。内置选择顺序为林中鸟鸣、贴岸小浪，然后是用户导入；雨声与音量随后排列。

用户反馈湖畔残留交通噪声不可接受，已从内置列表、Web 和原生路由及包内资产移除。原录音 `artifacts/sounds/晚间湖畔.mp3` 保留；57.764 秒处理稿移入 `artifacts/sounds/archived-evening-lakeside-20261012/evening-lakeside.wav`，SHA-256 为 `c566be60894cff8b78387ebcf2c8391a83c8bbaaf7fd9aecc5688ab575ff251b`，可恢复。不会因升级悄悄改播鸟鸣。

用户授权的录音不在此另行授予素材开源许可。公有领域雨声声明随包保留于 `public/licenses/ambient-audio.txt`。旧版四份合成音频和生成器移到 `artifacts/sounds/archived-synthetic-v74/`，可恢复，不再封装。
