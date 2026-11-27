package com.blockcolc.preview.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.graphicsLayer
import com.blockcolc.presentation.*
import com.blockcolc.preview.*
import com.blockcolc.storage.PlanMode
import kotlinx.coroutines.delay
import java.util.UUID

data class PlanEditorModel(val token:String=UUID.randomUUID().toString(),val projectId:String?,val taskId:String?,val mode:PlanMode=PlanMode.ROUNDS,
    val rounds:Int=1,val endAt:Long?=null,val replacingPlanId:String?=null)

internal enum class FocusExitVisibility { HIDDEN, HINT, ACTION }

@Stable internal class FocusExitControls {
    var visibility by mutableStateOf(FocusExitVisibility.HINT)
        private set
    var hintRequests by mutableIntStateOf(0)
        private set

    fun showHint() {
        if (visibility != FocusExitVisibility.ACTION) {
            hintRequests++
            visibility = FocusExitVisibility.HINT
        }
    }

    fun toggleAction() {
        visibility = if (visibility == FocusExitVisibility.ACTION) FocusExitVisibility.HIDDEN else FocusExitVisibility.ACTION
    }

    fun hide() { visibility = FocusExitVisibility.HIDDEN }
}

@Composable internal fun rememberFocusExitControls(): FocusExitControls {
    val controls = remember { FocusExitControls() }
    LaunchedEffect(controls.visibility, controls.hintRequests) {
        val timeout = when (controls.visibility) {
            FocusExitVisibility.HIDDEN -> return@LaunchedEffect
            FocusExitVisibility.HINT -> if (controls.hintRequests == 0) 3800L else 3000L
            FocusExitVisibility.ACTION -> 5000L
        }
        delay(timeout)
        controls.hide()
    }
    return controls
}

internal fun Modifier.focusExitGestures(controls: FocusExitControls, enabled: Boolean): Modifier =
    pointerInput(controls, enabled) {
        if (enabled) detectTapGestures(onDoubleTap = { controls.toggleAction() }, onTap = { controls.showHint() })
    }

@Composable fun NativeFocusExitControl(enabled: Boolean, onEnd: () -> Unit) {
    val controls = rememberFocusExitControls()
    NativeFocusExitControl(controls, enabled, onEnd, Modifier.focusExitGestures(controls, enabled))
}

/** The panel owns the blank-area gestures. The button consumes its own
 * taps and uses the same visibility state for its double-tap action. */
@Composable internal fun NativeFocusExitControl(controls:FocusExitControls,enabled:Boolean,onEnd:()->Unit,modifier:Modifier=Modifier){
    val ui=LocalNativeUi.current
    val revealed = controls.visibility == FocusExitVisibility.ACTION
    val drawReceipt=if(BuildConfig.BUILD_TYPE=="benchmark"&&enabled){
        val reported=remember{booleanArrayOf(false)}
        Modifier.drawWithContent{
            drawContent()
            if(!reported[0]){
                reported[0]=true
                NativeStartupTrace.point("focus-controls-drawn")
            }
        }
    }else Modifier
    Box(modifier.fillMaxWidth().heightIn(min=48.dp)
        .then(drawReceipt)
        .onKeyEvent{event->if(enabled&&event.type==KeyEventType.KeyDown&&event.key in listOf(Key.Enter,Key.Spacebar)){controls.toggleAction();true}else false}
        .semantics{
            contentDescription=ui.text("专注操作区")
            customActions=listOf(CustomAccessibilityAction(ui.text(if(revealed)"隐藏结束操作"else"显示结束操作")){if(enabled){controls.toggleAction();true}else false})
        }.focusable(enabled),contentAlignment=Alignment.Center){
        if(revealed)FormalGlassAction(ui.text("结束本次专注"),{controls.hide();onEnd()},enabled=enabled,danger=true,onDoubleClick=controls::toggleAction)
        else if(controls.visibility == FocusExitVisibility.HINT){
            val colors=MaterialTheme.colorScheme
            NativeText(ui.text("双击下方空白处唤出结束按钮"),NativeTextRole.CAPTION,
                Modifier.padding(horizontal=8.dp).background(colors.inverseSurface).padding(horizontal=8.dp,vertical=4.dp),
                color=colors.inverseOnSurface)
        }
    }
}

@Composable fun NativePlanEditor(model:PlanEditorModel?,s:WorkspaceUiState,runtime:WorkspaceActions,onClose:()->Unit){
    val ui=LocalNativeUi.current;var pending by remember(model?.token){mutableStateOf<String?>(null)};var error by remember(model?.token){mutableStateOf<String?>(null)}
    var choosingTask by rememberSaveable(model?.token){mutableStateOf(false)}
    LaunchedEffect(s.receipts,pending){pending?.let{id->s.receipts.find{it.id==id}?.let{result->
        pending=null
        if(result.saved)onClose()else error=result.reason?:"SAVE_FAILED"
    }}}
    NativeSheet(model,{ui.text("调整")},onClose,dismissible=pending==null,heading={
        if(choosingTask)NativeIconAction(ui.text("返回计划"),"back",{choosingTask=false})
        NativeText(ui.text(if(choosingTask)"本次专注"else"调整"),NativeTextRole.TITLE,Modifier.weight(1f))
    },contentSpacing=if(choosingTask)0.dp else 12.dp){entry->
        var project by rememberSaveable(entry.token){mutableStateOf(entry.projectId?:s.activeProject)}
        var task by rememberSaveable(entry.token){mutableStateOf(entry.taskId)}
        var mode by rememberSaveable(entry.token){mutableStateOf(entry.mode.name)}
        var rounds by rememberSaveable(entry.token){mutableIntStateOf(entry.rounds)}
        var end by rememberSaveable(entry.token){mutableStateOf(entry.endAt)}
        val owner=s.choices.find{it.id==project};val type=PlanMode.valueOf(mode)
        if(choosingTask){
            androidx.activity.compose.BackHandler{choosingTask=false}
            for((index,p) in s.choices.withIndex()){key(p.id){
                if(index>0)NativeSeparator()
                if(p.habit)FormalFocusChoice(p.title,null,project==p.id,pending==null&&p.canStart,habit=true){project=p.id;task=null;choosingTask=false}
                else {
                    var expanded by rememberSaveable(entry.token,p.id){mutableStateOf(p.id==project)}
                    NativeDisclosure(p.title,null,expanded,{expanded=it},rowHeight=NativeSettingsRowHeight,contentSpacing=0.dp){
                        if(p.tasks.isNotEmpty())Column(Modifier.padding(start=12.dp)){
                            for(t in p.tasks){
                                NativeSeparator()
                                FormalFocusChoice(t.title,ui.text("进度 {0}%",(t.progress+50)/100),project==p.id&&task==t.id,pending==null){project=p.id;task=t.id;choosingTask=false}
                            }
                        }
                    }
                }
            }}
            return@NativeSheet
        }
        if(type!=PlanMode.MINIMAL){
            if(entry.replacingPlanId==null||entry.mode!=PlanMode.ROUNDS)NativeSegments(listOf(PlanMode.ROUNDS.name to ui.text("固定轮次"),PlanMode.MARATHON.name to ui.text("按结束时间")),mode,{mode=it},enabled=pending==null,icons=mapOf(PlanMode.ROUNDS.name to "flag",PlanMode.MARATHON.name to "clock"))
            if(type==PlanMode.ROUNDS){
                val interaction=remember{MutableInteractionSource()}
                Row(Modifier.fillMaxWidth().heightIn(min=NativeSettingsRowHeight).clickable(enabled=pending==null,role=Role.Button,interactionSource=interaction,indication=null){choosingTask=true}
                    .nativePressMotion(interaction,pending==null).semantics{contentDescription=ui.text("选择小任务")}.padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                        NativeText(owner?.title?:ui.text("选择小任务"),NativeTextRole.CAPTION)
                        NativeText(if(owner?.habit==true)owner.title else owner?.tasks?.find{it.id==task}?.title?:ui.text("选择小任务"),NativeTextRole.BODY)
                    }
                    PixelGlyph("chevron",Modifier.size(20.dp).graphicsLayer{rotationZ=-90f})
                }
            }
        }
        val minutes=if(owner?.habit==true&&type==PlanMode.ROUNDS)s.preferences.habitFocusMinutes else s.preferences.focusMinutes
        if(type==PlanMode.ROUNDS)FormalRoundChoices(rounds,pending==null){rounds=it}
        else NativeClockPicker(end,System.currentTimeMillis(),minutes,s.preferences.breakMinutes,enabled=pending==null,onChange={end=it})
        NativeText(ui.text("每轮 {0} 分钟 · 休息 {1} 分钟",minutes,s.preferences.breakMinutes),NativeTextRole.CAPTION)
        if(type==PlanMode.ROUNDS){
            val reference=System.currentTimeMillis()
            val totalMs=minutes*60000L*rounds+s.preferences.breakMinutes*60000L*(rounds-1)
            NativeText(ui.text("共 {0} · 预计 {1} 结束",formatDuration(totalMs),formalEndLabel(reference+totalMs,reference)),NativeTextRole.CAPTION,color=MaterialTheme.colorScheme.primary)
        }
        NativeRequestError(error)
        val valid=owner!=null&&owner.canStart&&(owner.habit||type!=PlanMode.ROUNDS||owner.tasks.any{it.id==task})&&(type==PlanMode.ROUNDS||end?.let{it>System.currentTimeMillis()}==true)
        NativeAction(ui.text(if(pending==null)"确认计划" else "保存中…"),{
            val target=project?:return@NativeAction
            val draft=FocusDraft(target,if(type==PlanMode.ROUNDS)task else null,type,if(type==PlanMode.ROUNDS)DraftSchedule.Rounds(rounds)else DraftSchedule.EndAt(end?:return@NativeAction))
            val request=UUID.randomUUID().toString();pending=request;error=null
            if(entry.replacingPlanId==null)runtime.confirmPlan(draft,request)else runtime.amendPlan(entry.replacingPlanId,draft,request)
        },Modifier.fillMaxWidth(),pending=pending!=null,enabled=valid,icon="check")
    }
}

@Composable private fun FormalFocusChoice(title:String,detail:String?,selected:Boolean,enabled:Boolean,habit:Boolean=false,onClick:()->Unit){
    val ink=LocalContentColor.current
    val interaction=remember{MutableInteractionSource()}
    Row(Modifier.fillMaxWidth().heightIn(min=NativeSettingsRowHeight).drawBehind{if(selected&&!habit)drawRect(ink,Offset.Zero,androidx.compose.ui.geometry.Size(2.dp.toPx(),size.height))}
        .clickable(enabled=enabled,role=Role.RadioButton,interactionSource=interaction,indication=null,onClick=onClick)
        .nativePressMotion(interaction,enabled).semantics{this.selected=selected}.padding(horizontal=if(habit)0.dp else 10.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(3.dp)){
            if(habit)Text(title,style=MaterialTheme.typography.bodyLarge,color=if(enabled)ink else MaterialTheme.colorScheme.onSurfaceVariant)
            else NativeText(title,NativeTextRole.BODY,color=if(enabled)ink else MaterialTheme.colorScheme.onSurfaceVariant)
            if(detail!=null)NativeText(detail,NativeTextRole.CAPTION)
        }
        if(selected)PixelGlyph("check",Modifier.size(16.dp),ink)
    }
}
@Composable private fun FormalRoundChoices(value:Int,enabled:Boolean,onChange:(Int)->Unit){
    val ui=LocalNativeUi.current
    Row(Modifier.fillMaxWidth().heightIn(min=60.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
        NativeText(ui.text("计划轮数"),NativeTextRole.BODY,Modifier.weight(1f))
        NativeIconAction(ui.text("减少轮数"),"minus",{onChange(value-1)},enabled=enabled&&value>1)
        Box(Modifier.widthIn(min=36.dp).semantics{stateDescription=ui.text("{0} 轮",value)},contentAlignment=Alignment.Center){
            NativeText(value.toString(),NativeTextRole.SECTION,accent=true)
        }
        NativeIconAction(ui.text("增加轮数"),"plus",{onChange(value+1)},enabled=enabled&&value<24)
    }
}

@Composable fun NativeChoice(title:String,selected:Boolean,enabled:Boolean=true,icon:String?=null,description:String?=null,onClick:()->Unit){
    val colors=MaterialTheme.colorScheme
    val interaction=remember{MutableInteractionSource()}
    Row(Modifier.fillMaxWidth().heightIn(min=NativeSettingsRowHeight)
        .clickable(enabled=enabled,interactionSource=interaction,indication=null,role=Role.RadioButton,onClick=onClick)
        .nativePressMotion(interaction,enabled).semantics{this.selected=selected}
        .background(if(selected)colors.surfaceVariant else androidx.compose.ui.graphics.Color.Transparent).padding(NativeOptionSpacing),
        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(NativeOptionSpacing)){
        if(icon!=null)PixelGlyph(icon,color=colors.primary)
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
            Text(title,style=MaterialTheme.typography.bodyLarge)
            if(description!=null)Text(description,style=MaterialTheme.typography.bodySmall)
        }
        if(selected)PixelGlyph("check",color=colors.primary)
    }
}

@Composable fun NativeStepper(label:String,value:Int,min:Int,max:Int,enabled:Boolean=true,onChange:(Int)->Unit){
    val ui=LocalNativeUi.current
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
        Text(label,Modifier.weight(1f),style=MaterialTheme.typography.bodyLarge)
        NativeIconAction(ui.text("减少"),"minus",{onChange(value-1)},enabled=enabled&&value>min)
        Text(value.toString(),Modifier.widthIn(min=24.dp),style=MaterialTheme.typography.bodyLarge)
        NativeIconAction(ui.text("增加"),"plus",{onChange(value+1)},enabled=enabled&&value<max)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable fun NativeReportPanel(pool:ReportPool,pending:Boolean,delivered:Boolean,onSubmit:(ReportDraft)->Unit){
    val ui=LocalNativeUi.current
    val feedbackDraw = if (BuildConfig.BUILD_TYPE == "benchmark" && (pending || delivered)) {
        remember(pool.planId, pending, delivered) {
            var recorded = false
            Modifier.drawWithContent {
                drawContent()
                if (!recorded) {
                    recorded = true
                    NativeStartupTrace.point(if (delivered) "report-delivered-drawn" else "report-busy-drawn")
                }
            }
        }
    } else Modifier
    var draft by rememberNativePageState("report/${pool.planId}/draft",stateSaver=reportDraftSaver()){ReportDraft(pool.planId)}
    val ordinary=pool.mode==PlanMode.ROUNDS
    val valid=runCatching{draft.validate(pool)}.isSuccess
    val assigned=runCatching{draft.assignedDurations(pool)}.getOrDefault(emptyMap())
    @Composable fun assignedTime(key:String):String{
        val ms=assigned[key]?:0L
        return if(ms%60_000L==0L)formatDuration(ms)else formalClock(ms,countUp=true)
    }
    if(ordinary){
        val target=pool.targets.singleOrNull()?:return
        var selected by rememberNativePageState<Int?>("report/${pool.planId}/selected"){null}
        Column(Modifier.fillMaxWidth(),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(10.dp)){
            PixelGlyph("check",Modifier.size(32.dp),MaterialTheme.colorScheme.primary)
            val rounds=if(pool.totalRounds==1)ui.text("本轮已记录")else "${pool.totalRounds} ${ui.text("轮专注已结束")}"
            val summary=if(pool.partialExtensionMs>0)"$rounds · ${formalClock(pool.totalDurationMs,countUp=true)}"else rounds
            NativeText(summary,NativeTextRole.CAPTION,color=MaterialTheme.colorScheme.primary)
            Text(ui.text("这次工作推进到哪里？"),style=MaterialTheme.typography.titleLarge,textAlign=androidx.compose.ui.text.style.TextAlign.Center)
            Column(Modifier.padding(vertical=6.dp),horizontalAlignment=Alignment.CenterHorizontally){NativeText(target.title,NativeTextRole.BODY);NativeText(ui.text("当前")+" ${target.progress/100}%",NativeTextRole.CAPTION)}
            for(value in listOf(target.progress,2500,5000,7500,10000).distinct().filter{it>=target.progress}){
                val label=if(selected==value&&delivered)ui.text("材料已送达！")else if(selected==value&&pending)ui.text("正在保存…")else if(value==target.progress)ui.text("保持 {0}%",value/100)else if(value==10000)ui.text("完成小任务")else ui.text("推进至 {0}%",value/100)
                val enabled=!pending&&!delivered
                val colors=MaterialTheme.colorScheme
                val interaction=remember{MutableInteractionSource()}
                Row(Modifier.fillMaxWidth().heightIn(min=48.dp).clickable(enabled=enabled,role=Role.Button,interactionSource=interaction,indication=null){
                    selected=value;onSubmit(ReportDraft(pool.planId,listOf(TaskAllocation(target.projectId,target.taskId!!,value,pool.totalRounds))))
                }.nativePressMotion(interaction,enabled).border(1.dp,if(value==10000)colors.primary else colors.outlineVariant)
                    .background(colors.surface.copy(alpha=.8f)).padding(12.dp).then(if(selected==value)feedbackDraw else Modifier),
                    verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp,Alignment.CenterHorizontally)){
                    if(pending&&selected==value)NativeBusy()
                    Text(label,color=if(value==10000)colors.primary else colors.onSurface,style=MaterialTheme.typography.bodyLarge)
                }
            }
        }
        return
    }
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(4.dp)){
        NativeText("${pool.totalRounds} "+ui.text("轮专注已结束"),NativeTextRole.CAPTION,color=MaterialTheme.colorScheme.primary)
        val duration=if(pool.partialExtensionMs>0)formalClock(pool.totalDurationMs,countUp=true)else formatDuration(pool.totalDurationMs)
        NativeText(duration,NativeTextRole.NUMBER,accent=true)
    }
    Row(Modifier.fillMaxWidth().heightIn(min=44.dp),verticalAlignment=Alignment.CenterVertically){
        NativeText(ui.text("轮次如何记录"),NativeTextRole.CAPTION,Modifier.weight(1f))
        NativeInfoAction(ui.text("轮次如何记录"),ui.text("每轮只计入一个目标。不足一轮的时长均分到已分配轮次；保持进度也可计入轮次。"))
    }
    fun progress(target:ReportTarget,value:Int){
        val existing=draft.tasks.find{it.taskId==target.taskId}
        if(ordinary){onSubmit(ReportDraft(pool.planId,listOf(TaskAllocation(target.projectId,target.taskId!!,value,1))));return}
        val remaining=draft.tasks.filterNot{it.taskId==target.taskId}
        draft=draft.copy(tasks=if(existing?.progress==value)remaining else remaining+TaskAllocation(target.projectId,target.taskId!!,value,existing?.rounds?:0))
    }
    for((project,targets) in pool.targets.groupBy{it.projectId}.entries.sortedBy{if(it.value.first().taskId==null)0 else 1}){
        key(project){
            var expanded by rememberNativePageState("report/${pool.planId}/project/$project"){ordinary}
            val head=targets.first();val habit=head.taskId==null
            val description=if(habit)ui.text("习惯 · 第")+" ${head.habitCycle?:1} "+ui.text("座建筑 ·")+" ${head.habitCompleted?:0} / ${head.habitTarget?:head.maxRounds} "+ui.text("轮")else "${(head.projectProgress+50)/100}"+ui.text("% 总进度")
            NativeSeparator()
            NativeDisclosure(head.projectTitle,description,expanded,{expanded=it},titleStyle=MaterialTheme.typography.bodyLarge,indicator={NativeText(ui.text(if(expanded)"收起"else if(habit)"计入轮数"else"展开"),NativeTextRole.CAPTION,Modifier.padding(start=8.dp))}){
                for(target in targets){key(target.taskId?:target.projectId){
                    if(target.taskId==null){
                        val current=draft.habits.find{it.projectId==project}?.rounds?:0
                        val maximum=minOf(target.maxRounds,pool.totalRounds-(draft.allocated-current).toInt()).coerceAtLeast(0)
                        FormalRoundStepper(ui.text("计入轮数"),current,0,maximum,!pending&&!delivered){next->draft=draft.copy(habits=draft.habits.filterNot{it.projectId==project}+if(next==0)emptyList()else listOf(HabitAllocation(project,next)))}
                        NativeText((if(current>0)ui.text("预计实际投入 {0}",assignedTime("habit:$project"))else ui.text("默认 0 轮；展开不会自动分配"))+" · "+if(draft.allocated>=pool.totalRounds)ui.text("全部轮次已分配")else ui.text("还剩 {0} 轮",pool.totalRounds-draft.allocated),NativeTextRole.CAPTION)
                    }else{
                        if(!ordinary){NativeSeparator();NativeText(target.title,NativeTextRole.BODY);NativeText(ui.text("当前")+" ${target.progress/100}%（"+ui.text(if(target.progress==0)"尚未推进"else"已有建筑进度")+"）",NativeTextRole.CAPTION)}
                        val allocation=draft.tasks.find{it.taskId==target.taskId}
                        val chipColors=MaterialTheme.colorScheme
                        FlowRow(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp),maxItemsInEachRow=3){
                            for(value in listOf(target.progress,2500,5000,7500,10000).distinct().filter{it>=target.progress}){
                                val label=if(value==target.progress)ui.text("保持 {0}%",value/100)else if(value==10000)ui.text("完成小任务")else ui.text("推进至 {0}%",value/100)
                                val interaction=remember{MutableInteractionSource()}
                                val chosen=allocation?.progress==value
                                Row(Modifier.heightIn(min=44.dp).clickable(enabled=!pending&&!delivered,role=Role.Button,interactionSource=interaction,indication=null){progress(target,value)}
                                    .nativePressMotion(interaction,!pending&&!delivered).semantics{selected=chosen}
                                    .border(1.dp,if(chosen)chipColors.primary else chipColors.outlineVariant)
                                    .background(if(chosen)chipColors.surfaceVariant else chipColors.surface.copy(alpha=.55f))
                                    .padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
                                    if(chosen)PixelGlyph("check",Modifier.size(16.dp),chipColors.primary)
                                    Text(label,style=MaterialTheme.typography.bodyLarge,color=if(chosen)chipColors.primary else LocalContentColor.current)
                                }
                            }
                        }
                        if(!ordinary&&allocation!=null){
                            FormalRoundStepper(ui.text("计入轮数"),allocation.rounds,0,(pool.totalRounds-draft.allocated+allocation.rounds).toInt().coerceAtLeast(0),!pending&&!delivered){next->draft=draft.copy(tasks=draft.tasks.map{if(it.taskId==target.taskId)it.copy(rounds=next)else it})}
                            if(allocation.rounds>0)NativeText(ui.text("预计实际投入 {0}",assignedTime("task:${target.taskId}")),NativeTextRole.CAPTION)
                        }
                    }
                }}
            }
        }
    }
    if(!ordinary){
        NativeSeparator()
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
            FormalRoundPips(pool.totalRounds,draft.allocated.toInt(),cell=10.dp)
            Text(ui.text("已分配 {0} / {1} 轮",draft.allocated,pool.totalRounds),style=MaterialTheme.typography.bodySmall)
        }
        FormalGlassAction(ui.text(if(delivered)"材料已送达！" else if(pending)"正在保存…" else "一次提交本次推进"),{onSubmit(draft)},modifier=feedbackDraw.semantics{liveRegion=androidx.compose.ui.semantics.LiveRegionMode.Polite},pending=pending,enabled=valid&&!delivered)
    }else if(delivered||pending)Text(ui.text(if(delivered)"材料已送达！" else "保存中…"),style=MaterialTheme.typography.bodyLarge)
}

@Composable private fun FormalRoundStepper(label:String,value:Int,min:Int,max:Int,enabled:Boolean,onChange:(Int)->Unit){
    Row(Modifier.fillMaxWidth().heightIn(min=44.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
        NativeText(label,NativeTextRole.CAPTION,Modifier.weight(1f))
        NativeIconAction(LocalNativeUi.current.text("减少轮数"),"minus",{onChange((value-1).coerceAtLeast(min))},enabled=enabled&&value>min)
        NativeText(value.toString(),NativeTextRole.BODY)
        NativeIconAction(LocalNativeUi.current.text("增加轮数"),"plus",{onChange((value+1).coerceAtMost(max))},enabled=enabled&&value<max)
    }
}

private fun reportDraftSaver()=androidx.compose.runtime.saveable.mapSaver(
    save={d:ReportDraft->mapOf("plan" to d.planId,
        "tasks" to ArrayList(d.tasks.flatMap{listOf<Any>(it.projectId,it.taskId,it.progress,it.rounds)}),
        "habits" to ArrayList(d.habits.flatMap{listOf<Any>(it.projectId,it.rounds)}))},
    restore={raw->runCatching{ReportDraft(raw.getValue("plan") as String,
        (raw.getValue("tasks") as List<*>).chunked(4).map{TaskAllocation(it[0] as String,it[1] as String,it[2] as Int,it[3] as Int)},
        (raw.getValue("habits") as List<*>).chunked(2).map{HabitAllocation(it[0] as String,it[1] as Int)})}.getOrNull()})

@Composable fun formatDuration(ms:Long):String {
    val ui=LocalNativeUi.current;val minutes=(ms/60000.0+.5).toLong()
    return if(minutes<60)ui.text("{0} 分钟",minutes)else if(minutes%60==0L)ui.text("{0} 小时",minutes/60)else ui.text("{0} 小时 {1} 分钟",minutes/60,minutes%60)
}
