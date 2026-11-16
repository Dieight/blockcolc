package com.blockcolc.preview.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.*
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.blockcolc.presentation.ClientPreferences
import com.blockcolc.presentation.UiResources
import com.blockcolc.preview.R

data class NativeUi(val resources:UiResources,val language:String,val reduceMotion:Boolean,val reduceTransparency:Boolean){
    fun text(key:String,vararg values:Any?)=resources.text(language,key,*values)
}
val LocalNativeUi=compositionLocalOf<NativeUi>{error("Native UI theme is missing")}

/** Same semantic roles and font source as the formal UI, not a redesign. The
 * host supplies accessibility/capability fallbacks independently of theme. */
internal class NativeSystemBarPolicy {var immersive by mutableStateOf(false)}
internal val LocalNativeSystemBarPolicy=staticCompositionLocalOf<NativeSystemBarPolicy?>{null}

@Composable fun NativeTheme(preferences:ClientPreferences,resources:UiResources,reduceMotion:Boolean=false,reduceTransparency:Boolean=false,content:@Composable ()->Unit){
    val context=androidx.compose.ui.platform.LocalContext.current
    fun systemMotion()=runCatching{if(android.os.Build.VERSION.SDK_INT>=26)android.animation.ValueAnimator.areAnimatorsEnabled() else android.provider.Settings.Global.getFloat(context.contentResolver,android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,1f)>0f}.getOrDefault(false)
    var animations by remember(context){mutableStateOf(systemMotion())}
    DisposableEffect(context){val observer=object:android.database.ContentObserver(android.os.Handler(android.os.Looper.getMainLooper())){override fun onChange(selfChange:Boolean){animations=systemMotion()}}
        context.contentResolver.registerContentObserver(android.provider.Settings.Global.getUriFor(android.provider.Settings.Global.ANIMATOR_DURATION_SCALE),false,observer)
        onDispose{context.contentResolver.unregisterContentObserver(observer)}}
    val dark=when(preferences.themeMode){"dark"->true;"light"->false;else->isSystemInDarkTheme()}
    val pixel=remember{FontFamily(Font(R.font.fusion_pixel_12px_zh_hans,FontWeight.Normal))}
    val typography=remember(pixel,preferences.fontStyle){
        fun style(size:Int,line:Int,weight:FontWeight=FontWeight.Normal,accent:Boolean=false):TextStyle {
            val usePixel=preferences.fontStyle=="pixel"||preferences.fontStyle=="mixed"&&accent
            return TextStyle(fontFamily=if(usePixel)pixel else FontFamily.Default,fontSize=size.sp,lineHeight=line.sp,letterSpacing=0.sp,platformStyle=androidx.compose.ui.text.PlatformTextStyle(includeFontPadding=false),
                fontWeight=if(usePixel)FontWeight.Normal else weight,fontSynthesis=if(usePixel)FontSynthesis.None else FontSynthesis.All)
        }
        Typography(displayLarge=style(64,68,accent=true),displayMedium=style(48,52,accent=true),displaySmall=style(32,40,accent=true),
            headlineLarge=style(24,32,FontWeight.Medium),headlineMedium=style(24,32,FontWeight.Medium),headlineSmall=style(24,32,FontWeight.Medium),
            titleLarge=style(24,32,FontWeight.Medium),titleMedium=style(18,24,FontWeight.Medium),titleSmall=style(18,24,FontWeight.Medium),
            bodyLarge=style(16,24),bodyMedium=style(16,24),bodySmall=style(12,18),labelLarge=style(16,24,accent=true),labelMedium=style(12,18,accent=true),labelSmall=style(12,18,accent=true))
    }
    val colors=if(dark)NativePalette.dark else NativePalette.light
    val rectangle=RoundedCornerShape(0.dp)
    val barPolicy=remember{NativeSystemBarPolicy()}
    CompositionLocalProvider(LocalNativeUi provides NativeUi(resources,preferences.language,reduceMotion||!animations,reduceTransparency),LocalContentColor provides colors.onBackground,LocalNativeSystemBarPolicy provides barPolicy){
        MaterialTheme(colorScheme=colors,typography=typography,shapes=Shapes(rectangle,rectangle,rectangle,rectangle,rectangle)){
            NativeWindowAppearance();content()
        }
    }
}

/** Explicit app theme also owns system-bar ink, including a modal's separate
 * window. Following only the device theme is wrong for manual Light/Dark. */
@Composable internal fun NativeWindowAppearance(){
    val view=LocalView.current
    if(view.isInEditMode)return
    val dialogWindow=(view as? DialogWindowProvider)?.window
        ?:generateSequence(view.parent){it.parent}.filterIsInstance<DialogWindowProvider>().firstOrNull()?.window
    val window=dialogWindow?:generateSequence(view.context){(it as? android.content.ContextWrapper)?.baseContext}.filterIsInstance<android.app.Activity>().firstOrNull()?.window
        ?:return
    val immersive=LocalNativeSystemBarPolicy.current?.immersive
    val darkInk=MaterialTheme.colorScheme.onBackground.luminance()<.5f
    SideEffect{WindowCompat.getInsetsController(window,window.decorView).apply{
        isAppearanceLightStatusBars=darkInk;isAppearanceLightNavigationBars=darkInk
        if(dialogWindow!=null&&immersive!=null){
            systemBarsBehavior=androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            if(immersive)hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())else show(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        }
    }}
}

/** The timer world may extend behind the status bar; ordinary navigation still
 * keeps its system affordances. Only an immersive session hides both bars. */
@Composable internal fun NativeSystemBars(immersive:Boolean){
    val view=LocalView.current
    val policy=LocalNativeSystemBarPolicy.current
    SideEffect{policy?.immersive=immersive}
    val activity=remember(view){generateSequence(view.context){(it as? android.content.ContextWrapper)?.baseContext}.filterIsInstance<android.app.Activity>().firstOrNull()}
    DisposableEffect(activity,immersive){
        val window=activity?.window
        if(window!=null){
            WindowCompat.setDecorFitsSystemWindows(window,false)
            @Suppress("DEPRECATION")
            window.statusBarColor=android.graphics.Color.TRANSPARENT
            @Suppress("DEPRECATION")
            window.navigationBarColor=android.graphics.Color.TRANSPARENT
            WindowCompat.getInsetsController(window,window.decorView).apply{
                systemBarsBehavior=androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                if(immersive)hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
                else show(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            }
        }
        onDispose{if(window!=null)WindowCompat.getInsetsController(window,window.decorView).show(androidx.core.view.WindowInsetsCompat.Type.systemBars())}
    }
}
