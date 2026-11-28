package com.blockcolc.presentation

import java.util.Locale

data class SettingsGroup(val id:String,val title:String,val english:String)
data class SettingsEntry(val id:String,val group:String,val title:String,val english:String,val parents:List<String> = emptyList(),val keywords:String="")

/** Navigation/search is only an index into the existing preference controls.
 * It never stores a second value, invokes a setting, or changes a form draft. */
object SettingsCatalog {
    val groups=listOf(
        SettingsGroup("appearance","呈现与阅读","Presentation & reading"),
        SettingsGroup("world","世界与建筑","World & buildings"),
        SettingsGroup("timing","专注节律与护航","Focus rhythm & protection"),
        SettingsGroup("extras","声音与生活点缀","Audio & daily touches"),
        SettingsGroup("account","账户与互联","Account & connections"),
        SettingsGroup("advanced","数据、调试与版本","Data, debug & version"),
    )
    val entries=listOf(
        SettingsEntry("液态玻璃","appearance","液态玻璃","Liquid glass",keywords="沉浸计时玻璃 透明度 transparency"),
        SettingsEntry("主题","appearance","主题","Theme",keywords="深色 浅色 dark light"),
        SettingsEntry("界面语言","appearance","界面语言","App language",keywords="English 简体中文"),
        SettingsEntry("字体","appearance","字体","Fonts",keywords="像素 系统 混合 pixel system mixed"),
        SettingsEntry("极简模式","appearance","极简模式","Minimal mode"),
        SettingsEntry("世界叙事模式","world","世界叙事模式","World display mode",keywords="大世界 单体 建筑 叙事 settlement single building"),
        SettingsEntry("单体画面背景","world","单体画面背景","Single-building backdrop",keywords="展台 天光 建筑展台 真实天光 maquette sky plinth"),
        SettingsEntry("聚落环境","world","聚落环境","Settlement",keywords="空岛 山谷 海岛 海岸 island valley coast"),
        SettingsEntry("光影质量","world","光影质量","Lighting quality"),
        SettingsEntry("施工轮廓","world","施工轮廓","Construction outlines"),
        SettingsEntry("世界色彩","world","世界色彩","World colours",keywords="饱和度 亮度 对比度 saturation brightness contrast"),
        SettingsEntry("同步现实天气","world","同步现实天气","Real weather",keywords="位置 天文 location astronomy"),
        SettingsEntry("蓝图库","world","蓝图库","Blueprint library",keywords="原生 补充 奖励 导入 native rewards litematic"),
        SettingsEntry("方块材质包","world","方块材质包","Resource packs",keywords="导入 import textures"),
        SettingsEntry("普通任务","timing","普通任务","Regular tasks",keywords="专注时长 focus duration"),
        SettingsEntry("习惯任务","timing","习惯任务","Habit tasks",keywords="专注时长 建筑轮次 duration rounds"),
        SettingsEntry("休息时长","timing","休息时长","Break duration",keywords="分钟 minutes"),
        SettingsEntry("自动连续专注","timing","自动连续专注","Automatic continuation"),
        SettingsEntry("自动续专注时间","timing","自动续专注时间","Extend focus after plan",keywords="加时 延长 overtime extend"),
        SettingsEntry("计时闹钟","timing","计时闹钟","Timer alarms",keywords="轮次 休息 振动 震动 铃声 round break sound vibrate"),
        SettingsEntry("专注完整性","timing","专注完整性","Focus integrity",keywords="离开次数 阈值 excursions threshold"),
        SettingsEntry("计划专注日","timing","计划专注日","Planned focus days",keywords="星期 rest weekdays"),
        SettingsEntry("返回专注提醒","timing","返回专注提醒","Return-to-focus reminders"),
        SettingsEntry("通知与后台","timing","通知与后台","Notifications & background",keywords="流体云 灵动岛 电池 ColorOS OriginOS battery"),
        SettingsEntry("简易便签","extras","简易便签","Quick notes"),
        SettingsEntry("日期倒计时","extras","日期倒计时","Date countdown",keywords="目标日期 event target days"),
        SettingsEntry("白噪音","extras","白噪音","Ambient audio",keywords="雨声 导入 声音 rain sound audio"),
        SettingsEntry("生日祝福","extras","生日祝福","Birthday wishes"),
        SettingsEntry("账户与云同步","account","账户与云同步","Account & cloud",keywords="登录 注册 好友 云备份 云同步 接管 login register friends cloud backup sync takeover privacy 隐私 披露"),
        SettingsEntry("本地备份","advanced","本地备份","Local backups",keywords="恢复 导入 导出 JSON restore import export"),
        SettingsEntry("每日合并备份","advanced","每日合并备份","Daily merged backup",listOf("本地备份")),
        SettingsEntry("操作回滚","advanced","操作回滚","Operation rollback",listOf("本地备份")),
        SettingsEntry("画面调试","advanced","画面调试","Visual debug",keywords="时间 天气 腐败 time weather decay"),
        SettingsEntry("新手教程","advanced","新手教程","Tutorial",keywords="双击 结束 复位 地图 double tap end reset map"),
        SettingsEntry("自动检查并下载更新","advanced","自动检查并下载更新","Automatically check & download updates"),
        SettingsEntry("加入 Beta 测试","advanced","加入 Beta 测试","Join Beta testing",keywords="prerelease 更新 update"),
        SettingsEntry("关于","advanced","关于","About",keywords="开源 许可 license version 版本"),
    )
    init {require(groups.map{it.id}.distinct().size==groups.size);require(entries.map{it.id}.distinct().size==entries.size);require(entries.all{entry->groups.any{it.id==entry.group}&&entry.parents.all{parent->entries.any{it.id==parent}}})}
    fun group(id:String)=groups.single{it.id==id}
    fun search(query:String):List<SettingsEntry> {
        val words=query.trim().lowercase(Locale.ROOT).split(Regex("\\s+")).filter{it.isNotEmpty()}
        if(words.isEmpty())return emptyList()
        return entries.filter{entry->val group=group(entry.group);val text="${entry.title} ${entry.english} ${entry.keywords} ${group.title} ${group.english}".lowercase(Locale.ROOT);words.all{it in text}}
    }
}
