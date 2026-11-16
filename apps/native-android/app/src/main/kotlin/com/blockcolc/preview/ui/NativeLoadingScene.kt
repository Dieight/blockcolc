package com.blockcolc.preview.ui

import androidx.compose.foundation.*
import android.os.SystemClock
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.*
import androidx.compose.ui.platform.testTag
import kotlinx.coroutines.delay

/** The formal BootHouse/TomatoLoading artwork and timelines. One boot keeps its
 * selected family, house and elapsed phase across storage/world handoffs. */
class NativeLoadingChoice(val tomato:Boolean=kotlin.random.Random.nextBoolean(),val house:Int=kotlin.random.Random.nextInt(4),val animate:Boolean=true) {
    internal var phase by mutableFloatStateOf(0f)
        private set
    internal var leader by mutableStateOf<Any?>(null)
        private set
    private val leases=linkedSetOf<Any>()
    private var elapsedNs=0L
    private var startedNs=0L
    private var paintedFrame=frameKey(0f)

    internal fun attach(lease:Any,nowNs:Long) {
        if(!leases.add(lease))return
        if(leases.size==1){
            startedNs=nowNs
            leader=lease
        }
    }

    internal fun detach(lease:Any,nowNs:Long) {
        if(!leases.remove(lease))return
        if(leases.isEmpty())elapsedNs+=nowNs-startedNs
        if(leader===lease)leader=leases.firstOrNull()
    }

    internal fun sample(lease:Any,nowNs:Long) {
        if(leader!==lease)return
        val elapsed=(elapsedNs+nowNs-startedNs)/1e9f
        val frame=frameKey(elapsed)
        if(frame!=paintedFrame){
            paintedFrame=frame
            phase=elapsed
        }
    }

    private fun frameKey(time:Float):Long {
        if(!tomato)return houseFrame(time)
        val fruit=tomatoFruitPhase(time)
        return when {
            time<1.1f -> -1
            time<2.2f||fruit<.13f||fruit>.94f -> -2
            fruit<.39f -> -3
            fruit<.59f -> -4
            fruit>=.88f&&fruit<.92f -> -5
            // Falling, bouncing and fading change position or alpha.
            else -> time.toRawBits().toLong()
        }
    }
}
val LocalNativeLoading=staticCompositionLocalOf{NativeLoadingChoice()}
private val HOUSE_ROWS=listOf("   rrrr   ","  rrrrrr  "," rrrrrrrr ","rrrwwwwrrr","  wwgwww  ","  wwwwgw  ","  wgddww  ","  wwddww  ","  ssssss  ")
private data class HouseTile(val x:Int,val y:Int,val material:Char,val delay:Float)
private val HOUSE_TILES=HOUSE_ROWS.flatMapIndexed { y,row->
    row.mapIndexedNotNull { x,cell->
        if(cell==' ')null else HouseTile(x,y,cell,((8-y)*10+x)*.026f)
    }
}
private fun houseFrame(time:Float):Long {
    var mask=0L
    for((index,tile)in HOUSE_TILES.withIndex()){
        val local=time-tile.delay
        if(local>=0&&(local%4.8f)/4.8f>=.08f)mask=mask or (1L shl index)
    }
    return mask
}
private fun tomatoFruitPhase(time:Float)=((time-2.2f).coerceAtLeast(0f)%6)/6
private val HOUSE_ROOFS=listOf(0xffa7664c,0xff72936b,0xff638a99,0xffbd674e)
private val FRUIT_FALL=androidx.compose.animation.core.CubicBezierEasing(.42f,0f,1f,1f)
private val FRUIT_BOUNCE=androidx.compose.animation.core.CubicBezierEasing(0f,.65f,.35f,1f)
private val FRUIT_LAND=androidx.compose.animation.core.CubicBezierEasing(.45f,0f,1f,1f)
@Composable fun NativeLoadingScene(stage:String,modifier:Modifier=Modifier,embedded:Boolean=false,stageKind:String="scene"){
    val ui=LocalNativeUi.current;val choice=LocalNativeLoading.current;val colors=MaterialTheme.colorScheme
    val pageActive=LocalNativePageActive.current;val lease=remember{Any()}
    val lifecycle=androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    var active by remember{mutableStateOf(lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED))}
    DisposableEffect(lifecycle){val observer=androidx.lifecycle.LifecycleEventObserver{_,event->if(event==androidx.lifecycle.Lifecycle.Event.ON_START)active=true else if(event==androidx.lifecycle.Lifecycle.Event.ON_STOP)active=false};lifecycle.addObserver(observer);onDispose{lifecycle.removeObserver(observer)}}
    val animate=active&&pageActive&&!ui.reduceMotion&&choice.animate
    DisposableEffect(choice,animate){
        if(animate)choice.attach(lease,SystemClock.elapsedRealtimeNanos())
        onDispose{if(animate)choice.detach(lease,SystemClock.elapsedRealtimeNanos())}
    }
    val ownsClock=animate&&choice.leader===lease
    LaunchedEffect(choice,ownsClock){
        if(!ownsClock)return@LaunchedEffect
        while(true){
            // Sample elapsed time without asking Compose for display-rate frames.
            // Still construction/growth frames leave the draw state untouched.
            choice.sample(lease,SystemClock.elapsedRealtimeNanos())
            delay(33)
        }
    }
    val paths=remember(choice.tomato){if(!choice.tomato)emptyMap()else mapOf(
        "soilSide" to "M9 34h30v4H9z", "soil" to "M7 32h34v3H7z",
        "grass" to "M7 32h8v2H7zm28 0h6v2h-6zM9 31h4v1H9zm26 0h4v1h-4z",
        "grain" to "M12 35h2v1h-2zm6 1h3v1h-3zm9-1h2v1h-2zm8 1h2v1h-2z",
        "sprout" to "M24 30h2v5h-2zM22 28h2v2h-2zM26 28h2v2h-2z",
        "sproutLeaf" to "M19 25h3v3h-3zM28 25h3v3h-3z",
        "stem" to "M24 13h2v22h-2zM17 24h9v2h-9zM24 15h9v2h-9zM31 15h2v6h-2z",
        "leaf" to "M14 21h8v3h-8zM18 16h6v3h-6zM19 29h5v2h-5z",
        "leafLit" to "M26 12h9v3h-9zM26 27h5v2h-5z",
        "fruit" to "M29 18h6v1h1v5h-1v1h-6v-1h-1v-5h1z"
    ).mapValues{PathParser().parsePathString(it.value).toPath()}}
    val dark=colors.background.luminance()<.5f
    Box(modifier.background(colors.background).clickable(interactionSource=remember{androidx.compose.foundation.interaction.MutableInteractionSource()},indication=null){},contentAlignment=Alignment.Center){
      Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(if(embedded)2.dp else 14.dp)){
        Canvas(Modifier.size(if(embedded)134.dp else 176.dp,if(embedded)120.dp else 158.dp).testTag("formal-loading-art")){
            val still=ui.reduceMotion||!choice.animate
            val time=if(still)3.5f else choice.phase;val pixelDensity=density
            if(!choice.tomato){
                // The original model box is 176x158, with a centered 160x144 SVG.
                val unit=density*if(embedded).76f else 1f
                withTransform({translate((size.width-160*unit)/2,(size.height-144*unit)/2)}){
                val roof=HOUSE_ROOFS[choice.house.coerceIn(0,3)]
                drawRect(lerp(colors.background,colors.primary,.18f),Offset(16*unit,126*unit),Size(128*unit,4*unit))
                val frame=if(still)-1L else houseFrame(time)
                for((index,tile)in HOUSE_TILES.withIndex()){
                    if(frame and (1L shl index)==0L)continue
                    val color=when(tile.material){'r'->roof;'w'->0xffd3b58b;'g'->0xffb9dad1;'d'->0xff775740;else->0xff8f9987}
                    drawRect(Color(color),Offset((20+tile.x*12)*unit,(18+tile.y*12)*unit),Size(12*unit,12*unit))
                }
                }
            }else{
                val u=minOf(size.width/48,size.height/40)
                val stem=Color(if(dark)0xff63874e else 0xff507446);val leaf=Color(if(dark)0xff769f5d else 0xff618b50);val lit=Color(if(dark)0xffa4c776 else 0xff85ab62)
                withTransform({translate((size.width-48*u)/2,(size.height-40*u)/2);scale(u,u,Offset.Zero)}){
                    drawPath(paths.getValue("soilSide"),Color(if(dark)0xff675039 else 0xff796044));drawPath(paths.getValue("soil"),Color(if(dark)0xff8b6e48 else 0xff957650));drawPath(paths.getValue("grass"),leaf);drawPath(paths.getValue("grain"),Color(if(dark)0xff8b6e48 else 0xff957650))
                    if(time<1.1f){drawPath(paths.getValue("sprout"),stem);drawPath(paths.getValue("sproutLeaf"),leaf)}else{
                        drawPath(paths.getValue("stem"),stem);drawPath(paths.getValue("leaf"),leaf);drawPath(paths.getValue("leafLit"),lit)
                    }
                    val phase=tomatoFruitPhase(time)
                    if(still||time>=2.2f&&phase in .13f.. .94f){
                        var dx=0f;var dy=0f;var alpha=1f
                        if(phase>=.59f){
                            fun segment(a:Float,b:Float,from:Float,to:Float,ease:androidx.compose.animation.core.Easing):Float=from+(to-from)*ease.transform(((phase-a)/(b-a)).coerceIn(0f,1f))
                            dx=when{phase<.77f->segment(.59f,.77f,0f,-5f,FRUIT_FALL);phase<.825f->segment(.77f,.825f,-5f,-6f,FRUIT_BOUNCE);else->segment(.825f,.88f,-6f,-7f,FRUIT_LAND)}
                            dy=when{phase<.77f->segment(.59f,.77f,0f,26f,FRUIT_FALL);phase<.825f->segment(.77f,.825f,26f,19f,FRUIT_BOUNCE);else->segment(.825f,.88f,19f,26f,FRUIT_LAND)}
                            if(phase>=.92f)alpha=(.94f-phase)/.02f
                        }
                        val green=!still&&phase<.39f
                        withTransform({translate(dx*pixelDensity/u,dy*pixelDensity/u)}){
                            drawPath(paths.getValue("fruit"),Color(if(green)if(dark)0xffacc474 else 0xff91a955 else if(dark)0xffec6049 else 0xffd34835).copy(alpha=alpha))
                            drawRect(Color(if(green)if(dark)0xff769f5d else 0xff618b50 else if(dark)0xffb83d33 else 0xffa93029).copy(alpha=alpha),Offset(33f,20f),Size(3f,4f))
                            drawRect(Color(if(green)0xffc2d68e else 0xfff7be8e).copy(alpha=alpha),Offset(29f,19f),Size(2f,2f));drawRect(leaf.copy(alpha=alpha),Offset(30f,17f),Size(4f,2f))
                        }
                    }
                }
            }
        }
        if(!embedded){
            Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(2.dp)){NativeText(ui.text("方块钟"),NativeTextRole.SECTION);Text("BLOCKCOLC",style=MaterialTheme.typography.bodySmall.copy(letterSpacing=1.sp),color=Color(0xff8a938d))}
            Text(ui.text(when(stageKind){"storage"->"本机记录";"resources"->"世界资源";"environment"->"光照与天气";"page"->"页面";else->"地形与建筑"}),Modifier.padding(top=12.dp),style=MaterialTheme.typography.bodySmall.copy(letterSpacing=1.sp),color=colors.primary)
        }
        NativeText(if(embedded)ui.text("准备世界…")else stage,NativeTextRole.BODY,color=colors.onSurfaceVariant)
      }
    }
}
