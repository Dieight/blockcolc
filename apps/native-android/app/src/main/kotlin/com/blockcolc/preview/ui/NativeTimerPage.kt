package com.blockcolc.preview.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import kotlin.math.roundToInt
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.*
import com.blockcolc.domain.DomainTime
import com.blockcolc.presentation.*
import com.blockcolc.preview.*
import com.blockcolc.storage.PlanMode
import kotlinx.coroutines.*
import java.text.SimpleDateFormat
import java.util.*

/** Same workbench and symmetric FocusFace slots as the formal WorldScreenV7.
 * The application owns planning and recovery; this page only presents them. */
@Composable internal fun NativeTimerPage(s:WorkspaceUiState,runtime:WorkspaceActions,minimal:Boolean,immersive:Boolean,pool:ReportPool?,reportPending:Boolean,delivered:Boolean,reportError:String?,selectedTask:String?,onMinimal:(Boolean)->Unit,onAdjust:(PlanEditorModel)->Unit,onManual:()->Unit,onCreate:()->Unit,onSubmit:(ReportDraft)->Unit,onWorldHeight:(Int)->Unit,memory:String?,onCloseMemory:()->Unit,panelVisibility:State<Float>?=null,active:Boolean=true,onPanelTop:(Int)->Unit={},wide:Boolean=false,wideWorld:Dp=0.dp,minimalFriends:(@Composable (Boolean)->Unit)?=null){
    val ui=LocalNativeUi.current;val timer=s.timer?:return
    var now by remember(timer.planId,timer.surface,timer.deadline){mutableLongStateOf(System.currentTimeMillis())}
    LaunchedEffect(active,timer.planId,timer.surface,timer.deadline){while(active&&isActive){now=System.currentTimeMillis();delay(250)}}
    val countdown=LocalDateCountdownPreference.current?.value
    val project=s.choices.find{it.id==timer.projectId}?:s.choices.find{it.id==s.activeProject}
    val task=project?.tasks?.find{it.id==timer.subtaskId}?:project?.tasks?.find{it.id==selectedTask}?:project?.tasks?.firstOrNull{it.progress<10000}
    val details=s.workspace?.projects?.find{it.id==project?.id}
    val start=rememberNativeRequest(s)
    fun begin(){if(s.planId!=null)start.submit{runtime.startPlan(it)}else if(project!=null)start.submit{runtime.beginFocus(FocusDraft(project.id,task?.id,PlanMode.ROUNDS,DraftSchedule.Rounds(1)),it)}}
    fun adjust(){onAdjust(PlanEditorModel(projectId=project?.id,taskId=task?.id,mode=timer.mode?:PlanMode.ROUNDS,rounds=timer.totalRounds,endAt=timer.deadline?.let(DomainTime::millis),replacingPlanId=s.planId))}
    val remaining=timer.deadline?.let{(DomainTime.millis(it)-now).coerceAtLeast(0)}?:timer.remainingMs
    // A mode animation may still be showing the ordinary layout when an
    // already committed round/rest has resumed. Both faces share its clock.
    val workbenchDuration=!immersive&&timer.mode!=PlanMode.MARATHON&&timer.surface in setOf(TimerSurface.IDLE,TimerSurface.PREPARED)
    val extensionElapsed=timer.extensionStartedAt?.let{(now-DomainTime.millis(it)).coerceAtLeast(0)}
    val roundMs=s.plannedFocusMs?:(if(project?.habit==true)s.preferences.habitFocusMinutes else s.preferences.focusMinutes)*60000L
    val clock=formalClock(extensionElapsed?:if(workbenchDuration)roundMs else remaining,
        countUp=extensionElapsed!=null)
    // Plans show when they end, not only how long they take.
    val roundCount=timer.totalRounds.coerceAtLeast(1)
    val plannedMs=if(timer.surface==TimerSurface.PREPARED)timer.remainingMs else roundMs*roundCount+s.preferences.breakMinutes*60000L*(roundCount-1)
    val planEnds=formalEndLabel(timer.deadline?.let(DomainTime::millis)?:now+plannedMs,now)
    val planSummary=ui.text("{0} · 预计 {1} 结束",ui.rounds(roundCount),planEnds)
    val startLabel=if(timer.mode==PlanMode.MARATHON)ui.text("开始专注")else if(roundCount==1)ui.text("开始 1 轮")else ui.text("开始 {0} 轮",roundCount)
    var revealed by rememberSaveable(timer.surface,minimal){mutableStateOf(false)}
    // A single tap on the focus panel repeats the end-control hint; the
    // double-tap itself is unchanged.
    var hintRequest by remember(timer.planId){mutableIntStateOf(0)}
    val reveal=Modifier.pointerInput(timer.surface){detectTapGestures(onDoubleTap={revealed=true},onTap={hintRequest++})}
        .onFocusChanged{if(it.hasFocus)revealed=true}.semantics{customActions=listOf(CustomAccessibilityAction(ui.text("显示结束操作")){revealed=true;true})}
    BoxWithConstraints(Modifier.fillMaxSize()){
      val reportMax=maxHeight*.76f
      val focusPanelHeight=minimalPanelHeight(maxHeight)
      val memoryHeight=maxHeight
      val panelInsets=WindowInsets.safeDrawing.only(if(wide)WindowInsetsSides.End+WindowInsetsSides.Top else WindowInsetsSides.Horizontal)
      // System bars may still be retreating when the first immersive clock
      // is drawn. Only permanent cutouts can move its content.
      val immersiveInsets=WindowInsets.displayCutout.union(WindowInsets.waterfall)
      val focusInsets=immersiveInsets.only(if(wide)WindowInsetsSides.End+WindowInsetsSides.Vertical else WindowInsetsSides.Horizontal+WindowInsetsSides.Bottom)
      val panelMotion=Modifier.graphicsLayer{
          val progress=panelVisibility?.value?:1f
          alpha=progress
          if(wide)translationX=(1f-progress)*24.dp.toPx()
          else translationY=(1f-progress)*20.dp.toPx()
      }
      val reward=s.workspace?.memories?.rewards?.find{it.id==memory}
      val insets=(if(immersive)immersiveInsets else WindowInsets.safeDrawing).asPaddingValues()
      val direction=LocalLayoutDirection.current
      val leftInset=insets.calculateLeftPadding(direction)
      val rightInset=insets.calculateRightPadding(direction)
      val safeWidth=(maxWidth-leftInset-rightInset).coerceAtLeast(0.dp)
      val panelWidth=if(immersive)minimalPanelWidth(safeWidth)+rightInset else maxWidth-wideWorld
      NativeTimerFrame(wide,immersive,panelWidth,onWorldHeight){panel->
        if(!immersive&&memory!=null&&reward==null){NativeBuildingMemory(s,runtime,memory,onCloseMemory,panel.windowInsetsPadding(panelInsets).then(panelMotion));return@NativeTimerFrame}
        if(!immersive){
          BoxWithConstraints(panel.background(MaterialTheme.colorScheme.background).windowInsetsPadding(panelInsets)
              .testTag("formal-normal-workbench").onGloballyPositioned{onPanelTop(it.positionInRoot().y.roundToInt())}){
            val panelHeight=maxHeight
            if(wide&&project!=null){
                Column(Modifier.fillMaxSize().then(panelMotion).padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                        NativeText(if(timer.mode==PlanMode.MARATHON)ui.text("本场安排")else project.title,NativeTextRole.CAPTION,Modifier.weight(1f),maxLines=2)
                        if(s.preferences.minimalMode)FormalTextAction(ui.text("极简"),"expand",{onMinimal(true)})
                    }
                    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(LocalNativePageScroll.current?:rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp),horizontalAlignment=Alignment.CenterHorizontally){
                        NativeText(if(timer.mode==PlanMode.MARATHON)ui.text("按结束时间排程")else if(project.habit)s.blueprintNames[s.projects.find{it.id==project.id}?.blueprint]?:project.title else task?.title?:project.title,NativeTextRole.SECTION,Modifier.fillMaxWidth())
                        if(project.habit)NativeText(ui.text("{0} / {1} 轮",details?.habitApplied?:0,details?.habitTarget?:0),NativeTextRole.CAPTION,Modifier.fillMaxWidth())
                        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                            NativeText(planSummary,NativeTextRole.CAPTION,Modifier.weight(1f))
                            FormalTextAction(ui.text("调整"),"edit",::adjust,enabled=!s.busy)
                        }
                        NativeText(clock,NativeTextRole.CLOCK,Modifier.padding(vertical=4.dp),accent=true)
                        NativeDateCountdown(countdown,now)
                    }
                    NativeRequestError(start)
                    NativeAction(startLabel,::begin,Modifier.fillMaxWidth().heightIn(min=52.dp),pending=start.busy,enabled=project.canStart&&!s.busy,icon="play")
                    if(timer.mayCancelUnstarted)FormalTextAction(ui.text("取消本次计划"),"close",{start.submit{runtime.decideFocus(FocusDecision.Cancel(),it)}},Modifier.align(Alignment.CenterHorizontally),!start.busy&&!s.busy)
                }
                return@BoxWithConstraints
            }
            if(project==null){
                Column(Modifier.fillMaxWidth().then(panelMotion).verticalScroll(LocalNativePageScroll.current?:rememberScrollState()).heightIn(min=panelHeight).padding(start=20.dp,end=20.dp,top=16.dp,bottom=16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
                    NativeText(ui.text("其他任务"),NativeTextRole.SECTION)
                    if(s.choices.isEmpty())NativeText(ui.text("暂无其他任务"),NativeTextRole.BODY)
                    for(choice in s.choices){NativeText(choice.title,NativeTextRole.BODY)
                        if(choice.habit)FormalTextAction(choice.title,"play",{start.submit{runtime.beginFocus(FocusDraft(choice.id,null,PlanMode.ROUNDS,DraftSchedule.Rounds(1)),it)}},enabled=choice.canStart&&!s.busy)
                        else for(candidate in choice.tasks)FormalTextAction(candidate.title,"play",{start.submit{runtime.beginFocus(FocusDraft(choice.id,candidate.id,PlanMode.ROUNDS,DraftSchedule.Rounds(1)),it)}},enabled=!s.busy)
                    }
                    NativeAction(ui.text("新增任务"),onCreate,Modifier.fillMaxWidth(),icon="plus",enabled=!s.busy)
                    NativeRequestError(start)
                }
                return@BoxWithConstraints
            }
            // The start action stays below the scrolling details, as in the
            // landscape workbench: a short panel scrolls information, never
            // the primary action. Very short panels fold the round length
            // into the plan line instead of clipping the clock.
            val compact=panelHeight<340.dp
            val marathon=timer.mode==PlanMode.MARATHON
            val construction=s.projects.find{it.id==project.id}?.tasks.orEmpty()
            val step=construction.indexOfFirst{it.id==task?.id}
            Column(Modifier.fillMaxSize().then(panelMotion)){
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()){
                    val viewport=maxHeight
                    Column(Modifier.fillMaxWidth().verticalScroll(LocalNativePageScroll.current?:rememberScrollState()).heightIn(min=viewport).padding(start=20.dp,end=20.dp,top=8.dp,bottom=4.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                        Row(Modifier.fillMaxWidth().heightIn(min=44.dp),verticalAlignment=Alignment.CenterVertically){
                            if(marathon)NativeText(ui.text("本场安排"),NativeTextRole.CAPTION,Modifier.weight(1f),MaterialTheme.colorScheme.onSurfaceVariant)
                            else{
                                NativeText(project.title,NativeTextRole.CAPTION,Modifier.weight(1f,fill=false),MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1)
                                val context=if(project.habit)ui.text("第 {0} 座建筑",details?.habitCycle?:1)else if(step>=0)ui.text("第 {0} / {1} 项",step+1,construction.size)else null
                                if(context!=null)NativeText(" · $context",NativeTextRole.CAPTION,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1)
                                Spacer(Modifier.weight(1f))
                            }
                            if(s.preferences.minimalMode)FormalTextAction(ui.text("极简"),"expand",{onMinimal(true)},Modifier.widthIn(min=80.dp))
                        }
                        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                            NativeText(if(marathon)ui.text("按结束时间排程")else if(project.habit)s.blueprintNames[s.projects.find{it.id==project.id}?.blueprint]?:project.title else task?.title?:project.title,NativeTextRole.TITLE,Modifier.weight(1f))
                            s.workspace?.let{NativeOccasionEmblems(it.today,0,it.settings.birthday)}
                        }
                        when{
                            marathon->NativeText(ui.text("本场不指定小任务，结束后统一汇报"),NativeTextRole.CAPTION,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            project.habit->Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){
                                val target=(details?.habitTarget?:10).coerceAtLeast(1)
                                FormalProgress(details?.habitApplied?:0,max=target,segments=target.coerceIn(1,24),modifier=Modifier.weight(1f))
                                NativeText(ui.text("{0} / {1} 轮",details?.habitApplied?:0,target),NativeTextRole.CAPTION)
                            }
                            else->Row(Modifier.fillMaxWidth().semantics(mergeDescendants=true){},verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){
                                FormalProgress(task?.progress?:0,modifier=Modifier.weight(1f))
                                NativeText("${(task?.progress?:0)/100}%",NativeTextRole.CAPTION)
                            }
                        }
                        val plan=if(compact&&!marathon)ui.text("{0} × {1} · 预计 {2} 结束",ui.rounds(roundCount),formatDuration(roundMs),planEnds)else planSummary
                        val adjustInteraction=remember{MutableInteractionSource()}
                        Row(Modifier.fillMaxWidth().heightIn(min=44.dp).clickable(enabled=!s.busy,interactionSource=adjustInteraction,indication=null,onClick=::adjust)
                            .nativePressMotion(adjustInteraction,!s.busy),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                            if(!marathon)FormalRoundPips(roundCount,0)
                            NativeText(plan,NativeTextRole.CAPTION,Modifier.weight(1f))
                            FormalTextAction(ui.text("调整"),"edit",::adjust,Modifier.widthIn(min=80.dp),!s.busy)
                        }
                        if(!compact||marathon)Column(Modifier.fillMaxWidth().weight(1f).heightIn(min=76.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.Center){
                            NativeText(ui.text(if(marathon)"剩余总时长"else"每轮时长"),NativeTextRole.CAPTION)
                            Spacer(Modifier.height(4.dp));NativeText(clock,NativeTextRole.CLOCK,accent=true)
                            NativeDateCountdown(countdown,now,Modifier.padding(top=4.dp))
                        }else NativeDateCountdown(countdown,now)
                        if(timer.mayCancelUnstarted)FormalTextAction(ui.text("取消本次计划"),"close",{start.submit{runtime.decideFocus(FocusDecision.Cancel(),it)}},Modifier.align(Alignment.CenterHorizontally),!start.busy&&!s.busy)
                    }
                }
                Column(Modifier.fillMaxWidth().padding(start=20.dp,end=20.dp,top=8.dp,bottom=16.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                    NativeRequestError(start)
                    NativeAction(startLabel,::begin,Modifier.fillMaxWidth().heightIn(min=52.dp),pending=start.busy,enabled=project.canStart&&!s.busy,icon="play")
                }
            }
          }
        }else if(pool!=null){
            NativeGlass(s.preferences.focusGlassTransparency,panel.then(if(wide)Modifier else Modifier.heightIn(max=reportMax)).onGloballyPositioned{onPanelTop(it.positionInRoot().y.roundToInt())}){
                Column(Modifier.fillMaxWidth().windowInsetsPadding(focusInsets).then(panelMotion).verticalScroll(rememberScrollState()).padding(start=20.dp,end=20.dp,top=24.dp,bottom=16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                    NativeReportPanel(pool,reportPending,delivered,onSubmit)
                    if(reportError!=null)Text(ui.text("保存失败，请重试。"),color=MaterialTheme.colorScheme.error)
                }
            }
        }else{
          NativeGlass(s.preferences.focusGlassTransparency,panel.then(if(wide)Modifier else Modifier.height(focusPanelHeight)).testTag("formal-minimal-panel").onGloballyPositioned{onPanelTop(it.positionInRoot().y.roundToInt())}.then(reveal)){
            Box(Modifier.fillMaxSize().windowInsetsPadding(focusInsets).then(panelMotion).padding(horizontal=20.dp,vertical=16.dp)){
              if(minimal&&timer.surface==TimerSurface.IDLE){
                val pages=remember(s.preferences.quickNotesEnabled,minimalFriends!=null){
                    buildList{
                        if(s.preferences.quickNotesEnabled)add("notes")
                        add("clock")
                        add("statistics")
                        if(minimalFriends!=null)add("friends")
                    }
                }
                val pager=rememberPagerState(initialPage=pages.indexOf("clock"),pageCount={pages.size})
                val pagerScope=rememberCoroutineScope()
                Column(Modifier.fillMaxSize()){
                HorizontalPager(pager,Modifier.weight(1f).fillMaxWidth().testTag("minimal-info-pager").onKeyEvent{event->if(event.type==KeyEventType.KeyDown&&event.key in listOf(Key.DirectionLeft,Key.DirectionRight)){val direction=if(event.key==Key.DirectionLeft)-1 else 1;pagerScope.launch{pager.animateScrollToPage((pager.currentPage+direction).coerceIn(0,pager.pageCount-1))};true}else false},key={pages[it]}){index->
                    val key=pages[index]
                    when(key){
                        "notes"->NativeQuickNotes(s,runtime,compact=true)
                        "statistics"->Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())){
                            val timeline=s.workspace?.todayTimeline
                            if(timeline!=null)NativeTodayFocusPanel(timeline)else NativeHistoryDetailsStatus(s,runtime)
                        }
                        "friends"->minimalFriends?.invoke(active&&pager.settledPage==index)
                        else->FormalFocusFace(stretch=true,context={
                            Column(horizontalAlignment=Alignment.CenterHorizontally){
                                NativeDateCountdown(countdown,now)
                                NativeRequestError(start)
                            }
                        },timer={
                            var end by rememberSaveable{mutableStateOf<Long?>(null)}
                            NativeClockPicker(end,now,s.preferences.focusMinutes,s.preferences.breakMinutes,doubleConfirm=true,enabled=project!=null&&!s.busy,clockStyle=MaterialTheme.typography.displayLarge,onChange={end=it},onConfirm={deadline->project?.let{p->start.submit{runtime.beginFocus(FocusDraft(p.id,null,PlanMode.MINIMAL,DraftSchedule.EndAt(deadline)),it)}}})
                        },controls={
                            Box(Modifier.fillMaxWidth().height(48.dp),contentAlignment=Alignment.Center){
                                if(revealed)FormalTextAction(ui.text("返回普通模式"),"",{onMinimal(false)},Modifier.offset(y=(-8).dp))
                            }
                        })
                    }
                }
                NativePagerDots(pages.size,pager.currentPage)
                }
                s.workspace?.let{Box(Modifier.align(Alignment.TopEnd)){NativeOccasionEmblems(it.today,0,it.settings.birthday)}}
              }else{
                FormalFocusFace(context={
                    val context=when(timer.surface){
                        TimerSurface.FOCUS->if(extensionElapsed!=null)ui.text("加时专注")
                        else if(timer.mode in setOf(PlanMode.MINIMAL,PlanMode.MARATHON))ui.text("专注中 第{0}/{1}轮",timer.completedRounds+1,timer.totalRounds)else timer.taskTitle?:task?.title?:project?.title.orEmpty()
                        TimerSurface.REST->ui.text("休息中")
                        TimerSurface.WAITING->ui.text("剩余专注总时间")
                        else->""
                    }
                    Text(context,style=MaterialTheme.typography.bodyLarge,textAlign=TextAlign.Center,maxLines=2)
                },timer={
                    NativeText(clock,NativeTextRole.IMMERSIVE_CLOCK,Modifier.testTag("formal-focus-time").then(if(timer.surface in setOf(TimerSurface.PREPARED,TimerSurface.WAITING))Modifier.pointerInput(timer.planId,s.busy,start.busy){detectTapGestures(onDoubleTap={if(!s.busy&&!start.busy)begin()})}else Modifier),accent=true)
                },controls={
                    when(timer.surface){
                        TimerSurface.FOCUS->key(timer.planId,if(extensionElapsed==null)timer.deadline else timer.extensionStartedAt){NativeFocusExitControl(!s.busy,onManual,hintRequest=hintRequest)}
                        TimerSurface.REST->if(timer.mode==PlanMode.MARATHON&&revealed)FormalTextAction(ui.text("调整计划"),"edit",::adjust,enabled=!s.busy)
                        else->NativeRequestError(start)
                    }
                })
              }
            }
          }
        }
      }
      if(!immersive&&reward!=null)NativeRewardMemoryPlate(reward,onCloseMemory,if(wide)Modifier.width(wideWorld).align(Alignment.BottomStart).padding(12.dp)else Modifier.align(Alignment.TopCenter).padding(start=12.dp,end=12.dp,top=(memoryHeight*NORMAL_WORLD_FRACTION-76.dp).coerceAtLeast(0.dp)))
    }
}

/** Minimal pages are otherwise found only by swiping. The marks only show
 * position: taps here stay with the panel's double-tap reveal. */
@Composable private fun NativePagerDots(count:Int,current:Int){
    if(count<2)return
    val ui=LocalNativeUi.current;val ink=LocalContentColor.current
    Row(Modifier.fillMaxWidth().height(16.dp).clearAndSetSemantics{stateDescription=ui.text("第 {0} 页，共 {1} 页",current+1,count)},
        horizontalArrangement=Arrangement.spacedBy(8.dp,Alignment.CenterHorizontally),verticalAlignment=Alignment.CenterVertically){
        for(page in 0 until count)Canvas(Modifier.size(6.dp)){drawRect(if(page==current)ink else ink.copy(alpha=.35f))}
    }
}

@Composable private fun NativeTimerFrame(wide:Boolean,immersive:Boolean,panelWidth:Dp,onWorldHeight:(Int)->Unit,panel:@Composable (Modifier)->Unit){
    if(wide)Row(Modifier.fillMaxSize()){
        Spacer(Modifier.weight(1f).fillMaxHeight().onSizeChanged{onWorldHeight(it.height)})
        panel(Modifier.width(panelWidth).fillMaxHeight())
    }else Column(Modifier.fillMaxSize()){
        Spacer(Modifier.fillMaxWidth().weight(if(immersive)1f else NORMAL_WORLD_FRACTION).onSizeChanged{onWorldHeight(it.height)})
        panel(if(immersive)Modifier.fillMaxWidth()else Modifier.fillMaxWidth().weight(1f-NORMAL_WORLD_FRACTION))
    }
}

@Composable private fun FormalFocusFace(stretch:Boolean=false,context:@Composable ()->Unit,timer:@Composable ()->Unit,controls:@Composable ()->Unit){
    BoxWithConstraints(Modifier.fillMaxSize()){
      val available=maxHeight
      Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min=available),verticalArrangement=Arrangement.Center,horizontalAlignment=Alignment.CenterHorizontally){
        Box(Modifier.fillMaxWidth().heightIn(min=48.dp),contentAlignment=Alignment.Center){context()}
        Spacer(Modifier.height(10.dp));Box(Modifier.fillMaxWidth().then(if(stretch)Modifier.weight(1f)else Modifier),contentAlignment=Alignment.Center){timer()}
        Spacer(Modifier.height(10.dp));Box(Modifier.fillMaxWidth().heightIn(min=48.dp),contentAlignment=Alignment.Center){controls()}
      }
    }
}

@Composable internal fun NativeFocusIntegrityBanner(notice: FocusIntegrityNotice?, visible: Boolean, modifier: Modifier = Modifier) {
    val ui = LocalNativeUi.current
    val key = notice?.let { "${it.sessionId}:${it.count}:${it.limit}:${it.stopped}" }
    var announced by rememberSaveable { mutableStateOf<String?>(null) }
    var showing by remember { mutableStateOf(false) }
    LaunchedEffect(key, visible) {
        showing = false
        if (visible && key != null && key != announced) {
            announced = key
            showing = true
            delay(4200)
            showing = false
        }
    }
    AnimatedVisibility(showing && notice != null, modifier,
        enter = if (ui.reduceMotion) EnterTransition.None else fadeIn(tween(160)),
        exit = if (ui.reduceMotion) ExitTransition.None else fadeOut(tween(180))) {
        if (notice != null) {
            val colors = MaterialTheme.colorScheme
            Surface(color = when {
                notice.stopped -> colors.errorContainer
                notice.count > 0 -> colors.tertiaryContainer
                else -> colors.surface
            }, contentColor = when {
                notice.stopped -> colors.onErrorContainer
                notice.count > 0 -> colors.onTertiaryContainer
                else -> colors.onSurface
            }, modifier = Modifier.testTag("focus-integrity-notice").semantics { liveRegion = LiveRegionMode.Polite }) {
                Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(ui.text("有效离开 {0}/{1} 次", notice.count, notice.limit), style = MaterialTheme.typography.bodyMedium)
                    if (notice.stopped) Text(ui.text("已达离开次数上限，计划结束"),
                        style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
                }
            }
        }
    }
}

/** Clock time a plan ends; a later day is named rather than implied. */
@Composable internal fun formalEndLabel(endsAt:Long,now:Long):String{
    val ui=LocalNativeUi.current;val zone=java.time.ZoneId.systemDefault()
    return remember(endsAt/60_000,now/60_000,ui,zone){
        val end=java.time.Instant.ofEpochMilli(endsAt).atZone(zone)
        val days=java.time.temporal.ChronoUnit.DAYS.between(java.time.Instant.ofEpochMilli(now).atZone(zone).toLocalDate(),end.toLocalDate())
        val time=String.format(Locale.ROOT,"%02d:%02d",end.hour,end.minute)
        when{days<=0L->time;days==1L->ui.text("明天")+" "+time;else->"${end.monthValue}/${end.dayOfMonth} $time"}
    }
}

internal fun formalClock(ms:Long,countUp:Boolean=false):String{
    val seconds=(ms.coerceAtLeast(0)+if(countUp)0 else 999)/1000
    return if(seconds>=3600)String.format(Locale.ROOT,"%d:%02d:%02d",seconds/3600,seconds/60%60,seconds%60)else String.format(Locale.ROOT,"%02d:%02d",seconds/60,seconds%60)
}
