# 雨声试听候选

2026-10-23，按 /103 反馈重新寻找真实录音。以下均已核对原作者的 Freesound 页面和 CC0 标识；描述依据作者说明，不把波形、评分或他人评论当成已经听过的音质结论。用户选定 **1／4** 作为轻雨／大雨，已提供完整 WAV；其他三份不加入 App。

| 编号 | 录音与原作者 | 时长 | 方向 |
| --- | --- | --- | --- |
| 1 | [Soft rain — barkenov](https://freesound.org/people/barkenov/sounds/640655/) | 1:01 | 花园细雨，作为轻雨底层的候选 |
| 2 | [ForestRainShower1a — AlanCat](https://freesound.org/people/AlanCat/sounds/383064/) | 9:01 | 林中雨和近处叶片落滴，保留自然变化 |
| 3 | [rain against window 2 — bastipictures](https://freesound.org/people/bastipictures/sounds/243781/) | 1:05 | 近处雨点敲窗，颗粒更突出，需确认长听接受度 |
| 4 | [Hard rain — barkenov](https://freesound.org/people/barkenov/sounds/255900/) | 1:04 | 庭院大雨，与 1 同一作者，可试听能否组成轻／重两层 |
| 5 | [Raining on roof — Duasun](https://freesound.org/people/Duasun/sounds/468024/) | 0:24 | 屋顶雨声，短录音；若采用需单独检查循环感 |

CC0 的原许可入口均在各作者页面底部，许可正文见 [CC0](https://creativecommons.org/publicdomain/zero/1.0/)。正式采用时保留原件、记录 SHA-256、原时长与派生参数，继续保留作者信息；不使用来源不明或只允许非商用的替代录音。

## 已采用的雨量联动

当前天气解析已有降水种类与归一化雨强；可复用它，不新增定位或天气请求。让真实／本地天气都驱动雨声，调试覆盖仍一致生效。缺测时按天气种类回退，不把缺值误认为无雨。

用轻、中、重三个区间和平滑的非线性曲线交叉淡化，改变两种实际录音的比例，不用合成雨点代替；主录音音量不随雨量改变。混合峰值留余量，0.025 以内的归一化波动保持原目标，改变后按 900ms 时间常数渐近过渡。雪不播放雨声。Android 媒体会话的暂停跨天气刷新保留。

两份原 WAV、分析和转码日志保留在 `artifacts/sounds/rain-barkenov-20261023/`；完整时长、摘要和参数见[录音来源](ambient-audio.md)。Web／Android 均流式播放，不预解码成整段 PCM。旧 `rain.wav` 移入 `artifacts/sounds/retired-rain-20261023/`，可恢复，不再封装。原始试听已由用户选择；转码及混合后的长听效果仍待测试包体验。
