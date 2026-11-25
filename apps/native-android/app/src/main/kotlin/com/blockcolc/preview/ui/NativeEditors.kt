package com.blockcolc.preview.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.*
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import com.blockcolc.presentation.*
import com.blockcolc.storage.PlanMode
import com.blockcolc.preview.*
import java.util.UUID

data class ProjectEditor(val token:String=UUID.randomUUID().toString(),val nextHabit:Boolean=false,val initialHabit:Boolean=false)
data class TitleEditor(val token:String=UUID.randomUUID().toString(),val projectId:String,val taskId:String?,val initial:String,val add:Boolean=false)
private data class SubtaskDraft(val id:String,val value:TextFieldValue)

/** The original creation form is a page above the navigation, not a sheet. */
@Composable fun NativeProjectEditor(model:ProjectEditor?,s:WorkspaceUiState,runtime:WorkspaceActions,onClose:()->Unit){
    val entry=model?:return;val ui=LocalNativeUi.current;val colors=MaterialTheme.colorScheme
    val focus=androidx.compose.ui.platform.LocalFocusManager.current
    val request=rememberNativeRequest(s,onClose)
    androidx.compose.runtime.key(entry.token){
      var habit by rememberSaveable(entry.token){mutableStateOf(entry.nextHabit||entry.initialHabit)}
      var title by rememberSaveable(entry.token,stateSaver=TextFieldValue.Saver){mutableStateOf(TextFieldValue(ui.text("我的第一座工坊")))}
      var blueprint by rememberSaveable(entry.token){mutableStateOf("builtin-small-workshop")}
      val target=rememberSaveable(entry.token){s.preferences.habitTargetRounds}
      var adding by rememberSaveable(entry.token,stateSaver=TextFieldValue.Saver){mutableStateOf(TextFieldValue())}
      var tasks by rememberSaveable(entry.token,stateSaver=listSaver<List<SubtaskDraft>,Any>(
          save={list->list.flatMap{listOf<Any>(it.id,it.value.text,it.value.selection.start,it.value.selection.end)}},
          restore={values->values.chunked(4).map{SubtaskDraft(it[0] as String,TextFieldValue(it[1] as String,TextRange(it[2] as Int,it[3] as Int)))}})){
          mutableStateOf(listOf("确定目标","完成核心工作","检查并收尾").map{SubtaskDraft(UUID.randomUUID().toString(),TextFieldValue(ui.text(it)))})
      }
      androidx.activity.compose.BackHandler(enabled=!request.busy,onBack=onClose)
      NativePageScroll{
        Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){
            PixelGlyph("cube",Modifier.size(24.dp),colors.primary)
            NativeText(ui.text(if(entry.nextHabit)"选择下一栋建筑"else"新增任务"),NativeTextRole.TITLE)
        }
        if(!entry.nextHabit){
            NativeSegments(listOf(false to ui.text("普通大型任务"),true to ui.text("习惯任务")),habit,{habit=it},!request.busy,icons=mapOf(false to "cube",true to "repeat"),textStyle=MaterialTheme.typography.labelMedium)
            Column(verticalArrangement=Arrangement.spacedBy(7.dp)){
                NativeText(ui.text(if(habit)"习惯名称"else"大型任务"),NativeTextRole.CAPTION)
                FormalProjectInput(ui.text("任务名称"),title,{title=it},!request.busy)
            }
        }
        if(!habit){
            Column(verticalArrangement=Arrangement.spacedBy(7.dp)){
                Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){NativeText(ui.text("拆成小任务"),NativeTextRole.CAPTION,Modifier.weight(1f));FormalTextAction(ui.text("清空"),"",{tasks=emptyList()},enabled=!request.busy)}
                for((index,task) in tasks.withIndex())androidx.compose.runtime.key(task.id){
                    Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        Box(Modifier.size(30.dp).background(colors.surfaceVariant),contentAlignment=androidx.compose.ui.Alignment.Center){NativeText((index+1).toString(),NativeTextRole.CAPTION,color=colors.primary)}
                        Box(Modifier.weight(1f)){FormalProjectInput(if(index==0)ui.text("小任务名称")else ui.text("小任务 {0}",index+1),task.value,{v->tasks=tasks.map{if(it.id==task.id)it.copy(value=v)else it}},!request.busy)}
                        NativeIconAction(ui.text("删除小任务 {0}",index+1),"close",{tasks=tasks.filterNot{it.id==task.id}},enabled=!request.busy)
                    }
                }
                Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                    Box(Modifier.weight(1f)){FormalProjectInput(ui.text("新增小任务"),adding,{adding=it},!request.busy,ui.text("例如：整理验证结果"),true)}
                    FormalTextAction(ui.text("添加"),"plus",{if(adding.composition==null&&adding.text.isNotBlank()){tasks=tasks+SubtaskDraft(UUID.randomUUID().toString(),adding);adding=TextFieldValue()}},enabled=!request.busy&&adding.text.isNotBlank())
                }
            }
        }else Column(verticalArrangement=Arrangement.spacedBy(6.dp)){
            NativeText(ui.text("每座建筑"),NativeTextRole.CAPTION);NativeText("$target "+ui.text("轮专注"),NativeTextRole.TITLE,accent=true)
            NativeText(ui.text("统一在设置中调整；创建后，本周期内不会改变。"),NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
        }
        Column(verticalArrangement=Arrangement.spacedBy(NativeOptionSpacing)){
            NativeText(ui.text("选择建筑蓝图"),NativeTextRole.BODY)
            NativeBlueprintPicker(s.blueprints,blueprint,!request.busy){blueprint=it}
        }
        NativeRequestError(request)
        val valid=s.blueprints.items.any{it.id==blueprint&&it.selectable}&&(entry.nextHabit||title.text.isNotBlank())&&(habit||tasks.isNotEmpty()&&tasks.all{it.value.text.isNotBlank()})
        Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){
            FormalTextAction(ui.text("取消"),"",onClose,Modifier.widthIn(min=64.dp),!request.busy)
            NativeAction(ui.text(if(request.busy)"正在创建…"else if(entry.nextHabit)"确认选择"else"开始建造"),{
                if(BuildConfig.NATIVE_DIAGNOSTICS)android.util.Log.i("BlockcolcEditor","explicit-create habit=$habit")
                val cmd=if(entry.nextHabit)WorkspaceMutation.NextHabitBuilding(s.activeProject?:return@NativeAction,blueprint,target)
                    else if(habit)WorkspaceMutation.CreateHabit(UUID.randomUUID().toString(),title.text,blueprint,target)
                    else WorkspaceMutation.CreateProject(UUID.randomUUID().toString(),title.text,blueprint,tasks.map{WorkspaceMutation.NewSubtask(it.id,it.value.text)})
                // An explicit save commits the visible composing text. IME
                // candidate Enter is still not a submission action.
                if(BuildConfig.NATIVE_DIAGNOSTICS&&(title.composition!=null||tasks.any{it.value.composition!=null}))android.util.Log.i("BlockcolcEditor","explicit-create-composition")
                title=title.copy(composition=null);tasks=tasks.map{it.copy(value=it.value.copy(composition=null))};focus.clearFocus()
                request.submit{runtime.dispatch(cmd,it)}
            },Modifier.weight(1f),pending=request.busy,enabled=valid&&!s.busy,icon="hammer")
        }
      }
    }
}

@Composable private fun FormalProjectInput(label:String,value:TextFieldValue,onValue:(TextFieldValue)->Unit,enabled:Boolean,placeholder:String?=null,dashed:Boolean=false){
    val colors=MaterialTheme.colorScheme
    androidx.compose.foundation.text.BasicTextField(value,onValue,enabled=enabled,singleLine=true,textStyle=MaterialTheme.typography.bodyLarge.copy(color=colors.onSurface),
        cursorBrush=androidx.compose.ui.graphics.SolidColor(colors.primary),modifier=Modifier.fillMaxWidth().heightIn(min=44.dp).semantics{contentDescription=label}
          .then(if(dashed)Modifier.drawBehind{drawRect(colors.outline,style=androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx(),pathEffect=androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(),3.dp.toPx()))))}else Modifier.border(1.dp,colors.outline))
          .background(if(dashed)androidx.compose.ui.graphics.Color.Transparent else colors.surface).padding(horizontal=12.dp,vertical=10.dp),
        decorationBox={field->Box(contentAlignment=androidx.compose.ui.Alignment.CenterStart){if(value.text.isEmpty()&&placeholder!=null)NativeText(placeholder,NativeTextRole.BODY,color=colors.onSurfaceVariant.copy(alpha=.7f));field()}})
}

@Composable fun NativeTitleEditor(model:TitleEditor?,s:WorkspaceUiState,runtime:WorkspaceActions,onClose:()->Unit){
    val ui=LocalNativeUi.current;val request=rememberNativeRequest(s,onClose)
    val focus=androidx.compose.ui.platform.LocalFocusManager.current
    NativeSheet(model,{ui.text(if(it.add)"新增小任务" else "重命名")},onClose,!request.busy){entry->
        var input by rememberSaveable(entry.token,stateSaver=TextFieldValue.Saver){mutableStateOf(TextFieldValue(entry.initial))}
        NativeTextEntry(ui.text("名称"),input,{input=it},!request.busy)
        NativeRequestError(request)
        NativeAction(ui.text("保存"),{
            if(s.activeProject!=entry.projectId)return@NativeAction
            val cmd=when{entry.add->WorkspaceMutation.AddSubtask(entry.projectId,UUID.randomUUID().toString(),input.text)
                entry.taskId!=null->WorkspaceMutation.RenameSubtask(entry.projectId,entry.taskId,input.text)
                else->WorkspaceMutation.RenameProject(entry.projectId,input.text)}
            if(BuildConfig.NATIVE_DIAGNOSTICS&&input.composition!=null)android.util.Log.i("BlockcolcEditor","explicit-title-composition")
            input=input.copy(composition=null);focus.clearFocus()
            request.submit{runtime.dispatch(cmd,it)}
        },Modifier.fillMaxWidth(),pending=request.busy,enabled=input.text.isNotBlank()&&s.activeProject==entry.projectId&&!s.busy)
    }
}

@Composable fun NativeGoalEditor(open:Boolean,s:WorkspaceUiState,runtime:WorkspaceActions,onClose:()->Unit){
    val ui=LocalNativeUi.current;val request=rememberNativeRequest(s)
    NativeSheet(if(open)s.workspace?.today else null,{ui.text("今日目标")},onClose,!request.busy){date->
        val saved=s.workspace!!.todayGoal
        var draft by rememberSaveable(date){mutableIntStateOf(if(saved.enabled)saved.target else 0)}
        Text(ui.text("目标轮次"),style=MaterialTheme.typography.bodyLarge)
        Text("$draft ${ui.text("轮")}",style=MaterialTheme.typography.titleLarge)
        NativePhysicalSlider(ui.text("目标轮次"),draft,0,20,1,enabled=!request.busy&&!s.busy){value->
            draft=value
            request.submit{runtime.dispatch(WorkspaceMutation.DailyGoal(date,value),it)}
        }
        if(draft==0)Text(ui.text("今日目标已关闭"),style=MaterialTheme.typography.bodySmall)
        if(request.busy)NativeBusy()
        NativeRequestError(request)
    }
}

private data class ManualFocusSheet(val planId:String,val timer:TimerPresentation,val habit:Boolean){
    val resting get()=timer.surface==TimerSurface.REST
    val extending get()=timer.extensionStartedAt!=null
    val deferred get()=timer.mode in setOf(PlanMode.MINIMAL,PlanMode.MARATHON)
}

@Composable fun NativeManualEditor(open:Boolean,s:WorkspaceUiState,runtime:WorkspaceActions,onClose:()->Unit){
    val ui=LocalNativeUi.current;val request=rememberNativeRequest(s,onClose)
    var operation by rememberSaveable(open,s.planId){mutableStateOf<String?>(null)}
    val entry=remember(open,s.planId){
        val planId=s.planId
        val timer=s.timer
        if(open&&planId!=null&&timer!=null)ManualFocusSheet(planId,timer,s.choices.any{it.id==timer.projectId&&it.habit})else null
    }
    val options=listOf("external-interruption" to "外部打扰","task-blocked" to "任务受阻","fatigue" to "需要休息","priority-changed" to "优先级变化","device-or-app" to "设备或应用问题","other" to "其他")
    NativeSheet(entry,{item->ui.text(when{
        item.extending->"加时专注"
        operation=="interrupt"->"这次为什么中断？"
        operation=="cancel"->"取消整个多轮计划？"
        item.resting->"结束休息"
        else->"如何结束这次专注？"
    })},onClose,!request.busy){item->
        val planId=item.planId
        val timer=item.timer
        val resting=item.resting
        val extending=item.extending
        val deferred=item.deferred
        val habit=item.habit
        var category by rememberSaveable(planId){mutableStateOf<String?>(null)}
        var note by rememberSaveable(planId,stateSaver=TextFieldValue.Saver){mutableStateOf(TextFieldValue())}
        val enabled=!request.busy&&!s.busy
        if(extending){
            FormalGlassAction(ui.text("结束并完成本次专注"),{request.submit{runtime.decideFocus(FocusDecision.FinishExtension,it)}},
                pending=request.busy,enabled=enabled,reading=true)
        }else if(operation==null){
            NativeText(timer?.taskTitle?:ui.text(if(habit)"习惯专注"else"本次专注"),NativeTextRole.BODY)
            if(!resting){
                FormalEndChoice(ui.text("中断本轮"),ui.text("保留已有任务进度，不计完整轮次")+if(deferred||timer.totalRounds>1)ui.text("；本轮计划继续")else"","stop",enabled){operation="interrupt"}
                val detail=when{
                    deferred&&habit->if((timer?.completedRounds?:0)+1>=(timer?.totalRounds?:1))"推进当前习惯建筑，并结束本场计划"else"推进当前习惯建筑，并继续本场计划"
                    deferred->if((timer?.completedRounds?:0)+1>=(timer?.totalRounds?:1))"记录本轮，并进入本场统一汇报"else"记录本轮，并继续本场计划"
                    habit->"推进当前习惯建筑，并结束本轮计划"
                    else->"将当前小任务标为完成并结束本轮计划"
                }
                FormalEndChoice(ui.text(if(request.busy)"正在保存…"else if(deferred||habit)"提前完成本轮"else"提前完成任务"),ui.text(detail),"check",enabled,request.busy){request.submit{runtime.decideFocus(FocusDecision.CompleteEarly,it)}}
            }else FormalGlassAction(ui.text("结束休息"),{request.submit{runtime.decideFocus(FocusDecision.EndRest,it)}},pending=request.busy,enabled=enabled,reading=true)
            if(timer.mayCancelRunning)FormalEndChoice(ui.text("取消整个计划"),ui.text("结束后续轮次，保留已完成轮次"),"close",enabled){operation="cancel"}
        }else if(operation=="interrupt"){
            NativeText(ui.text("选择一项便于以后复盘，也可以不记录。"),NativeTextRole.BODY)
            for((id,label) in options+listOf(null to "不记录"))FormalGlassAction(ui.text(if(request.busy)"正在保存…"else label),{
                val reason=FocusEndReason.entries.find{it.key==id}
                request.submit{runtime.decideFocus(FocusDecision.Interrupt(reason),it)}
            },pending=request.busy,enabled=enabled,reading=true)
            FormalGlassAction(ui.text("返回"),{operation=null},enabled=enabled,reading=true)
        }else{
            NativeText(ui.text("已完成轮次会保留。当前未完成轮次会按中断记录。"),NativeTextRole.BODY)
            for((id,label) in options)FormalGlassAction(ui.text(label),{category=id},enabled=enabled,selected=category==id,reading=true)
            NativeTextEntry(ui.text("补充说明（可选）"),note,{if(it.text.length<=200)note=it},enabled,singleLine=false)
            NativeText(ui.text("{0} / 200 字",note.text.length),NativeTextRole.CAPTION)
            FormalGlassAction(ui.text(if(request.busy)"正在保存…"else"确认取消整个计划"),{
                if(note.composition==null&&category!=null)request.submit{runtime.decideFocus(FocusDecision.Cancel(FocusEndReason.entries.first{it.key==category},note.text),it)}
            },pending=request.busy,enabled=enabled&&category!=null,danger=true,reading=true)
            FormalGlassAction(ui.text("返回"),{operation=null},enabled=enabled,reading=true)
        }
        NativeRequestError(request)
    }
}

@Composable private fun FormalEndChoice(title:String,detail:String,icon:String,enabled:Boolean,pending:Boolean=false,onClick:()->Unit){
    val ink=LocalContentColor.current
    val interaction=remember{androidx.compose.foundation.interaction.MutableInteractionSource()}
    var motion by remember{mutableIntStateOf(0)}
    Row(Modifier.fillMaxWidth().heightIn(min=72.dp).clickable(enabled=enabled&&!pending,role=Role.Button,
        interactionSource=interaction,indication=null){motion++;onClick()}.nativePressMotion(interaction,enabled&&!pending)
        .border(1.dp,ink.copy(alpha=.12f)).padding(12.dp),
        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){
        Box(Modifier.width(30.dp),contentAlignment=Alignment.CenterStart){if(pending)NativeBusy()else NativeMotionGlyph(icon,motion,Modifier.size(23.dp),ink)}
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){NativeText(title,NativeTextRole.BODY);NativeText(detail,NativeTextRole.CAPTION)}
    }
}
