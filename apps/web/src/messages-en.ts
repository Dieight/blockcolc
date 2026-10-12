/** Presentation strings only. User-written names, notes and imported metadata are never catalog keys. */
const decode = (value: string) => value.replaceAll('\\n', '\n').replaceAll('\\u0020', ' ');
export const EN:Readonly<Record<string,string>> = Object.fromEntries(String.raw`
方块钟|Blockcolc
设置|Settings
计时|Timer
任务|Tasks
统计|Statistics
删除|Delete
取消|Cancel
确认|Confirm
关闭|Off
全部|All
当前|Current
打开|Open
保存|Save
恢复|Restore
刷新|Refresh
导出|Export
返回|Back
继续|Continue
完成|Done
版本|Version
个| items
条| entries
份 ·| files ·
方块|blocks
方块 ·|blocks ·
项目|Projects
语言|Language
界面语言|App language
中文|简体中文
英语|English
专注节奏、聚落外观与本地数据。|Focus, world and local data.
普通任务专注（分钟）|Task focus (min)
普通任务专注分钟|Task focus minutes
习惯任务专注（分钟）|Habit focus (min)
习惯任务专注分钟|Habit focus minutes
每座习惯建筑（轮）|Habit building (rounds)
每座习惯建筑轮数|Rounds per habit building
每轮休息（分钟）|Break (min)
每轮休息分钟|Break minutes
0 表示不休息|0 skips breaks
自动连续专注|Auto-continue focus
休息结束自动开始下一轮，锁屏时也按计划继续|Start after breaks, even when locked
专注保护|Focus protection
提醒|Notifications
返回专注提醒|Return-to-focus reminder
极简或马拉松休息结束且还有轮次时提醒回来专注|Remind me when another round is ready
开启返回专注提醒|Enable return-to-focus reminders
外观|Appearance
深色模式|Theme
跟随系统或手动指定|Follow system or choose a theme
浅色|Light
深色|Dark
跟随系统|System
界面字体|Font
立即生效，无需重启|Applies immediately
像素|Pixel
原字体|System
沉浸计时玻璃，通透度 {0}%|Focus glass, clarity {0}%
沉浸计时玻璃|Focus glass
仅调整计时面板，点击调节|Tap to adjust clarity
预计 {0}%|Preview {0}%
液态玻璃通透程度|Glass clarity
世界|World
聚落环境|Environment
回到计时页更新地形|Updates on returning to Timer
空岛|Sky island
山谷|Valley
海岛|Island
海岸|Coast
同步现实天气|Real weather
位置仅存本机；定位暂失时使用缓存，关闭即清除|Location stays local; cached until disabled
光影质量|Lighting
回到计时页应用；高档位更耗电|Applies in Timer; higher uses more power
自动|Auto
流畅|Fast
均衡|Balanced
精致|Detailed
施工轮廓|Construction outline
未建部分的显示范围|Show unfinished blocks
建筑腐败|Weathering
错过的计划日会风化建筑，专注可修复|Missed days cause wear; focus repairs it
开启建筑腐败|Enable weathering
高级|Advanced
自动检查并下载|Check & download updates
启动时检查新版|Check on launch
渐进启动|Progressive startup
先打开计时，世界稍后就绪；下次启动生效|Open Timer first; applies next launch
新手教程|Quick tour
重新查看|View again
显示世界坐标|World coordinates
点按地形时显示 x、z 与高度，便于定位世界问题|Tap terrain for coordinates
暂时无法读取系统提醒状态|Notification status unavailable
正在读取系统提醒状态|Reading notification status
提醒可用 · 精准提醒已开启|Notifications ready · exact alarms on
提醒可用 · 锁屏时可能略有延迟|Ready · may be delayed when locked
首次开始专注时请求通知权限|Permission requested on first focus
系统通知已关闭|System notifications disabled
当前平台不提供系统通知|System notifications unavailable
专注结束提醒|Focus-end reminder
打开系统设置|System settings
刷新通知状态|Refresh notification status
暂时无法读取系统实时通知状态|Live notification status unavailable
正在读取系统实时通知状态|Reading live notification status
当前系统仅提供普通持续通知|Standard ongoing notifications only
已开启 · 专注与休息会显示在流体云、锁屏和通知抽屉|Enabled · focus and break status
系统未允许实时通知，专注与休息倒计时会退化到通知栏|Live updates disabled; notification fallback
专注与休息实时状态|Live focus & break status
开启实时通知|Enable live updates
刷新实时通知状态|Refresh live notification status
需在 vivo 系统授权原子岛场景；当前使用普通通知|OriginOS scene approval needed; using notifications
原子岛场景已授权|Atomic Island scene approved
正在解析...|Reading…
导入 .litematic|Import .litematic
每日奖励装饰|Daily reward decoration
这份蓝图为 {0} x {1} x {2}，奖励装饰上限为 12 x 12 x 16。|Size {0} × {1} × {2}; reward limit is 12 × 12 × 16.
这份蓝图含 {0} 个方块，奖励装饰上限为 2,000 个。|{0} blocks; reward limit is 2,000.
图纸超过安全限制：文件 64 MB、占地 96 x 96、高度 256、最多 300,000 个方块。|Blueprint limit: 64 MB, 96 × 96 footprint, 256 high, 300,000 blocks.
无法读取这份 .litematic，请确认文件完整且由 Litematica 导出。|Cannot read this file. Use a complete Litematica export.
图纸导入失败，请换一份文件重试。|Import failed. Try another blueprint.
最多保存 {0} 份，请先删除一份。|Limit: {0} blueprints. Delete one first.
无法保存这份蓝图。|Could not save blueprint.
蓝图名称不能为空。|Enter a blueprint name.
无法修改蓝图名称。|Could not rename blueprint.
建筑蓝图库|Building library
最多|Up to
份 · 任务建筑与每日奖励| files · buildings & daily rewards
导入蓝图用途|Blueprint purpose
大型任务建筑|Project building
保存到建筑蓝图库|Save to building library
加入每日奖励装饰池|Add to daily reward pool
重命名“{0}”|Rename “{0}”
保存蓝图名称|Save blueprint name
取消重命名|Cancel rename
从蓝图库删除？|Delete blueprint?
不会改变使用这份蓝图创建的已有大型任务。|Existing projects keep their blueprint.
删除蓝图|Delete blueprint
设置未保存。|Settings were not saved.
专注完整性|Focus integrity
离开超|Away over
秒计次，达上限本轮失败|s counts; reaching the limit fails the round
开启专注完整性|Enable focus integrity
有效离开上限（次）|Away limit (times)
一轮内达到该次数即失败|Reaching this limit fails the round
允许有效离开次数|Allowed times away
离开阈值（秒）|Away threshold (s)
回到前台时离开超过该秒数才计入|Count absences longer than this
离开阈值秒数|Away threshold seconds
备份文件不能超过 {0} MiB。|Backup limit: {0} MiB.
无法读取备份：{0}|Could not read backup: {0}
导入完成，已创建回滚备份。|Imported. Previous data saved for rollback.
导入失败：{0}|Import failed: {0}
已恢复备份，并创建恢复前回滚点。|Restored. Previous data saved for rollback.
恢复失败：{0}|Restore failed: {0}
留档已恢复，原数据保留为回滚点。|Archive restored; previous data retained.
本地备份|Local backups
导入前留回滚点；完整替换，不合并。|Import replaces data; rollback saved first.
正在导出…|Exporting…
导出 JSON|Export JSON
正在读取…|Reading…
选择备份|Choose backup
选择备份 JSON 文件|Choose backup JSON
导入预览|Import preview
导出时间|Exported
 · 当前：{0}| · current: {0}
专注记录|Focus history
完成 /|completed /
中断|interrupted
进度汇报|Progress reports
正在替换…|Replacing…
确认替换本地数据|Replace local data
可恢复备份|Rollback backups
刷新可恢复备份|Refresh rollback backups
尚无回滚备份。|No rollback backups yet.
个项目|projects
每日合并备份|Daily merged backup
仅保留一份，每日合并变化并复用未变内容。上限 200 MiB；导出是完整备份，操作回滚另存。|One merged backup, up to 200 MiB. Exports are complete; rollback is separate.
还没有留档，次日会自动保存。|No archive yet. Saved automatically next day.
保存 ·|saved ·
恢复留档|Restore archive
恢复这份备份？|Restore this backup?
恢复备份|Restore backup
当前数据会被完整替换，并保留恢复前回滚点。|Replaces current data; rollback saved first.
恢复 {0} 留档？|Restore archive from {0}?
恢复当时保存的完整记录；当前数据会先保留为回滚点。|Restores the full archive; current data saved first.
导入前备份|Before import
删除任务前备份|Before deleting a task
恢复前备份|Before restore
发生未知错误，请重试。|Something went wrong. Please retry.
正在恢复…|Restoring…
当前已是最新版本 {0}。|You're up to date: {0}.
暂时无法检查更新，请确认网络后重试。|Could not check updates. Check your connection.
公开版 {0} 已更新；私人版保留好友同步，不下载公开包。|Public {0} available. This private build keeps friend sync and will not download it.
版本 {0} 已下载并验证，等待安装。|Version {0} verified and ready to install.
正在{0} {1}|{0} {1}
发现新版本 {0}{1}。|New version {0}{1} available.
等待手动检查更新|Ready to check for updates
关闭关于页面|Close About
跳一跳，方块钟|Bounce, Blockcolc
 · 私人版| · private
把时间，慢慢建成一座聚落。任务、记录与蓝图默认保存在本机。|Build a settlement with your time. Tasks, history and blueprints stay on this device.
项目仓库|Repository
隐私|Privacy
默认本地保存；外部服务按设置启用|Local by default; services are opt-in
项目许可|Project license
天文计算|Astronomy
节日历法|Holiday calendar
像素字体|Pixel font
缝合像素 · OFL-1.1|Fusion Pixel · OFL-1.1
本应用不是 Minecraft 官方产品，未获 Mojang Studios 或 Microsoft 认可或关联。Minecraft 是其权利人的商标。|Not an official Minecraft product. Not approved by or associated with Mojang Studios or Microsoft. Minecraft is a trademark of its owners.
手动检查更新|Check for updates
更新下载进度|Update download progress
处理中|Working
确认下载更新|Download update
取消下载|Cancel download
安装更新|Install update
允许安装此来源|Allow this source
查看发布说明|Release notes
原因未提供|No reason provided
正常退出|Normal exit
进程收到系统信号|System signal
系统内存回收|Reclaimed by system
应用崩溃|App crash
原生崩溃|Native crash
应用无响应|App not responding
启动失败|Startup failed
权限变更|Permissions changed
资源用量超限|Resource limit exceeded
用户或系统停止|Stopped by user or system
用户停止|Stopped by user
依赖进程退出|Dependency exited
其他系统原因|Other system reason
系统冻结进程|Frozen by system
包状态变更|Package state changed
应用更新|App updated
暂未读到系统状态|System status unavailable
未能打开系统电源设置|Could not open power settings
后台运行|Background operation
已放宽标准省电限制|Battery restriction relaxed
受系统省电策略管理|Managed by battery policy
 · 省电模式开启| · battery saver on
上次退出|Last exit
系统未提供退出记录|No exit record from system
WebView 渲染进程崩溃|WebView renderer crashed
WebView 渲染进程被回收|WebView renderer reclaimed
电源设置|Power settings
刷新后台状态|Refresh background status
无法读取本机音频|Could not read audio library
音频导入失败|Audio import failed
白噪音|Ambient audio
环境白噪音|Environment ambience
随聚落播放，可叠加本机音频|Environment sound + your own audio
启用白噪音的聚落|Enable ambience for
空岛 · 风|Sky island · wind
山谷 · 溪流|Valley · stream
海岛 · 海浪|Island · waves
海岸 · 海风|Coast · sea breeze
白噪音音量|Ambience volume
音频未能删除|Could not delete audio
导入音频|Import audio
最多 8 份 · 单份 64 MiB · 同时叠加 3 份|8 files · 64 MiB each · mix up to 3
音频不能超过 64 MiB|Audio limit: 64 MiB
最多保存 8 份音频|Audio library is full (8 files)
无法读取这份音频|Could not read audio
音频格式暂不支持|Unsupported audio format
请选择三小时以内的音频|Choose audio under three hours
原生图纸|Native
补充图纸|Supplemental
自添加图纸|Imported
本机导入的建筑图纸|Blueprints imported on this device
每日奖励|Daily rewards
完成每日目标可获得|Earned through daily goals
节日奖励|Holiday rewards
也许在某些特定节日启动方块钟会发现它|Perhaps opening Blockcolc on a special holiday will reveal it
蓝图库|Blueprint library
待发现|Undiscovered
导入与管理|Import & manage
蓝图预览|Blueprint preview
关闭蓝图预览|Close blueprint preview
尚未发现的节日建筑|Undiscovered holiday building
本机记录|Local records
世界资源|World resources
地形与建筑|Terrain & buildings
光照与天气|Lighting & weather
页面|Page
暂未准备好|Not ready yet
世界暂不可用|World unavailable
准备光照…|Preparing lighting…
准备世界…|Preparing world…
无法打开本地世界|Could not open local world
上一页|Previous
下一页|Next
开始使用|Let's begin
关闭新手教程|Close quick tour
新手教程 ·|Quick tour ·
晴|Clear
多云|Cloudy
小雨|Light rain
雾|Fog
小雪|Light snow
雷雨|Thunderstorm
雪|Snow
雨|Rain
来源|Source
位置权限未授予，不会使用缓存位置联网|Location permission denied; no cached requests
定位不可用，已尝试本机缓存位置|Location unavailable; tried cache
定位超时，已尝试本机缓存位置|Location timed out; tried cache
位置权限不可用|Location permission unavailable
天气同步已取消|Weather sync cancelled
本机天气位置缓存未能清除|Could not clear location cache
现实天气未配置，不会发起服务请求|Real weather not configured
当前设备不可用|Unavailable on this device
此 Android 构筑未接入天气组件，服务端未收到请求|Weather module missing; no request sent
Android 天气调用失败，未确认服务端收到请求|Native weather bridge failed
Android 天气插件返回格式异常，未确认服务端收到请求|Invalid native weather response
无法读取 Android 应用签名身份，未发出服务请求|Signing identity unavailable; no request sent
网络不可用|Network unavailable
天气请求超时|Weather request timed out
天气网络请求失败|Weather request failed
和风天气凭据验证失败|QWeather authentication failed
和风天气安全限制拒绝请求，请核对 API 与 Android 应用限制|QWeather security restriction; check API and Android limits
和风天气 API Host 无效|Invalid QWeather API host
和风天气可用额度不足|QWeather quota exhausted
和风天气账单状态需要处理|QWeather billing needs attention
和风天气账户不可用|QWeather account unavailable
和风天气接口已停用|QWeather API deprecated
和风天气拒绝请求，请核对 API 限制与服务权限|QWeather access denied; check permissions
和风天气拒绝了请求参数或位置|QWeather rejected parameters or location
和风天气接口路径未找到，请核对当前授权 API|QWeather endpoint unavailable; check API access
和风天气暂时限制请求，请检查额度或稍后重试|QWeather rate limited; try later
和风天气服务暂不可用|QWeather unavailable
天气响应超过安全大小限制|Weather response too large
天气响应压缩格式无法识别|Unsupported weather compression
现实天气返回数据无效，响应结构无法识别|Invalid real-weather response
天气现象暂未适配|Unsupported weather condition
同步暂不可用|Sync unavailable
天气状态暂不可用|Weather status unavailable
我的第一座工坊|My first workshop
确定目标\n完成核心工作\n检查并收尾|Define the goal\nDo the core work\nReview and finish
设置未保存：{0}|Settings not saved: {0}
设置未保存，请重试。|Settings not saved. Please retry.
转场未完成，已恢复操作。|Transition interrupted; controls restored.
正在打开任务…|Opening tasks…
正在打开统计…|Opening statistics…
正在打开设置…|Opening settings…
关于方块钟|About Blockcolc
主导航|Main navigation
本地 Litematic · Minecraft 数据版本 {0}|Local Litematic · Minecraft data version {0}
本地建筑蓝图 · {0} 导入|Local blueprint · imported {0}
请先填写任务名称。|Enter a task name.
请先选择建筑蓝图。|Choose a blueprint.
习惯建筑轮数必须在 10 到 30 轮之间。|Habit buildings require 10–30 rounds.
至少保留一个小任务。|Keep at least one subtask.
创建失败，请检查输入后重试。|Creation failed. Check your input.
创建失败，请重试。|Creation failed. Please retry.
已加入本地装饰池。|Added to local decoration pool.
这份装饰蓝图已在本地装饰池中。|This blueprint is already in the decoration pool.
无法加入装饰池。|Could not add decoration.
个方块 ·|blocks ·
个区域|regions
个方块使用资源包，|blocks textured,\u0020
个原创回退|original fallbacks
个方块使用占位材质|placeholder blocks
忽略|Ignored
个实体、方块实体或计划刻|entities, block entities or scheduled ticks
蓝图用途|Blueprint purpose
主任务建筑|Project building
装饰上限 12 x 12 x 16、2,000 个非空气方块；达成每日目标后自动选取。|Reward limit: 12 × 12 × 16 and 2,000 blocks. Chosen after daily goals.
已有任务|Existing tasks
习惯 · {0}|Habit · {0}
等待选择下一建筑|Choose the next building
{0} / {1} 轮|{0} / {1} rounds
{0}% · {1} 个小任务|{0}% · {1} subtasks
切换|Switch
建立你的第一项任务|Create your first task
新增任务|New task
建立新任务|Create a task
让日常坚持，一座接一座地建造。|Build one habit at a time.
拆成小任务，一步步建成自己的建筑。|Break work into steps. Build as you go.
任务类型|Task type
普通大型任务|Project
习惯任务|Habit
习惯名称|Habit name
大型任务|Project
每座建筑|Each building
轮专注|focus rounds
统一在设置中调整；创建后，本周期内不会改变。|Set in Settings; fixed for this cycle.
正在准备建筑预览...|Preparing preview…
加入装饰池|Add decoration
正在创建…|Creating…
开始建造|Start building
拆成小任务|Break into subtasks
清空小任务|Clear subtasks
清空|Clear
小任务 {0}|Subtask {0}
删除“{0}”|Delete “{0}”
新增小任务|Add subtask
例如：整理验证结果|e.g. Review test results
添加|Add
主体建筑完成|Building complete
这项长期工作已经在聚落中留下完整建筑。|Your work has left a complete building.
回到聚落|Back to settlement
页面暂时没能打开|Could not open this page
重新打开会读取本机记录，不会重置任务。|Reopening loads local records; tasks are kept.
重新打开|Reopen
分钟|min
轮| rounds
外部打扰|External interruption
任务受阻|Task blocked
需要休息|Need a break
优先级变化|Priorities changed
设备或应用问题|Device or app issue
其他|Other
不记录|Don't record
保存未完成，请重试；本轮记录仍保留。|Could not save. This round is kept; please retry.
取消未完成，请重试；当前计划仍保留。|Could not cancel. Your plan is kept; please retry.
提前完成本轮|Finish round early
提前完成任务|Finish task early
推进当前习惯建筑，并结束本场计划|Advance this habit and finish the plan
推进当前习惯建筑，并继续本场计划|Advance this habit and continue the plan
记录本轮，并进入本场统一汇报|Record this round and report the plan
记录本轮，并继续本场计划|Record this round and continue the plan
推进当前习惯建筑，并结束本轮计划|Advance this habit and finish the round
将当前小任务标为完成并结束本轮计划|Complete this subtask and finish the round
关闭结束专注窗口|Close end-focus dialog
如何结束这次专注？|How would you like to finish?
这次为什么中断？|Why did you stop?
取消整个多轮计划？|Cancel the whole plan?
选择一项便于以后复盘，也可以不记录。|Choose a reason, or skip it.
已完成轮次会保留并进入汇报；当前未完成轮次会按中断记录。|Completed rounds are kept for reporting. The current round is interrupted.
中断本轮|Interrupt round
保留已有任务进度，不计完整轮次|Keep progress; don't count a full round
；本轮计划继续|; the plan continues
正在保存…|Saving…
取消整个计划|Cancel whole plan
结束后续轮次，已完成轮次仍可汇报|Stop future rounds; report completed ones
补充说明（可选）|Note (optional)
需要时再写|Add a note if helpful
/ 200 字|/ 200 characters
确认取消整个计划|Cancel whole plan
排程方式|Plan type
固定轮次|Fixed rounds
按结束时间|End time
习惯专注轮数|Habit focus rounds
专注轮数|Focus rounds
计划轮数|Planned rounds
取消原因|Cancellation reason
选择原因|Choose a reason
保留已完成轮次，当前轮记为中断。最多 200 字。|Completed rounds kept; current round interrupted. Up to 200 characters.
计划仍保留，可修改后重试。|Your plan is kept. Adjust and retry.
取消未完成，请重试。|Could not cancel. Please retry.
保存失败，请重试。|Could not save. Please retry.
确认计划|Confirm plan
计划未保存，请重试。|Plan not saved. Please retry.
 已锁定，可取消后重新安排。| is locked. Cancel to rearrange.
本次计划|This plan
安排下一轮|Plan next round
关闭本次计划|Close plan
本次专注|This focus
进度 {0}%|Progress {0}%
每轮|Each round
分钟专注|min focus
；多轮之间休息 {0} 分钟。|; {0} min break between rounds.
；休息已关闭。|; no breaks.
请先选择结束时间。|Choose an end time.
从现在到|From now until
不足一轮专注（|Not enough time for one round (
分钟），请选择更晚的时间。|min). Choose a later time.
 · {0} 次休息| · {0} breaks
· 结束后统一汇报。|· Report together at the end.
最多 {0} 轮，约 {1}。|Up to {0} rounds, about {1}.
取消计划|Cancel plan
取消未完成|Cancellation failed
安排习惯专注|Plan habit focus
 · 休息 {0} 分钟| · {0} min breaks
 · 不休息| · no breaks
。完成即推进建筑。|. Each round advances the building.
不足一轮习惯专注（|Not enough time for a habit round (
轮习惯专注，每轮|habit rounds, each
本轮已记录|Round recorded
这次工作推进到哪里？|How far did you get?
结束原因：|End reason:\u0020
材料已送达！|Materials delivered!
保持 {0}%|Keep {0}%
完成小任务|Complete subtask
推进至 {0}%|Advance to {0}%
轮专注已结束|focus rounds complete
把这次推进汇报给哪些任务？|Which tasks did you work on?
把专注留在做过的事上|Connect your focus to your work
本次结束原因：|End reason:\u0020
补充说明：|Note:\u0020
轮次如何记录|How rounds are recorded
每轮只计入一个目标，按完成顺序记录时长。未选择则记为未分配；保持进度也可计入轮次。|Each round belongs to one task, in completion order. Unselected rounds stay unassigned; unchanged progress may still receive time.
选择小任务或习惯并分配轮数，每轮只计入一个目标。按完成顺序记录时长，未选择则记为未分配。|Assign rounds to subtasks or habits. Each round belongs to one target; others stay unassigned.
这次没有需要汇报的轮次，直接结束计划即可。|No rounds to report. You can finish this plan.
暂无可推进的任务，可直接结束计划。|No available tasks. You can finish this plan.
习惯 · 第|Habit · building
座建筑 ·|·
收起|Collapse
计入轮数|Assign rounds
预计实际投入 {0}|Estimated time {0}
默认 0 轮；展开不会自动分配|Starts at 0; expanding does not assign rounds
全部轮次已分配|All rounds assigned
还剩 {0} 轮|{0} rounds left
% 总进度|% total progress
展开|Expand
尚未推进|No progress yet
已有建筑进度|Existing progress
已选任务至少计入 1 轮，或取消推进。|Assign at least one round, or remove this progress.
全部轮次已明确分配，仍会一次性提交。|All rounds assigned; submitted together.
还有|Remaining
轮未分配，可直接提交并明确记为未分配。|rounds unassigned. You can submit them as unassigned.
已分配|Assigned
轮未分配|rounds unassigned
一次提交本次推进|Submit all progress
直接结束计划|Finish plan
{0} 小时{1}|{0} h{1}
 {0} 分钟| {0}m
{0} 分钟|{0} min
{0} {1} 计入轮数|{0} {1} assigned rounds
{0}计入轮数|{0} assigned rounds
{0}轮次分配|{0} round allocation
轮次分配|Round allocation
减少|Decrease
{0} 计入轮数|{0} assigned rounds
增加|Increase
 · 实际 {0}| · actual {0}
当前时间|Current time
每轮时长|Round duration
休息中|Taking a break
剩余专注总时间|Remaining plan time
剩余总时长|Remaining time
距结束|Until end
本轮剩余|Round remaining
不足 1 分钟|Under 1 min
一|Mon
二|Tue
三|Wed
四|Thu
五|Fri
六|Sat
日|Sun
专注日未保存，请重试。|Focus days not saved. Please retry.
计划专注日|Focus days
每周|Per week
天 · 其余为休息日|days · other days are rest days
{0}月|Month {0}
{0}年{1}月{2}日|{0}-{1}-{2}
过去 26 周的投入|Past 26 weeks
专注日历：点击一天，按住拖动选择多天。方向键切换，Shift 加方向键扩选，Escape 回到今天。|Focus calendar: tap a day or drag to select. Arrow keys move, Shift extends, Escape returns to today.
{0} · 尚未到来|{0} · upcoming
{0} · {1} · {2} 次|{0} · {1} · {2} sessions
热力图时长档位|Heatmap time ranges
高亮 {0}|Highlight {0}
最长一天 ·|Longest day ·
按住拖动，可选多天|Drag to select days
时间花在了哪里|Where your time went
开始一次专注，投入会在这里留下记录。|Start a focus session to leave a record here.
{0}专注时间占比。{1}。每个像素约为总投入的 1%，文字显示实际时间。|{0} focus distribution. {1}. Each pixel is about 1%; labels show actual time.
每个像素约占 1%；文字为实际投入。|Each pixel ≈ 1%; labels show actual time.
旗下小任务投入|Subtask time
条长从零开始，按可追溯实际时间比较|Bars compare recorded time from zero
暂时没有可追溯的小任务投入。|No traceable subtask time yet.
纪念建筑|Memorial buildings
正在建造|Under construction
暂停建造|Paused
调整|Adjust
今日 {0} / {1} 轮|Today {0} / {1} rounds
今日已完成 {0} 轮|{0} rounds today
重试|Retry
座| buildings
已完成|Completed
{0}，{1}，{2}，建造进度 {3}%，保存状况 {4}|{0}, {1}, {2}, progress {3}%, condition {4}
世界初始化失败，请重新打开此页面或刷新后重试。|Could not prepare the world. Reopen this page to retry.
正在校准光照与天气…|Preparing lighting & weather…
正在准备地形与建筑…|Preparing terrain & buildings…
正在读取世界资源…|Reading world resources…
正在更新世界材质…|Updating textures…
正在更新世界画面…|Updating world…
项目建筑世界|Settlement world
重置地图|Reset map
重置视角|Reset view
聚落，共|Settlement,\u0020
栋建筑。|buildings.
材质包暂不可用，当前使用默认材质。|Resource pack unavailable; using default textures.
画面设置未完成，部分设置尚未应用。|Some visual settings could not be applied.
重试画面设置|Retry visual settings
聚落建筑|Settlement buildings
查看建筑记忆：|View building memory:\u0020
查看奖励记忆：|View reward memory:\u0020
· 高|· height
正在查看 · {0}|Viewing · {0}
{0}聚落 · {1} 栋|{0} · {1} buildings
饱和度|Saturation
亮度|Brightness
对比度|Contrast
世界色彩|World color
仅调整画面，不改变天气与日夜|Visual only; weather and time stay unchanged
世界{0}|World {0}
恢复默认|Reset to defaults
正常天气|Live weather
画面调试|Visual debug
临时调试世界|Temporary world preview
关闭后恢复；不改变专注记录|Restores when off; history is unchanged
天气|Weather
调试天气|Debug weather
时间|Time
指定时间|Set time
世界调试时间|Debug world time
正常时间|Live time
腐败|Weathering
指定程度|Set amount
世界调试腐败程度|Debug weathering
正常腐败|Live weathering
无法继续专注，请重试。|Could not resume focus. Please retry.
休息后返回工作台|Back to work after the break
下一轮专注 · 全部完成后统一汇报|Next round · report together at the end
结束 {0} · 剩余 {1} · 约 {2} 轮|Until {0} · {1} left · about {2} rounds
{0} 轮 · 结束 {1}|{0} rounds · until {1}
按结束时间排程|Plan by end time
{0} 轮 · 总计 {1}|{0} rounds · {1} total
开始到 {0}|Start until {0}
选择结束时间|Choose end time
开始 {0} 轮|Start {0} rounds
进入极简模式|Enter minimal mode
极简|Minimal
调整本次计划|Adjust this plan
结束本轮专注后才能切换任务。|Finish this round before switching tasks.
先完成当前任务的进度汇报，再切换任务。|Submit this report before switching tasks.
每日奖励记忆|Daily reward memory
获得的建造奖励|Earned building reward
关闭奖励记忆|Close reward memory
本场安排|This plan
习惯轮次直接推进建筑 · 已完成 {0} / {1} 轮|Habit rounds build directly · {0} / {1} complete
本场不指定小任务，结束后统一汇报|No subtask selected; report at the end
当前习惯建筑 · 第|Current habit building ·
本周期|This cycle
轮 ·|rounds ·
当前小任务|Current subtask
准备第|Ready for
本轮专注因达到离开应用次数上限而结束。下次可以从这里继续。|Round ended at the away limit. Continue here when ready.
调整计划|Adjust plan
返回完整模式|Full mode
有效离开|Times away
次| times
退出极简模式|Leave minimal mode
专注中 第{0}/{1}轮|Focusing · {0}/{1}
跳过休息|Skip break
正在开始…|Starting…
开始下一轮|Start next round
结束本次专注|End this focus
双击下方空白处唤出结束按钮|Double-tap the blank area to end focus
马拉松 第 {0} / {1} 轮|Marathon · {0}/{1}
已关闭 · 本机位置缓存未能清除|Off · could not clear cached location
已关闭 · 聚落继续使用本地天气|Off · using local weather
当前显示 {0}{1}{2}{3}|Showing {0}{1}{2}{3}
现实天气|Real weather
 · 使用本机上次保存的位置| · cached location
 · 数据时间 {0}| · observed {0}
 · 正在刷新| · refreshing
尚未同步 · 返回计时页后开始获取|Not synced · fetched on returning to Timer
正在同步现实天气 · 当前暂用本地天气|Syncing real weather · local weather for now
{0} · 当前使用本地天气{1}|{0} · using local weather{1}
 · 已暂停自动重试；处理后关闭并重新开启天气同步| · retries paused; toggle sync after resolving
天文增强已关闭|Astronomy sync off
天文日历已同步 · 日月方向按本地时间连续计算|Calendar synced · continuous local sun & moon positions
日历暂不可用 · 按已授权位置本地历算|Calendar unavailable · local calculation at authorized location
正在获取天文日历|Fetching astronomy calendar
天文位置不可用 · 聚落继续使用本地光照|Location unavailable · using local lighting
天文日历尚未同步|Astronomy calendar not synced
数据来源：|Source:\u0020
和风天气|QWeather
查看天气与天文数据归因 {0}|View weather & astronomy attribution {0}
数据归因 ↗|Attribution ↗
本地天气|Local weather
当前天气|Current weather
当前天气：|Current weather:\u0020
本地|Local
完成轮次|Completed rounds
中断投入|Interrupted time
无|None
另有|Also
条记录无法追溯|records untraceable
，未分摊。|; not allocated.
其他 {0} 项任务|{0} other tasks
展示回执未保存；本次已关闭，之后进入统计时可能再次提示。|Dismissal not saved; this may appear again.
今天|Today
专注轨迹|Focus trail
专注与建造，按时间回看。|Your focus and buildings, over time.
按时间范围统计|Statistics by date range
有效专注摘要|Effective focus summary
的投入|time
有效完成轮次 / 目标完成轮次|Effective rounds / goal rounds
活跃日|Active days
建造留下的记录|Built memories
累计|Total
座已完成|buildings complete
展示可追溯投入；旧记录单列，不估算分配。|Recorded time shown; older untraceable records kept separate.
完成一项大型任务或习惯建筑后，这里会保留它的投入记忆。|Completed projects and habits leave their time records here.
已完成习惯建筑|Completed habit building
已完成大型任务|Completed project
 · {0} / {1} 轮可追溯| · {0} / {1} traceable rounds
 · {0} 轮可追溯| · {0} traceable rounds
 · {0} 条中断| · {0} interruptions
实际投入|Actual time
{0} 条 · {1}|{0} records · {1}
完成时间|Completed
未知|Unknown
未分配的投入|Unassigned time
{0} 个完成轮次|{0} completed rounds
{0} 条中断记录|{0} interruptions
· 无法追溯，不估算分配|· untraceable; no estimated allocation
选择下一座习惯建筑|Choose next habit building
完成本周期第 {0} / {1} 轮|Complete round {0} / {1} this cycle
未能切换任务，请重试。|Could not switch task. Please retry.
建筑记忆 ·|Building memory ·
关闭建筑记忆|Close building memory
建造进度 {0}%|Building progress {0}%
累计实际投入|Total recorded time
尚无记录|No records yet
{0} 条 · {1} 分钟|{0} records · {1} min
最近一次专注|Last focus
（{0} 分钟）|({0} min)
下一步|Next step
正在切换…|Switching…
继续专注|Resume focus
继续这个任务|Continue task
已完成并保留为聚落记忆。投入分布见统计页“纪念建筑”。|Completed and kept as a memory. See time distribution in Statistics.
完整|Intact
风化|Weathered
破损|Damaged
保存完整|Intact
已有风化|Weathered
需要修复|Needs repair
场地准备|Site preparation
地基施工|Foundations
框架与地板|Frame & floors
墙体施工|Walls
屋顶施工|Roof
门窗与收尾|Doors, windows & finishing
建筑已完成|Building complete
等待网络后继续|Waiting for network
下载|Downloading
，安装包暂不可验证|; package cannot be verified yet
紧凑|Compact
适中|Medium
丰富|Rich
选择建筑蓝图|Choose blueprint
蓝图在创建后不可更换，请确认完整预览。|Blueprint is fixed after creation. Review the preview.
{0}完整建筑预览，可拖动旋转|{0} building preview; drag to rotate
重置预览视角|Reset preview view
没有可选项|No choices available
今日装饰|Today's decoration
保存今日目标失败，请重试。|Could not save daily goal. Please retry.
今日目标|Daily goal
所有任务合计|All tasks combined
调整今日目标|Adjust daily goal
轮已完成|rounds complete
轮 · 目标未开启|rounds · goal off
再完成|Complete
轮，达成今日目标|more rounds to reach today's goal
今日装饰已入库 ·|Today's decoration saved ·
今日已达成|Today's goal reached
每日建造|Daily building
关闭今日目标|Close daily goal
今日已完成 {0} / {1} 轮|Today {0} / {1} rounds
今日目标完成进度|Daily goal progress
开启今日目标|Enable daily goal
达成后获得今日装饰|Reach the goal to earn a decoration
已开启|On
已关闭|Off
目标轮数|Goal rounds
预计\u0020|Preview\u0020
今日目标次数|Daily goal rounds
原目标 {0} 轮保留；调整范围 0–20 轮。|Original goal {0} kept; adjustable range 0–20.
0 轮关闭目标；松手后保存。|0 turns the goal off; release to save.
今日装饰已入库|Today's decoration saved
查看所在建筑|View in world
上一座已完成|Previous building complete
选择第|Choose building
座建筑|building
已留下|Built
座建筑；下一座需要|buildings; the next requires
轮专注。确认后，本周期内不能更换。|focus rounds. Fixed for this cycle after confirmation.
正在确定...|Confirming…
开始建造这座建筑|Start this building
时钟|Clock
今日专注时间轴|Today's focus timeline
极简信息面板：{0}|Minimal panel: {0}
面板获得焦点后，按向左或向右方向键切换内容。|Focus this panel, then use left/right arrows to switch.
面板|Panel
{0} 小时 {1} 分钟|{0}h {1}m
今日专注|Today's focus
 / {0} 轮| / {0} rounds
今日实际专注 {0}，横轴零点至二十四点，每小时最多堆叠四格，每格代表该小时内一段实际专注的十五分钟，颜色代表小任务或习惯。|Today's focus {0}. Timeline covers 0–24h; each square is 15 minutes, colored by subtask or habit.
未分配 · {0}|Unassigned · {0}
今天的专注会留在这里|Today's focus appears here
时长按今日实际区间 · 轮次按完成日|Time by today's overlap · rounds by completion date
已导入并启用：{0} 张纹理、{1} 个状态、{2} 个模型。|Imported & enabled: {0} textures, {1} states, {2} models.
已切回方块钟原创材质。|Original Blockcolc textures enabled.
已切换外观资源包；缺失资源仍可由基础包补全。|Appearance changed; base pack fills missing resources.
已关闭基础资源包。|Base pack disabled.
已设置基础资源包，将补全当前外观包缺失的资源。|Base pack set; fills missing appearance resources.
已删除资源包；相关外观或基础层已自动取消。|Pack deleted; its active layers were removed.
已删除资源包。|Pack deleted.
方块材质包|Resource packs
导入 ZIP 或 Java 26.3 JAR，外观优先、基础包补缺。|ZIP or Java 26.3 JAR; base fills missing textures.
方块钟原创材质|Blockcolc original
正在使用|Active
安全回退外观|Safe fallback
切换中…|Switching…
使用中|Active
使用|Use
尚未读取本机资源包。|Resource packs not loaded yet.
正在读取本机资源包…|Reading resource packs…
无法读取资源包：|Could not read pack:\u0020
正在导入…|Importing…
导入 Java 资源包 ZIP / JAR|Import Java pack ZIP / JAR
资源需自备并有权使用，不上传、不含在备份中；缺失部分用原创材质。|Use packs you have rights to. Local only, excluded from backups; missing textures use originals.
本机尚无导入的资源包。|No imported packs yet.
张纹理 ·|textures ·
外观层|Appearance
基础层|Base
保存中…|Saving…
取消基础|Remove base
设为基础|Set as base
删除这个资源包？|Delete this pack?
删除后会立即回退到方块钟原创材质。|Returns to original textures.
删除后会取消这个资源包的外观或基础层；其他已选资源包仍保留。|Removes this pack's layers; other selections remain.
只删除本机保存的资源包，不影响任务与蓝图。|Deletes the local pack only; tasks and blueprints stay.
删除中…|Deleting…
删除资源包|Delete pack
未命名资源包|Untitled pack
资源包超过当前格式的导入上限（普通 ZIP 32 MB，26.3 客户端 JAR 64 MB）。|Pack too large (ZIP 32 MB; 26.3 client JAR 64 MB).
资源包中有单个文件超过 4 MB 安全上限。|A pack entry exceeds 4 MB.
资源包展开后超过 64 MB 安全上限。|Unpacked resources exceed 64 MB.
资源包文件数超过当前格式的安全上限。|Too many pack entries.
资源包缺少有效的 pack.mcmeta；客户端 JAR 还需为 Java 26.3。|Missing valid pack.mcmeta; client JAR must be Java 26.3.
资源包包含不安全、重复、大小写冲突或加密的文件路径。|Pack contains unsafe, duplicate, case-conflicting or encrypted paths.
无法解析这个 Java 资源包。|Cannot parse this Java resource pack.
资源包操作失败，请重试。|Resource pack operation failed. Please retry.
已有进度后不能删除|Cannot delete after progress
至少保留一个小任务|Keep at least one subtask
已有专注记录的小任务不能删除|Cannot delete a subtask with focus history
把要做的事，排成下一步建造|Turn your to-do list into your next building
任务选择与创建|Choose or create tasks
我的任务|My tasks
当前任务|Current task
习惯 · 等待选择建筑|Habit · choose a building
习惯 · {0} / {1} 轮|Habit · {0} / {1} rounds
查看聚落|View settlement
查看建筑|View building
请先结束或汇报当前专注|Finish or report this focus first
当前任务详情|Current task details
任务名称|Task name
保存任务名称|Save task name
取消修改|Cancel editing
修改任务名称|Edit task name
习惯周期|Habit cycle
每次完整或提前完成的专注都会推进当前建筑。|Completed and early-finished rounds advance this building.
等待下一座建筑|Waiting for next building
第 {0} 座建筑|Building {0}
待选择|Not chosen
习惯周期进度|Habit cycle progress
已完成建筑|Completed buildings
当前蓝图|Current blueprint
前往计时页选择|Choose in Timer
本周期内锁定|Fixed for this cycle
施工清单|Construction list
项| items
结束编辑施工清单|Finish editing construction list
编辑施工清单|Edit construction list
已有进度后不能增删，可继续改名和排序。|After progress, rename and reorder only.
后续任务|Next tasks
删除任务|Delete task
请先结束当前专注，才能删除任务。|End the current focus before deleting tasks.
当前未完成建筑会移除，已完成的 {0} 座建筑会保留。删除前仍会创建回滚备份。|Removes the unfinished building; keeps {0} completed buildings. Rollback saved first.
删除前会自动创建本地回滚备份，可在设置中恢复。|Rollback saved before deletion. Restore in Settings.
请先结束当前专注后再删除任务|End focus before deleting this task
删除当前任务|Delete current task
删除这个小任务？|Delete this subtask?
删除小任务|Delete subtask
”将被永久删除，剩余小任务会重新等分建筑进度。此操作无法撤销。|” will be deleted; remaining subtasks share progress equally. This cannot be undone.
删除这项任务？|Delete this task?
“{0}”的当前未完成建筑会被移除，已完成的 {1} 座建筑仍留在聚落中。|“{0}”: unfinished building removed; {1} completed buildings kept.
“{0}”会从当前世界中移除。|“{0}” will be removed from this world.
习惯|Habit
暂停|Paused
纪念|Memorial
任务总览与管理|Task overview & management
第 {0} 座 · {1}/{2} 轮|Building {0} · {1}/{2} rounds
习惯 · |Habit ·\u0020
{0} 建造进度|{0} building progress
查看|View
{0}，已完成 {1}%。双击或按 Enter 修改名称。|{0}, {1}% complete. Double-tap or Enter to rename.
长按拖动“{0}”排序；使用方向键微调|Hold and drag “{0}” to reorder; arrow keys adjust
小任务名称|Subtask name
{0} 施工进度|{0} construction progress
保存小任务名称|Save subtask name
{0} {1} 项|{0} {1} items
处理中…|Working…
萌芽|Sprout
完整茎|Stem
青番茄|Green tomato
成熟|Ripe
落果|Fruit drops
暂未切换，请重试。|Could not switch. Please retry.
建造记录已保留|Building records kept
继续哪项工作？|What's next?
给下一项工作留个位置|Make room for your next task
可以回看建筑，也可以开始新的任务。|Revisit buildings or start a new task.
新建任务|New task
还没有可展示的成就，继续专注会逐步点亮。|Keep focusing to unlock achievements.
成就|Achievements
从第一天起的专注与建造记录。|Your focus and buildings, from day one.
已解锁|Unlocked
进度 {0} / {1} {2}|Progress {0} / {1} {2}
专注与建造的记录|Focus & building records
新的成就|New achievements
这些事实已经满足。关闭后只会在新的成就出现时再次提示。|You've earned these. Next time, only new unlocks appear.
获得于 {0}|Earned {0}
获得时间未知（历史记录无法推导）|Earned date unknown (not in history)
全部关闭|Dismiss all
{0}介绍|About {0}
关闭节日介绍|Close holiday introduction
计划待继续：双击剩余专注总时间或按 Enter 开始下一轮|Plan ready: double-tap remaining time or Enter for the next round
双击休息中计时或按 Enter 跳过休息并继续专注|Double-tap the break clock or Enter to skip the break
明天|Tomorrow
未选择结束时间|No end time selected
结束时间，上下滑动或按方向键调整|End time; swipe vertically or use arrow keys
专注到{0} {1}，双击或按 Enter 开始专注|Focus until {0} {1}; double-tap or Enter to start
当前时间 {0}，上下滑动或按方向键选择结束时间|Current time {0}; swipe or use arrows to choose end time
上下滑动调整|Swipe to adjust
{0}上下滑动调整|{0} swipe to adjust
{0}结束 · |Until {0} ·\u0020
{0}结束 · 双击确认|Until {0} · double-tap to confirm
极简模式|Minimal mode
专注到|Focus until
关闭专注到|Close focus-until sheet
结束时间|End time
时|h
减少结束小时|Decrease end hour
结束小时|End hour
增加结束小时|Increase end hour
分|min
减少结束分钟|Decrease end minute
结束分钟|End minute
增加结束分钟|Increase end minute
全部轮次结束后，统一提交进度。|Submit progress after all rounds.
开始 · 至 {0}|Start · until {0}
极简专注模式|Minimal focus mode
开始专注|Start focus
启动直接进入沉浸计时|Launch into immersive Timer
开启极简模式|Enable minimal mode
，预计落点|, predicted landing
预计|Preview
每格最多|Per square, up to
读取记录…|Reading records…
准备页面…|Preparing page…
读取资源…|Reading resources…
建造世界…|Building world…
正在准备世界…|Preparing world…
操作失败，请重试。|Operation failed. Please retry.
暂时无法读取更新状态，请重试。|Could not read update status. Please retry.
更新未完成，请重试。|Update interrupted. Please retry.
新版暂未提供可验证的安装包。|No verifiable package for this release yet.
允许此来源后，返回并点击安装更新。|Allow this source, then return and install.
请在系统安装页面确认；取消后仍可继续使用。|Confirm in the system installer. Cancelling keeps this version.
把事情建成建筑|Build your work into a world
建立任务|Create tasks
首次选一个大任务或习惯任务，再挑建筑。大任务拆成小任务；习惯按轮次建造。|Choose a project or habit, then a building. Projects use subtasks; habits build by rounds.
管理清单|Manage your list
在任务页切换、新增或暂停任务，改名和排序；有进度后不能增删小任务。|Switch, add, pause, rename and reorder in Tasks. Subtasks cannot be added or removed after progress.
自己的蓝图|Your own blueprints
新建任务或设置里可导入 .litematic，先看预览再使用。|Import .litematic in task creation or Settings. Preview before using.
开始、休息、汇报|Focus, rest, report
安排节奏|Set your rhythm
计时页「调整」选固定轮次或结束时间，确认后开始。多轮间可休息。|Choose fixed rounds or an end time in Timer → Adjust. Confirm, then start. Breaks are optional.
极简操作|Minimal controls
设置开启极简；空闲时上下滑时间、双击开始，信息面板左右切换。|Enable Minimal in Settings. Swipe time up/down, double-tap to start; swipe the panel sideways.
结束与提交|Finish & submit
点计时面板显示结束按钮，可提前完成或中止；统一汇报时分配轮次并提交进度。|Tap the timer to reveal End. Finish early or interrupt; assign rounds and submit in the report.
逛逛你的聚落|Explore your settlement
转动与缩放|Rotate & zoom
拖动世界旋转，双指缩放；点建筑查看记忆，以它为中心转动。|Drag to rotate, pinch to zoom. Tap a building to see its memory and orbit around it.
返回全景|Back to the map
点世界右上角显示控件；地图按钮回聚落，复位按钮恢复视角。|Tap the world's top-right corner for controls. Map returns to the settlement; Reset restores the view.
奖励建筑|Reward buildings
每日目标达成后获得装饰；奖励也能点看，完成的大任务成为纪念建筑。|Daily goals earn decorations. Rewards are tappable; completed projects become memorials.
让投入留下痕迹|Leave a trace of your time
任务页调整当天目标轮数，0 轮关闭。设置中选择计划专注日。|Set today's round goal in Tasks; 0 turns it off. Choose focus days in Settings.
习惯与节日|Habits & holidays
习惯完成一座后可选下一座。节日挂件点按可读介绍，专注还可能留下节日建筑。|Choose a new building after finishing a habit cycle. Tap holiday emblems for an introduction; focus may earn a holiday building.
继续工作|Continue your work
建筑记忆可继续对应任务；未分配的轮次仍保留在统计中。|Resume a task from its building memory. Unassigned rounds remain in Statistics.
回看时间花在哪里|See where your time went
选择日期|Choose dates
点热力图看一天，按住拖动选多天；下方团簇显示各任务投入。|Tap a heatmap day, or drag to select several. Pixel clusters below show time per task.
比较投入|Compare time
点时长档位高亮对应日期，最高档还标记专注最长的一天。|Tap a time range to highlight matching days. The top range also marks your longest day.
纪念与成就|Memories & achievements
向下看完成建筑及小任务投入、已解锁与未解锁成就；新成就会弹出提示。|Scroll for completed buildings, subtask time and locked/unlocked achievements. New unlocks appear in a dialog.
按自己的习惯调整|Make it yours
外观与世界|Appearance & world
设置里切字体、主题、聚落和光影；玻璃与色彩滑杆可拖动，也能把小球拉开弹出。|Choose fonts, theme, environment and lighting in Settings. Drag sliders, or pull and launch the bead.
天气与保护|Weather & protection
可选同步现实天气、自动连续专注、离开保护和返回提醒；按实际需要开启。|Optional real weather, auto-continuation, away protection and return reminders. Enable what you need.
材质与数据|Textures & data
导入材质包改世界外观；自动备份之外，也可导出、导入和恢复。关于页检查更新，本教程可在设置重看。|Import texture packs; export, import or restore backups. Check updates in About. Revisit this tour in Settings.
栋|buildings
天|days
第一块基石|First foundation
完成第一轮专注|Complete your first focus round
渐入佳境|Finding your rhythm
累计完成 10 轮专注|Complete 10 focus rounds
日积月累|Steady progress
累计完成 50 轮专注|Complete 50 focus rounds
百轮成形|A hundred rounds
累计完成 100 轮专注|Complete 100 focus rounds
投入一小时|One hour in
累计记录 60 分钟实际专注|Record 60 minutes of focus
十小时的形状|The shape of ten hours
累计记录 600 分钟实际专注|Record 600 minutes of focus
长路有光|Light on the long road
累计记录 1500 分钟实际专注|Record 1,500 minutes of focus
初见落成|First building
完成第一栋普通或习惯建筑|Complete your first project or habit building
聚落初成|A settlement begins
累计完成 5 栋普通或习惯建筑|Complete 5 project or habit buildings
十景相连|Ten landmarks
累计完成 10 栋普通或习惯建筑|Complete 10 project or habit buildings
七日足迹|Seven days of focus
在 7 个不同日期完成专注，无需连续|Complete focus on 7 different days; no streak needed
三十日留痕|Thirty days of focus
在 30 个不同日期完成专注，无需连续|Complete focus on 30 different days; no streak needed
元旦|New Year's Day
烟花|Fireworks
礼盒|Gift box
星星|Stars
烟花与礼盒，迎接公历新年的开始。|Fireworks and gifts welcome the new calendar year.
烟花观景台|Fireworks lookout
春节|Lunar New Year
灯笼|Lanterns
结绳|Decorative knots
爆竹|Firecrackers
灯笼与爆竹，迎接农历新年与团聚。|Lanterns and firecrackers welcome the lunar new year and family reunions.
双灯笼小亭|Twin-lantern pavilion
情人节|Valentine's Day
心形|Hearts
玫瑰|Roses
信封|Letters
玫瑰与信笺，传递爱意和心意。|Roses and letters share love and affection.
玫瑰邮筒庭院|Rose mailbox courtyard
元宵节|Lantern Festival
汤圆|Tangyuan
正月十五赏花灯，汤圆寓意团圆。|Lanterns mark the first lunar full moon; tangyuan symbolize reunion.
花灯台|Lantern terrace
国际妇女节|International Women's Day
含羞草|Mimosa
书|Books
含羞草与书，纪念女性的贡献与平等权利。|Mimosa and books celebrate women's contributions and equal rights.
金色阅读花园|Golden reading garden
诺鲁孜节|Nowruz
嫩芽|Sprouts
苹果|Apples
镜子|Mirrors
伊朗与中亚等地迎新春；嫩芽与镜子象征更新。|A new spring in Iran and Central Asia; sprouts and mirrors symbolize renewal.
春芽玻璃花房|Spring greenhouse
泰国宋干节|Songkran
水滴|Water drops
花碗|Flower bowls
泰国新年以水迎新，花碗盛着清凉祝福。|Thailand welcomes its new year with water and refreshing blessings.
水轮花庭|Waterwheel garden
劳动节|Labour Day
锤子|Hammers
齿轮|Gears
多国在五月一日纪念劳动者；工具象征创造。|May 1 honors workers in many countries; tools symbolize creation.
工具工坊|Tool workshop
非洲日|Africa Day
非洲轮廓|Africa silhouette
绿叶|Leaves
五月二十五日纪念非洲的团结与多样文化。|May 25 celebrates African unity and cultural diversity.
绿荫阅读庭院|Shaded reading courtyard
儿童节|Children's Day
风车|Windmills
积木|Blocks
气球|Balloons
中国及多国在六月一日庆祝；积木与风车寄托童趣。|June 1 celebrates children in China and many countries, with playful blocks and windmills.
积木风车屋|Block windmill house
端午节|Dragon Boat Festival
粽子|Zongzi
龙舟|Dragon boats
农历五月初五，粽子与龙舟是传统节日意象。|Zongzi and dragon boats mark the fifth day of the fifth lunar month.
龙舟停泊台|Dragon boat dock
美国独立日|US Independence Day
星条旗|Stars and Stripes
七月四日纪念美国独立；星条旗与烟花是常见庆祝意象。|July 4 marks US independence with flags and fireworks.
星光烟花亭|Starlight fireworks pavilion
法国国庆日|Bastille Day
三色旗串|Tricolor bunting
法国七月十四日以三色旗与烟花庆祝国庆。|France celebrates July 14 with tricolor flags and fireworks.
烟花小花园|Fireworks garden
中秋节|Mid-Autumn Festival
月饼|Mooncakes
桂花|Osmanthus
玉兔|Jade rabbit
农历八月十五，月饼与桂花寄托团圆。|Mooncakes and osmanthus celebrate reunion on the eighth lunar month's full moon.
桂花赏月亭|Osmanthus moon pavilion
慕尼黑啤酒节|Oktoberfest
椒盐卷饼|Pretzels
啤酒花|Hops
杯|Mugs
德国慕尼黑的秋季庆典，以卷饼、啤酒花和蓝白棚为意象。|Munich's autumn celebration features pretzels, hops and blue-white tents.
蓝白市集棚|Blue-white market tent
中国国庆节|China National Day
红旗|Red flags
十月一日纪念中华人民共和国成立；红旗、灯笼与烟花装点庆祝。|October 1 marks the founding of the PRC, with flags, lanterns and fireworks.
红旗灯笼亭|Red-flag lantern pavilion
万圣节|Halloween
南瓜灯|Jack-o'-lanterns
糖果|Candy
蝙蝠|Bats
十月末的节日庆祝，以南瓜灯、糖果和蝙蝠点缀。|An end-of-October celebration with carved pumpkins, candy and bats.
南瓜糖果屋|Pumpkin candy house
墨西哥亡灵节|Día de los Muertos
万寿菊|Marigolds
剪纸彩旗|Papel picado
烛光|Candles
主要在十一月一至二日，以花与彩纸追思亲友。|Flowers and paper banners remember loved ones, mainly November 1–2.
万寿菊记忆花廊|Marigold memory gallery
圣诞节|Christmas
常青树|Evergreens
铃铛|Bells
常青树、礼物与铃铛，是广泛使用的庆祝意象。|Evergreens, gifts and bells are widely used festive symbols.
礼物松林屋|Pine gift house
巴西狂欢节|Brazilian Carnival
彩色小伞|Colorful umbrellas
鼓|Drums
巴西的年度狂欢庆典，以彩伞与鼓表现音乐和色彩。|Brazil's annual carnival celebrates music and color with umbrellas and drums.
彩伞音乐亭|Colorful music pavilion
第{0}/{1}轮|Round {0}/{1}
音频不能超过 64 MiB|Audio must be no larger than 64 MiB
最多保存 8 份音频|Save up to 8 audio files
无法读取这份音频|Could not read this audio
音频格式暂不支持|Unsupported audio format
请选择三小时以内的音频|Choose audio under 3 hours
河岸木屋|Riverside timber house
带挑出上层、烟囱和双层木构的宽体住宅。|A broad timber home with an overhanging upper floor and chimney.
村庄礼拜堂|Village chapel
拥有石砌礼拜空间、钟塔与高耸屋脊的聚落地标。|A stone village landmark with a bell tower and tall roof.
小型工坊|Small workshop
林边工坊|Woodland workshop
石基、木墙与陡坡屋顶组成的紧凑工坊。|A compact workshop with a stone foundation, timber walls and a steep roof.
蓝图库暂不可用，请稍后重试|Blueprint library unavailable. Please try again.
所有图纸|All blueprints
原生、导入与建造奖励|Built-in, imported and earned
蓝图名称|Blueprint name
奖励装饰上限 12 × 12 × 16、2,000 个方块。|Rewards: up to 12 × 12 × 16 and 2,000 blocks.
便签|Notes
简易便签|Quick notes
任务页与极简面板共用清单|One checklist in Tasks and the minimal panel
写一条便签|Write a note
添加便签|Add note
完成便签：{0}|Complete note: {0}
删除便签：{0}|Delete note: {0}
便签未保存，请重试。|Note not saved. Please try again.
计时已开始；系统通知当前不可用，回到应用时仍会正确恢复。|Focus started. System notifications are unavailable; your timer will recover when you return.
去设置|Open Settings
本轮已记录，有效专注时间已计入统计。|Round recorded. Your focus time is included in statistics.
这座习惯建筑已完成，请选择下一座建筑。|Habit building complete. Choose your next building.
习惯专注已推进一轮，实际专注时间已记录。|Habit advanced by one round. Your actual focus time is recorded.
本轮已提前完成，实际专注时间已记录。|Round finished early. Your actual focus time is recorded.
小任务已提前完成，实际专注时间已记录。|Subtask finished early. Your actual focus time is recorded.
系统提醒已开启，但未获精准闹钟权限，锁屏时可能略有延迟。|Reminders are on, but exact-alarm access is unavailable. Locked-screen reminders may be delayed.
任务已删除，已完成的习惯建筑仍保留在聚落中。|Task deleted. Completed habit buildings stay in your settlement.
未分配 / 不可追溯|Unassigned / untraceable
已完成便签|Completed notes
留一件小事，慢慢完成。|One small thing at a time.
{0}结束 · 上下滑动调整|Ends {0} · swipe up or down
现实天气|Real weather
少云|Few clouds
晴间多云|Partly cloudy
阴|Overcast
阵雨|Showers
强阵雨|Heavy showers
雷阵雨|Thundery showers
强雷阵雨|Heavy thundery showers
雷阵雨伴有冰雹|Thunder and hail
中雨|Moderate rain
大雨|Heavy rain
极端降雨|Extreme rain
毛毛雨/细雨|Drizzle
暴雨|Torrential rain
大暴雨|Very heavy rain
特大暴雨|Severe rainstorm
冻雨|Freezing rain
小到中雨|Light to moderate rain
中到大雨|Moderate to heavy rain
大到暴雨|Heavy to torrential rain
暴雨到大暴雨|Intense rainstorm
大暴雨到特大暴雨|Severe rainstorm
中雪|Moderate snow
大雪|Heavy snow
暴雪|Blizzard
雨夹雪|Sleet
雨雪天气|Rain and snow
阵雨夹雪|Wintry showers
阵雪|Snow showers
小到中雪|Light to moderate snow
中到大雪|Moderate to heavy snow
大到暴雪|Heavy snow to blizzard
薄雾|Mist
霾|Haze
扬沙|Blowing sand
浮尘|Dust
沙尘暴|Dust storm
强沙尘暴|Severe dust storm
浓雾|Dense fog
强浓雾|Very dense fog
中度霾|Moderate haze
重度霾|Heavy haze
严重霾|Severe haze
大雾|Thick fog
特强浓雾|Extremely dense fog
热|Hot
冷|Cold
 · 使用本机上次保存的位置| · cached location
 · 数据时间 {0}| · observed {0}
 · 正在刷新| · refreshing
 · 已暂停自动重试；处理后关闭并重新开启天气同步| · retry paused; toggle real weather after resolving
Dieight的高级火柴盒|Dieight's Advanced Matchbox
Dieight的高级火柴盒plus|Dieight's Advanced Matchbox Plus
Dieight的高级火柴盒pro|Dieight's Advanced Matchbox Pro
GYPpro的简易小仓库|GYPpro's Small Warehouse
Dieight的神秘附魔台|Dieight's Enchanting Corner
Dieight的小别墅|Dieight's Small Villa
Dieight的小水箱|Dieight's Water Tank
karry_steven的豪宅|karry_steven's Mansion
GYPpro的豪宅（一层）|GYPpro's Mansion (First Floor)
m0m0kA_QWQ的小黄鸭|m0m0kA_QWQ's Little Duck
Dieight的挂机池|Dieight's AFK Pool
Dieight的圣诞树|Dieight's Christmas Tree
Dieight的昔涟Q版手办_byMC烤河马|Dieight's Chibi Cyrene · MC Kaohema
GYPpro的挂机点|GYPpro's AFK Spot
GYPpro的昔涟-仪式剑|GYPpro's Cyrene Ritual Sword
GYPpro的樱花仓库熔炉|GYPpro's Cherry Storage & Furnace
GYPpro的樱花树|GYPpro's Cherry Tree
m0m0kA_QWQ的神秘小房子|m0m0kA_QWQ's Mysterious Cottage
Togawa15akiko的豪宅|Togawa15akiko's Mansion
Togawa15akiko的刷铁机|Togawa15akiko's Iron Farm
zdrcgubjo4的铁傀儡|zdrcgubjo4's Iron Golem
zdrcgubjo4的小喷泉|zdrcgubjo4's Small Fountain
Dieight的高级火柴盒：方正的火柴盒小屋，以简洁立面呈现紧凑轮廓。|Dieight: a compact box-shaped home with a simple facade.
Dieight的高级火柴盒plus：在方盒外形上增加层次的进阶小屋。|Dieight: a box-shaped home with extra architectural layers.
Dieight的高级火柴盒pro：轮廓更丰富、立面更完整的火柴盒住宅。|Dieight: a matchbox home with a fuller facade and varied silhouette.
GYPpro的简易小仓库：以方正体量和简洁屋顶构成的小型仓库。|GYPpro: a small warehouse with a square plan and simple roof.
Dieight的神秘附魔台：以附魔台为中心的神秘魔法角落。|Dieight: a mysterious nook built around an enchanting table.
Dieight的小别墅：有舒展屋顶与开阔立面的独栋小别墅。|Dieight: a detached villa with a broad roof and open facade.
Dieight的小水箱：小巧的储水装饰，以方正箱体呈现水面。|Dieight: a compact water tank framed by a square rim.
karry_steven的豪宅：体量宽阔、层次分明的宅邸。|karry_steven: a spacious mansion with clearly layered volumes.
GYPpro的豪宅（一层）：以宽大的首层平面展开的宅邸雏形。|GYPpro: the broad first-floor layout of a future mansion.
m0m0kA_QWQ的小黄鸭：小黄鸭造型装饰，有圆润身体和醒目的喙。|m0m0kA_QWQ: a little duck with a rounded body and a bright beak.
Dieight的挂机池：围绕水面搭成的小型挂机池，池沿勾勒出紧凑轮廓。|Dieight: a small AFK pool with a neatly framed water surface.
Dieight的圣诞树：层层收拢的枝叶与节日装点组成一棵方块圣诞树。|Dieight: a festive block tree with tiers of tapering branches.
Dieight的昔涟Q版手办（MC烤河马制作）：以方块塑成的Q版人物手办，呈现鲜明的人物轮廓。|Dieight · built by MC Kaohema: a block-built chibi Cyrene figurine.
GYPpro的挂机点：集中布置的紧凑挂机角落，以小巧方块构件组成。|GYPpro: a compact AFK corner made from small block structures.
GYPpro的昔涟-仪式剑：以细长剑身和醒目剑饰构成的仪式剑造型。|GYPpro: a slender ritual sword with distinctive ornamental details.
GYPpro的樱花仓库熔炉：以樱花木搭起的仓储与熔炉建筑，兼具温柔配色和实用布局。|GYPpro: cherry-wood storage and furnaces in a soft, practical layout.
GYPpro的樱花树：舒展的枝干托起层叠花冠，形成柔和的樱花树轮廓。|GYPpro: spreading branches beneath a layered cherry-blossom canopy.
m0m0kA_QWQ的神秘小房子：紧凑屋身与独特屋顶组成一间神秘小屋。|m0m0kA_QWQ: a mysterious little cottage beneath a distinctive roof.
Togawa15akiko的豪宅：宽阔宅邸以丰富的体量和立面层次展开。|Togawa15akiko: a broad mansion with richly layered volumes and facades.
Togawa15akiko的刷铁机：分层平台与收集结构组成的方块机械建筑。|Togawa15akiko: an iron farm with tiered platforms and collection channels.
zdrcgubjo4的铁傀儡：宽肩长臂的铁傀儡造型，以方块呈现守卫姿态。|zdrcgubjo4: a broad-shouldered, long-armed iron golem standing guard.
zdrcgubjo4的小喷泉：围绕中央水景展开的小型喷泉，池边构件形成整齐轮廓。|zdrcgubjo4: a small fountain with neatly arranged poolside details.
自然白噪音|Nature sounds
删除音频：{0}|Delete audio: {0}
所有聚落共用一个声音|One sound across all environments
晨间鸟鸣|Morning birdsong
随天气播放雨声|Rain with the weather
下雨时自动叠加，放晴停止|Layer rain when it rains; stop when it clears
轻雨|Gentle rain
主音轨|Main sound
最多 8 份 · 单份 64 MiB · 主音轨仅播放一份|8 files · 64 MiB each · one main sound
`.trim().split('\n').map(line=>{const at=line.indexOf('|');return [decode(line.slice(0,at)),decode(line.slice(at+1))];}));
