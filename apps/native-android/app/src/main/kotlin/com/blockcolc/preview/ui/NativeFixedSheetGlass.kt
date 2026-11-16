package com.blockcolc.preview.ui

import android.graphics.Canvas
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.Drawable
import android.os.Build
import android.view.WindowManager
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.window.DialogWindowProvider
import java.util.function.Consumer
import kotlin.math.roundToInt

internal val LocalNativeFixedBlur=staticCompositionLocalOf{false}

/** Android's window compositor blurs the current Activity behind this sheet.
 * It has no retained minimal-world bitmap, readback loop or second renderer. */
@Composable internal fun NativeFixedSheetGlass(modifier:Modifier=Modifier,blurBackground:Boolean=true,content:@Composable ()->Unit){
    val context=LocalContext.current;val view=LocalView.current;val density=LocalDensity.current.density
    val window=(view as? DialogWindowProvider)?.window
        ?:generateSequence(view.parent){it.parent}.filterIsInstance<DialogWindowProvider>().firstOrNull()?.window
    var supported by remember(window){mutableStateOf(false)}
    var top by remember(window){mutableIntStateOf(-1)}
    val background=remember(window){SheetWindowBackground(0)}
    val reduced=LocalNativeUi.current.reduceTransparency||!blurBackground
    DisposableEffect(window,reduced){
        if(Build.VERSION.SDK_INT>=31&&window!=null&&!reduced){
            val manager=context.getSystemService(WindowManager::class.java)
            val listener=Consumer<Boolean>{supported=it}
            manager.addCrossWindowBlurEnabledListener(context.mainExecutor,listener)
            onDispose{manager.removeCrossWindowBlurEnabledListener(listener)}
        }else{supported=false;onDispose{}}
    }
    DisposableEffect(window,supported,top>=0,density,reduced){
        if(Build.VERSION.SDK_INT>=31&&window!=null&&supported&&top>=0&&!reduced){
            val previous=window.decorView.background
            window.setBackgroundDrawable(background)
            window.setBackgroundBlurRadius((22*density).roundToInt())
            onDispose{window.setBackgroundBlurRadius(0);window.setBackgroundDrawable(previous)}
        }else onDispose{}
    }
    // The sheet moves every animation frame. Update its outline in place;
    // do not tear down and recreate cross-window blur for each new y position.
    SideEffect{if(background.moveTop(top.coerceAtLeast(0)))window?.decorView?.invalidateOutline()}
    CompositionLocalProvider(LocalNativeFixedBlur provides (supported&&top>=0&&!reduced)){
        Box(modifier.testTag(if(blurBackground)"fixed-sheet-glass"else"fixed-sheet-clear").onGloballyPositioned{coordinates->
            val location=IntArray(2);window?.decorView?.getLocationOnScreen(location)
            top=(coordinates.nativeScreenBounds(view).top-location[1]).roundToInt().coerceAtLeast(0)
        }){NativeGlass(55,Modifier.fillMaxWidth(),weatherEnabled=false,content=content)}
    }
}

/** Keep layout padding at zero. Platform background blur is window-scoped;
 * this drawable must not move the sheet while its reading surface animates. */
private class SheetWindowBackground(private var top:Int):Drawable(){
    private val paint=Paint().apply{color=0x01ffffff}
    fun moveTop(value:Int):Boolean{if(top==value)return false;top=value;invalidateSelf();return true}
    override fun draw(canvas:Canvas){canvas.drawRect(bounds.left.toFloat(),maxOf(bounds.top,top).toFloat(),bounds.right.toFloat(),bounds.bottom.toFloat(),paint)}
    override fun getOutline(outline:Outline){outline.setRect(bounds.left,maxOf(bounds.top,top),bounds.right,bounds.bottom);outline.alpha=1f}
    override fun getPadding(padding:Rect):Boolean{padding.set(0,0,0,0);return false}
    override fun setAlpha(alpha:Int){paint.alpha=alpha;invalidateSelf()}
    override fun setColorFilter(filter:android.graphics.ColorFilter?){paint.colorFilter=filter;invalidateSelf()}
    @Deprecated("Android Drawable opacity") override fun getOpacity():Int=PixelFormat.TRANSLUCENT
}
