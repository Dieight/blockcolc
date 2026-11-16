# 原生天气协议与数据来源

原生预览的天气平台实现位于 `apps/native-android/platform-weather`。当前交付状态与验证见 [P3 工作包](../versions/3.0.0-p3.md)，本文只记录来源和转换边界。

## 代码复用

| 输入 | 原生采用 |
| --- | --- |
| `apps/android/android/app/src/main/java/com/blockcolc/app/WeatherPlugin.java` | 复用响应／错误解码、Gzip 双重限额、主机和坐标校验、缓存编码及签名指纹格式；不带入定位桥或 Capacitor |
| 同目录 `QWeatherAstronomy.java` | 复用日历解码、极地空事件、时区／夏令时和缓存覆盖规则 |
| 上述两类对应的现行 Java 测试 | 原断言继续检查生成后的同一算法 |
| `apps/web/src/qweather-visual.ts` | `WeatherAppearance` 采用同样的天气码、雨雪优先级、毫米／英寸换算和显式雷雨判断；世界继续负责非线性视觉放大 |

`tools/prepare-native-weather.mjs` 校验提取边界，将 Java 桥对象换成标准 `JSONObject`／`JSONArray`，补充相应受检异常声明。生成物位于该模块的 `build/generated`；`native-weather-source.json` 只记录两份代码、两份测试和生成器的摘要，不读取或记录凭据。运行时不执行 TypeScript 或 JavaScript。原文件保留，共享源的最终目录整理随旧宿主迁移处理。

## 接口与身份

实时天气使用专用 API Host 的 `/weather/v1/current/{latitude}/{longitude}`，坐标为两位小数，语言随界面传 `zh` 或 `en`。天文日历沿用已授权的每日天气数据路径，最多七天；日历按 12 小时和连续 48 小时覆盖条件复用。[和风实时天气接口](https://dev.qweather.com/docs/api/weather/weather-current/)

Android 请求携带本机构建注入的 API Key，以及当前 APK 的 `X-Android-Package-Name`／`X-Android-Cert`。预览包使用自身身份；服务端白名单是否包含它须经实际请求确认。凭据文件不进入公开源码、Web、协议清单、备份或日志。[Android 应用限制](https://dev.qweather.com/docs/best-practices/security-guidelines/#android-apps)

网络只走 HTTPS，禁止自动跳转；连接／读取超时分别为 8／10 秒，压缩和解压后的响应各不超过 64 KiB。服务端错误映射为固定原因，原始响应和异常文字不对外发布。

## 位置与数据展示

定位最长等待 15 秒；当前授权仍有效时，无法获取新位置才使用本机缓存。缓存位于 `no_backup/qweather-last-location-v1`，最多 64 字节，关闭同步时清除。坐标和天文日历不进入领域备份。天气请求和天文请求彼此独立，天气失败仍可按已授权坐标计算日月。

天气与日历的归因在设置中合并去重。HTTPS 归因显示为可点链接，普通声明显示为文字；不把不支持的 URL 协议变成链接。界面只显示来源、同步状态和安全失败原因，不显示 API Host、密钥或坐标。

网络、定位及系统选择器等实际设备行为，以对应设备报告为准；协议和调度单元检查不代替服务成功、授权流程或画面验收。
