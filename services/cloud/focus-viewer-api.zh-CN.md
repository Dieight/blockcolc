# 方块钟专注公报 API

朋友可以在自己的服务上复用现有公报接口，读取公报主人 Dieight 的实时状态和逐日专注时长。先用朋友自己的方块钟账号注册或登录公报，登录返回的会话 Cookie 可以供服务端复用。 [专注公报](https://blockcolc.arcol.site/)

## 登录与读取

所有请求发往 `https://blockcolc.arcol.site`。所有 `POST` 请求的 `Origin` 必须是 `https://blockcolc.arcol.site`，登录和注册的请求体为 JSON。响应中的 `__Host-blockcolc_viewer` Cookie 有效期最长 30 天。遇到 `401` 时重新登录一次，账号改密后需要重新登录。把朋友自己的登录凭据与 Cookie 放在其服务的密钥配置里。

| 方法和路径 | 用途 |
| --- | --- |
| `POST /api/login` | 提交 `{"username":"朋友自己的用户名","password":"朋友自己的密码"}`，接收会话 Cookie |
| `POST /api/register` | 首次注册可提交同样的两个字段，可加 `"timeZone":"Asia/Shanghai"`；日常只需登录 |
| `GET /api/live` | 读取当前任务、开始、预计结束和当天累计时长 |
| `GET /api/days?from=YYYY-MM-DD&through=YYYY-MM-DD` | 按北京时间回填逐日专注时长，包含起止日，每次最多请求 366 天 |
| `GET /api/events` | SSE，接通先收到一条 `snapshot`，之后有变化时才推送同结构数据 |
| `POST /api/logout` | 结束当前公报会话 |

`/api/live` 和 SSE 的 `data` 都返回 `live.snapshot`。其中 `currentName`、`startedAt`、`estimatedEndsAt` 在空闲时为 `null`。加时专注保留 `currentName` 和 `startedAt`，`estimatedEndsAt` 为 `null`，并返回 `waitingForEnd: true`。时间戳是 ISO 8601，`estimatedElapsedMs` 和 `todayActualFocusMs` 的单位是毫秒。可用预计结束时间和 `serverTime` 计算剩余时间。当天累计以已同步的记录为准。客户端可比较 `live.sourceEpoch` 与 `daysVersion`，有变化时刷新日统计。

`/api/days` 返回 `days`，每项含 `date`、`actualFocusMs`、`confirmed`。范围会截在公报的起始日和当天，当天数据可继续变化。接入范围与公报一致，可读取已展示的专注状态和日汇总。读取这三个接口不会增加访客计数。访客榜只有站主可读，公报接口也没有工作区、备份或账号令牌。

快照带有 `estimated: true` 时，客户端可从 `startedAt` 和 `serverTime` 推算预计持续时间。当前阶段截止 90 秒后仍无更新时，快照返回 `stale: true`，实时字段清空，应显示等待同步。确认空闲时也会清空实时字段，此时没有 `stale`。日累计按实际结算更新。

## 最小调用示例

以下 Python 3 示例使用环境变量里的朋友账号，直接在内存复用 Cookie。持续运行的服务可以保留同一个客户端，登录一次后继续读取。轮询可从每 10–30 秒一次开始，实时显示可使用 SSE。服务返回 `429` 时按 `Retry-After` 等待。

```python
import http.cookiejar
import json
import os
import urllib.request

base = "https://blockcolc.arcol.site"
client = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
)
login = urllib.request.Request(
    base + "/api/login",
    data=json.dumps({
        "username": os.environ["BLOCKCOLC_VIEWER_USER"],
        "password": os.environ["BLOCKCOLC_VIEWER_PASSWORD"],
    }).encode("utf-8"),
    headers={"Content-Type": "application/json", "Origin": base},
    method="POST",
)
with client.open(login, timeout=10) as response:
    assert json.load(response)["ok"]
with client.open(base + "/api/live", timeout=10) as response:
    live = json.load(response)
    print(live["live"]["snapshot"])
with client.open(base + "/api/days?from=2026-11-01&through=2026-11-17", timeout=10) as response:
    daily = json.load(response)["days"]
```
