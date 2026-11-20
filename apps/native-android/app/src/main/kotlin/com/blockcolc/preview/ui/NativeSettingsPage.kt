package com.blockcolc.preview.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.blockcolc.presentation.*
import com.blockcolc.preview.*
import com.blockcolc.preview.world.automaticQuality
import java.util.UUID

@Composable fun NativeSettingsPage(s:WorkspaceUiState,runtime:WorkspaceActions,onTutorial:()->Unit,onAbout:()->Unit,onImport:()->Unit,onExport:()->Unit,audioSettings:@Composable ()->Unit={},weatherSettings:@Composable ()->Unit={},debugSettings:@Composable ()->Unit={},resourceSettings:@Composable ()->Unit={},notificationSettings:@Composable ()->Unit={},blueprintSettings:@Composable ()->Unit={},cloudSettings:@Composable ()->Unit={},updateSettings:@Composable ()->Unit={}){
    val ui=LocalNativeUi.current;val prefs=s.preferences;val workspace=s.workspace?:return
    val domain=rememberNativeRequest(s)
    val settlement=rememberNativeRequest(s)
    val backdrop=LocalNativeBackdrop.current
    fun command(value:WorkspaceMutation){domain.submit{runtime.dispatch(value,it)}}
    fun update(change:(ClientPreferences)->ClientPreferences)=runtime.updatePreferences(change)
    val jump=remember{SettingsJump()}
    CompositionLocalProvider(LocalSettingsJump provides jump,LocalNativeSettingsActions provides true){
    NativePageScroll{
        NativeHeading(ui.text("设置"))
        NativeSettingsNavigation(jump)
        NativeSection(ui.text(SettingsCatalog.group("account").title)){NativeSettingAnchor("账户与云同步"){cloudSettings()}}
        if(s.preferencesReadFailed)Text(ui.text("本地设置读取失败，原文件已保留。"),color=MaterialTheme.colorScheme.error)
        NativeSection(ui.text(SettingsCatalog.group("timing").title)){
            NativeSettingGroup("普通任务",ui.text("{0} 分钟",prefs.focusMinutes)){
                NativeNumber(ui.text("专注时长（分钟）"),prefs.focusMinutes,1..180,!s.preferencesReadFailed){n->update{it.copy(focusMinutes=n)}}
            }
            NativeSeparator()
            NativeSettingGroup("习惯任务",ui.text("{0} 分钟 · {1} 轮",prefs.habitFocusMinutes,prefs.habitTargetRounds)){
                NativeNumber(ui.text("专注时长（分钟）"),prefs.habitFocusMinutes,1..180,!s.preferencesReadFailed){n->update{it.copy(habitFocusMinutes=n)}}
                NativeNumber(ui.text("建筑轮次"),prefs.habitTargetRounds,10..30,!s.preferencesReadFailed){n->update{it.copy(habitTargetRounds=n)}}
            }
            NativeSeparator()
            NativeSettingAnchor("休息时长"){NativeNumber(ui.text("休息时长（分钟）"),prefs.breakMinutes,0..60,!s.preferencesReadFailed){n->update{it.copy(breakMinutes=n)}}}
            NativeSeparator()
            NativeSettingAnchor("自动连续专注"){NativeToggle(ui.text("自动连续专注"),value=prefs.autoContinueFocus,enabled=!s.preferencesReadFailed){v->update{it.copy(autoContinueFocus=v)}}}
            NativeSeparator()
            NativeSettingAnchor("自动续专注时间"){NativeToggle(ui.text("自动续专注时间"),value=prefs.autoExtendFocus,enabled=!s.preferencesReadFailed){v->update{it.copy(autoExtendFocus=v)}}}
        }
        NativeSection(ui.text(SettingsCatalog.group("protection").title)){
            NativeSettingGroup("专注完整性"){
                val integrity=workspace.settings.integrity
                val available=!domain.busy&&!s.busy
                NativeToggle(ui.text("启用专注完整性"),value=integrity.enabled,enabled=available){v->command(WorkspaceMutation.Integrity(v,integrity.excursions,integrity.thresholdSeconds))}
                NativeSeparator()
                NativeNumber(ui.text("有效离开次数"),integrity.excursions,1..5,available&&integrity.enabled){n->command(WorkspaceMutation.Integrity(true,n,integrity.thresholdSeconds))}
                NativeNumber(ui.text("离开阈值（秒）"),integrity.thresholdSeconds,1..60,available&&integrity.enabled){n->command(WorkspaceMutation.Integrity(true,integrity.excursions,n))}
            }
            NativeSeparator()
            NativeSettingAnchor("计划专注日"){
                Text(ui.text("计划专注日"),Modifier.padding(top=8.dp,bottom=12.dp),style=MaterialTheme.typography.bodyLarge)
                Row(Modifier.fillMaxWidth()){
                    for(day in 0..6){val planned=day !in workspace.settings.restWeekdays
                        val label=ui.text(listOf("周日","周一","周二","周三","周四","周五","周六")[day])
                        Column(Modifier.weight(1f).heightIn(min=48.dp).clickable(enabled=!domain.busy&&!s.busy,interactionSource=remember{androidx.compose.foundation.interaction.MutableInteractionSource()},indication=null){
                            val rests=workspace.settings.restWeekdays.toMutableSet();if(planned)rests.add(day)else rests.remove(day)
                            if(rests.size<7)command(WorkspaceMutation.Calendar(workspace.settings.timeZone,rests.sorted()))
                        },horizontalAlignment=Alignment.CenterHorizontally){Text(label,style=MaterialTheme.typography.bodySmall);if(planned)Text("▪",color=MaterialTheme.colorScheme.primary)}
                    }
                }
            }
            NativeSeparator()
            NativeSettingAnchor("返回专注提醒"){NativeToggle(ui.text("返回专注提醒"),value=prefs.returnToFocusReminders,enabled=!s.preferencesReadFailed){v->update{it.copy(returnToFocusReminders=v)}}}
            NativeSeparator()
            NativeSettingGroup("通知与后台"){notificationSettings()}
            NativeRequestError(domain)
        }
        NativeSection(ui.text(SettingsCatalog.group("appearance").title)){
            NativeSettingAnchor("主题"){
            Text(ui.text("主题"),Modifier.padding(top=8.dp),style=MaterialTheme.typography.bodyLarge)
            NativeSegments(listOf("system" to ui.text("跟随系统"),"light" to ui.text("浅色"),"dark" to ui.text("深色")),prefs.themeMode,{v->update{it.copy(themeMode=v)}},!s.preferencesReadFailed)
            }
            NativeSeparator()
            NativeSettingAnchor("界面语言"){
            Text(ui.text("界面语言"),Modifier.padding(top=8.dp),style=MaterialTheme.typography.bodyLarge)
            NativeSegments(listOf("zh-CN" to "简体中文","en" to "English"),prefs.language,{v->update{it.copy(language=v)}},!s.preferencesReadFailed)
            }
            NativeSeparator()
            NativeSettingAnchor("字体"){
            Text(ui.text("字体"),Modifier.padding(top=8.dp),style=MaterialTheme.typography.bodyLarge)
            NativeSegments(listOf("pixel" to ui.text("像素字体"),"system" to ui.text("系统字体"),"mixed" to ui.text("混合字体")),prefs.fontStyle,{v->update{it.copy(fontStyle=v)}},!s.preferencesReadFailed)
            }
            NativeSeparator()
            NativeSettingAnchor("极简模式"){NativeToggle(ui.text("极简模式"),value=prefs.minimalMode,enabled=!s.preferencesReadFailed){v->update{it.copy(minimalMode=v)}}}
            NativeSeparator()
            NativeSettingSlider("液态玻璃",prefs.focusGlassTransparency,0,100,!s.preferencesReadFailed,saving=s.preferencesSaving,error=s.message){n->update{it.copy(focusGlassTransparency=n)}}
        }
        NativeSection(ui.text(SettingsCatalog.group("world").title)){
            NativeSettingAnchor("聚落环境"){
                val pending=settlement.busy||backdrop?.preparingSettlement==true
                Row(Modifier.fillMaxWidth().heightIn(min=40.dp),verticalAlignment=Alignment.CenterVertically){
                    Text(ui.text("聚落环境"),Modifier.weight(1f),style=MaterialTheme.typography.bodyLarge)
                    if(pending)WorldSettingProgress()
                }
                NativeSegments(listOf("classic-island" to ui.text("空岛"),"natural-valley" to ui.text("山谷"),"ocean-island" to ui.text("海岛"),"mosaic-coast" to ui.text("海岸")),workspace.settings.environment,{v->
                    if(v!=workspace.settings.environment)settlement.submit{runtime.dispatch(WorkspaceMutation.Environment(v),it)}
                },!settlement.busy&&!s.busy)
                NativeRequestError(settlement)
            }
                NativeSeparator()
            NativeSettingAnchor("光影质量"){
                val context=LocalContext.current
                val automatic=remember(context){automaticQuality(context)}
                val tiers=listOf("auto" to ui.text("自动"),"paper" to ui.text("纸雕"),"performance" to ui.text("流畅"),"balanced" to ui.text("均衡"),"cinematic" to ui.text("精致"))
                var selectedQuality by remember{mutableStateOf<String?>(null)}
                var qualityFailure by remember{mutableStateOf<String?>(null)}
                LaunchedEffect(prefs.lightingQuality,s.preferencesSaving,s.message){
                    if(selectedQuality==prefs.lightingQuality)selectedQuality=null
                    else if(selectedQuality!=null&&s.message!=null&&!s.preferencesSaving){
                        qualityFailure=s.message
                        selectedQuality=null
                    }
                }
                Row(Modifier.fillMaxWidth().heightIn(min=40.dp),verticalAlignment=Alignment.CenterVertically,
                    horizontalArrangement=Arrangement.spacedBy(NativeSettingActionGap)){
                    Text(ui.text("光影质量"),Modifier.weight(1f),style=MaterialTheme.typography.bodyLarge)
                    if(selectedQuality!=null||backdrop?.preparingQuality==true)WorldSettingProgress()
                    NativeInfoAction(ui.text("光影质量"),ui.text(
                        "自动根据设备是否低内存及应用堆上限选择画质。此设备自动选择：{0}。",
                        tiers.first{it.first==automatic}.second,
                    ))
                }
                NativeSegments(tiers,prefs.lightingQuality,{v->
                    if(v!=prefs.lightingQuality){qualityFailure=null;selectedQuality=v;update{it.copy(lightingQuality=v)}}
                },!s.preferencesReadFailed&&selectedQuality==null)
                qualityFailure?.let{Text(ui.text(it),color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)}
            }
            if(backdrop?.worldSettingFailed==true){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                    Text(ui.text("世界暂未准备好"),Modifier.weight(1f),color=MaterialTheme.colorScheme.error)
                    NativeIconAction(ui.text("重试"),"reset",backdrop.retryWorld)
                }
            }
                NativeSeparator()
            NativeSettingAnchor("施工轮廓"){
                Text(ui.text("施工轮廓"),Modifier.padding(top=8.dp),style=MaterialTheme.typography.bodyLarge)
                NativeSegments(listOf("off" to ui.text("关闭"),"current" to ui.text("当前"),"all" to ui.text("全部")),prefs.constructionOutlineVisibility,{v->update{it.copy(constructionOutlineVisibility=v)}},!s.preferencesReadFailed)
            }
                NativeSeparator()
                NativeSettingGroup("世界色彩",trailing={NativeIconAction(ui.text("恢复默认"),"reset",{update{it.copy(worldColorAdjustment=WorldColor())}},enabled=!s.preferencesReadFailed)}){
                    NativeSettingSlider("饱和度",prefs.worldColorAdjustment.saturation,50,150,!s.preferencesReadFailed,saving=s.preferencesSaving,error=s.message,collapsible=false){n->update{it.copy(worldColorAdjustment=it.worldColorAdjustment.copy(saturation=n))}}
                    NativeSettingSlider("亮度",prefs.worldColorAdjustment.brightness,80,120,!s.preferencesReadFailed,saving=s.preferencesSaving,error=s.message,collapsible=false){n->update{it.copy(worldColorAdjustment=it.worldColorAdjustment.copy(brightness=n))}}
                    NativeSettingSlider("对比度",prefs.worldColorAdjustment.contrast,80,120,!s.preferencesReadFailed,saving=s.preferencesSaving,error=s.message,collapsible=false){n->update{it.copy(worldColorAdjustment=it.worldColorAdjustment.copy(contrast=n))}}
                }
                NativeSeparator()
                NativeSettingAnchor("同步现实天气"){weatherSettings()}
                NativeRequestError(domain)
        }
        NativeSection(ui.text(SettingsCatalog.group("library").title)){
            resourceSettings()
            NativeSeparator()
            blueprintSettings()
        }
        NativeSection(ui.text("附加功能")){
            NativeSettingAnchor("简易便签"){NativeToggle(ui.text("简易便签"),value=prefs.quickNotesEnabled,enabled=!s.preferencesReadFailed){v->update{it.copy(quickNotesEnabled=v)}}}
            NativeSeparator()
            LocalDateCountdownPreference.current?.let{
                NativeCountdownSettings(it)
                NativeSeparator()
            }
            audioSettings()
            NativeSeparator()
            NativeSettingGroup("生日祝福"){
                val birthday=workspace.settings.birthday
                val birthdaySave=rememberNativeRequest(s)
                var enabled by rememberNativePageState("settings/birthday/enabled"){birthday.enabled}
                var month by rememberNativePageState("settings/birthday/month"){birthday.month?:1}
                var day by rememberNativePageState("settings/birthday/day"){birthday.day?:1}
                var datesOpen by rememberNativePageState("settings/birthday/datesOpen"){false}
                LaunchedEffect(birthdaySave.error){if(birthdaySave.error!=null)enabled=birthday.enabled}
                NativeToggle(ui.text("启用生日祝福"),value=enabled,enabled=!birthdaySave.busy&&!s.busy){v->
                    enabled=v
                    if(!v)datesOpen=false
                    if(!v&&birthday.enabled)birthdaySave.submit{runtime.dispatch(WorkspaceMutation.Birthday(false,birthday.month?:1,birthday.day?:1),it)}
                }
                NativeSeparator()
                val available=enabled&&!s.busy&&!birthdaySave.busy
                val changed=!birthday.enabled||month!=birthday.month||day!=birthday.day
                NativeDisclosure(ui.text("日期"),null,enabled&&datesOpen,{datesOpen=it},valueLabel="%02d / %02d".format(month,day),rowHeight=56.dp,contentSpacing=0.dp,enabled=available){
                    NativeNumber(ui.text("月份"),month,1..12,available){month=it}
                    NativeNumber(ui.text("日期"),day,1..31,available){day=it}
                }
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){
                    NativeAction(ui.text("保存日期"),{birthdaySave.submit{runtime.dispatch(WorkspaceMutation.Birthday(true,month,day),it)}},primary=false,
                        pending=birthdaySave.busy,enabled=available&&changed&&runCatching{java.time.MonthDay.of(month,day)}.isSuccess)
                }
                NativeRequestError(birthdaySave)
            }
        }
        NativeSection(ui.text(SettingsCatalog.group("advanced").title)){
            NativeSettingAnchor("新手教程"){NativeSettingLink(ui.text("新手教程"),onTutorial)}
            NativeSeparator()
            NativeSettingAnchor("画面调试"){debugSettings()}
            NativeSeparator()
            NativeBackups(s,runtime,onImport,onExport)
            NativeSeparator()
            NativeSettingAnchor("自动检查并下载更新"){NativeToggle(ui.text("自动检查并下载更新"),value=prefs.autoCheckUpdates,enabled=!s.preferencesReadFailed){v->update{it.copy(autoCheckUpdates=v)}}}
            NativeSeparator()
            NativeSettingAnchor("加入 Beta 测试"){updateSettings()}
            NativeSeparator()
            NativeSettingAnchor("关于"){NativeSettingLink(ui.text("关于"),onAbout)}
        }
    }
    }
}

@Composable private fun WorldSettingProgress(){
    val ui=LocalNativeUi.current
    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp),
        modifier=Modifier.semantics{liveRegion=LiveRegionMode.Polite}){
        NativeBusy(Modifier.size(18.dp))
        Text(ui.text("正在建造世界"),style=MaterialTheme.typography.bodySmall)
    }
}

@Composable fun NativeSettingGroup(key:String,description:String?=null,trailing:(@Composable ()->Unit)?=null,showTrailingWhenCollapsed:Boolean=false,content:@Composable ColumnScope.()->Unit){
    var expanded by rememberNativePageState("settings/disclosure/$key"){false}
    val jump=LocalSettingsJump.current
    LaunchedEffect(jump?.serial){if(jump?.opens(key)==true)expanded=true}
    NativeSettingAnchor(key){
        NativeDisclosure(LocalNativeUi.current.text(key),description,expanded,{expanded=it},
            rowHeight=if(trailing==null)60.dp else 64.dp,contentSpacing=0.dp,trailing=if(expanded||showTrailingWhenCollapsed)trailing else null,content=content)
    }
}
@Composable internal fun NativeSettingSlider(key:String,value:Int,min:Int,max:Int,enabled:Boolean,saving:Boolean=false,error:String?=null,collapsible:Boolean=true,onCommit:(Int)->Unit){
    val ui=LocalNativeUi.current;var open by rememberNativePageState("settings/slider/$key"){false};var preview by remember{mutableStateOf<Int?>(null)}
    var held by remember(key){mutableStateOf<Int?>(null)};var flight by remember(key){mutableStateOf<Int?>(null)};var savingSeen by remember(key){mutableStateOf(false)}
    LaunchedEffect(value,saving,error){
        if(held!=null){if(saving)savingSeen=true;if(value==held||savingSeen&&!saving||error!=null){held=null;savingSeen=false}}
    }
    val jump=LocalSettingsJump.current
    LaunchedEffect(jump?.serial){if(jump?.opens(key)==true)open=true}
    val shown=preview?:held?:flight?:value
    val label=ui.text(key)
    val percentage=if(preview==null)"$shown%"else ui.text("预计 {0}%",shown)
    val slider:@Composable ()->Unit={
        NativePhysicalSlider(label,held?:value,min,max,enabled=enabled||held!=null,onPreview={preview=it},
            onFlightValue={flight=it},onCommit={held=it;savingSeen=false;onCommit(it)})
    }
    NativeSettingAnchor(key){
        if(collapsible)NativeDisclosure(label,null,open,{open=it},valueLabel=percentage,rowHeight=60.dp){slider()}
        else Column(Modifier.fillMaxWidth().padding(vertical=8.dp)){
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                NativeText(label,NativeTextRole.BODY,Modifier.weight(1f))
                NativeText(percentage,NativeTextRole.BODY)
            }
            slider()
        }
    }
}
@Composable private fun NativeBackups(s:WorkspaceUiState,runtime:WorkspaceActions,onImport:()->Unit,onExport:()->Unit){
    val ui=LocalNativeUi.current;var selected by rememberNativePageState<String?>("settings/backup/selected"){null}
    val restore=rememberNativeRequest(s){selected=null}
    val refresh=rememberNativeRequest(s)
    NativeSettingGroup("本地备份",trailing={
        NativeIconAction(ui.text("刷新"),"reset",{refresh.submit(runtime::refreshBackups)},enabled=!refresh.busy&&!s.busy,pending=refresh.busy)
    }){
        val active=LocalNativePageActive.current
        var attempted by remember(s.generation,s.roomContext){mutableStateOf(false)}
        LaunchedEffect(active,s.backupListingReady,attempted){
            if(s.backupListingReady)attempted=false
            else if(active&&!attempted){attempted=true;refresh.submit(runtime::refreshBackups)}
        }
        NativeRequestError(refresh,"备份暂不可用，请重试。")
        NativeSettingGroup("导入与导出"){
            NativeInlineAction(ui.text("导出 JSON"),onExport,"chest",ui.text("导出"),
                enabled=!s.busy,pending=s.backupOperation==BackupOperation.EXPORT)
            NativeSeparator()
            NativeInlineAction(ui.text("导入备份"),onImport,"plus",ui.text("选择文件"),
                enabled=!s.busy,pending=s.backupOperation==BackupOperation.READ_IMPORT)
        }
        NativeSeparator()
        for((kind,label) in listOf("operation" to "操作回滚","daily" to "每日合并备份")){
            if(kind=="daily")NativeSeparator()
            NativeSettingGroup(label,trailing=if(kind=="daily") ({
                NativeInfoAction(ui.text("每日合并备份"),ui.text("每日合并为一份，上限 200 MiB；操作回滚另存。"))
            }) else null,showTrailingWhenCollapsed=kind=="daily"){
                if(kind=="daily"){
                    if(s.dailyBackupFailed)Text(ui.text("每日留档未完成，稍后重试。"),color=MaterialTheme.colorScheme.error)
                }
                val roots=s.roots.filter{if(kind=="daily")it.kind=="daily" else it.kind!="daily"}
                if(!s.backupListingReady){if(refresh.busy)Text(ui.text("处理中"),style=MaterialTheme.typography.bodySmall)}
                else if(roots.isEmpty())Text(ui.text("暂无可恢复备份"),style=MaterialTheme.typography.bodySmall)
                if(s.backupListingReady)for(root in roots){
                    NativeInlineAction(root.date?:root.id,{selected=root.id},"chest",ui.text("恢复"),enabled=!s.busy)
                }
            }
        }
    }
    NativeSheet(selected,{ui.text("确认恢复")},{selected=null},!restore.busy){id->
        Text(ui.text("恢复将替换当前记录，并保留操作回滚点。旧计划不会自动续轮。"))
        NativeAction(ui.text("确认恢复"),{restore.submit{runtime.restore(id,it)}},Modifier.fillMaxWidth(),pending=restore.busy,enabled=!s.busy,danger=true)
        NativeRequestError(restore)
    }
}
