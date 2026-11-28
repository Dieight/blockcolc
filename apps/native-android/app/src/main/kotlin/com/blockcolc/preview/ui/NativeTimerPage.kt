package com.blockcolc.preview.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sign
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import com.blockcolc.domain.DomainTime
import com.blockcolc.presentation.*
import com.blockcolc.preview.*
import com.blockcolc.preview.world.NativeWorldInteractionState
import com.blockcolc.storage.PlanMode
import kotlinx.coroutines.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.*

private data class TimeQuote(val zh: String, val zhBy: String, val en: String, val enBy: String)

private val TIME_QUOTES = listOf(
    TimeQuote("一寸光阴一寸金", "古谚", "Lost time is never found again.", "Franklin"),
    TimeQuote("逝者如斯夫，不舍昼夜", "论语", "Begin at once to live.", "Seneca"),
    TimeQuote("盛年不重来，一日难再晨", "陶渊明", "Time is the wisest counselor.", "Pericles"),
    TimeQuote("不饱食以终日，不弃功于寸阴", "葛洪", "Time stays long enough for use.", "Da Vinci"),
    TimeQuote("少壮不努力，老大徒伤悲", "长歌行", "Well-arranged time marks the mind.", "Pitman"),
    TimeQuote("明日复明日，明日何其多", "文嘉", "Make use of time; let not advantage slip.", "Shakespeare"),
    TimeQuote("光景不待人，须臾发成丝", "李白", "The key is not spending, but investing time.", "Covey"),
    TimeQuote("寸阴尺璧，当惜分秒", "淮南子", "Focus turns minutes into monuments.", "Blockcolc"),
)

/** Gallery architectural workbench paired with the preserved minimal/immersive
 * focus faces. Horizontal drags stay unclaimed so page swipes never conflict. */
@Composable internal fun NativeTimerPage(
    s:WorkspaceUiState,
    runtime:WorkspaceActions,
    minimal:Boolean,
    immersive:Boolean,
    pool:ReportPool?,
    reportPending:Boolean,
    delivered:Boolean,
    reportError:String?,
    selectedTask:String?,
    onMinimal:(Boolean)->Unit,
    onAdjust:(PlanEditorModel)->Unit,
    onManual:()->Unit,
    onCreate:()->Unit,
    onSubmit:(ReportDraft)->Unit,
    onWorldHeight:(Int)->Unit,
    memory:String?,
    onCloseMemory:()->Unit,
    panelVisibility:State<Float>?=null,
    active:Boolean=true,
    onPanelTop:(Int)->Unit={},
    wide:Boolean=false,
    wideWorld:Dp=0.dp,
    minimalFriends:(@Composable (Boolean)->Unit)?=null,
    clockNow:()->Long=System::currentTimeMillis,
    worldInteraction:NativeWorldInteractionState?=null,
    hasRoom:Boolean=false,
    onSelectTask:(String?)->Unit={},
){
    val ui=LocalNativeUi.current;val timer=s.timer?:return
    val view=LocalView.current
    val context=LocalContext.current
    var now by remember(timer.planId,timer.surface,timer.deadline){mutableLongStateOf(clockNow())}
    val currentClock by rememberUpdatedState(clockNow)
    LaunchedEffect(active,timer.planId,timer.surface,timer.deadline){while(active&&isActive){now=currentClock();delay(250)}}
    val countdown=LocalDateCountdownPreference.current?.value
    val project=s.choices.find{it.id==timer.projectId}?:s.choices.find{it.id==s.activeProject}
    // Stable creation/document order for project switcher (never re-shuffles active item to top)
    val orderedChoices=remember(s.projects,s.choices){
        val byId=s.choices.associateBy{it.id}
        s.projects.mapNotNull{byId[it.id]}.ifEmpty{s.choices}
    }
    val unfinishedTasks=project?.tasks.orEmpty()
    val projectRow=s.projects.find{it.id==project?.id}
    val task=unfinishedTasks.find{it.id==timer.subtaskId}?:unfinishedTasks.find{it.id==selectedTask}?:unfinishedTasks.firstOrNull{it.progress<10000}
    val details=s.workspace?.projects?.find{it.id==project?.id}
    val start=rememberNativeRequest(s)
    val projectSwitch=rememberNativeRequest(s)
    val singleMode=s.preferences.worldDisplayMode=="single"
    val maquetteMode=singleMode&&s.preferences.singleBuildingBackdrop=="maquette"

    // Local direct-gesture draft state for the normal workbench.
    var draftModeName by rememberSaveable(timer.planId,project?.id){
        mutableStateOf(if(timer.mode in setOf(PlanMode.MARATHON,PlanMode.MINIMAL))PlanMode.MARATHON.name else PlanMode.ROUNDS.name)
    }
    var draftRounds by rememberSaveable(timer.planId,project?.id){
        mutableIntStateOf(timer.totalRounds.coerceIn(1,24))
    }
    var draftEndAt by rememberSaveable(timer.planId,project?.id){
        mutableStateOf(if(timer.mode in setOf(PlanMode.MARATHON,PlanMode.MINIMAL))timer.deadline?.let(DomainTime::millis)else null)
    }
    LaunchedEffect(timer.planId,timer.mode,timer.totalRounds,timer.deadline){
        if(timer.planId!=null&&timer.surface==TimerSurface.PREPARED){
            draftModeName=if(timer.mode in setOf(PlanMode.MARATHON,PlanMode.MINIMAL))PlanMode.MARATHON.name else PlanMode.ROUNDS.name
            draftRounds=timer.totalRounds.coerceIn(1,24)
            draftEndAt=if(timer.mode in setOf(PlanMode.MARATHON,PlanMode.MINIMAL))timer.deadline?.let(DomainTime::millis)else null
        }
    }
    val draftMode=if(draftModeName==PlanMode.MARATHON.name)PlanMode.MARATHON else PlanMode.ROUNDS
    val canEditDraft=!s.busy&&!start.busy&&timer.surface in setOf(TimerSurface.IDLE,TimerSurface.PREPARED)

    var projectSheetOpen by rememberSaveable{mutableStateOf(false)}
    var subtaskSheetOpen by rememberSaveable{mutableStateOf(false)}
    val daySeed=remember(now/3_600_000L){((now/3_600_000L)%TIME_QUOTES.size).toInt().coerceIn(0,TIME_QUOTES.lastIndex)}
    var quoteOffset by rememberSaveable{mutableIntStateOf(0)}
    val activeQuote=TIME_QUOTES[(daySeed+quoteOffset)%TIME_QUOTES.size]

    val focusMinutes=if(project?.habit==true&&draftMode==PlanMode.ROUNDS)s.preferences.habitFocusMinutes else s.preferences.focusMinutes
    val roundMs=s.plannedFocusMs?.takeIf{timer.surface !in setOf(TimerSurface.IDLE,TimerSurface.PREPARED)}?:(focusMinutes*60000L)
    val breakMs=s.preferences.breakMinutes*60000L
    // End-Time mode starts at current time (null selection) so sliding up begins
    // smoothly from now with ZERO jump, matching Minimal Mode!
    val selectedEndAt=if(draftMode==PlanMode.MARATHON)draftEndAt?.takeIf{it>now} else null
    var endDetentRound by rememberSaveable(timer.planId,project?.id){mutableStateOf<Int?>(null)}
    LaunchedEffect(selectedEndAt,draftMode){if(draftMode!=PlanMode.MARATHON||selectedEndAt==null)endDetentRound=null}
    val activeEndDetent=if(draftMode==PlanMode.MARATHON&&selectedEndAt!=null){
        endDetentRound?:ClockSelection.matchingDetentRound(selectedEndAt,now,s.preferences.focusMinutes,s.preferences.breakMinutes)
    }else null

    fun begin(){
        val owner=project?:return
        if(s.planId!=null&&timer.surface==TimerSurface.WAITING){
            start.submit{runtime.startPlan(it)}
            return
        }
        val unchangedPrepared=s.planId!=null&&timer.surface==TimerSurface.PREPARED&&
            (draftMode==PlanMode.MARATHON&&timer.mode in setOf(PlanMode.MARATHON,PlanMode.MINIMAL)&&timer.deadline?.let(DomainTime::millis)==selectedEndAt||
                draftMode==PlanMode.ROUNDS&&timer.mode==PlanMode.ROUNDS&&timer.totalRounds==draftRounds&&timer.subtaskId==task?.id)
        if(unchangedPrepared){
            start.submit{runtime.startPlan(it)}
            return
        }
        val replacing=s.planId.takeIf{timer.surface==TimerSurface.PREPARED}
        val draft=if(draftMode==PlanMode.MARATHON){
            val targetEnd=selectedEndAt?:return
            // End-time focus always defers settlement (PlanMode.MINIMAL) so BOTH
            // large projects and habits finish into the unified report rather than
            // auto-advancing the page's active subtask or habit.
            FocusDraft(owner.id,null,PlanMode.MINIMAL,DraftSchedule.EndAt(targetEnd),replacing)
        }else{
            FocusDraft(owner.id,if(owner.habit)null else task?.id,PlanMode.ROUNDS,DraftSchedule.Rounds(draftRounds),replacing)
        }
        start.submit{runtime.beginFocus(draft,it)}
    }
    fun adjust(){onAdjust(PlanEditorModel(projectId=project?.id,taskId=task?.id,mode=timer.mode?:PlanMode.ROUNDS,rounds=timer.totalRounds,endAt=timer.deadline?.let(DomainTime::millis),replacingPlanId=s.planId))}

    val remaining=timer.deadline?.let{(DomainTime.millis(it)-now).coerceAtLeast(0)}?:timer.remainingMs
    val extensionElapsed=timer.extensionStartedAt?.let{(now-DomainTime.millis(it)).coerceAtLeast(0)}
    val runningClock=formalClock(extensionElapsed?:remaining,countUp=extensionElapsed!=null)
    val runningProgress=if(timer.surface==TimerSurface.FOCUS&&extensionElapsed==null&&roundMs>0L){
        (1f-remaining.toFloat()/roundMs.toFloat()).coerceIn(0f,1f)
    }else null

    val todayGoal=s.workspace?.todayGoal
    val remainingGoal=todayGoal?.let{ClockSelection.remainingGoalRounds(it.enabled,it.target,it.completed)}
    val goalReachedByDraft=draftMode==PlanMode.ROUNDS&&remainingGoal!=null&&draftRounds==remainingGoal
    val clockPineHighlight=goalReachedByDraft||activeEndDetent!=null

    val roundsTotalFocusMs=roundMs*draftRounds
    val roundsSpanMs=roundsTotalFocusMs+breakMs*(draftRounds-1)
    val roundsEndLabel=formalEndLabel(now+roundsSpanMs,now)
    val marathonSchedule=selectedEndAt?.let{EndTimeSchedule.forDuration((it-now).coerceAtLeast(1L),s.preferences.focusMinutes,s.preferences.breakMinutes)}
    val endClockFormat=remember{DateTimeFormatter.ofPattern("HH:mm")}
    val zone=remember{ZoneId.systemDefault()}
    val marathonClockText=Instant.ofEpochMilli(selectedEndAt?:now).atZone(zone).format(endClockFormat)
    val workbenchClock=if(draftMode==PlanMode.MARATHON)marathonClockText else formalClock(roundsTotalFocusMs)
    val startLabel=when{
        draftMode==PlanMode.MARATHON&&selectedEndAt==null->ui.text("上下滑动设定结束时间")
        draftMode==PlanMode.MARATHON->ui.text("开始专注至 {0}",marathonClockText)
        draftRounds==1->ui.text("开始 1 轮")
        else->ui.text("开始 {0} 轮",draftRounds)
    }
    val startTag=if(draftMode==PlanMode.MARATHON){
        selectedEndAt?.let{"${((it-now)/60_000L).coerceAtLeast(1L)} MIN"}
    }else{
        "${(roundsSpanMs/60_000L).coerceAtLeast(1L)} MIN"
    }

    var revealed by rememberSaveable(timer.surface,minimal){mutableStateOf(false)}
    val focusExit = if (timer.surface == TimerSurface.FOCUS) {
        key(timer.planId, timer.extensionStartedAt ?: timer.deadline) { rememberFocusExitControls() }
    } else null
    val reveal = if (focusExit != null) {
        Modifier.focusExitGestures(focusExit, !s.busy)
    } else {
        Modifier.pointerInput(timer.surface){detectTapGestures(onDoubleTap={revealed=true})}
            .onFocusChanged{if(it.hasFocus)revealed=true}.semantics{customActions=listOf(CustomAccessibilityAction(ui.text("显示结束操作")){revealed=true;true})}
    }

    // Subtle scale spring when hitting daily-goal detent or full-round detent.
    var sparkSerial by remember{mutableIntStateOf(0)}
    val clockScale=remember{Animatable(1f)}
    LaunchedEffect(sparkSerial,ui.reduceMotion){
        if(sparkSerial>0&&!ui.reduceMotion){
            clockScale.snapTo(1f)
            clockScale.animateTo(1.055f,tween(110,easing=FastOutSlowInEasing))
            clockScale.animateTo(1f,spring(dampingRatio=0.55f,stiffness=520f))
        }
    }

    fun toggleDraftMode(){
        if(!canEditDraft)return
        view.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
        NativeTactileAudio.tick(context,1260f)
        draftModeName=if(draftMode==PlanMode.ROUNDS)PlanMode.MARATHON.name else PlanMode.ROUNDS.name
    }

    BoxWithConstraints(Modifier.fillMaxSize()){
      val reportMax=maxHeight*.76f
      val focusPanelHeight=minimalPanelHeight(maxHeight)
      val memoryHeight=maxHeight
      val panelInsets=WindowInsets.safeDrawing.only(if(wide)WindowInsetsSides.End+WindowInsetsSides.Top else WindowInsetsSides.Horizontal)
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
      val colors=MaterialTheme.colorScheme

      NativeTimerFrame(wide,immersive,panelWidth,onWorldHeight,worldVeil={
          // Seamless atmospheric bottom veil blending the 3D world organically into the Gallery canvas (ZERO hard cut!)
          if(!immersive&&!wide&&!maquetteMode){
              Box(
                  Modifier
                      .fillMaxWidth()
                      .height(84.dp)
                      .align(Alignment.BottomCenter)
                      .background(
                          Brush.verticalGradient(
                              0f to Color.Transparent,
                              0.58f to colors.background.copy(alpha=0.72f),
                              1f to colors.background,
                          ),
                      ),
              )
          }
      }){panel->
        if(!immersive&&memory!=null&&reward==null){NativeBuildingMemory(s,runtime,memory,onCloseMemory,panel.windowInsetsPadding(panelInsets).then(panelMotion));return@NativeTimerFrame}
        if(!immersive){
          BoxWithConstraints(panel.background(colors.background).windowInsetsPadding(panelInsets)
              .testTag("formal-normal-workbench").onGloballyPositioned{onPanelTop(it.positionInRoot().y.roundToInt())}){
            val panelHeight=maxHeight
            if(project==null){
                Column(Modifier.fillMaxWidth().then(panelMotion).verticalScroll(LocalNativePageScroll.current?:rememberScrollState()).heightIn(min=panelHeight).padding(horizontal=24.dp,vertical=16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
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
            val compact=panelHeight<310.dp
            val canStartNow=project.canStart&&!s.busy&&(if(draftMode==PlanMode.MARATHON)selectedEndAt!=null else project.habit||task!=null)

            // Vertical-only clock drag (NEVER claims horizontal gestures -> zero page-swipe conflict!)
            val currentRounds by rememberUpdatedState(draftRounds)
            val currentEnd by rememberUpdatedState(draftEndAt)
            val currentMode by rememberUpdatedState(draftMode)
            val currentGoalRem by rememberUpdatedState(remainingGoal)
            val currentFocusMin by rememberUpdatedState(s.preferences.focusMinutes)
            val currentBreakMin by rememberUpdatedState(s.preferences.breakMinutes)
            val clockGesture=Modifier
                .pointerInput(canEditDraft,project.id){
                    if(!canEditDraft)return@pointerInput
                    val pxPerDp=density
                    awaitEachGesture{
                        val down=awaitFirstDown(requireUnconsumed=false)
                        val startX=down.position.x
                        var anchorY=down.position.y
                        var lastY=anchorY
                        var axis=0 // 1=horizontal (yield to page swipe), 2=vertical time adjust
                        var baseRounds=currentRounds
                        var selectedRounds=currentRounds
                        var baseEnd=currentEnd
                        var selectedEnd=currentEnd
                        var direction=0
                        var dwellUntil=0L
                        val nowAnchor=Math.floorDiv(System.currentTimeMillis(),60000L)*60000L
                        while(true){
                            val change=awaitPointerEvent().changes.find{it.id==down.id}?:break
                            if(!change.pressed)break
                            val dxDp=(change.position.x-startX)/pxPerDp
                            var dyDp=(anchorY-change.position.y)/pxPerDp
                            if(axis==0&&maxOf(abs(dxDp),abs(dyDp))>=12f){
                                axis=if(abs(dxDp)>abs(dyDp)*1.2f)1 else 2
                            }
                            if(axis!=2)continue
                            change.consume()
                            val prevY=lastY
                            val nextDir=sign(prevY-change.position.y).toInt()
                            lastY=change.position.y
                            if(nextDir==0)continue
                            val stamp=android.os.SystemClock.uptimeMillis()
                            if(direction!=0&&nextDir!=direction){
                                dwellUntil=0L
                                baseRounds=selectedRounds
                                baseEnd=selectedEnd
                                anchorY=prevY
                                dyDp=(anchorY-change.position.y)/pxPerDp
                            }
                            direction=nextDir
                            if(stamp<dwellUntil){
                                anchorY=change.position.y
                                baseRounds=selectedRounds
                                baseEnd=selectedEnd
                                continue
                            }
                            if(currentMode==PlanMode.ROUNDS){
                                val candidate=(baseRounds+ClockSelection.roundSteps(dyDp.toDouble())).coerceIn(1,24)
                                if(candidate!=selectedRounds){
                                    val goalRem=currentGoalRem
                                    val next=if(ClockSelection.crossesGoalRound(selectedRounds,candidate,goalRem)&&goalRem!=null){
                                        dwellUntil=stamp+ClockSelection.DWELL_MS
                                        anchorY=change.position.y
                                        baseRounds=goalRem
                                        sparkSerial++
                                        view.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
                                        NativeTactileAudio.tick(context,1380f)
                                        goalRem
                                    }else{
                                        view.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
                                        NativeTactileAudio.tick(context,1060f+candidate*18f)
                                        candidate
                                    }
                                    selectedRounds=next
                                    draftRounds=next
                                }
                            }else{
                                var next=ClockSelection.shift(baseEnd,ClockSelection.steps(dyDp.toDouble()),System.currentTimeMillis())
                                val detent=ClockSelection.detent(selectedEnd?:nowAnchor,next?:nowAnchor,nowAnchor,currentFocusMin,currentBreakMin)
                                if(detent!=null){
                                    next=detent.endMs
                                    dwellUntil=stamp+ClockSelection.DWELL_MS
                                    anchorY=change.position.y
                                    baseEnd=next
                                    endDetentRound=detent.round
                                    sparkSerial++
                                    view.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
                                    NativeTactileAudio.tick(context,1360f)
                                }else if(next!=selectedEnd){
                                    endDetentRound=next?.let{ClockSelection.matchingDetentRound(it,nowAnchor,currentFocusMin,currentBreakMin)}
                                    NativeTactileAudio.tick(context,1040f)
                                }
                                if(next!=selectedEnd){
                                    selectedEnd=next
                                    draftEndAt=next
                                }
                            }
                        }
                    }
                }
                .onKeyEvent{event->
                    if(!canEditDraft||event.type!=KeyEventType.KeyDown)false else when(event.key){
                        Key.DirectionUp->{
                            if(draftMode==PlanMode.ROUNDS)draftRounds=(draftRounds+1).coerceAtMost(24)
                            else draftEndAt=ClockSelection.shift(draftEndAt,1,System.currentTimeMillis())
                            true
                        }
                        Key.DirectionDown->{
                            if(draftMode==PlanMode.ROUNDS)draftRounds=(draftRounds-1).coerceAtLeast(1)
                            else draftEndAt=ClockSelection.shift(draftEndAt,-1,System.currentTimeMillis())
                            true
                        }
                        else->false
                    }
                }
                .semantics{
                    contentDescription=ui.text(if(draftMode==PlanMode.ROUNDS)"固定轮次，上下滑动增减轮次" else "结束时间，上下滑动设定结束时间")
                }

            // DEMO-faithful left-aligned Gallery architectural workbench!
            Column(
                Modifier
                    .fillMaxSize()
                    .then(panelMotion)
                    .padding(start=24.dp,end=24.dp,top=if(compact)4.dp else 8.dp,bottom=14.dp),
                verticalArrangement=Arrangement.SpaceBetween,
            ){
                // 1. Hero Naked Left-Aligned Clock + Wordless Dual Mode Hairline Bars
                Column(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .then(clockGesture),
                    verticalArrangement=Arrangement.Center,
                ){
                    // Pure wordless dual hairline mode bars (tap to toggle Fixed Rounds <-> End-Time)
                    val roundsBarW by animateDpAsState(if(draftMode==PlanMode.ROUNDS)30.dp else 18.dp,tween(if(ui.reduceMotion)0 else 220,easing=FastOutSlowInEasing),label="rounds-bar")
                    val endBarW by animateDpAsState(if(draftMode==PlanMode.MARATHON)30.dp else 18.dp,tween(if(ui.reduceMotion)0 else 220,easing=FastOutSlowInEasing),label="end-bar")
                    Row(
                        Modifier
                            .clickable(enabled=canEditDraft,role=Role.Button,interactionSource=remember{MutableInteractionSource()},indication=null,onClick=::toggleDraftMode)
                            .semantics{contentDescription=ui.text("切换计时模式")}
                            .padding(top=4.dp,bottom=10.dp,end=20.dp),
                        verticalAlignment=Alignment.CenterVertically,
                        horizontalArrangement=Arrangement.spacedBy(6.dp),
                    ){
                        Box(Modifier.size(width=roundsBarW,height=if(draftMode==PlanMode.ROUNDS)2.5.dp else 2.dp).background(if(draftMode==PlanMode.ROUNDS)colors.primary else colors.outlineVariant))
                        Box(Modifier.size(width=endBarW,height=if(draftMode==PlanMode.MARATHON)2.5.dp else 2.dp).background(if(draftMode==PlanMode.MARATHON)colors.primary else colors.outlineVariant))
                    }

                    // Giant flush-left naked numeral + subtle right micro badge
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment=Alignment.Bottom,
                        horizontalArrangement=Arrangement.SpaceBetween,
                    ){
                        val heroStyle=if(compact)MaterialTheme.typography.displaySmall else MaterialTheme.typography.displayMedium
                        Text(
                            workbenchClock,
                            modifier=Modifier.graphicsLayer{
                                transformOrigin=androidx.compose.ui.graphics.TransformOrigin(0f,0.6f)
                                scaleX=clockScale.value
                                scaleY=clockScale.value
                            },
                            style=heroStyle,
                            color=if(clockPineHighlight)colors.primary else colors.onBackground,
                            maxLines=1,
                        )
                        s.workspace?.let{NativeOccasionEmblems(it.today,0,it.settings.birthday)}
                    }

                    Spacer(Modifier.height(if(compact)4.dp else 7.dp))

                    // Single compact editorial caption flush-left underneath clock
                    if(draftMode==PlanMode.ROUNDS){
                        Row(
                            verticalAlignment=Alignment.CenterVertically,
                            horizontalArrangement=Arrangement.spacedBy(6.dp),
                        ){
                            if(goalReachedByDraft){
                                PixelGlyph("target",Modifier.size(14.dp),colors.primary)
                                NativeText(ui.text("达成今日目标")+" · "+roundsEndLabel,NativeTextRole.CAPTION,color=colors.primary,maxLines=1)
                            }else{
                                NativeText(ui.text("{0} · 预计 {1} 结束",ui.rounds(draftRounds),roundsEndLabel),NativeTextRole.CAPTION,color=colors.onSurfaceVariant,maxLines=1)
                            }
                        }
                    }else{
                        val info=if(selectedEndAt!=null&&marathonSchedule!=null){
                            ui.text("共 {0} 轮 · {1}",marathonSchedule.rounds,formatDuration((selectedEndAt-now).coerceAtLeast(60_000L)))
                        }else ui.text("上下滑动设定结束时间")
                        Row(
                            verticalAlignment=Alignment.CenterVertically,
                            horizontalArrangement=Arrangement.spacedBy(6.dp),
                        ){
                            if(activeEndDetent!=null){
                                PixelGlyph("target",Modifier.size(14.dp),colors.primary)
                            }
                            NativeText(info,NativeTextRole.CAPTION,color=if(activeEndDetent!=null)colors.primary else colors.onSurfaceVariant,maxLines=1)
                        }
                    }
                    if(timer.mayCancelUnstarted){
                        FormalTextAction(ui.text("取消本次计划"),"close",{start.submit{runtime.decideFocus(FocusDecision.Cancel(),it)}},Modifier.padding(top=4.dp),!start.busy&&!s.busy)
                    }
                }

                // 2. DEMO-Faithful Cardless 2-Column Hairline Spec Strip (Left: Current Subtask | Right: Date Countdown or Time Quote!)
                val canSwitchSubtask=draftMode==PlanMode.ROUNDS&&!project.habit&&unfinishedTasks.isNotEmpty()&&!s.busy
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(IntrinsicSize.Min)
                        .drawBehind{
                            val stroke=1.dp.toPx()
                            drawLine(colors.outlineVariant,Offset.Zero,Offset(size.width,0f),stroke)
                            drawLine(colors.outlineVariant,Offset(0f,size.height),Offset(size.width,size.height),stroke)
                        }
                        .padding(vertical=if(compact)8.dp else 11.dp),
                    verticalAlignment=Alignment.CenterVertically,
                ){
                    // Left column: Current Subtask (tap to open Subtask Picker Sheet)
                    Column(
                        Modifier
                            .weight(1.08f)
                            .fillMaxHeight()
                            .then(if(canSwitchSubtask)Modifier
                                .clickable(role=Role.Button,interactionSource=remember{MutableInteractionSource()},indication=null){
                                    NativeTactileAudio.tick(context,1160f)
                                    subtaskSheetOpen=true
                                }
                                .semantics{contentDescription=ui.text("切换小任务")}
                            else Modifier),
                        verticalArrangement=Arrangement.SpaceBetween,
                    ){
                        val leftEyebrow=when{
                            draftMode==PlanMode.MARATHON->ui.text("按结束时间")
                            project.habit->ui.text("习惯建筑")
                            else->{
                                val totalSubs=projectRow?.tasks?.size?:unfinishedTasks.size
                                val doneSubs=projectRow?.tasks?.count{it.progress>=10000}?:0
                                val stepIdx=(doneSubs+1).coerceAtMost(totalSubs.coerceAtLeast(1))
                                ui.text("当前推进 · {0}/{1}",stepIdx,totalSubs.coerceAtLeast(1))
                            }
                        }
                        val leftVal=when{
                            draftMode==PlanMode.MARATHON->ui.text("结束后统一分配")
                            project.habit->s.blueprintNames[projectRow?.blueprint]?:project.title
                            else->task?.title?:project.title
                        }
                        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(5.dp)){
                            NativeText(leftEyebrow,NativeTextRole.CAPTION,Modifier.weight(1f,fill=false),color=colors.onSurfaceVariant,maxLines=1)
                            if(canSwitchSubtask&&unfinishedTasks.size>1){
                                PixelGlyph("chevron",Modifier.size(11.dp),colors.onSurfaceVariant)
                            }
                        }
                        Spacer(Modifier.height(3.dp))
                        Text(leftVal,style=MaterialTheme.typography.bodyMedium,color=colors.onBackground,maxLines=1,overflow=TextOverflow.Ellipsis)
                        Spacer(Modifier.height(6.dp))
                        if(draftMode==PlanMode.ROUNDS){
                            if(project.habit){
                                val target=(details?.habitTarget?:10).coerceAtLeast(1)
                                FormalProgress(details?.habitApplied?:0,max=target,segments=target.coerceIn(1,16),height=2.5.dp)
                            }else{
                                FormalProgress(task?.progress?:0,segments=16,height=2.5.dp)
                            }
                        }else{
                            NativeText(ui.text("完成后按轮次分配"),NativeTextRole.CAPTION,color=colors.onSurfaceVariant,maxLines=1)
                        }
                    }

                    // Hairline vertical editorial divider
                    Box(Modifier.padding(horizontal=14.dp,vertical=2.dp).width(1.dp).fillMaxHeight().background(colors.outlineVariant))

                    // Right column: Date Countdown (when enabled) OR concise rotating time-treasuring quote!
                    if(countdown!=null){
                        val today=remember(now/60_000L){Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault()).toLocalDate()}
                        val daysLeft=ChronoUnit.DAYS.between(today,countdown.date)
                        val daysText=when{
                            daysLeft>0->ui.text("还有 {0} 天",daysLeft)
                            daysLeft==0L->ui.text("就是今天")
                            else->ui.text("已过 {0} 天",-daysLeft)
                        }
                        var cdMotion by remember{mutableIntStateOf(0)}
                        Column(
                            Modifier
                                .weight(0.92f)
                                .fillMaxHeight()
                                .clickable(role=Role.Button,interactionSource=remember{MutableInteractionSource()},indication=null){
                                    cdMotion++
                                    NativeTactileAudio.tick(context,1200f)
                                },
                            verticalArrangement=Arrangement.SpaceBetween,
                        ){
                            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(5.dp)){
                                NativeMotionGlyph("countdown",cdMotion,Modifier.size(12.dp),colors.primary)
                                NativeText(ui.text("日期倒计时"),NativeTextRole.CAPTION,color=colors.onSurfaceVariant,maxLines=1)
                            }
                            Spacer(Modifier.height(3.dp))
                            Text(countdown.title.ifBlank{ui.text("目标日期")},style=MaterialTheme.typography.bodyMedium,color=colors.onBackground,maxLines=1,overflow=TextOverflow.Ellipsis)
                            Spacer(Modifier.height(3.dp))
                            NativeText(daysText,NativeTextRole.CAPTION,color=colors.primary,maxLines=1,accent=true)
                        }
                    }else{
                        val quoteText=if(ui.language=="en")activeQuote.en else activeQuote.zh
                        val quoteAuthor=if(ui.language=="en")activeQuote.enBy else activeQuote.zhBy
                        Column(
                            Modifier
                                .weight(0.92f)
                                .fillMaxHeight()
                                .clickable(interactionSource=remember{MutableInteractionSource()},indication=null){
                                    quoteOffset=(quoteOffset+1)%TIME_QUOTES.size
                                    NativeTactileAudio.tick(context,1140f)
                                },
                            verticalArrangement=Arrangement.SpaceBetween,
                        ){
                            Text(
                                quoteText,
                                style=MaterialTheme.typography.bodySmall,
                                color=colors.onBackground.copy(alpha=0.84f),
                                maxLines=2,
                                overflow=TextOverflow.Ellipsis,
                            )
                            Spacer(Modifier.height(4.dp))
                            NativeText("— $quoteAuthor",NativeTextRole.CAPTION,color=colors.onSurfaceVariant,maxLines=1)
                        }
                    }
                }

                Spacer(Modifier.height(if(compact)10.dp else 14.dp))

                // 3. Razor-Sharp Gallery Ink CTA Bar with Black-to-Pine Curtain Sweep Animation!
                Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(6.dp)){
                    NativeRequestError(start)
                    NativeRequestError(projectSwitch)
                    NativeAction(
                        label=startLabel,
                        onClick={
                            NativeTactileAudio.tick(context,1240f)
                            begin()
                        },
                        modifier=Modifier.fillMaxWidth(),
                        pending=start.busy,
                        enabled=canStartNow,
                        icon="play",
                        tag=startTag,
                    )
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
              if(minimal&&timer.surface in setOf(TimerSurface.IDLE,TimerSurface.PREPARED)){
                // Preserved pure immersive idle: ZERO top buttons, ZERO start button, ZERO length bar.
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
                            NativeClockPicker(end,now,s.preferences.focusMinutes,s.preferences.breakMinutes,doubleConfirm=true,enabled=project!=null&&!s.busy,clockStyle=MaterialTheme.typography.displayLarge,onChange={end=it},onConfirm={deadline->
                                project?.let { owner ->
                                    val replacing = timer.planId.takeIf { timer.surface == TimerSurface.PREPARED }
                                    val draft = FocusDraft(owner.id,null,PlanMode.MINIMAL,DraftSchedule.EndAt(deadline),replacing)
                                    start.submit { runtime.beginFocus(draft,it) }
                                }
                            })
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
                // Preserved exact 3-slot running focus layout + subtle 2dp progress bar beneath countdown.
                FormalFocusFace(context={
                    val contextLabel=when(timer.surface){
                        TimerSurface.FOCUS->if(extensionElapsed!=null)ui.text("加时专注")
                        else if(timer.mode in setOf(PlanMode.MINIMAL,PlanMode.MARATHON))ui.text("专注中 第{0}/{1}轮",timer.completedRounds+1,timer.totalRounds)else timer.taskTitle?:task?.title?:project?.title.orEmpty()
                        TimerSurface.REST->ui.text("休息中")
                        TimerSurface.WAITING->ui.text("剩余专注总时间")
                        else->""
                    }
                    Text(contextLabel,style=MaterialTheme.typography.bodyLarge,textAlign=TextAlign.Center,maxLines=2)
                },timer={
                    Column(Modifier.fillMaxWidth(),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)){
                        NativeText(runningClock,NativeTextRole.IMMERSIVE_CLOCK,Modifier.testTag("formal-focus-time").then(if(timer.surface in setOf(TimerSurface.PREPARED,TimerSurface.WAITING))Modifier.pointerInput(timer.planId,s.busy,start.busy){detectTapGestures(onDoubleTap={if(!s.busy&&!start.busy)begin()})}else Modifier),accent=true)
                        if(runningProgress!=null){
                            val barTrack=LocalContentColor.current.copy(alpha=.2f)
                            val barFill=MaterialTheme.colorScheme.primary
                            Canvas(Modifier.fillMaxWidth(.68f).height(2.dp).testTag("focus-progress-bar")){
                                drawRect(barTrack,Offset.Zero,Size(size.width,size.height))
                                drawRect(barFill,Offset.Zero,Size(size.width*runningProgress,size.height))
                            }
                        }
                    }
                },controls={
                    when(timer.surface){
                        TimerSurface.FOCUS->NativeFocusExitControl(checkNotNull(focusExit),!s.busy,onManual)
                        TimerSurface.REST->if(timer.mode==PlanMode.MARATHON&&revealed)FormalTextAction(ui.text("调整计划"),"edit",::adjust,enabled=!s.busy)
                        else->NativeRequestError(start)
                    }
                })
              }
            }
          }
        }
      }

      // Frameless Gallery Editorial Top World HUD (Normal mode only; ZERO top buttons in immersive mode!)
      if(!immersive&&memory==null&&project!=null){
          val overSky=!maquetteMode
          val topInset=WindowInsets.statusBars.asPaddingValues().calculateTopPadding()+8.dp
          val hudWidthMod=if(wide)Modifier.width(wideWorld)else Modifier.fillMaxWidth()
          val sides=WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal)
          val titleInk=if(overSky)Color(0xFFF8F8F5)else colors.onBackground
          val pctInk=if(overSky)Color(0xFF9CF0BE)else colors.primary
          val textShadow=if(overSky)Shadow(Color(0x70000000),Offset(0f,2f),10f)else Shadow.None
          val progressPct=if(project.habit){
              val t=(details?.habitTarget?:10).coerceAtLeast(1)
              val a=if(details?.awaitingBuilding==true)t else details?.habitApplied?:0
              "${(a*100/t).coerceIn(0,100)}%"
          }else "${((projectRow?.progress?:0)+50)/100}%"

          Box(hudWidthMod.align(Alignment.TopStart).then(panelMotion)){
              // Soft top atmospheric scrim when over real sky/settlement (ZERO boxy bar!)
              if(overSky){
                  Box(
                      Modifier
                          .fillMaxWidth()
                          .height(topInset+64.dp)
                          .background(Brush.verticalGradient(0f to Color(0x660A0E0C),0.65f to Color(0x280A0E0C),1f to Color.Transparent)),
                  )
              }
              Row(
                  Modifier
                      .fillMaxWidth()
                      .windowInsetsPadding(sides)
                      .padding(start=22.dp,end=18.dp,top=topInset),
                  verticalAlignment=Alignment.CenterVertically,
                  horizontalArrangement=Arrangement.SpaceBetween,
              ){
                  // Left: Frameless Editorial Serif Project Title (tap opens slim picker; ZERO swipe conflict!)
                  Row(
                      Modifier
                          .weight(1f,fill=false)
                          .padding(end=12.dp)
                          .heightIn(min=40.dp)
                          .clickable(enabled=!s.busy&&s.planId==null&&orderedChoices.isNotEmpty(),role=Role.Button,interactionSource=remember{MutableInteractionSource()},indication=null){
                              NativeTactileAudio.tick(context,1160f)
                              projectSheetOpen=true
                          }
                          .semantics{contentDescription=ui.text("切换任务")}
                          .padding(vertical=4.dp),
                      verticalAlignment=Alignment.CenterVertically,
                      horizontalArrangement=Arrangement.spacedBy(7.dp),
                  ){
                      Text(
                          project.title,
                          modifier=Modifier.weight(1f,fill=false),
                          style=MaterialTheme.typography.titleLarge.copy(shadow=textShadow),
                          color=titleInk,
                          maxLines=1,
                          overflow=TextOverflow.Ellipsis,
                      )
                      Text(
                          progressPct,
                          style=MaterialTheme.typography.labelMedium.copy(shadow=textShadow),
                          color=pctInk,
                          maxLines=1,
                      )
                      if(orderedChoices.size>1&&s.planId==null){
                          PixelGlyph("chevron",Modifier.size(13.dp),titleInk.copy(alpha=0.72f))
                      }
                  }
                  // Right: Pure pixel icon rail (translucent glass over sky, hairline paper over maquette; reset hidden until camera moved)
                  Row(horizontalArrangement=Arrangement.spacedBy(6.dp),verticalAlignment=Alignment.CenterVertically){
                      if(worldInteraction!=null&&worldInteraction.cameraMoved){
                          GalleryWorldIcon(ui.text("重置视角"),"reset",overSky){
                              NativeTactileAudio.tick(context,1080f)
                              worldInteraction.resetView()
                          }
                      }
                      if(worldInteraction!=null&&!singleMode&&!worldInteraction.indoors&&worldInteraction.selected!=null){
                          GalleryWorldIcon(ui.text("重置地图"),"map",overSky){
                              NativeTactileAudio.tick(context,1080f)
                              worldInteraction.resetMap()
                          }
                      }
                      if(worldInteraction!=null&&!singleMode&&hasRoom){
                          GalleryWorldIcon(ui.text(if(worldInteraction.indoors)"返回聚落"else"室内视角"),if(worldInteraction.indoors)"map"else"study",overSky){
                              NativeTactileAudio.tick(context,1120f)
                              worldInteraction.toggleInterior()
                          }
                      }
                      if(s.preferences.minimalMode){
                          GalleryWorldIcon(ui.text("极简"),"expand",overSky){
                              NativeTactileAudio.tick(context,1180f)
                              onMinimal(true)
                          }
                      }
                  }
              }
          }
      }

      if(!immersive&&reward!=null)NativeRewardMemoryPlate(reward,onCloseMemory,if(wide)Modifier.width(wideWorld).align(Alignment.BottomStart).padding(12.dp)else Modifier.align(Alignment.TopCenter).padding(start=12.dp,end=12.dp,top=(memoryHeight*NORMAL_WORLD_FRACTION-76.dp).coerceAtLeast(0.dp)))
    }

    // Slim frameless Project Quick-Switch Sheet (stable project order!)
    NativeSheet(Unit.takeIf{projectSheetOpen&&!immersive&&s.planId==null},{ui.text("切换任务")},{projectSheetOpen=false},contentSpacing=0.dp){
        for((index,choice) in orderedChoices.withIndex()){
            if(index>0)NativeSeparator()
            val selected=choice.id==project?.id
            val info=s.workspace?.projects?.find{it.id==choice.id}
            val detail=when{
                choice.habit&&info?.awaitingBuilding==true->ui.text("等待下一座建筑")
                choice.habit->ui.text("第 {0} 座 · {1} / {2} 轮",info?.habitCycle?:1,info?.habitApplied?:0,info?.habitTarget?:10)
                else->"${((s.projects.find{it.id==choice.id}?.progress?:0)+50)/100}%"
            }
            NativeChoice(choice.title,selected=selected,enabled=!s.busy&&!projectSwitch.busy,icon=if(choice.habit)"repeat"else"cube",description=detail){
                projectSheetOpen=false
                if(!selected){
                    NativeTactileAudio.tick(context,1200f)
                    projectSwitch.submit{runtime.dispatch(WorkspaceMutation.SwitchProject(choice.id),it)}
                }
            }
        }
    }

    // Slim frameless Subtask Picker Sheet (current project unfinished subtasks only)
    NativeSheet(Unit.takeIf{subtaskSheetOpen&&!immersive&&project!=null&&!project.habit},{ui.text("切换小任务")},{subtaskSheetOpen=false},contentSpacing=0.dp){
        for((index,candidate) in unfinishedTasks.withIndex()){
            if(index>0)NativeSeparator()
            val selected=candidate.id==task?.id
            NativeChoice(candidate.title,selected=selected,enabled=!s.busy,icon="flag",description="${(candidate.progress+50)/100}%"){
                subtaskSheetOpen=false
                NativeTactileAudio.tick(context,1180f)
                onSelectTask(candidate.id)
            }
        }
    }
}

@Composable private fun GalleryWorldIcon(title:String,icon:String,overSky:Boolean,onClick:()->Unit){
    var motion by remember{mutableIntStateOf(0)}
    val colors=MaterialTheme.colorScheme
    val interaction=remember{MutableInteractionSource()}
    val bg=if(overSky)Color(0x5A0E1412)else colors.background.copy(alpha=0.82f)
    val border=if(overSky)Color(0x48FFFFFF)else colors.outlineVariant
    val tint=if(overSky)Color(0xFFF8F8F5)else colors.onBackground
    Box(
        Modifier
            .size(36.dp)
            .background(bg)
            .border(1.dp,border)
            .clickable(role=Role.Button,interactionSource=interaction,indication=null){motion++;onClick()}
            .nativePressMotion(interaction)
            .semantics{contentDescription=title},
        contentAlignment=Alignment.Center,
    ){
        NativeMotionGlyph(icon,motion,Modifier.size(17.dp),tint)
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

@Composable private fun NativeTimerFrame(wide:Boolean,immersive:Boolean,panelWidth:Dp,onWorldHeight:(Int)->Unit,worldVeil:@Composable BoxScope.()->Unit={},panel:@Composable (Modifier)->Unit){
    if(wide)Row(Modifier.fillMaxSize()){
        Box(Modifier.weight(1f).fillMaxHeight().onSizeChanged{onWorldHeight(it.height)},content=worldVeil)
        panel(Modifier.width(panelWidth).fillMaxHeight())
    }else Column(Modifier.fillMaxSize()){
        Box(Modifier.fillMaxWidth().weight(if(immersive)1f else NORMAL_WORLD_FRACTION).onSizeChanged{onWorldHeight(it.height)},content=worldVeil)
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
