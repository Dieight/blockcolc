package com.blockcolc.preview.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.blockcolc.presentation.WorkspaceActions
import com.blockcolc.presentation.WorkspaceMutation
import com.blockcolc.preview.*
import java.util.UUID

@OptIn(ExperimentalLayoutApi::class)
@Composable fun NativeTasksPage(s:WorkspaceUiState,runtime:WorkspaceActions,onCreate:()->Unit,onGoal:()->Unit,onEdit:(TitleEditor)->Unit,onSelect:(String,String?)->Unit,onNextHabit:()->Unit,onView:(String)->Unit={},onFriends:()->Unit={},friendsEnabled:Boolean=false){
    val ui=LocalNativeUi.current;val current=s.projects.find{it.id==s.activeProject};val workspace=s.workspace
    val switch=rememberNativeRequest(s)
    NativePageScroll{
        NativePageTitle(ui.text("任务")){
            FormalTextAction(ui.text("新增任务"),"plus",onCreate,enabled=!s.busy&&s.planId==null)
            if(friendsEnabled)NativeIconAction(if(ui.language=="en")"Friends"else"好友","friends",onFriends)
        }
        if(workspace!=null)FormalCard(Modifier.heightIn(min=200.dp)){
            Row(Modifier.fillMaxWidth().heightIn(min=44.dp),verticalAlignment=Alignment.CenterVertically){
                NativeText(ui.text("今日目标"),NativeTextRole.SECTION,Modifier.weight(1f));NativeIconAction(ui.text("调整"),"edit",onGoal)
            }
            val goal=workspace.todayGoal
            Row(Modifier.fillMaxWidth().heightIn(min=48.dp),verticalAlignment=Alignment.CenterVertically){
                NativeText(if(goal.enabled)"${goal.completed}"else "—",NativeTextRole.NUMBER,color=MaterialTheme.colorScheme.primary)
                NativeText(if(goal.enabled)" / ${goal.target} ${ui.text("轮")}"else ui.text("今日目标已关闭"),NativeTextRole.BODY,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(22.dp))
            Row(Modifier.fillMaxWidth().heightIn(min=52.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(16.dp)){
                FormalProgress(goal.completed,max=goal.target,segments=goal.target.coerceIn(1,20),modifier=Modifier.weight(1f))
                NativeOccasionEmblems(workspace.today,1,workspace.settings.birthday)
            }
        }
        if(s.preferences.quickNotesEnabled)FormalCard{NativeQuickNotes(s,runtime)}
        if(current!=null)FormalCard{
            var managing by rememberNativePageState("tasks/${current.id}/managing"){false}
            var deleting by rememberNativePageState("tasks/${current.id}/deleting"){false}
            val edit=rememberNativeRequest(s)
            val details=workspace?.projects?.find{it.id==current.id}
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Column(Modifier.weight(1f).pointerInput(current.id){detectTapGestures(onDoubleTap={onEdit(TitleEditor(projectId=current.id,taskId=null,initial=current.title))})},verticalArrangement=Arrangement.spacedBy(4.dp)){
                    NativeText(current.title,NativeTextRole.SECTION)
                    if(current.kind=="habit")NativeText(ui.text("习惯任务"),NativeTextRole.CAPTION,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
                NativeIconAction(ui.text(if(managing)"结束编辑施工清单"else"编辑施工清单"),if(managing)"check"else"edit",{managing=!managing})
            }
            if(current.kind!="habit"){Spacer(Modifier.height(16.dp));FormalProgress(current.progress)}
            Row(Modifier.fillMaxWidth().padding(top=6.dp),horizontalArrangement=Arrangement.End){
                if(managing)FormalTextAction(ui.text("修改任务名称"),"edit",{onEdit(TitleEditor(projectId=current.id,taskId=null,initial=current.title))},Modifier.weight(1f))
                FormalTextAction(ui.text(if(details?.awaitingBuilding==true)"查看聚落"else"查看建筑"),"cube",{onView(current.id)})
            }
            Spacer(Modifier.height(14.dp))
            if(current.kind=="habit"){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                    NativeText(ui.text("习惯周期"),NativeTextRole.BODY,Modifier.weight(1f))
                    NativeInfoAction(ui.text("习惯周期"),ui.text("每次完整或提前完成的专注都会推进当前建筑。"))
                }
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                    NativeText(if(details?.awaitingBuilding==true)ui.text("等待下一座建筑")else ui.text("第 {0} 座建筑",details?.habitCycle?:1),NativeTextRole.CAPTION,Modifier.weight(1f))
                    NativeText(if(details?.awaitingBuilding==true)ui.text("待选择")else "${details?.habitApplied?:0} / ${details?.habitTarget?:0} ${ui.text("轮")}",NativeTextRole.SECTION)
                }
                val target=details?.habitTarget?:10
                Spacer(Modifier.height(12.dp));FormalProgress(if(details?.awaitingBuilding==true)target else details?.habitApplied?:0,max=target,segments=target.coerceIn(1,24),
                    modifier=Modifier.semantics{contentDescription=ui.text("习惯周期进度")})
                Spacer(Modifier.height(16.dp))
                Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
                    Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
                        NativeText(ui.text("已完成建筑"),NativeTextRole.CAPTION,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        NativeText("${workspace?.memories?.archives?.count{it.projectId==current.id&&it.cycleNumber!=null}?:0} ${ui.text("座")}",NativeTextRole.BODY)
                    }
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                            NativeText(ui.text("当前蓝图"),NativeTextRole.CAPTION,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            NativeText(if(details?.awaitingBuilding==true)ui.text("前往计时页选择")else s.blueprintNames[current.blueprint]?:current.blueprint,NativeTextRole.BODY)
                        }
                        if(details?.awaitingBuilding!=true)NativeInfoAction(ui.text("当前蓝图"),ui.text("本周期内锁定"))
                    }
                }
                if(details?.awaitingBuilding==true)NativeAction(ui.text("选择下一栋建筑"),onNextHabit,Modifier.fillMaxWidth().padding(top=16.dp),enabled=!s.busy)
            }else{
                NativeText("${ui.text("已完成")} ${current.tasks.count{it.progress>=10000}} / ${current.tasks.size} ${ui.text("项")}",NativeTextRole.CAPTION,Modifier.padding(top=6.dp),MaterialTheme.colorScheme.onSurfaceVariant)
                if(details?.structureLocked==true)NativeText(ui.text("已有进度后不能增删，可继续改名和排序。"),NativeTextRole.CAPTION,Modifier.padding(top=10.dp))
                val next=current.tasks.firstOrNull{it.progress<10000}
                @Composable fun taskRow(task:TaskRow){
                    val index=current.tasks.indexOf(task);val complete=task.progress>=10000
                    Row(Modifier.fillMaxWidth().heightIn(min=78.dp).padding(vertical=10.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){
                        if(complete)PixelGlyph("check",Modifier.size(24.dp))else FormalTaskFlag(task.id==next?.id)
                        Column(Modifier.weight(1f).pointerInput(task.id){detectTapGestures(onDoubleTap={onEdit(TitleEditor(projectId=current.id,taskId=task.id,initial=task.title))})},verticalArrangement=Arrangement.spacedBy(4.dp)){
                            NativeText(task.title,NativeTextRole.BODY,color=if(task.id==next?.id)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                            NativeText((if(complete)ui.text("已完成")+" · "else if(task.id==next?.id)ui.text("进行中")+" · "else "")+"${task.progress/100}%",NativeTextRole.CAPTION,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if(!managing&&!complete)NativeIconAction(ui.text("选择小任务"),"play",{onSelect(current.id,task.id)},enabled=s.planId==null&&!s.busy)
                        if(managing){NativeIconAction(ui.text("重命名"),"edit",{onEdit(TitleEditor(projectId=current.id,taskId=task.id,initial=task.title))},enabled=!s.busy)}
                    }
                    if(managing)FlowRowForActions{
                        NativeIconAction(ui.text("上移"),"chevron",{val order=current.tasks.map{it.id}.toMutableList();java.util.Collections.swap(order,index,index-1);edit.submit{runtime.dispatch(WorkspaceMutation.ReorderSubtasks(current.id,order),it)}},enabled=index>0&&!edit.busy&&!s.busy)
                        NativeIconAction(ui.text("下移"),"chevron",{val order=current.tasks.map{it.id}.toMutableList();java.util.Collections.swap(order,index,index+1);edit.submit{runtime.dispatch(WorkspaceMutation.ReorderSubtasks(current.id,order),it)}},enabled=index<current.tasks.lastIndex&&!edit.busy&&!s.busy)
                        if(details?.structureLocked!=true)NativeIconAction(ui.text("删除小任务"),"minus",{edit.submit{runtime.dispatch(WorkspaceMutation.RemoveSubtask(current.id,task.id),it)}},enabled=current.tasks.size>1&&!edit.busy&&!s.busy)
                    }
                    NativeSeparator()
                }
                if(managing)for(task in current.tasks)key(task.id){taskRow(task)}else{
                    if(next!=null){key(next.id){taskRow(next)}}
                    for(task in current.tasks.filter{it.progress<10000&&it.id!=next?.id})key(task.id){taskRow(task)}
                    val completed=current.tasks.filter{it.progress>=10000}
                    if(completed.isNotEmpty()){var open by rememberNativePageState("tasks/${current.id}/completed"){false};NativeDisclosure(ui.text("已完成"),null,open,{open=it},valueLabel=completed.size.toString()){for(task in completed)key(task.id){taskRow(task)}}}
                }
                if(managing&&details?.structureLocked!=true)FormalTextAction(ui.text("新增小任务"),"plus",{onEdit(TitleEditor(projectId=current.id,taskId=null,initial="",add=true))},enabled=!s.busy)
            }
            if(managing){
                FormalTextAction(ui.text("删除当前任务"),"close",{deleting=true},Modifier.padding(top=16.dp),s.planId==null&&!s.busy)
                NativeSheet(if(deleting)current.id else null,{ui.text("删除任务")},{deleting=false},!edit.busy){
                    NativeText(ui.text("删除前会自动创建本地回滚备份，可在设置中恢复。"),NativeTextRole.BODY)
                    NativeAction(ui.text("确认删除"),{edit.submit{runtime.dispatch(WorkspaceMutation.DeleteProject(current.id),it)}},Modifier.fillMaxWidth(),pending=edit.busy,danger=true,enabled=!s.busy)
                    NativeRequestError(edit)
                }
            }
            NativeRequestError(edit)
        }else NativeText(ui.text("还没有当前任务"),NativeTextRole.BODY)
        FormalCard{
            val others=s.projects.filter{it.id!=s.activeProject&&it.status!="deleted"};var expanded by rememberNativePageState("tasks/overview"){false}
            NativeDisclosure(ui.text("任务总览与管理"),null,expanded,{expanded=it},valueLabel=others.size.toString(),titleStyle=MaterialTheme.typography.titleMedium){
                for((label,projects)in listOf("习惯" to others.filter{it.kind=="habit"},"暂停" to others.filter{it.kind!="habit"&&it.status=="paused"},"已完成" to others.filter{it.kind!="habit"&&it.status=="monument"})){
                    if(projects.isNotEmpty())NativeText(ui.text(label),NativeTextRole.CAPTION,Modifier.padding(top=12.dp))
                    for(project in projects)Row(Modifier.fillMaxWidth().heightIn(min=56.dp),verticalAlignment=Alignment.CenterVertically){
                        NativeText(project.title,NativeTextRole.BODY,Modifier.weight(1f))
                        FormalTextAction(ui.text("查看建筑"),"cube",{onView(project.id)})
                        if(project.status!="monument")FormalTextAction(ui.text("切换"),"play",{switch.submit{runtime.dispatch(WorkspaceMutation.SwitchProject(project.id),it)}},enabled=s.planId==null&&!s.busy&&!switch.busy)
                    }
                }
                NativeRequestError(switch)
            }
        }
    }
}

@Composable private fun FormalTaskFlag(current:Boolean){
    val ink=if(current)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    androidx.compose.foundation.Canvas(Modifier.size(24.dp)){
        val u=size.width/12;drawRect(ink,Offset(3*u,2*u),androidx.compose.ui.geometry.Size(u,8*u));drawRect(ink,Offset(4*u,2*u),androidx.compose.ui.geometry.Size(5*u,u));drawRect(ink,Offset(4*u,4*u),androidx.compose.ui.geometry.Size(3*u,u));drawRect(ink,Offset(8*u,3*u),androidx.compose.ui.geometry.Size(u,u))
    }
}
@Composable fun NativePageScroll(modifier:Modifier=Modifier,content:@Composable ColumnScope.()->Unit){
    val shared=LocalNativePageScroll.current
    val scroll=shared?:rememberScrollState()
    Column(modifier.fillMaxSize().verticalScroll(scroll).padding(start=20.dp,end=20.dp,top=22.dp,bottom=32.dp),verticalArrangement=Arrangement.spacedBy(24.dp),content=content)
}
@OptIn(ExperimentalLayoutApi::class)
@Composable private fun FlowRowForActions(content:@Composable FlowRowScope.()->Unit){FlowRow(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),content=content)}
