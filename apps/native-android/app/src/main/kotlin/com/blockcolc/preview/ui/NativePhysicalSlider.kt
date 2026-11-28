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
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.blockcolc.presentation.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.*

private data class TrailDot(val x:Double,val y:Double,val life:Float)

@Composable fun NativePhysicalSlider(label:String,value:Int,min:Int=0,max:Int=100,step:Int=5,enabled:Boolean=true,onPreview:(Int?)->Unit={},onFlightValue:(Int?)->Unit={},onCommit:(Int)->Unit){
    require(min<max&&step>0)
    val ui=LocalNativeUi.current;val density=LocalDensity.current.density;val scope=rememberCoroutineScope()
    val context=LocalContext.current;val view=LocalView.current
    var width by remember{mutableDoubleStateOf(1.0)};var pose by remember{mutableStateOf<SliderPoint?>(null)};var aiming by remember{mutableStateOf<SliderFlight?>(null)}
    var flying by remember{mutableStateOf<SliderFlight?>(null)};var preview by remember{mutableStateOf<Int?>(null)}
    var job by remember{mutableStateOf<Job?>(null)};var bouncing by remember{mutableStateOf(false)};var committedFlight by remember{mutableStateOf(false)}
    var trail by remember{mutableStateOf<List<TrailDot>>(emptyList())}
    val current by rememberUpdatedState(value);val commit by rememberUpdatedState(onCommit);val announce by rememberUpdatedState(onPreview);val flightValue by rememberUpdatedState(onFlightValue)
    val colors=MaterialTheme.colorScheme
    fun clear(){pose=null;aiming=null;flying=null;preview=null;bouncing=false;committedFlight=false;trail=emptyList();announce(null);flightValue(null)}
    // A save beginning at landing must not cancel its already committed bounce.
    // An unrelated disable before committing still cancels the gesture safely.
    LaunchedEffect(enabled){if(!enabled&&!committedFlight){job?.cancel();clear()}}
    DisposableEffect(Unit){onDispose{job?.cancel();onPreview(null);onFlightValue(null)}}
    val target=aiming?:flying
    val displayed=target?.let{SliderPhysics.landingValueAt(it.landing,width,min,max,step,it.vx)}?:preview?:value.coerceIn(min,max)
    Canvas(Modifier.fillMaxWidth().height(72.dp).onSizeChanged{width=maxOf(1.0,(it.width-24*density)/density.toDouble())}
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
                var lastStep=current
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
                        preview?.let{pv->if(pv!=lastStep){lastStep=pv;NativeTactileAudio.tick(context,960f+(pv-min)*3f)}}
                        announce(preview)
                    }
                }finally{if(!released)clear()}
                if(!released)return@awaitEachGesture
                if(!vertical){commit(SliderPhysics.valueAt(origin+pullX,width,min,max,step));clear()}
                else {
                    val f=SliderPhysics.flight(origin,pullX,pullY,width);val landing=SliderPhysics.landingValueAt(f.landing,width,min,max,step,f.vx);aiming=null;flying=f;flightValue(landing);announce(null)
                    if(ui.reduceMotion){commit(landing);clear()}
                    else job=scope.launch{
                        val start=withFrameNanos{it};val impact=f.vy+f.gravity*f.duration;val bounce=SliderPhysics.firstBounceDuration(impact);val aligned=(landing-min).toDouble()/(max-min)*width;var saved=false;var bounceSounded=false
                        while(true){val elapsed=(withFrameNanos{it}-start)/1e9
                            val pt=if(elapsed<f.duration)SliderPhysics.position(f,elapsed)
                            else {
                                if(!bounceSounded){
                                    bounceSounded=true
                                    view.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
                                    NativeTactileAudio.bounce(context,(abs(impact)/650.0).toFloat().coerceIn(0.25f,1f))
                                }
                                bouncing=true;val t=elapsed-f.duration;val alignment=minOf(1.0,t/maxOf(.001,bounce))
                                if(!saved&&alignment>=1){committedFlight=true;commit(landing);saved=true}
                                SliderPoint(f.landing+(aligned-f.landing)*alignment,SliderPhysics.bounce(t,impact))
                            }
                            pose=pt
                            trail=(trail.mapNotNull{d->val nl=d.life-0.08f;if(nl>0f)d.copy(life=nl)else null}+TrailDot(pt.x,pt.y,1f)).takeLast(14)
                            if(elapsed>=f.duration+bounce*1.5){if(!saved){committedFlight=true;commit(landing)};break}
                        };clear()
                    }
                }
            }
        }){
        val left=12*density;val top=size.height/2;val railWidth=width.toFloat()*density
        // Frameless 1dp architectural hairline rail + subtle end ticks
        drawRect(colors.outlineVariant,Offset(left,top-0.5f*density),Size(railWidth,1f*density))
        drawRect(colors.outline,Offset(left,top-4f*density),Size(1f*density,8f*density))
        drawRect(colors.outline,Offset(left+railWidth-1f*density,top-4f*density),Size(1f*density,8f*density))

        val forecast=target?.let{if(bouncing)pose?.x?:it.landing else it.landing}?:((displayed-min).toDouble()/(max-min)*width)
        val fill=(forecast/width).toFloat()*railWidth
        if(fill>0f)drawRect(colors.primary,Offset(left,top-1f*density),Size(fill,2f*density))

        // Dashed pine tether when pulled off track + parabolic trajectory dots
        aiming?.let{f->
            pose?.let{p->
                val px=left+p.x.toFloat()*density;val py=top+p.y.toFloat()*density
                val lx=left+f.landing.toFloat()*density
                drawLine(colors.primary.copy(alpha=0.55f),Offset(px,py),Offset(lx,top),1f*density,pathEffect=PathEffect.dashPathEffect(floatArrayOf(3f*density,3f*density)))
                drawRect(colors.primary,Offset(lx-2f*density,top-2f*density),Size(4f*density,4f*density))
            }
            for(i in 1..18){
                val pt=SliderPhysics.position(f,f.duration*i/18)
                drawCircle(colors.onSurface.copy(alpha=0.32f),1.25f*density,Offset(left+pt.x.toFloat()*density,top+pt.y.toFloat()*density))
            }
        }

        // Fading pine gravity trail during flight & bounce
        for(dot in trail){
            drawCircle(colors.primary.copy(alpha=dot.life*0.34f),2.8f*density*dot.life,Offset(left+dot.x.toFloat()*density,top+dot.y.toFloat()*density))
        }

        // Monochrome Gallery circular ink thumb with crisp pine square pixel core
        val point=pose?:SliderPoint((displayed-min).toDouble()/(max-min)*width,0.0)
        val cx=left+point.x.toFloat()*density;val cy=top+point.y.toFloat()*density
        val r=if(pose!=null)7.5f*density else 6f*density
        drawCircle(colors.onBackground,r,Offset(cx,cy))
        val core=1.75f*density
        drawRect(colors.primary,Offset(cx-core,cy-core),Size(core*2f,core*2f))
    }
}
