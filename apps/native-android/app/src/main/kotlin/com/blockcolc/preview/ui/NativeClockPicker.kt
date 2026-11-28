package com.blockcolc.preview.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.blockcolc.presentation.ClockSelection
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.sign

/** Shared five-minute clock gesture, not another ticking plan or native picker.
 * Horizontal motion is left unconsumed for the surrounding minimal pager. */
@Composable fun NativeClockPicker(value:Long?,now:Long,focusMinutes:Int,breakMinutes:Int,enabled:Boolean=true,doubleConfirm:Boolean=false,timeOfDay:Boolean=false,clockStyle:androidx.compose.ui.text.TextStyle=MaterialTheme.typography.displayMedium,onChange:(Long?)->Unit,onConfirm:(Long)->Unit={}){
    val ui=LocalNativeUi.current;val view=LocalView.current;val context=LocalContext.current
    val colors=MaterialTheme.colorScheme
    val current by rememberUpdatedState(value);val change by rememberUpdatedState(onChange);val confirm by rememberUpdatedState(onConfirm)
    val zone=remember{ZoneId.systemDefault()};val format=remember{DateTimeFormatter.ofPattern("HH:mm")}
    val clock=Instant.ofEpochMilli(value?:now).atZone(zone).format(format)
    val day=ui.text(if(Instant.ofEpochMilli(value?:now).atZone(zone).toLocalDate()==Instant.ofEpochMilli(now).atZone(zone).toLocalDate())"今天" else "明天")
    val label=ui.text(if(timeOfDay)"世界调试时间"else"结束时间，上下滑动或按方向键调整")
    val reference by rememberUpdatedState(now)
    fun shifted(base:Long?,steps:Int)=if(timeOfDay)ClockSelection.shiftTimeOfDay(base,steps,reference,zone.id)else ClockSelection.shift(base,steps,System.currentTimeMillis())
    val local=Instant.ofEpochMilli(value?:now).atZone(zone)
    var held by remember{mutableStateOf<Int?>(null)}
    var snappedRound by remember{mutableStateOf<Int?>(null)}
    var sparkSerial by remember{mutableIntStateOf(0)}
    val clockScale=remember{Animatable(1f)}
    LaunchedEffect(held){if(held!=null){delay(ClockSelection.DWELL_MS);held=null}}
    LaunchedEffect(sparkSerial,ui.reduceMotion){
        if(sparkSerial>0&&!ui.reduceMotion){
            clockScale.snapTo(1f)
            clockScale.animateTo(1.06f,tween(110,easing=FastOutSlowInEasing))
            clockScale.animateTo(1f,spring(dampingRatio=0.55f,stiffness=520f))
        }
    }
    LaunchedEffect(value){if(value==null)snappedRound=null}
    val matchedDetent=if(timeOfDay||value==null)null else held?:snappedRound?:ClockSelection.matchingDetentRound(value,now,focusMinutes,breakMinutes)
    val detentActive=matchedDetent!=null
    Column(Modifier.fillMaxWidth().heightIn(min=112.dp).semantics{
        contentDescription=label;if(doubleConfirm)role=Role.Button
        progressBarRangeInfo=if(timeOfDay)ProgressBarRangeInfo((local.hour*60+local.minute)/5f,0f..287f,286)
            else ProgressBarRangeInfo(((value?:now)-now).coerceAtLeast(0)/300000f,0f..288f,287)
        setProgress{next->if(!enabled||!next.isFinite())false else{snappedRound=null;change(if(timeOfDay)ClockSelection.timeOfDay(next.toInt().coerceIn(0,287)*5,reference,zone.id)
            else ClockSelection.shift(null,next.toInt(),System.currentTimeMillis()));true}}
    }.onKeyEvent{event->if(!enabled||event.type!=KeyEventType.KeyDown)false else when(event.key){
        Key.DirectionUp->{snappedRound=null;change(shifted(current,1));true}
        Key.DirectionDown->{snappedRound=null;change(shifted(current,-1));true}
        Key.Escape->{held=null;snappedRound=null;change(null);true}
        Key.Enter,Key.Spacebar->if(doubleConfirm&&current!=null){confirm(current!!);true}else false
        else->false
    }}.focusable(enabled).pointerInput(enabled,doubleConfirm,timeOfDay){
        detectTapGestures(onDoubleTap={if(enabled&&doubleConfirm)current?.let(confirm)})
    }.pointerInput(enabled,focusMinutes,breakMinutes,timeOfDay){
        if(!enabled)return@pointerInput
        val density=density
        awaitEachGesture{
            val down=awaitFirstDown(requireUnconsumed=false);val x=down.position.x
            var y=down.position.y;var lastY=y;var base=current;var selected=current;var direction=0;var axis=0;var until=0L
            val anchor=Math.floorDiv(System.currentTimeMillis(),60000)*60000
            try{
                while(true){
                    val pointer=awaitPointerEvent().changes.find{it.id==down.id}?:break
                    if(!pointer.pressed)break
                    var delta=(y-pointer.position.y)/density;val dx=(pointer.position.x-x)/density
                    if(axis==0&&maxOf(abs(dx),abs(delta))>=12)axis=if(abs(dx)>abs(delta)*1.25)1 else 2
                    if(axis!=2)continue
                    pointer.consume();val previous=lastY;val nextDirection=sign(previous-pointer.position.y).toInt();lastY=pointer.position.y
                    if(nextDirection==0)continue
                    val stamp=android.os.SystemClock.uptimeMillis()
                    if(direction!=0&&nextDirection!=direction){until=0;held=null;base=selected;y=previous;delta=(y-pointer.position.y)/density}
                    direction=nextDirection
                    if(stamp<until){y=pointer.position.y;base=selected;continue}
                    var next=shifted(base,ClockSelection.steps(delta.toDouble()))
                    val detent=if(timeOfDay)null else ClockSelection.detent(selected?:anchor,next?:anchor,anchor,focusMinutes,breakMinutes)
                    if(detent!=null){next=detent.endMs;until=stamp+ClockSelection.DWELL_MS;y=pointer.position.y;base=next;held=detent.round;snappedRound=detent.round;sparkSerial++
                        view.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
                        NativeTactileAudio.tick(context,1360f)}
                    else if(next!=selected){
                        snappedRound=next?.let{ClockSelection.matchingDetentRound(it,anchor,focusMinutes,breakMinutes)}
                        NativeTactileAudio.tick(context,1040f)
                    }
                    selected=next;change(next)
                }
            }finally{held=null}
        }
    },horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.Center){
        Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.Center){
            Text(
                clock,
                modifier=Modifier.graphicsLayer{scaleX=clockScale.value;scaleY=clockScale.value},
                style=clockStyle,
                color=if(detentActive)colors.primary else LocalContentColor.current,
            )
            if(doubleConfirm&&value!=null){
                val caption=if(matchedDetent!=null)ui.rounds(matchedDetent)+" · "+ui.text("{0}结束 · 双击确认",day) else ui.text("{0}结束 · 双击确认",day)
                Text(caption,Modifier.align(Alignment.BottomCenter).offset(y=25.dp),style=MaterialTheme.typography.bodySmall,color=if(detentActive)colors.primary else LocalContentColor.current)
            }
        }
        if(!doubleConfirm)Text(if(timeOfDay||value==null)ui.text("上下滑动调整")else ui.text("{0}结束 · 上下滑动调整",day),style=MaterialTheme.typography.bodySmall,color=if(detentActive)colors.primary else LocalContentColor.current)

    }
}
