package com.blockcolc.preview.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
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
    val context=LocalContext.current
    val current=s.projects.find{it.id==s.activeProject}
    val workspace=s.workspace
    val switch=rememberNativeRequest(s)

    // Stable domain document order (NEVER re-sorts active project to index 0, so < and > traverse ALL 3+ projects cleanly!)
    val switchable=remember(s.projects){s.projects.filter{it.status in setOf("active","paused")}}
    val activeChoiceIndex=switchable.indexOfFirst{it.id==current?.id}.coerceAtLeast(0)

    fun switchTo(id:String){
        if(s.busy||switch.busy||s.planId!=null||id==current?.id)return
        view.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
        NativeTactileAudio.tick(context,1160f)
        switch.submit{runtime.dispatch(WorkspaceMutation.SwitchProject(id),it)}
    }
    fun stepProject(delta:Int){
        if(switchable.size<2||s.planId!=null||s.busy||switch.busy)return
        val next=switchable[(activeChoiceIndex+delta+switchable.size)%switchable.size]
        switchTo(next.id)
    }

    NativePageScroll{
        // Monograph Folio Top Eyebrow (Stable counter on left; pure pixel utility icons on right)
        Row(Modifier.fillMaxWidth().heightIn(min=40.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(2.dp)){
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

            // Clean DEMO-style Monograph Folio Title Row: Flush-left editorial serif title (NO caret/directory popup) + right hairline steppers [ < ] [ > ]
            Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(10.dp)){
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment=Alignment.CenterVertically,
                    horizontalArrangement=Arrangement.spacedBy(12.dp),
                ){
                    Text(
                        current.title,
                        modifier=Modifier
                            .weight(1f)
                            .pointerInput(current.id){detectTapGestures(onDoubleTap={onEdit(TitleEditor(projectId=current.id,taskId=null,initial=current.title))})},
                        style=MaterialTheme.typography.headlineLarge,
                        color=colors.onBackground,
                        maxLines=2,
                        overflow=TextOverflow.Ellipsis,
                    )
                    if(switchable.size>1){
                        val canStep=!s.busy&&s.planId==null&&!switch.busy
                        Row(horizontalArrangement=Arrangement.spacedBy(6.dp),verticalAlignment=Alignment.CenterVertically){
                            FolioStepperButton(ui.text("上一个任务"),rotateDeg=90f,enabled=canStep){stepProject(-1)}
                            FolioStepperButton(ui.text("下一个任务"),rotateDeg=-90f,enabled=canStep){stepProject(1)}
                        }
                    }
                }
                // Architectural Hairline Index Segments (tap any segment to jump directly to that project)
                if(switchable.size>1){
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(5.dp)){
                        for(choice in switchable){
                            val active=choice.id==current.id
                            Box(
                                Modifier
                                    .weight(1f)
                                    .height(if(active)2.5.dp else 2.dp)
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

            // Interactive Magnetic Circular Radial Dot-Matrix Sculpture (touch/drag bends dots + tap emits pine ripple wave; NO page-swipe conflict!)
            val progressFraction=if(current.kind=="habit"){
                val target=(details?.habitTarget?:10).coerceAtLeast(1)
                val applied=if(details?.awaitingBuilding==true)target else details?.habitApplied?:0
                (applied.toFloat()/target.toFloat()).coerceIn(0f,1f)
            }else{
                (current.progress/10000f).coerceIn(0f,1f)
            }
            GalleryRadialDotSculpture(
                projectId=current.id,
                fraction=progressFraction,
                onTapRipple={NativeTactileAudio.tick(context,1220f)},
            )

            // Naked Flush-Left Hero Percentage + Architectural Spec Line
            Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(4.dp)){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Bottom){
                    val heroPercent=if(current.kind=="habit"){
                        val target=(details?.habitTarget?:10).coerceAtLeast(1)
                        val applied=if(details?.awaitingBuilding==true)target else details?.habitApplied?:0
                        ((applied*100+target/2)/target).coerceIn(0,100)
                    }else{
                        ((current.progress+50)/100).coerceIn(0,100)
                    }
                    Text("$heroPercent%",style=MaterialTheme.typography.displayMedium,color=colors.onBackground,maxLines=1)
                    Spacer(Modifier.weight(1f))
                    workspace?.let{NativeOccasionEmblems(it.today,1,it.settings.birthday)}
                }
                val blueprintTitle=s.blueprintNames[current.blueprint]?:current.blueprint
                val summaryLine=if(current.kind=="habit"){
                    val target=(details?.habitTarget?:10).coerceAtLeast(1)
                    val applied=if(details?.awaitingBuilding==true)target else details?.habitApplied?:0
                    if(details?.awaitingBuilding==true)ui.text("等待下一座建筑")
                    else ui.text("第 {0} 座建筑",details?.habitCycle?:1)+" · "+blueprintTitle+" · $applied"+ui.text(" / {0} 轮",target)
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
}

@Composable private fun FolioStepperButton(title:String,rotateDeg:Float,enabled:Boolean,onClick:()->Unit){
    val colors=MaterialTheme.colorScheme
    val interaction=remember{MutableInteractionSource()}
    Box(
        Modifier
            .size(34.dp)
            .border(1.dp,if(enabled)colors.outline else colors.outlineVariant)
            .clickable(enabled=enabled,role=Role.Button,interactionSource=interaction,indication=null,onClick=onClick)
            .nativePressMotion(interaction,enabled)
            .semantics{contentDescription=title},
        contentAlignment=Alignment.Center,
    ){
        PixelGlyph("chevron",Modifier.size(14.dp).graphicsLayer{rotationZ=rotateDeg},if(enabled)colors.onBackground else colors.onSurfaceVariant.copy(alpha=0.4f))
    }
}

/** Interactive magnetic 6-ring × 26 circular dot-matrix sculpture (matches the
 * Gallery DEMO's RadialDotSculpture & editorial reference): touching or dragging
 * inside the circular disc bends & expands nearby dots with spring physics, and
 * tapping or switching projects emits a concentric pine-green wave ripple. */
@Composable private fun GalleryRadialDotSculpture(projectId:String,fraction:Float,onTapRipple:()->Unit){
    val ui=LocalNativeUi.current
    val colors=MaterialTheme.colorScheme
    val activePage=LocalNativePageActive.current
    val rings=6
    val perRing=26
    val totalDots=rings*perRing
    val targetFraction by rememberUpdatedState(fraction.coerceIn(0f,1f))

    val ox=remember{FloatArray(totalDots)}
    val oy=remember{FloatArray(totalDots)}
    var displayProgress by remember{mutableFloatStateOf(fraction.coerceIn(0f,1f))}
    var ripple by remember{mutableFloatStateOf(0f)}
    var pointerPos by remember{mutableStateOf<Offset?>(null)}
    var canvasPx by remember{mutableFloatStateOf(0f)}
    var frameTick by remember{mutableLongStateOf(0L)}

    // Emit gentle ripple when switching project or when progress advances!
    LaunchedEffect(projectId,fraction){
        if(!ui.reduceMotion)ripple=1f else displayProgress=fraction.coerceIn(0f,1f)
    }

    // Only animate frames while pointer is active, ripple is running, progress is settling, or dots are springing back!
    LaunchedEffect(activePage,ui.reduceMotion,pointerPos,ripple,fraction){
        if(!activePage||ui.reduceMotion){
            displayProgress=targetFraction
            ripple=0f
            ox.fill(0f);oy.fill(0f)
            return@LaunchedEffect
        }
        var lastNs=withFrameNanos{it}
        while(true){
            val nowNs=withFrameNanos{it}
            val dt=((nowNs-lastNs)/1_000_000_000f).coerceIn(0.001f,0.05f)
            lastNs=nowNs
            displayProgress+=(targetFraction-displayProgress)*minOf(1f,dt*7.5f)
            if(ripple>0f)ripple=(ripple-dt*1.15f).coerceAtLeast(0f)
            val sizePx=canvasPx
            val ptr=pointerPos
            var maxOffset=0f
            if(sizePx>0f){
                val cx=sizePx/2f;val cy=sizePx/2f
                val innerR=sizePx*0.15f;val ringStep=sizePx*0.064f
                val influence=sizePx*0.24f
                val pushMax=sizePx*0.032f
                var idx=0
                for(r in 0 until rings){
                    val rad=innerR+r*ringStep
                    for(i in 0 until perRing){
                        val a=-PI/2.0+2.0*PI*i/perRing
                        val bx=cx+(rad*cos(a)).toFloat()
                        val by=cy+(rad*sin(a)).toFloat()
                        var tx=0f;var ty=0f
                        if(ptr!=null){
                            val dx=bx-ptr.x;val dy=by-ptr.y
                            val dist=hypot(dx,dy)
                            if(dist<influence&&dist>0.5f){
                                val f=1f-dist/influence
                                tx=(dx/dist)*f*pushMax
                                ty=(dy/dist)*f*pushMax
                            }
                        }
                        val nextX=ox[idx]+(tx-ox[idx])*minOf(1f,dt*14f)
                        val nextY=oy[idx]+(ty-oy[idx])*minOf(1f,dt*14f)
                        ox[idx]=nextX;oy[idx]=nextY
                        val mag=abs(nextX)+abs(nextY)
                        if(mag>maxOffset)maxOffset=mag
                        idx++
                    }
                }
            }
            frameTick=nowNs
            val settling=abs(targetFraction-displayProgress)>0.002f
            val needsBreathing=displayProgress>0f&&displayProgress<1f
            if(ptr==null&&ripple<=0f&&!settling&&maxOffset<0.08f&&!needsBreathing)break
        }
    }

    Box(Modifier.fillMaxWidth().padding(vertical=2.dp),contentAlignment=Alignment.Center){
        Canvas(
            Modifier
                .size(214.dp)
                .pointerInput(ui.reduceMotion){
                    awaitEachGesture{
                        val down=awaitFirstDown(requireUnconsumed=false)
                        val center=Offset(size.width/2f,size.height/2f)
                        val maxR=minOf(size.width,size.height)*0.5f
                        if(hypot(down.position.x-center.x,down.position.y-center.y)>maxR)return@awaitEachGesture
                        down.consume()
                        pointerPos=down.position
                        if(!ui.reduceMotion){
                            ripple=1f
                            onTapRipple()
                        }
                        try{
                            while(true){
                                val ev=awaitPointerEvent()
                                val ch=ev.changes.firstOrNull{it.id==down.id}?:break
                                if(!ch.pressed)break
                                ch.consume()
                                pointerPos=ch.position
                            }
                        }finally{
                            pointerPos=null
                        }
                    }
                },
        ){
            // Read frameTick so Canvas invalidates at 60fps during spring / ripple / breathing motion.
            val nowMs=(frameTick/1_000_000L)
            val sPx=minOf(size.width,size.height)
            if(canvasPx!=sPx)canvasPx=sPx
            val cx=size.width/2f;val cy=size.height/2f
            val innerR=sPx*0.15f;val ringStep=sPx*0.064f
            val influence=sPx*0.24f
            val activeCount=(displayProgress*totalDots).roundToInt().coerceIn(0,totalDots)
            val activeRing=if(activeCount>0)(activeCount-1)/perRing else -1
            val waveR=(1f-ripple)*(sPx*0.54f)
            val waveBand=sPx*0.11f
            val ptr=pointerPos
            val baseLit=2.15.dp.toPx()
            val baseDim=1.0.dp.toPx()
            val dark=colors.background.luminance()<0.5f
            val dimAlphaBase=if(dark)0.24f else 0.20f

            var idx=0
            for(r in 0 until rings){
                val rad=innerR+r*ringStep
                for(i in 0 until perRing){
                    val a=-PI/2.0+2.0*PI*i/perRing
                    val bx=cx+(rad*cos(a)).toFloat()
                    val by=cy+(rad*sin(a)).toFloat()
                    val lit=idx<activeCount
                    val lead=idx==activeCount-1&&activeCount>0
                    val hb=if(ptr!=null){
                        val dist=hypot(bx-ptr.x,by-ptr.y)
                        if(dist<influence)1f-dist/influence else 0f
                    }else 0f
                    val pb=if(ripple>0f){
                        (1f-abs(rad-waveR)/waveBand).coerceIn(0f,1f)*ripple
                    }else 0f
                    val breathe=if(lead&&!ui.reduceMotion)(0.5f+0.5f*sin(nowMs*0.005f))*1.15.dp.toPx() else 0f
                    val dotR=(if(lit)baseLit else baseDim)+hb*1.35.dp.toPx()+pb*1.45.dp.toPx()+breathe
                    val usePine=lead||pb>0.32f||(lit&&r==activeRing)
                    val dotColor=if(usePine)colors.primary else colors.onBackground
                    val dotAlpha=if(lit)0.92f else (dimAlphaBase+hb*0.42f+pb*0.46f).coerceIn(0f,1f)
                    drawCircle(
                        color=dotColor.copy(alpha=dotAlpha),
                        radius=dotR,
                        center=Offset(bx+ox[idx],by+oy[idx]),
                    )
                    idx++
                }
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
    Column(modifier.fillMaxSize().verticalScroll(scroll).padding(start=24.dp,end=24.dp,top=18.dp,bottom=40.dp),verticalArrangement=Arrangement.spacedBy(20.dp),content=content)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun FlowRowForActions(content:@Composable FlowRowScope.()->Unit){FlowRow(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),content=content)}
