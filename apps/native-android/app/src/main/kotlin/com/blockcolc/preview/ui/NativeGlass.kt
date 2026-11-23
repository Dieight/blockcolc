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
import com.blockcolc.presentation.GlassReadability
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
    internal var presentedWindow by mutableStateOf<NativePresentedWindow?>(null)
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
        val scale=min(1f,960f/max(bounds.width,bounds.height))
        val bitmap=Bitmap.createBitmap(max(1,(bounds.width*scale).roundToInt()),max(1,(bounds.height*scale).roundToInt()),Bitmap.Config.ARGB_8888)
        val accepted=view.copyBackdrop(bitmap,main){success->if(continuation.isActive)continuation.resume(if(success)bitmap else null)}
        if(!accepted&&continuation.isActive)continuation.resume(null)
    }
    /** Average sRGB colour of the presented, already blurred world under
     * [region] (screen coordinates), from a copy 24 pixels wide. Used only to
     * choose text ink at a slow cadence; never a glass feed or a frame. */
    suspend fun sampleColor(region:Rect):FloatArray?=kotlinx.coroutines.suspendCancellableCoroutine{continuation->
        val view=source
        val area=region.intersect(bounds)
        if(closed||view==null||bounds.width<=0||bounds.height<=0||area.width<1f||area.height<1f||Build.VERSION.SDK_INT<24){continuation.resume(null);return@suspendCancellableCoroutine}
        val width=24;val height=max(1,(width*bounds.height/bounds.width).roundToInt())
        val bitmap=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888)
        val accepted=view.copyBackdrop(bitmap,main){success->
            val result=if(!success||!continuation.isActive)null else{
                val left=((area.left-bounds.left)/bounds.width*width).toInt().coerceIn(0,width-1)
                val right=((area.right-bounds.left)/bounds.width*width).roundToInt().coerceIn(left+1,width)
                val top=((area.top-bounds.top)/bounds.height*height).toInt().coerceIn(0,height-1)
                val bottom=((area.bottom-bounds.top)/bounds.height*height).roundToInt().coerceIn(top+1,height)
                var red=0f;var green=0f;var blue=0f;var count=0
                for(y in top until bottom)for(x in left until right){val pixel=bitmap.getPixel(x,y)
                    red+=(pixel shr 16 and 255)/255f;green+=(pixel shr 8 and 255)/255f;blue+=(pixel and 255)/255f;count++}
                if(count==0)null else floatArrayOf(red/count,green/count,blue/count)
            }
            bitmap.recycle()
            if(continuation.isActive)continuation.resume(result)
        }
        if(!accepted){bitmap.recycle();continuation.resume(null)}
    }
    override fun close(){if(closed)return;closed=true;source?.glassRegions(emptyList());source=null;panels.clear();sent=emptyList()}
}
internal data class NativePresentedWindow(val width:Int,val height:Int,val top:Int)

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
    val worldBacked=sampling&&backdrop?.ready==true
    val themeLight=dark||worldBacked&&com.blockcolc.world.NativeGlassMaterial.usesLightInk(transparency,dark,night)
    // On clear glass the scene, not the theme, decides which ink reads. The
    // glass itself stays clear: only the ink and a glyph halo adapt.
    val probing=worldBacked&&material.tintAlpha<GLASS_PROBE_TINT
    var measuredLight by remember{mutableStateOf<Boolean?>(null)}
    val currentBounds by rememberUpdatedState(panelBounds)
    LaunchedEffect(probing,material,dark,themeLight,backdrop){
        val source=backdrop?.takeIf{probing}
        if(source==null){measuredLight=null;return@LaunchedEffect}
        val surface=doubleArrayOf(colors.surface.red.toDouble(),colors.surface.green.toDouble(),colors.surface.blue.toDouble())
        kotlinx.coroutines.delay(GLASS_PROBE_FIRST_MS)
        while(true){
            source.sampleColor(currentBounds)?.let{scene->
                val background=GlassReadability.backgroundLuminance(doubleArrayOf(scene[0].toDouble(),scene[1].toDouble(),scene[2].toDouble()),surface,material.tintAlpha.toDouble())
                measuredLight=GlassReadability.lightInk(background,measuredLight?:themeLight)
            }
            kotlinx.coroutines.delay(GLASS_PROBE_INTERVAL_MS)
        }
    }
    val light=if(probing)measuredLight?:themeLight else themeLight
    val ink=if(light)Color.White else Color.Black
    val haloRadius=with(androidx.compose.ui.platform.LocalDensity.current){4.dp.toPx()}
    val halo=if(worldBacked)Shadow(if(light)Color.Black.copy(alpha=.55f)else Color.White.copy(alpha=.72f),Offset.Zero,haloRadius)else null
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
        val typography=MaterialTheme.typography
        CompositionLocalProvider(LocalContentColor provides ink){
            MaterialTheme(colorScheme=colors.withGlassInk(ink),typography=if(halo==null)typography else typography.withHalo(halo)){content()}
        }
    }
}

/** Above this coating the theme ink already reads; below it the scene decides. */
private const val GLASS_PROBE_TINT=.5f
private const val GLASS_PROBE_FIRST_MS=600L
private const val GLASS_PROBE_INTERVAL_MS=4000L

/** A soft opposite-ink glow behind every glyph on world-backed glass. */
internal fun Typography.withHalo(halo:Shadow)=copy(
    displayLarge=displayLarge.copy(shadow=halo),displayMedium=displayMedium.copy(shadow=halo),displaySmall=displaySmall.copy(shadow=halo),
    headlineLarge=headlineLarge.copy(shadow=halo),headlineMedium=headlineMedium.copy(shadow=halo),headlineSmall=headlineSmall.copy(shadow=halo),
    titleLarge=titleLarge.copy(shadow=halo),titleMedium=titleMedium.copy(shadow=halo),titleSmall=titleSmall.copy(shadow=halo),
    bodyLarge=bodyLarge.copy(shadow=halo),bodyMedium=bodyMedium.copy(shadow=halo),bodySmall=bodySmall.copy(shadow=halo),
    labelLarge=labelLarge.copy(shadow=halo),labelMedium=labelMedium.copy(shadow=halo),labelSmall=labelSmall.copy(shadow=halo))

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
