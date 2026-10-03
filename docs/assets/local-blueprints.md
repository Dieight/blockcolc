# 补充蓝图来源

蓝图由用户提供。原始文件名作为展示名称；说明沿用“作者与名称：一句视觉描述。”的格式，`byMC烤河马` 标注保留在名称和说明中。文件名和 NBT 作者字段只是来源线索，不据此推断素材许可。

## 当前封装

当前共 22 张：16 张普通补充蓝图、6 张每日奖励。v2.3.0 新增的 12 张见下表；v2.4.0 修正负尺寸选区的坐标解释，重新转换仪式剑和昔涟 Q 版手办，其他 20 份产物未变。稳定 ID、分类和名称保留。完整文件与派生摘要见 [资源清单](local-blueprints-manifest.json)，运行时名称、分类和描述由 [目录元数据](../../packages/voxel/src/local-blueprint-sources.ts)统一维护。

坐标依据 [Litematica 的容器写入实现](https://github.com/maruohon/litematica/blob/ornithe/1.12.2/src/main/java/litematica/scheduler/task/LocalCreateSchematicTask.java)：选区可以反向选择，方块与方块实体始终相对最小角保存。用户提供的“月湾画廊”仅用于本地回归，不加入内置目录。

| 新增名称 | 分类 | 稳定 ID |
| --- | --- | --- |
| Dieight的圣诞树 | 普通补充蓝图 | `builtin-local-dieight-christmas-tree` |
| Dieight的挂机池 | 每日奖励 | `builtin-local-dieight-afk-pool` |
| Dieight的昔涟Q版手办_byMC烤河马 | 普通补充蓝图 | `builtin-local-dieight-xilian-figurine` |
| GYPpro的挂机点 | 每日奖励 | `builtin-local-gyp-afk-spot` |
| GYPpro的昔涟-仪式剑 | 普通补充蓝图 | `builtin-local-gyp-ritual-sword` |
| GYPpro的樱花仓库熔炉 | 普通补充蓝图 | `builtin-local-gyp-cherry-storage-furnace` |
| GYPpro的樱花树 | 普通补充蓝图 | `builtin-local-gyp-cherry-tree` |
| Togawa15akiko的刷铁机 | 普通补充蓝图 | `builtin-local-togawa-iron-farm` |
| Togawa15akiko的豪宅 | 普通补充蓝图 | `builtin-local-togawa-mansion` |
| m0m0kA_QWQ的神秘小房子 | 普通补充蓝图 | `builtin-local-momo-mysterious-house` |
| zdrcgubjo4的小喷泉 | 普通补充蓝图 | `builtin-local-zdrcgubjo4-small-fountain` |
| zdrcgubjo4的铁傀儡 | 每日奖励 | `builtin-local-zdrcgubjo4-iron-golem` |

## 原件与再转换

本轮原件快照保存在工作区 `artifacts/v2.3.0/build-inputs/local-builtins-01/`；外部 `D:/Litematic` 仅是本轮复制来源。构建读取 `packages/voxel/src/local-blueprints/` 中已经转换的 JSON，不扫描外部目录。

新增时先登记元数据，再显式运行：

```powershell
npm run package:local-builtins -w @blockcolc/litematic -- "C:\Codex\blockcolc\artifacts\v2.3.0\build-inputs\local-builtins-01"
```

转换器在任何文件、ID、分类或尺寸检查失败时不写资产；成功报告包含原件与 JSON 摘要。按报告更新资源清单，核对旧资产摘要，并检查新增目录、预览和奖励注册。原件与 JSON 留在本机资产目录，两种构筑使用同一份输入；不把 MC 客户端 JAR 作为 App 内置素材。

## 保留范围

这是建筑外观，不运行挂机或刷铁装置的游戏逻辑。方块名称、状态及支持的告示牌/方块实体数据随规范化蓝图保留；其他实体与计划刻沿用导入器现有处理方式，详情留在转换报告，原始 NBT 文件不修改。

新版告示牌兼容直接 NBT 文本，旧版继续按 JSON 读取，二者以文件的数据版本区分。对文字长度、嵌套与节点数量的限制仍生效，动态文本不转换成可执行内容。格式依据 [25w02a 官方说明](https://www.minecraft.net/en-us/article/minecraft-snapshot-25w02a)及其[游戏生成元数据](https://raw.githubusercontent.com/misode/mcmeta/25w02a-summary/version.json)。
