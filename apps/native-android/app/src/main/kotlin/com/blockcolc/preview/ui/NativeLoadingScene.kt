package com.blockcolc.preview.ui

import androidx.compose.animation.core.*
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

/** The formal loading scene artwork and clock handoff. Uses one unified
 * gallery pine architectural cottage style across storage/world handoffs and
 * preserves monotonic boot progress so house construction aligns with loading. */
class NativeLoadingChoice(val tomato:Boolean=false,val house:Int=0,val animate:Boolean=true) {
    internal var phase by mutableFloatStateOf(0f)
        private set
    internal var leader by mutableStateOf<Any?>(null)
        private set
    internal var bootProgress by mutableFloatStateOf(0f)
        private set
    private val leases=linkedSetOf<Any>()
    private var elapsedNs=0L
    private var startedNs=0L
    private var paintedFrame=frameKey(0f)

    internal fun reportBootProgress(value:Float) {
        val clamped=value.coerceIn(0f,1f)
        if(clamped>bootProgress)bootProgress=clamped
    }

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

// Clock frame buckets retained for deterministic clock handoff tests.
private val CLOCK_HOUSE_ROWS=listOf("   rrrr   ","  rrrrrr  "," rrrrrrrr ","rrrwwwwrrr","  wwgwww  ","  wwwwgw  ","  wgddww  ","  wwddww  ","  ssssss  ")
private data class ClockTile(val x:Int,val y:Int,val delay:Float)
private val CLOCK_HOUSE_TILES=CLOCK_HOUSE_ROWS.flatMapIndexed { y,row->
    row.mapIndexedNotNull { x,cell->
        if(cell==' ')null else ClockTile(x,y,((8-y)*10+x)*.026f)
    }
}
private fun houseFrame(time:Float):Long {
    var mask=0L
    for((index,tile)in CLOCK_HOUSE_TILES.withIndex()){
        val local=time-tile.delay
        if(local>=0&&(local%4.8f)/4.8f>=.08f)mask=mask or (1L shl index)
    }
    return mask
}

// Unified signature 16x14 Gallery Pine Architectural Cottage on a stepped plinth.
// Tiles are ordered strictly bottom-to-top in architectural construction sequence
// (stepped plinth -> timber walls & door -> windows -> eaves -> pitched roof -> chimney)
// so construction progress tracks actual app/world loading progress 1:1.
private val GALLERY_HOUSE_ROWS=listOf(
    "          cc    ", // 00: chimney cap
    "       Rr ck    ", // 01: roof ridge + chimney shaft
    "      RRrrck    ", // 02: upper gable + chimney
    "     RRRrrr     ", // 03: gable slope
    "    RRRRrrrr    ", // 04: mid roof
    "   RRRRRrrrrr   ", // 05: lower roof
    "  sRRRRRrrrrrs  ", // 06: overhanging dark-pine eaves
    "   bbbbbbbbbb   ", // 07: under-eave shadow beam
    "   twGGwwGGWt   ", // 08: upper facade + sunlit casement windows
    "   twGGwwGGWt   ", // 09: lower casement windows
    "   twffddffWt   ", // 10: window sills + walnut door lintel
    "   twwwdhwWWt   ", // 11: walls + door with warm brass handle
    "  qppppppppppq  ", // 12: upper gallery maquette plinth
    "   qqqqqqqqqq   ", // 13: stepped plinth base
)
private data class GalleryTile(val x:Int,val y:Int,val material:Char,val threshold:Float)
private val GALLERY_HOUSE_TILES:List<GalleryTile> = run {
    val raw=ArrayList<Triple<Int,Int,Char>>()
    // Build bottom-to-top, alternating slight outward sweep per row for natural bricklaying.
    for(y in GALLERY_HOUSE_ROWS.lastIndex downTo 0){
        val row=GALLERY_HOUSE_ROWS[y]
        val cols=if((GALLERY_HOUSE_ROWS.lastIndex-y)%2==0) row.indices else row.indices.reversed()
        for(x in cols){
            val cell=row[x]
            if(cell!=' ')raw+=Triple(x,y,cell)
        }
    }
    val total=raw.size.coerceAtLeast(1)
    raw.mapIndexed{idx,(x,y,mat)->GalleryTile(x,y,mat,idx.toFloat()/total.toFloat())}
}

private fun tomatoFruitPhase(time:Float)=((time-2.2f).coerceAtLeast(0f)%6)/6
private val FRUIT_FALL=CubicBezierEasing(.42f,0f,1f,1f)
private val FRUIT_BOUNCE=CubicBezierEasing(0f,.65f,.35f,1f)
private val FRUIT_LAND=CubicBezierEasing(.45f,0f,1f,1f)

@Composable fun NativeLoadingScene(
    stage:String,
    modifier:Modifier=Modifier,
    embedded:Boolean=false,
    stageKind:String="scene",
    progress:Float?=null,
){
    val ui=LocalNativeUi.current;val choice=LocalNativeLoading.current;val colors=MaterialTheme.colorScheme
    val pageActive=LocalNativePageActive.current;val lease=remember{Any()}
    val lifecycle=androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    var active by remember{mutableStateOf(lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED))}
    DisposableEffect(lifecycle){val observer=androidx.lifecycle.LifecycleEventObserver{_,event->if(event==androidx.lifecycle.Lifecycle.Event.ON_START)active=true else if(event==androidx.lifecycle.Lifecycle.Event.ON_STOP)active=false};lifecycle.addObserver(observer);onDispose{lifecycle.removeObserver(observer)}}
    val animate=active&&pageActive&&!ui.reduceMotion&&choice.animate
    val useClock=progress==null||choice.tomato
    DisposableEffect(choice,animate,useClock){
        if(animate&&useClock)choice.attach(lease,SystemClock.elapsedRealtimeNanos())
        onDispose{if(animate&&useClock)choice.detach(lease,SystemClock.elapsedRealtimeNanos())}
    }
    val ownsClock=animate&&useClock&&choice.leader===lease
    LaunchedEffect(choice,ownsClock){
        if(!ownsClock)return@LaunchedEffect
        while(true){
            choice.sample(lease,SystemClock.elapsedRealtimeNanos())
            delay(33)
        }
    }

    // Align house construction smoothly with real loading progress.
    val initialProgress=remember(choice,embedded){
        val reported=progress?.coerceIn(0f,1f)
        when{
            reported==null->1f
            !embedded||choice.bootProgress<0.99f->maxOf(reported,choice.bootProgress)
            else->reported
        }
    }
    val displayedProgress=remember{Animatable(initialProgress)}
    LaunchedEffect(progress,animate,embedded){
        val target=progress?.coerceIn(0f,1f)?:return@LaunchedEffect
        val effective=if(!embedded||choice.bootProgress<0.99f){
            choice.reportBootProgress(target)
            maxOf(target,choice.bootProgress)
        }else target
        if(!animate){
            displayedProgress.snapTo(effective)
            return@LaunchedEffect
        }
        // Reset smoothly if a brand-new rebuild cycle starts after completion.
        if(effective<displayedProgress.value-0.30f){
            displayedProgress.snapTo(effective)
        }else if(effective>displayedProgress.value){
            displayedProgress.animateTo(effective,tween(260,easing=FastOutSlowInEasing))
        }
        // Gentle bounded micro-creep inside active stages so bricklaying stays
        // alive without ever running far ahead of actual loading work.
        val creepCap=(effective+0.07f).coerceAtMost(0.95f)
        if(effective<0.95f&&displayedProgress.value<creepCap){
            displayedProgress.animateTo(creepCap,tween(1100,easing=LinearEasing))
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
    val barProgress=if(progress!=null) displayedProgress.value.coerceIn(0f,1f)
        else if(ui.reduceMotion||!choice.animate) 1f
        else ((choice.phase%3.6f)/2.4f).coerceIn(0f,1f)

    Box(modifier.background(colors.background).clickable(interactionSource=remember{androidx.compose.foundation.interaction.MutableInteractionSource()},indication=null){},contentAlignment=Alignment.Center){
      Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(if(embedded)6.dp else 14.dp)){
        Canvas(Modifier.size(if(embedded)136.dp else 176.dp,if(embedded)120.dp else 156.dp).testTag("formal-loading-art")){
            val still=ui.reduceMotion||!choice.animate
            val time=if(still)3.5f else choice.phase;val pixelDensity=density
            if(!choice.tomato){
                // Crisp whole-pixel grid for the 16x14 architectural gallery cottage.
                val cell=nativePixelCell(minOf(size.width/18f,size.height/16f)).coerceAtLeast(1f)
                val gridW=cell*16f
                val gridH=cell*14f
                val ox=nativePixelOrigin(size.width,gridW)
                val oy=nativePixelOrigin(size.height,gridH)
                val buildFraction=if(still) 1f else barProgress
                // Subtle architectural ground shadow beneath the stepped plinth.
                val shadowAlpha=(buildFraction*5f).coerceIn(0.15f,1f)*(if(dark)0.35f else 0.14f)
                drawRect(
                    color=(if(dark)Color(0xFF000000)else Color(0xFF1F2723)).copy(alpha=shadowAlpha),
                    topLeft=Offset(ox+2.5f*cell,oy+13.8f*cell),
                    size=Size(11f*cell,0.55f*cell),
                )
                val windowGlow=(if(buildFraction>0.88f)(buildFraction-0.88f)/0.12f else 0f).coerceIn(0f,1f)
                for(tile in GALLERY_HOUSE_TILES){
                    val span=0.055f
                    val settle=if(still)1f else ((buildFraction-tile.threshold)/span).coerceIn(0f,1f)
                    if(settle<=0f)continue
                    val baseColor=when(tile.material){
                        'R'->Color(if(dark)0xFF3E8B64 else 0xFF357A57) // sunlit pine roof slope
                        'r'->Color(if(dark)0xFF286043 else 0xFF22573C) // shaded architectural pine roof
                        's'->Color(if(dark)0xFF1C4631 else 0xFF19422D) // crisp overhanging eave shadow
                        'c'->Color(if(dark)0xFF9C7B66 else 0xFFA67E66) // warm stone/terracotta chimney
                        'k'->Color(if(dark)0xFF775D4D else 0xFF83624E) // chimney shaded edge
                        'b'->Color(if(dark)0xFF98907E else 0xFFC8BFA9) // under-eave shadow beam
                        't'->Color(if(dark)0xFF7B6049 else 0xFF8C6D53) // walnut timber corner post
                        'w'->Color(if(dark)0xFFDAD2BF else 0xFFEAE3D2) // gallery limestone plaster wall
                        'W'->Color(if(dark)0xFFC5BCA8 else 0xFFDDD4C0) // shaded plaster edge
                        'G'->lerp(Color(if(dark)0xFFD5B163 else 0xFFE6C26D),Color(0xFFF9DE8C),windowGlow) // sunlit amber window
                        'f'->Color(if(dark)0xFF8A8070 else 0xFFB5A892) // stone window sill
                        'd'->Color(if(dark)0xFF5D4333 else 0xFF6B4E3B) // walnut timber door
                        'h'->Color(0xFFE5BA62)                         // warm brass door handle
                        'p'->Color(if(dark)0xFF3A413D else 0xFFD9D6CC) // upper gallery maquette plinth
                        else->Color(if(dark)0xFF262C29 else 0xFFC2BEB3) // stepped plinth trim/base ('q')
                    }
                    val lift=(1f-settle)*cell*0.55f
                    val tx=ox+tile.x*cell
                    val ty=oy+tile.y*cell-lift
                    drawRect(baseColor.copy(alpha=settle),Offset(tx,ty),Size(cell,cell))
                    // Crisp subtle top highlight on roof ridges and plinth edges for pixel depth.
                    if(settle>=0.95f&&(tile.material=='R'||tile.material=='p')){
                        drawRect(Color.White.copy(alpha=if(dark)0.08f else 0.14f),Offset(tx,ty),Size(cell,maxOf(1f,cell*0.16f)))
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
                            fun segment(a:Float,b:Float,from:Float,to:Float,ease:Easing):Float=from+(to-from)*ease.transform(((phase-a)/(b-a)).coerceIn(0f,1f))
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
        // Minimal 2dp gallery hairline progress rule synced 1:1 with the house bricks.
        if(!choice.tomato){
            Box(Modifier.width(if(embedded)112.dp else 136.dp).height(2.dp).background(colors.outlineVariant)){
                Box(Modifier.fillMaxHeight().fillMaxWidth(barProgress.coerceIn(0.04f,1f)).background(colors.primary))
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
