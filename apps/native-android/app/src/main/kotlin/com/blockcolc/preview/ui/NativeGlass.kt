package com.blockcolc.preview.ui

import android.graphics.Bitmap
import android.os.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.*
import androidx.compose.ui.unit.*
import com.blockcolc.world.NativeAtmosphereFacts
import com.blockcolc.world.filament.NativeWorldView
import kotlin.math.*
import kotlin.coroutines.resume

/** Registers panel geometry with the world GPU. PixelCopy is used only once
 * to retain a transition frame, never as an independently ticking glass feed. */
class NativeBackdrop:AutoCloseable {
    private val main=Handler(Looper.getMainLooper())
    private var source:NativeWorldView?=null;private var active=false;private var closed=false
    private data class Panel(val bounds:Rect,val material:com.blockcolc.world.NativeGlassMaterial)
    private val panels=LinkedHashMap<Any,Panel>()
    private var sent:List<com.blockcolc.world.NativeGlassRegion> = emptyList()
    private var diagnosticSignature=""
    var glassConsumers by mutableIntStateOf(0)
    var presentedWindow by mutableStateOf<Pair<Int,Int>?>(null)
    var projectionHeight by mutableStateOf(0)
    var projectionTop by mutableStateOf(0)
    var clipBottom by mutableStateOf<Int?>(null)
    var requested by mutableStateOf(false)
    var immersive by mutableStateOf(false)
    var bounds=Rect.Zero;private set
    var ready by mutableStateOf(false)
    // Standalone hosts can prepare immediately. The App's first workspace
    // holds CPU world preparation until its core has crossed a draw frame.
    var corePresented by mutableStateOf(true)
    var opening by mutableStateOf(false)
    var failed by mutableStateOf(false)
    var preparingSettlement by mutableStateOf(false)
    var preparingQuality by mutableStateOf(false)
    var requestedSettlement by mutableStateOf<String?>(null)
    var requestedQuality by mutableStateOf<String?>(null)
    var worldSettingFailed by mutableStateOf(false)
    var retryWorld:()->Unit={}
    fun configure(view:NativeWorldView?,active:Boolean,rect:Rect){
        if(closed)return
        if(source!==view){source?.glassRegions(emptyList());source=view;sent=emptyList()}
        this.active=active;bounds=rect;publish()
    }
    fun panel(id:Any,rect:Rect,material:com.blockcolc.world.NativeGlassMaterial){
        if(closed)return
        val panel=Panel(rect,material);if(panels[id]==panel)return
        panels[id]=panel;publish()
    }
    fun remove(id:Any){if(panels.remove(id)!=null)publish()}
    private fun publish(){
        val next=if(!active||bounds.width<=0||bounds.height<=0)emptyList()else panels.values.mapNotNull{panel->
            val r=panel.bounds.intersect(bounds)
            if(r.width<=0||r.height<=0)null else panel.material.let{m->com.blockcolc.world.NativeGlassRegion(
                ((r.left-bounds.left)/bounds.width).coerceIn(0f,1f),(1-(r.bottom-bounds.top)/bounds.height).coerceIn(0f,1f),
                ((r.right-bounds.left)/bounds.width).coerceIn(0f,1f),(1-(r.top-bounds.top)/bounds.height).coerceIn(0f,1f),
                m.blur*android.content.res.Resources.getSystem().displayMetrics.density/bounds.width,
                m.blur*android.content.res.Resources.getSystem().displayMetrics.density/bounds.height,m.saturation,m.brightness,m.ceiling,m.floor)}
        }.takeLast(4)
        if(com.blockcolc.preview.BuildConfig.NATIVE_DIAGNOSTICS){
            val signature="$active/$bounds/${panels.values.map{it.bounds}}/${next.size}/${source!=null}"
            if(signature!=diagnosticSignature){diagnosticSignature=signature;android.util.Log.i("BlockcolcGlass",signature)}
        }
        if(next!=sent){sent=next;source?.glassRegions(next)}
    }
    suspend fun snapshot():Bitmap?=kotlinx.coroutines.suspendCancellableCoroutine{continuation->
        val view=source
        if(closed||view==null||bounds.width<=0||bounds.height<=0||Build.VERSION.SDK_INT<24){continuation.resume(null);return@suspendCancellableCoroutine}
        val scale=min(1f,1280f/max(bounds.width,bounds.height))
        val bitmap=Bitmap.createBitmap(max(1,(bounds.width*scale).roundToInt()),max(1,(bounds.height*scale).roundToInt()),Bitmap.Config.ARGB_8888)
        val accepted=view.copyBackdrop(bitmap,main){success->if(continuation.isActive)continuation.resume(if(success)bitmap else null)}
        if(!accepted&&continuation.isActive)continuation.resume(null)
    }
    override fun close(){if(closed)return;closed=true;source?.glassRegions(emptyList());source=null;panels.clear();sent=emptyList()}
}
private val LocalNativePageActivityState=staticCompositionLocalOf<State<Boolean>?>{null}
object LocalNativePageActive {
    val current:Boolean @Composable get()=LocalNativePageActivityState.current?.value?:true
}
/** Keep the provided object stable. Changing a page's activation must not
 * replace the composition-local context around its remembered form state. */
@Composable internal fun NativePageActivation(active:Boolean,vararg values:ProvidedValue<*>,content:@Composable ()->Unit){
    val state=rememberUpdatedState(active)
    CompositionLocalProvider(LocalNativePageActivityState provides state,*values,content=content)
}
val LocalNativeBackdrop=staticCompositionLocalOf<NativeBackdrop?>{null}
val LocalNativeAtmosphere=compositionLocalOf<NativeAtmosphereFacts?>{null}

/** Text stays in Compose; world scattering is performed inside Filament's
 * submitted frame. Fixed sheets use their own reading surface, never a retained
 * bitmap from the minimal view that happened to precede them. */
@Composable fun NativeGlass(transparency:Int,modifier:Modifier=Modifier,weatherEnabled:Boolean=true,content:@Composable ()->Unit){
    val ui=LocalNativeUi.current;val backdrop=LocalNativeBackdrop.current
    val colors=MaterialTheme.colorScheme;val dark=colors.background.luminance()<.5f
    val night=(LocalNativeAtmosphere.current?.sun?.nightFactor?:0.0)>.55
    val sampling=(LocalNativePageActive.current||backdrop?.immersive==true)&&weatherEnabled&&!ui.reduceTransparency&&backdrop!=null
    val fixedBlur=LocalNativeFixedBlur.current&&!weatherEnabled&&!ui.reduceTransparency
    val material=remember(transparency,dark,night){com.blockcolc.world.NativeGlassMaterial.forClarity(transparency,dark,night)}
    val key=remember{Any()};val nativeView=androidx.compose.ui.platform.LocalView.current
    var localBounds by remember{mutableStateOf(Rect.Zero)}
    // Observe layout in composition. Reading state only from SideEffect does
    // not subscribe this scope, so its initial zero rectangle stayed published
    // even though onGloballyPositioned had already received the correct size.
    val panelBounds=localBounds
    DisposableEffect(backdrop,sampling){if(sampling&&backdrop!=null)backdrop.glassConsumers++
        onDispose{backdrop?.remove(key);if(sampling&&backdrop!=null)backdrop.glassConsumers--}}
    SideEffect{if(sampling)backdrop?.panel(key,panelBounds,material)else backdrop?.remove(key)}
    val ink=if(dark||sampling&&backdrop?.ready==true&&com.blockcolc.world.NativeGlassMaterial.usesLightInk(transparency,dark,night))Color.White else Color.Black
    Box(modifier.onGloballyPositioned{localBounds=it.nativeScreenBounds(nativeView)}){
        Canvas(Modifier.matchParentSize()){
            if(fixedBlur)drawRect(Brush.verticalGradient(if(dark)listOf(Color(0xff1f3329).copy(alpha=.86f),Color(0xff131c17).copy(alpha=.81f))
                else listOf(Color.White.copy(alpha=.928f),Color(0xfff3f5f2).copy(alpha=.888f))))
            else drawRect(colors.surface.copy(alpha=if(sampling&&backdrop?.ready==true)material.tintAlpha else 1f))
            if(sampling){
                drawLine(Color.White.copy(alpha=material.highlightAlpha),Offset.Zero,Offset(size.width,0f),1.dp.toPx())
                drawLine(ink.copy(alpha=.12f),Offset(0f,size.height-1),Offset(size.width,size.height-1),1f)
            }
        }
        if(weatherEnabled)NativePanelWeather(Modifier.matchParentSize())
        CompositionLocalProvider(LocalContentColor provides ink){MaterialTheme(colorScheme=colors.withGlassInk(ink)){content()}}
    }
}

internal fun ColorScheme.withGlassInk(ink: Color) =
    copy(onSurface=ink,onSurfaceVariant=ink,onBackground=ink)

/** Surface and modal may belong to different windows. Screen coordinates
 * include each window origin, unlike comparing boundsInWindow directly. */
fun LayoutCoordinates.nativeScreenBounds(view:android.view.View):Rect {
    val screen=IntArray(2);val window=IntArray(2);view.getLocationOnScreen(screen);view.getLocationInWindow(window)
    // Use the physical corners independently of transient ancestor crops.
    // publish() intersects them with the actual world surface itself.
    val corners=listOf(localToWindow(Offset.Zero),localToWindow(Offset(size.width.toFloat(),0f)),
        localToWindow(Offset(0f,size.height.toFloat())),localToWindow(Offset(size.width.toFloat(),size.height.toFloat())))
    return Rect(corners.minOf{it.x},corners.minOf{it.y},corners.maxOf{it.x},corners.maxOf{it.y})
        .translate(Offset((screen[0]-window[0]).toFloat(),(screen[1]-window[1]).toFloat()))
}
