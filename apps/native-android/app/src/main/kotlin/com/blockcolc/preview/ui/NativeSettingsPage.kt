package com.blockcolc.preview.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
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
        NativePageTitle(ui.text("设置"))
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
                        val interaction=remember{androidx.compose.foundation.interaction.MutableInteractionSource()}
                        Column(Modifier.weight(1f).heightIn(min=48.dp).clickable(enabled=!domain.busy&&!s.busy,interactionSource=interaction,indication=null){
                            val rests=workspace.settings.restWeekdays.toMutableSet();if(planned)rests.add(day)else rests.remove(day)
                            if(rests.size<7)command(WorkspaceMutation.Calendar(workspace.settings.timeZone,rests.sorted()))
                        }.nativePressMotion(interaction,!domain.busy&&!s.busy),horizontalAlignment=Alignment.CenterHorizontally){Text(label,style=MaterialTheme.typography.bodySmall);if(planned)Text("▪",color=MaterialTheme.colorScheme.primary)}
                    }
                }
            }
            NativeSeparator()
            NativeSettingAnchor("返回专注提醒"){NativeToggle(ui.text("返回专注提醒"),value=prefs.returnToFocusReminders,enabled=!s.preferencesReadFailed){v->update{it.copy(returnToFocusReminders=v)}}}
            NativeSeparator()
            NativeSettingGroup("计时闹钟"){NativePhaseAlarmSettings()}
            NativeSeparator()
            NativeSettingGroup("通知与后台"){notificationSettings()}
            NativeRequestError(domain)
        }
        NativeSection(ui.text(SettingsCatalog.group("appearance").title)){
            NativeSettingAnchor("主题"){
            NativeSettingsOptionTitle(ui.text("主题"))
            NativeSegments(listOf("system" to ui.text("跟随系统"),"light" to ui.text("浅色"),"dark" to ui.text("深色")),prefs.themeMode,{v->update{it.copy(themeMode=v)}},!s.preferencesReadFailed)
            }
            NativeSeparator()
            NativeSettingAnchor("界面语言"){
            NativeSettingsOptionTitle(ui.text("界面语言"))
            NativeSegments(listOf("zh-CN" to "简体中文","en" to "English"),prefs.language,{v->update{it.copy(language=v)}},!s.preferencesReadFailed)
            }
            NativeSeparator()
            NativeSettingAnchor("字体"){
            NativeSettingsOptionTitle(ui.text("字体"))
            NativeSegments(listOf("pixel" to ui.text("像素字体"),"system" to ui.text("系统字体"),"mixed" to ui.text("混合字体")),prefs.fontStyle,{v->update{it.copy(fontStyle=v)}},!s.preferencesReadFailed)
            }
            NativeSeparator()
            NativeSettingAnchor("极简模式"){NativeToggle(ui.text("极简模式"),value=prefs.minimalMode,enabled=!s.preferencesReadFailed){v->update{it.copy(minimalMode=v)}}}
            NativeSeparator()
            NativeSettingSlider("液态玻璃",prefs.focusGlassTransparency,0,100,!s.preferencesReadFailed,saving=s.preferencesSaving,error=s.message){n->update{it.copy(focusGlassTransparency=n)}}
        }
        NativeSection(ui.text(SettingsCatalog.group("world").title)){
            NativeSettingAnchor("聚落环境"){
                val pending=settlement.busy||backdrop?.preparingSettlement==true||
                    backdrop?.let{it.requestedSettlement!=null&&!it.worldSettingFailed}==true
                LaunchedEffect(settlement.error){if(settlement.error!=null)backdrop?.requestedSettlement=null}
                NativeSettingsOptionTitle(ui.text("聚落环境")){
                    if(pending)WorldSettingProgress()
                }
                NativeSegments(listOf("classic-island" to ui.text("空岛"),"natural-valley" to ui.text("山谷"),"ocean-island" to ui.text("海岛"),"mosaic-coast" to ui.text("海岸")),workspace.settings.environment,{v->
                    if(v!=workspace.settings.environment)settlement.submit{
                        backdrop?.requestedSettlement=v
                        runtime.dispatch(WorkspaceMutation.Environment(v),it)
                    }
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
                        backdrop?.requestedQuality=null
                    }
                }
                NativeSettingsOptionTitle(ui.text("光影质量")){
                    if(selectedQuality!=null||backdrop?.preparingQuality==true||
                        backdrop?.let{it.requestedQuality!=null&&!it.worldSettingFailed}==true)WorldSettingProgress()
                    NativeInfoAction(ui.text("光影质量")){
                        Column(Modifier.widthIn(max=304.dp).padding(horizontal=16.dp,vertical=8.dp),
                            verticalArrangement=Arrangement.spacedBy(NativeOptionSpacing)){
                            val explanations=listOf(
                                ui.text("根据设备内存和图形能力选择。本机：{0}。",tiers.first{it.first==automatic}.second),
                                ui.text("用纸雕色块表现世界，渲染负担最低。"),
                                ui.text("保留立体光影，减少云层和特效细节。"),
                                ui.text("云层和阴影更丰富，画质与性能折中。"),
                                ui.text("最完整的云层、阴影和光照细节。"),
                            )
                            for((tier,summary)in tiers.zip(explanations)){
                                Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
                                    Text(tier.second,style=MaterialTheme.typography.bodyMedium)
                                    Text(summary,style=MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                }
                NativeSegments(tiers,prefs.lightingQuality,{v->
                    if(v!=prefs.lightingQuality){
                        qualityFailure=null
                        selectedQuality=v
                        backdrop?.requestedQuality=if(v=="auto")automatic else v
                        update{it.copy(lightingQuality=v)}
                    }
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
                NativeSettingsOptionTitle(ui.text("施工轮廓"))
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
                // Same date row and sheet as the countdown: the date is saved
                // in the sheet, and the switch saves at once when a date exists.
                val birthday=workspace.settings.birthday
                var sheet by remember{mutableStateOf<NativeDateDraft?>(null)}
                val birthdaySave=rememberNativeRequest(s){sheet=null}
                NativeToggle(ui.text("启用生日祝福"),value=birthday.enabled,enabled=!birthdaySave.busy&&!s.busy){v->
                    val month=birthday.month;val day=birthday.day
                    when{
                        !v->birthdaySave.submit{runtime.dispatch(WorkspaceMutation.Birthday(false,month?:1,day?:1),it)}
                        month!=null&&day!=null->birthdaySave.submit{runtime.dispatch(WorkspaceMutation.Birthday(true,month,day),it)}
                        else->{val today=java.time.LocalDate.now();sheet=NativeDateDraft(null,today.monthValue,today.dayOfMonth)}
                    }
                }
                val savedMonth=birthday.month;val savedDay=birthday.day
                if(birthday.enabled&&savedMonth!=null&&savedDay!=null){
                    NativeSeparator()
                    NativeSettingLink(ui.text("日期"),{sheet=NativeDateDraft(null,savedMonth,savedDay)},value="%02d / %02d".format(savedMonth,savedDay),
                        modifier=Modifier.testTag("birthday-date"))
                }
                if(sheet==null)NativeRequestError(birthdaySave)
                NativeDateSheet(sheet,ui.text("生日祝福"),{if(!birthdaySave.busy)sheet=null},
                    pending=birthdaySave.busy,feedback={NativeRequestError(birthdaySave)}){draft->
                    birthdaySave.submit{runtime.dispatch(WorkspaceMutation.Birthday(true,draft.month,draft.day),it)}
                }
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

@Composable internal fun NativeSettingsOptionTitle(title:String,actions:@Composable RowScope.()->Unit={}){
    Row(Modifier.fillMaxWidth().heightIn(min=48.dp).padding(bottom=4.dp),verticalAlignment=Alignment.CenterVertically,
        horizontalArrangement=Arrangement.spacedBy(NativeSettingActionGap)){
        Text(title,Modifier.weight(1f),style=MaterialTheme.typography.bodyLarge)
        actions()
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
            contentSpacing=0.dp,trailing=trailing,showTrailing=expanded||showTrailingWhenCollapsed,
            contentBottomSpacing=NativeOptionSpacing,content=content)
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
        if(collapsible)NativeDisclosure(label,null,open,{open=it},valueLabel=percentage,rowHeight=60.dp,contentBottomSpacing=NativeOptionSpacing){slider()}
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
            NativeInlineAction(ui.text("导出 JSON"),onExport,"export",ui.text("导出"),
                enabled=!s.busy,pending=s.backupOperation==BackupOperation.EXPORT)
            NativeSeparator()
            NativeInlineAction(ui.text("导入备份"),onImport,"import",ui.text("选择文件"),
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
                    NativeInlineAction(root.date?:root.id,{selected=root.id},"import",ui.text("恢复"),enabled=!s.busy)
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
