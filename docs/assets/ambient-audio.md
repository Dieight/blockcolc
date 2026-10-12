# 环境录音

2026-10-12。两通道使用同一份 PCM。原始录音保留在 `artifacts/sounds/`，构建只使用已处理的 `apps/web/public/audio/`，不要求运行音频处理工具。

| 成品 | 来源与处理 |
| --- | --- |
| 晨间鸟鸣 / Morning birdsong | 用户录音 `晨间鸟鸣.mp3`；取 0.25–21.5 秒，避开末尾电动车提示音，过滤低频 |
| 雨声 / Rain | ezwa 的 [Rain (1)](https://commons.wikimedia.org/w/index.php?title=File:Rain_(1).ogg&oldid=899302123)，作者标记为公有领域；过滤低频并制作循环 |

原始录音 SHA-256：

- 湖畔：`f1ddda55ae48056df3cc598480b7a75bc8f88629f9e8a0c7e75cf8ce9ba924fa`
- 鸟鸣：`fad300d9572129c0086ef549f2b47d7cdea0bb27fda5c2b15c79ede8c48d231f`
- 雨声：`31efcbe952a3989a9276774e2d7be61a2dc98fdd785a94d1435fc19cda9a84d1`

成品均为 32 kHz 单声道 PCM16 WAV。鸟鸣、雨声循环交叠分别为 1.5 / 2.5 秒，电平匹配后限峰；不是在播放器末尾淡出再重启。工具为 `tools/prepare-ambient-recordings.py`，参数和低频衰减测量在 `artifacts/sounds/processed/processing-report.json`。该报告保留最初三份处理结果，其中湖畔已退役；重新运行工具只处理鸟鸣和雨声。

| 文件 | 时长 | SHA-256 |
| --- | ---: | --- |
| `morning-birdsong.wav` | 19.750 秒 | `e50eab7da7bbe54049315d2ee5b2faf92b7103994dc8c0468c22bccf6eb77bd7` |
| `rain.wav` | 42.157 秒 | `7f333ae904983726c5dfc89ec497540304dbc748564c8189c288cb4ea8f74199` |

用户反馈湖畔残留交通噪声不可接受，已从内置列表、Web 和原生路由及包内资产移除。原录音 `artifacts/sounds/晚间湖畔.mp3` 保留；57.764 秒处理稿移入 `artifacts/sounds/archived-evening-lakeside-20261012/evening-lakeside.wav`，SHA-256 为 `c566be60894cff8b78387ebcf2c8391a83c8bbaaf7fd9aecc5688ab575ff251b`，可恢复。不会因升级悄悄改播鸟鸣。

用户授权的录音不在此另行授予素材开源许可。公有领域雨声声明随包保留于 `public/licenses/ambient-audio.txt`。旧版四份合成音频和生成器移到 `artifacts/sounds/archived-synthetic-v74/`，可恢复，不再封装。
