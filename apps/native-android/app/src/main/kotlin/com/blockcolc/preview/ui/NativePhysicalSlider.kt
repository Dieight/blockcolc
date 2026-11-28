package com.blockcolc.preview.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.blockcolc.presentation.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.*

@Composable fun NativePhysicalSlider(label:String,value:Int,min:Int=0,max:Int=100,step:Int=5,enabled:Boolean=true,onPreview:(Int?)->Unit={},onFlightValue:(Int?)->Unit={},onCommit:(Int)->Unit){
    require(min<max&&step>0)
    val ui=LocalNativeUi.current;val density=LocalDensity.current.density;val scope=rememberCoroutineScope()
    var width by remember{mutableDoubleStateOf(1.0)};var pose by remember{mutableStateOf<SliderPoint?>(null)};var aiming by remember{mutableStateOf<SliderFlight?>(null)}
    var flying by remember{mutableStateOf<SliderFlight?>(null)};var preview by remember{mutableStateOf<Int?>(null)}
    var job by remember{mutableStateOf<Job?>(null)};var bouncing by remember{mutableStateOf(false)};var committedFlight by remember{mutableStateOf(false)}
    val current by rememberUpdatedState(value);val commit by rememberUpdatedState(onCommit);val announce by rememberUpdatedState(onPreview);val flightValue by rememberUpdatedState(onFlightValue)
    val colors=MaterialTheme.colorScheme
    fun clear(){pose=null;aiming=null;flying=null;preview=null;bouncing=false;committedFlight=false;announce(null);flightValue(null)}
    // A save beginning at landing must not cancel its already committed bounce.
    // An unrelated disable before committing still cancels the gesture safely.
    LaunchedEffect(enabled){if(!enabled&&!committedFlight){job?.cancel();clear()}}
    DisposableEffect(Unit){onDispose{job?.cancel();onPreview(null);onFlightValue(null)}}
    val target=aiming?:flying
    val displayed=target?.let{SliderPhysics.landingValueAt(it.landing,width,min,max,step,it.vx)}?:preview?:value.coerceIn(min,max)
    Canvas(Modifier.fillMaxWidth().height(64.dp).onSizeChanged{width=maxOf(1.0,(it.width-24*density)/density.toDouble())}
        .semantics{contentDescription=label;progressBarRangeInfo=ProgressBarRangeInfo(value.toFloat().coerceIn(min.toFloat(),max.toFloat()),min.toFloat()..max.toFloat(),((max-min)/step-1).coerceAtLeast(0))
            setProgress{next->if(!enabled)false else {job?.cancel();clear();commit(SliderPhysics.valueAt((next-min)/(max-min)*width,width,min,max,step));true}}}
        .onKeyEvent{e->if(!enabled||e.type!=KeyEventType.KeyDown)false else when(e.key){Key.DirectionLeft,Key.DirectionDown->{job?.cancel();clear();commit((current-step).coerceAtLeast(min));true};Key.DirectionRight,Key.DirectionUp->{job?.cancel();clear();commit((current+step).coerceAtMost(max));true};else->false}}
        .focusable(enabled).pointerInput(enabled,min,max,step,density){
            if(!enabled)return@pointerInput
            awaitEachGesture {
                val down=awaitFirstDown(requireUnconsumed=true);down.consume()
                job?.cancel();clear()
                var origin=(current-min).toDouble()/(max-min)*width
                var pullX=0.0;var pullY=0.0;var vertical=false;var released=false
                val x=(down.position.x/density-12).toDouble().coerceIn(0.0,width)
                if(abs(x-origin)>22){origin=x;preview=SliderPhysics.valueAt(x,width,min,max,step);announce(preview)}
                pose=SliderPoint(origin,0.0)
                try {
                    while(true){
                        val change=awaitPointerEvent().changes.find{it.id==down.id}?:break
                        if(change.isConsumed)break
                        pullX=((change.position.x-down.position.x)/density).toDouble()
                        pullY=((change.position.y-down.position.y)/density).toDouble().coerceIn(-110.0,110.0)
                        change.consume()
                        if(!change.pressed){released=true;break}
                        if(abs(pullY)>14)vertical=true
                        if(vertical){pullX=pullX.coerceIn(-160.0,160.0);val f=SliderPhysics.flight(origin,pullX,pullY,width);aiming=f;pose=SliderPoint((origin+pullX).coerceIn(0.0,width),pullY);preview=SliderPhysics.landingValueAt(f.landing,width,min,max,step,f.vx)}
                        else {pose=SliderPoint((origin+pullX).coerceIn(0.0,width),0.0);preview=SliderPhysics.valueAt(origin+pullX,width,min,max,step)}
                        announce(preview)
                    }
                }finally{if(!released)clear()}
                if(!released)return@awaitEachGesture
                if(!vertical){commit(SliderPhysics.valueAt(origin+pullX,width,min,max,step));clear()}
                else {
                    val f=SliderPhysics.flight(origin,pullX,pullY,width);val landing=SliderPhysics.landingValueAt(f.landing,width,min,max,step,f.vx);aiming=null;flying=f;flightValue(landing);announce(null)
                    if(ui.reduceMotion){commit(landing);clear()}
                    else job=scope.launch{
                        val start=withFrameNanos{it};val impact=f.vy+f.gravity*f.duration;val bounce=SliderPhysics.firstBounceDuration(impact);val aligned=(landing-min).toDouble()/(max-min)*width;var saved=false
                        while(true){val elapsed=(withFrameNanos{it}-start)/1e9
                            if(elapsed<f.duration)pose=SliderPhysics.position(f,elapsed)
                            else {bouncing=true;val t=elapsed-f.duration;val alignment=minOf(1.0,t/maxOf(.001,bounce));pose=SliderPoint(f.landing+(aligned-f.landing)*alignment,SliderPhysics.bounce(t,impact));if(!saved&&alignment>=1){committedFlight=true;commit(landing);saved=true}}
                            if(elapsed>=f.duration+bounce*1.5){if(!saved){committedFlight=true;commit(landing)};break}
                        };clear()
                    }
                }
            }
        }){
        val left=12*density;val top=size.height/2;val railWidth=width.toFloat()*density
        drawRect(colors.outlineVariant,Offset(left,top-0.75f*density),Size(railWidth,1.5f*density))
        val forecast=target?.let{if(bouncing)pose?.x?:it.landing else it.landing}?:((displayed-min).toDouble()/(max-min)*width)
        val fill=(forecast/width).toFloat()*railWidth
        if(fill>0f)drawRect(colors.primary,Offset(left,top-1.25f*density),Size(fill,2.5f*density))
        fun ball(x:Double,y:Double,alpha:Float){
            val cx=left+x.toFloat()*density;val cy=top+y.toFloat()*density;val half=5f*density
            drawRect(colors.primary.copy(alpha=alpha),Offset(cx-half,cy-half),Size(half*2,half*2))
            drawRect(colors.background.copy(alpha=alpha),Offset(cx-1.5f*density,cy-1.5f*density),Size(3f*density,3f*density))
        }
        aiming?.let{f->
            for(i in 1..20){
                val pt=SliderPhysics.position(f,f.duration*i/20)
                val dot=1.25f*density
                drawRect(colors.onSurface.copy(alpha=.42f),Offset(left+pt.x.toFloat()*density-dot,top+pt.y.toFloat()*density-dot),Size(dot*2,dot*2))
            }
            ball(f.landing,0.0,.32f)
        }
        val point=pose?:SliderPoint((displayed-min).toDouble()/(max-min)*width,0.0);ball(point.x,point.y,1f)
    }
}
