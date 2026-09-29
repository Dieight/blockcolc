# Blockcolc UI 视觉资产

## 应用图标

四时段不规则色块表盘的批准母版是 `apps/android/icon-source/blockcolc-four-periods-approved-20260913.png`，已于 2026-09-13 批准。番茄线框保留为计时语义；通知图标继续使用已验收的 Android 单色镂空番茄。

Android 各密度启动图标 PNG，以及 PWA 192/512 图标，都由同一母版和 `tools/build-adaptive-icon-source.py` 生成。现行资源引用链由 `ui-assets-manifest.json` 检查，包括 PWA HTML/manifest、Android manifest 和自适应启动图标 XML。manifest 中旧尺寸和摘要已按当前 tracked 文件更新，全部为完整 SHA-256。

重复生成命令（需要既有 Python Pillow 与 NumPy 环境）：

```powershell
py -3 tools/build-adaptive-icon-source.py `
  apps/android/icon-source/blockcolc-four-periods-approved-20260913.png `
  "$env:TEMP\blockcolc-icon-preview" `
  --android-res "$env:TEMP\blockcolc-icon-preview\android-res" `
  --web-icons "$env:TEMP\blockcolc-icon-preview\web-icons"
```

该命令将预览与派生资源写入临时目录，不会覆盖仓库中的启动图标。资产 manifest 的命令会再次运行同一生成器并将输出与仓库资源逐字节比较：

```powershell
node tools/check-ui-assets.mjs --check
node tools/check-ui-assets.mjs --write
```

`--write` 只刷新已登记资产的字节数与摘要；它不会改动批准母版的固定批准摘要，也不会把未批准源、草案或来源未核实的文件标为已批准。派生输出若与母版生成结果不一致，`--write` 会失败。`--check` 校验完整摘要、文件存在性、重复/越界路径、源批准摘要、派生关系、实际生成字节和消费者引用。工具验证使用临时目录，退出时清理临时输出。

## 资产状态

- `blockcolc-four-periods-approved-20260913.png`：当前批准母版。
- `blockcolc-icon-source.png`：较早的历史源；目前未证明与现行派生产物有关，不是批准母版。
- `blockcolc-four-periods-no-clock-draft.png`：未批准草案，不进入生成链。
- `ic_stat_tomato_outline.xml`：保留的单色镂空番茄通知图标，有原生通知代码引用。
- `ic_stat_blockcolc.xml`：当前全仓代码未发现引用；作为候选清理项记录，未在本轮删除。
- `res/drawable*` 下的启动画面 PNG：完整摘要已记录，但生成来源仍未确认；不声称它们由应用图标母版派生。
- 自适应图标 XML/背景色资源：引用与摘要已登记；它们是静态 Android 资源，不是 Python 生成器输出。

界面线图标继续使用 `lucide-react`。世界材质为程序生成；用户导入资源包与用户蓝图不属于应用 UI 母版，按产品文档中各自来源和许可边界处理。
