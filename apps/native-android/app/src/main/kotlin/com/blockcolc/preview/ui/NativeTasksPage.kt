package com.blockcolc.preview.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.blockcolc.presentation.WorkspaceActions
import com.blockcolc.presentation.WorkspaceMutation
import com.blockcolc.preview.*
import kotlin.math.*

@OptIn(ExperimentalLayoutApi::class)
@Composable fun NativeTasksPage(
    s:WorkspaceUiState,
    runtime:WorkspaceActions,
    onCreate:()->Unit,
    onGoal:()->Unit,
    onEdit:(TitleEditor)->Unit,
    onSelect:(String,String?)->Unit,
    onNextHabit:()->Unit,
    onView:(String)->Unit={},
    onFriends:()->Unit={},
    friendsEnabled:Boolean=false,
    friendsFocusing:Boolean=false,
){
    val ui=LocalNativeUi.current
    val colors=MaterialTheme.colorScheme
    val view=LocalView.current
    val current=s.projects.find{it.id==s.activeProject}
    val workspace=s.workspace
    val switch=rememberNativeRequest(s)
    var directoryOpen by rememberSaveable{mutableStateOf(false)}

    val switchable=s.choices
    val activeChoiceIndex=switchable.indexOfFirst{it.id==current?.id}.coerceAtLeast(0)

    fun switchTo(id:String){
        if(s.busy||switch.busy||s.planId!=null||id==current?.id)return
        view.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
        switch.submit{runtime.dispatch(WorkspaceMutation.SwitchProject(id),it)}
    }
    fun stepProject(delta:Int){
        if(switchable.size<2||s.planId!=null||s.busy||switch.busy)return
        val next=switchable[(activeChoiceIndex+delta+switchable.size)%switchable.size]
        switchTo(next.id)
    }

    NativePageScroll{
        // Monograph Folio Top Eyebrow (No generic "任务" heading; pure pixel utility rail)
        Row(Modifier.fillMaxWidth().heightIn(min=40.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(4.dp)){
            val counterText=if(switchable.size>1&&current!=null)String.format(java.util.Locale.ROOT,"%02d / %02d",activeChoiceIndex+1,switchable.size) else ui.text("当前大任务")
            NativeText(counterText,NativeTextRole.CAPTION,Modifier.weight(1f),color=colors.onSurfaceVariant,accent=true)
            if(friendsEnabled){
                Box(contentAlignment=Alignment.Center){
                    NativeIconAction(if(ui.language=="en")"Friends"else"好友","friends",onFriends)
                    if(friendsFocusing){
                        Box(Modifier.align(Alignment.TopEnd).padding(top=8.dp,end=8.dp).size(5.dp).background(colors.primary))
                    }
                }
            }
            NativeIconAction(ui.text("新增任务"),"plus",onCreate,enabled=!s.busy&&s.planId==null)
            if(current!=null){
                val details=workspace?.projects?.find{it.id==current.id}
                NativeIconAction(ui.text(if(details?.awaitingBuilding==true)"查看聚落"else"查看建筑"),"cube",{onView(current.id)})
            }
        }

        if(current!=null){
            var managing by rememberNativePageState("tasks/${current.id}/managing"){false}
            var deleting by rememberNativePageState("tasks/${current.id}/deleting"){false}
            val edit=rememberNativeRequest(s)
            val details=workspace?.projects?.find{it.id==current.id}

            // Monograph Project Title Switcher + Architectural Index Bars
            Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(12.dp)){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
                    if(switchable.size>1){
                        NativeIconAction(ui.text("上一个任务"),"chevron",{stepProject(-1)},Modifier.graphicsLayer{rotationZ=90f},enabled=!s.busy&&s.planId==null&&!switch.busy)
                    }
                    Row(
                        Modifier
                            .weight(1f)
                            .clickable(role=Role.Button,interactionSource=remember{MutableInteractionSource()},indication=null){directoryOpen=true}
                            .pointerInput(current.id){detectTapGestures(onDoubleTap={onEdit(TitleEditor(projectId=current.id,taskId=null,initial=current.title))})}
                            .semantics{contentDescription=ui.text("全部任务")}
                            .padding(vertical=4.dp),
                        verticalAlignment=Alignment.CenterVertically,
                        horizontalArrangement=if(switchable.size>1)Arrangement.Center else Arrangement.Start,
                    ){
                        Text(current.title,style=MaterialTheme.typography.headlineLarge,color=colors.onBackground,maxLines=2,modifier=Modifier.weight(1f,fill=false))
                        Spacer(Modifier.width(6.dp))
                        PixelGlyph("chevron",Modifier.size(16.dp),colors.onSurfaceVariant)
                    }
                    if(switchable.size>1){
                        NativeIconAction(ui.text("下一个任务"),"chevron",{stepProject(1)},Modifier.graphicsLayer{rotationZ=-90f},enabled=!s.busy&&s.planId==null&&!switch.busy)
                    }
                }
                if(switchable.size>1){
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(5.dp)){
                        for(choice in switchable){
                            val active=choice.id==current.id
                            Box(
                                Modifier
                                    .weight(1f)
                                    .height(2.5.dp)
                                    .background(if(active)colors.primary else colors.outlineVariant)
                                    .clickable(enabled=!s.busy&&s.planId==null&&!switch.busy,interactionSource=remember{MutableInteractionSource()},indication=null){
                                        switchTo(choice.id)
                                    },
                            )
                        }
                    }
                }
                NativeRequestError(switch)
            }

            // Magnetic Radial Dot-Matrix Progress Sculpture (interactive swipe flips projects)
            val progressFraction=if(current.kind=="habit"){
                val target=(details?.habitTarget?:10).coerceAtLeast(1)
                val applied=if(details?.awaitingBuilding==true)target else details?.habitApplied?:0
                (applied.toFloat()/target.toFloat()).coerceIn(0f,1f)
            }else{
                (current.progress/10000f).coerceIn(0f,1f)
            }
            GalleryRadialDotSculpture(
                fraction=progressFraction,
                canSwipe=switchable.size>1&&s.planId==null&&!s.busy,
                onSwipeStep=::stepProject,
            )

            // Naked Hero Percentage + Compact Architectural Spec Line
            Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(4.dp)){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Bottom){
                    if(current.kind=="habit"){
                        val target=(details?.habitTarget?:10).coerceAtLeast(1)
                        val applied=if(details?.awaitingBuilding==true)target else details?.habitApplied?:0
                        Text("$applied",style=MaterialTheme.typography.displayMedium,color=colors.onBackground,maxLines=1)
                        NativeText(" / $target",NativeTextRole.TITLE,Modifier.padding(bottom=6.dp,start=4.dp),color=colors.onSurfaceVariant,accent=true)
                        Spacer(Modifier.weight(1f))
                    }else{
                        Text("${(current.progress+50)/100}%",style=MaterialTheme.typography.displayMedium,color=colors.onBackground,maxLines=1)
                        Spacer(Modifier.weight(1f))
                    }
                    workspace?.let{NativeOccasionEmblems(it.today,1,it.settings.birthday)}
                }
                val blueprintTitle=s.blueprintNames[current.blueprint]?:current.blueprint
                val summaryLine=if(current.kind=="habit"){
                    if(details?.awaitingBuilding==true)ui.text("等待下一座建筑")
                    else ui.text("第 {0} 座建筑",details?.habitCycle?:1)+" · "+blueprintTitle
                }else{
                    blueprintTitle+" · "+ui.text("已完成 {0} / {1} 项",current.tasks.count{it.progress>=10000},current.tasks.size)
                }
                NativeText(summaryLine,NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
                if(current.kind=="habit"&&details?.awaitingBuilding==true){
                    NativeAction(ui.text("选择下一栋建筑"),onNextHabit,Modifier.fillMaxWidth().padding(top=10.dp),enabled=!s.busy)
                }
            }

            // Cardless Today's Goal Strip (sole daily-goal entry across the app)
            if(workspace!=null){
                val goal=workspace.todayGoal
                FormalCard(padding=16.dp){
                    val goalInteraction=remember{MutableInteractionSource()}
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min=44.dp)
                            .clickable(role=Role.Button,interactionSource=goalInteraction,indication=null,onClick=onGoal)
                            .nativePressMotion(goalInteraction),
                        verticalAlignment=Alignment.CenterVertically,
                        horizontalArrangement=Arrangement.spacedBy(10.dp),
                    ){
                        PixelGlyph("target",Modifier.size(18.dp),if(goal.enabled)colors.primary else colors.onSurfaceVariant)
                        NativeText(ui.text("今日目标"),NativeTextRole.BODY,Modifier.weight(1f))
                        if(goal.enabled){
                            Row(verticalAlignment=Alignment.Bottom){
                                NativeText("${goal.completed}",NativeTextRole.SECTION,color=colors.primary,accent=true)
                                NativeText(ui.text(" / {0} 轮",goal.target),NativeTextRole.CAPTION,Modifier.padding(bottom=2.dp),color=colors.onSurfaceVariant)
                            }
                        }else{
                            NativeText(ui.text("关闭"),NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
                        }
                        PixelGlyph("chevron",Modifier.size(16.dp).graphicsLayer{rotationZ=-90f},colors.onSurfaceVariant)
                    }
                    if(goal.enabled){
                        Spacer(Modifier.height(10.dp))
                        FormalProgress(goal.completed,max=goal.target,segments=goal.target.coerceIn(1,20),height=3.dp)
                        val left=(goal.target-goal.completed).coerceAtLeast(0)
                        NativeText(
                            if(left==0)ui.text("今日目标已达成")else ui.text("还差 {0} · 约 {1}",ui.rounds(left),formatDuration(left*s.preferences.focusMinutes*60_000L)),
                            NativeTextRole.CAPTION,
                            Modifier.padding(top=8.dp),
                            color=if(left==0)colors.primary else colors.onSurfaceVariant,
                        )
                    }
                }
            }

            // Cardless Construction Subtask Ledger / Habit Cycle Facts
            FormalCard(padding=16.dp){
                Row(Modifier.fillMaxWidth().heightIn(min=40.dp),verticalAlignment=Alignment.CenterVertically){
                    NativeText(
                        ui.text(if(current.kind=="habit")"习惯周期"else"拆成小任务"),
                        NativeTextRole.CAPTION,
                        Modifier.weight(1f),
                        color=colors.onSurfaceVariant,
                    )
                    if(current.kind=="habit"){
                        NativeInfoAction(ui.text("习惯周期"),ui.text("每次完整或提前完成的专注都会推进当前建筑。"))
                    }
                    NativeIconAction(ui.text(if(managing)"结束编辑施工清单"else"编辑施工清单"),if(managing)"check"else"edit",{managing=!managing})
                }
                if(managing){
                    FormalTextAction(ui.text("修改任务名称"),"edit",{onEdit(TitleEditor(projectId=current.id,taskId=null,initial=current.title))})
                }
                if(current.kind=="habit"){
                    Spacer(Modifier.height(6.dp))
                    Row(Modifier.fillMaxWidth().padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
                        NativeText(ui.text("已完成建筑"),NativeTextRole.BODY,Modifier.weight(1f))
                        NativeText(ui.text("{0} 座",workspace?.memories?.archives?.count{it.projectId==current.id&&it.cycleNumber!=null}?:0),NativeTextRole.BODY,color=colors.onSurfaceVariant)
                    }
                    NativeSeparator()
                    Row(Modifier.fillMaxWidth().padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
                        NativeText(ui.text("当前蓝图"),NativeTextRole.BODY,Modifier.weight(1f))
                        NativeText(if(details?.awaitingBuilding==true)ui.text("前往计时页选择")else s.blueprintNames[current.blueprint]?:current.blueprint,NativeTextRole.BODY,color=colors.onSurfaceVariant)
                    }
                }else{
                    if(details?.structureLocked==true&&managing)NativeText(ui.text("已有进度后不能增删，可继续改名和排序。"),NativeTextRole.CAPTION,Modifier.padding(vertical=6.dp),color=colors.onSurfaceVariant)
                    val next=current.tasks.firstOrNull{it.progress<10000}
                    @Composable fun taskRow(task:TaskRow){
                        val index=current.tasks.indexOf(task);val complete=task.progress>=10000
                        val activeRow=task.id==next?.id
                        Row(Modifier.fillMaxWidth().heightIn(min=52.dp).padding(vertical=6.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){
                            if(complete)PixelGlyph("check",Modifier.size(18.dp),colors.primary)
                            else FormalTaskFlag(activeRow)
                            NativeText(
                                task.title,
                                NativeTextRole.BODY,
                                Modifier.weight(1f).pointerInput(task.id){detectTapGestures(onDoubleTap={onEdit(TitleEditor(projectId=current.id,taskId=task.id,initial=task.title))})},
                                color=if(activeRow)colors.primary else if(complete)colors.onSurfaceVariant else colors.onBackground,
                                maxLines=2,
                            )
                            NativeText("${(task.progress+50)/100}%",NativeTextRole.CAPTION,color=if(activeRow)colors.primary else colors.onSurfaceVariant,accent=true)
                            if(!managing&&!complete)NativeIconAction(ui.text("选择小任务"),"play",{onSelect(current.id,task.id)},enabled=s.planId==null&&!s.busy)
                            if(managing)NativeIconAction(ui.text("重命名"),"edit",{onEdit(TitleEditor(projectId=current.id,taskId=task.id,initial=task.title))},enabled=!s.busy)
                        }
                        if(managing)FlowRowForActions{
                            NativeIconAction(ui.text("上移"),"chevron",{val order=current.tasks.map{it.id}.toMutableList();java.util.Collections.swap(order,index,index-1);edit.submit{runtime.dispatch(WorkspaceMutation.ReorderSubtasks(current.id,order),it)}},Modifier.graphicsLayer{rotationZ=180f},enabled=index>0&&!edit.busy&&!s.busy)
                            NativeIconAction(ui.text("下移"),"chevron",{val order=current.tasks.map{it.id}.toMutableList();java.util.Collections.swap(order,index,index+1);edit.submit{runtime.dispatch(WorkspaceMutation.ReorderSubtasks(current.id,order),it)}},enabled=index<current.tasks.lastIndex&&!edit.busy&&!s.busy)
                            if(details?.structureLocked!=true)NativeIconAction(ui.text("删除小任务"),"minus",{edit.submit{runtime.dispatch(WorkspaceMutation.RemoveSubtask(current.id,task.id),it)}},enabled=current.tasks.size>1&&!edit.busy&&!s.busy)
                        }
                        NativeSeparator()
                    }
                    if(managing)for(task in current.tasks)key(task.id){taskRow(task)}else{
                        if(next!=null){key(next.id){taskRow(next)}}
                        for(task in current.tasks.filter{it.progress<10000&&it.id!=next?.id})key(task.id){taskRow(task)}
                        val completed=current.tasks.filter{it.progress>=10000}
                        if(completed.isNotEmpty()){
                            var open by rememberNativePageState("tasks/${current.id}/completed"){false}
                            NativeDisclosure(ui.text("已完成"),null,open,{open=it},valueLabel=completed.size.toString()){
                                for(task in completed)key(task.id){taskRow(task)}
                            }
                        }
                    }
                    if(managing&&details?.structureLocked!=true)FormalTextAction(ui.text("新增小任务"),"plus",{onEdit(TitleEditor(projectId=current.id,taskId=null,initial="",add=true))},Modifier.padding(top=8.dp),enabled=!s.busy)
                }
                if(managing){
                    FormalTextAction(ui.text("删除当前任务"),"close",{deleting=true},Modifier.padding(top=12.dp),s.planId==null&&!s.busy)
                    NativeSheet(if(deleting)current.id else null,{ui.text("删除任务")},{deleting=false},!edit.busy){
                        NativeText(ui.text("删除前会自动创建本地回滚备份，可在设置中恢复。"),NativeTextRole.BODY)
                        NativeAction(ui.text("确认删除"),{edit.submit{runtime.dispatch(WorkspaceMutation.DeleteProject(current.id),it)}},Modifier.fillMaxWidth(),pending=edit.busy,danger=true,enabled=!s.busy)
                        NativeRequestError(edit)
                    }
                }
                NativeRequestError(edit)
            }
        }else{
            NativeText(ui.text("还没有当前任务"),NativeTextRole.BODY)
            NativeAction(ui.text("新增任务"),onCreate,Modifier.fillMaxWidth(),icon="plus",enabled=!s.busy)
        }

        // Cardless Quick Notes directly on canvas
        if(s.preferences.quickNotesEnabled)FormalCard(padding=16.dp){NativeQuickNotes(s,runtime)}
    }

    // Frameless All-Projects Directory Sheet (replaces old stacked "任务总览与管理" box)
    NativeSheet(Unit.takeIf{directoryOpen},{ui.text("全部任务")},{directoryOpen=false},contentSpacing=0.dp){
        val all=s.projects.filter{it.status!="deleted"}
        val groups=listOf(
            "当前大任务" to all.filter{it.id==s.activeProject},
            "习惯" to all.filter{it.id!=s.activeProject&&it.kind=="habit"},
            "暂停" to all.filter{it.id!=s.activeProject&&it.kind!="habit"&&it.status=="paused"},
            "已完成" to all.filter{it.id!=s.activeProject&&it.kind!="habit"&&it.status=="monument"},
        )
        for((label,projects) in groups){
            if(projects.isEmpty())continue
            NativeText(ui.text(label),NativeTextRole.CAPTION,Modifier.padding(top=12.dp,bottom=4.dp),color=colors.onSurfaceVariant)
            for((idx,project) in projects.withIndex()){
                if(idx>0)NativeSeparator()
                val info=workspace?.projects?.find{it.id==project.id}
                val status=when{
                    project.kind=="habit"&&info?.awaitingBuilding==true->ui.text("等待下一座建筑")
                    project.kind=="habit"->ui.text("第 {0} 座 · {1} / {2} 轮",info?.habitCycle?:1,info?.habitApplied?:0,info?.habitTarget?:0)
                    project.status=="monument"->null
                    else->"${(project.progress+50)/100}%"
                }
                Row(Modifier.fillMaxWidth().heightIn(min=56.dp).padding(vertical=6.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                    PixelGlyph(if(project.kind=="habit")"repeat"else"cube",Modifier.size(18.dp),if(project.id==s.activeProject)colors.primary else colors.onSurfaceVariant)
                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)){
                        NativeText(project.title,NativeTextRole.BODY,color=if(project.id==s.activeProject)colors.primary else colors.onBackground,maxLines=2)
                        if(status!=null)NativeText(status,NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
                    }
                    NativeIconAction(ui.text("查看建筑"),"cube",{directoryOpen=false;onView(project.id)})
                    if(project.status!="monument"&&project.id!=s.activeProject){
                        NativeIconAction(ui.text("切换"),"play",{directoryOpen=false;switchTo(project.id)},enabled=s.planId==null&&!s.busy&&!switch.busy)
                    }
                }
            }
        }
        NativeRequestError(switch)
    }
}

/** Architectural concentric dot-matrix sculpture reflecting project completion.
 * Responds to horizontal drag to flip active projects cleanly. */
@Composable private fun GalleryRadialDotSculpture(fraction:Float,canSwipe:Boolean,onSwipeStep:(Int)->Unit){
    val ui=LocalNativeUi.current
    val colors=MaterialTheme.colorScheme
    val animated by animateFloatAsState(fraction.coerceIn(0f,1f),tween(if(ui.reduceMotion)0 else 420,easing=FastOutSlowInEasing),label="radial-sculpture")
    var dragAccum by remember{mutableFloatStateOf(0f)}
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(176.dp)
            .then(if(canSwipe)Modifier.pointerInput(canSwipe){
                val threshold=44.dp.toPx()
                detectHorizontalDragGestures(
                    onDragStart={dragAccum=0f},
                    onDragEnd={
                        if(abs(dragAccum)>=threshold)onSwipeStep(if(dragAccum<0f)1 else -1)
                        dragAccum=0f
                    },
                    onDragCancel={dragAccum=0f},
                    onHorizontalDrag={change,amount->change.consume();dragAccum+=amount},
                )
            }.semantics{contentDescription=ui.text("滑动切换大任务")} else Modifier),
    ){
        val center=Offset(size.width/2f,size.height/2f)
        val maxRadius=minOf(size.width,size.height)*0.45f
        val ringCounts=intArrayOf(12,18,24,30,36,42)
        val totalDots=ringCounts.sum()
        val filledDots=(animated*totalDots).roundToInt().coerceIn(0,totalDots)
        var index=0
        val unit=max(1.5.dp.toPx(),minOf(size.width,size.height)/110f)
        for(ring in ringCounts.indices){
            val count=ringCounts[ring]
            val r=maxRadius*(0.24f+0.76f*(ring.toFloat()/(ringCounts.size-1).toFloat()))
            val ringProgress=ring.toFloat()/(ringCounts.size-1).toFloat()
            for(i in 0 until count){
                val angle=-PI/2.0+2.0*PI*i/count
                val px=center.x+(r*cos(angle)).toFloat()
                val py=center.y+(r*sin(angle)).toFloat()
                val active=index<filledDots
                val isLeading=index==filledDots-1&&filledDots>0
                val dotSize=when{
                    isLeading->unit*2.7f
                    active->unit*(1.55f+0.55f*(1f-ringProgress))
                    else->unit*1.15f
                }
                val inactiveTint=colors.onSurfaceVariant.copy(alpha=if(colors.background.luminance()<0.5f)0.34f else 0.28f)
                val tint=when{
                    isLeading->colors.primary
                    active->if(ring<2)colors.primary else colors.onBackground.copy(alpha=0.86f-ringProgress*0.24f)
                    else->inactiveTint
                }
                drawRect(tint,Offset(px-dotSize/2f,py-dotSize/2f),Size(dotSize,dotSize))
                index++
            }
        }
    }
}

@Composable private fun FormalTaskFlag(current:Boolean){
    val ink=if(current)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Canvas(Modifier.size(18.dp)){
        val u=nativePixelCell(size.width/12);val o=Offset(nativePixelOrigin(size.width,12*u),nativePixelOrigin(size.height,12*u))
        translate(o.x,o.y){drawRect(ink,Offset(3*u,2*u),Size(u,8*u));drawRect(ink,Offset(4*u,2*u),Size(5*u,u));drawRect(ink,Offset(4*u,4*u),Size(3*u,u));drawRect(ink,Offset(8*u,3*u),Size(u,u))}
    }
}

@Composable fun NativePageScroll(modifier:Modifier=Modifier,content:@Composable ColumnScope.()->Unit){
    val shared=LocalNativePageScroll.current
    val scroll=shared?:rememberScrollState()
    Column(modifier.fillMaxSize().verticalScroll(scroll).padding(start=20.dp,end=20.dp,top=18.dp,bottom=36.dp),verticalArrangement=Arrangement.spacedBy(20.dp),content=content)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun FlowRowForActions(content:@Composable FlowRowScope.()->Unit){FlowRow(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),content=content)}
