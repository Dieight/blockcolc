package com.blockcolc.preview.ui

import android.graphics.Canvas
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.Drawable
import android.os.Build
import android.view.WindowManager
import android.view.Window
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.window.DialogWindowProvider
import java.util.function.Consumer
import kotlin.math.roundToInt

internal val LocalNativeFixedBlur=staticCompositionLocalOf{false}
private const val DEFAULT_SHEET_DIM=.28f

/** Android's window compositor blurs the current Activity behind this sheet.
 * It has no retained minimal-world bitmap, readback loop or second renderer. */
@Composable internal fun NativeFixedSheetGlass(modifier:Modifier=Modifier,blurBackground:Boolean=true,content:@Composable ()->Unit){
    val context=LocalContext.current;val view=LocalView.current;val density=LocalDensity.current
    val window=(view as? DialogWindowProvider)?.window
        ?:generateSequence(view.parent){it.parent}.filterIsInstance<DialogWindowProvider>().firstOrNull()?.window
    var supported by remember(window){mutableStateOf(false)}
    var laidOut by remember(window){mutableStateOf(false)}
    val background=remember(window){SheetWindowBackground()}
    val blurAllowed=blurBackground&&!LocalNativeUi.current.reduceTransparency
    val bottomInset=WindowInsets.safeDrawing.getBottom(density)
    val normalRadius=(22*density.density).roundToInt()
    DisposableEffect(window){
        if(window!=null){
            // The modal owns this window. Leaving its system dim enabled
            // would keep the Activity dark after the drawable reaches zero.
            val dimFlag=WindowManager.LayoutParams.FLAG_DIM_BEHIND
            if((window.attributes.flags and dimFlag)!=0){
                background.absorbSystemDim(window.attributes.dimAmount)
                window.clearFlags(dimFlag)
            }
            window.setBackgroundDrawable(background)
            onDispose{
                background.place(window.decorView.height,0f)
                background.applyBlur(window,0)
            }
        }else onDispose{}
    }
    DisposableEffect(window,blurAllowed){
        if(Build.VERSION.SDK_INT>=31&&window!=null&&blurAllowed){
            val manager=context.getSystemService(WindowManager::class.java)
            val listener=Consumer<Boolean>{supported=it}
            manager.addCrossWindowBlurEnabledListener(context.mainExecutor,listener)
            onDispose{manager.removeCrossWindowBlurEnabledListener(listener)}
        }else{supported=false;onDispose{}}
    }
    val blurActive=supported&&laidOut&&blurAllowed
    SideEffect{background.applyBlur(window,if(blurActive)(normalRadius*background.reveal).roundToInt()else 0)}
    CompositionLocalProvider(LocalNativeFixedBlur provides blurActive){
        Box(modifier.testTag(if(blurBackground)"fixed-sheet-glass"else"fixed-sheet-clear").onGloballyPositioned{coordinates->
            val windowHeight=window?.decorView?.height?:return@onGloballyPositioned
            if(windowHeight<=0)return@onGloballyPositioned
            val top=coordinates.localToWindow(Offset.Zero).y.roundToInt().coerceIn(0,windowHeight)
            val revealed=(windowHeight-top).toFloat()/(coordinates.size.height+bottomInset).coerceAtLeast(1)
            if(background.place(top,revealed.coerceIn(0f,1f)))window.decorView.invalidateOutline()
            laidOut=true
            background.applyBlur(window,if(supported&&blurAllowed)(normalRadius*background.reveal).roundToInt()else 0)
        }){NativeGlass(55,Modifier.fillMaxWidth(),weatherEnabled=false,content=content)}
    }
}

/** Keep layout padding at zero. Platform background blur is window-scoped;
 * this drawable must not move the sheet while its reading surface animates. */
private class SheetWindowBackground:Drawable(){
    private var top=0
    var reveal=0f
        private set
    private var radius=0
    private var shadeOpacity=DEFAULT_SHEET_DIM
    private val tint=Paint().apply{color=0x01ffffff}
    private val shade=Paint().apply{color=android.graphics.Color.BLACK}
    fun absorbSystemDim(amount:Float){
        shadeOpacity=1f-(1f-DEFAULT_SHEET_DIM)*(1f-amount.coerceIn(0f,1f))
        invalidateSelf()
    }
    fun place(nextTop:Int,nextReveal:Float):Boolean{
        val moved=top!=nextTop
        if(moved||reveal!=nextReveal){
            top=nextTop
            reveal=nextReveal
            invalidateSelf()
        }
        return moved
    }
    fun applyBlur(window:Window?,nextRadius:Int){
        if(Build.VERSION.SDK_INT>=31&&window!=null&&radius!=nextRadius){
            window.setBackgroundBlurRadius(nextRadius)
            radius=nextRadius
        }
    }
    override fun draw(canvas:Canvas){
        shade.alpha=(reveal*shadeOpacity*255).roundToInt()
        canvas.drawRect(bounds,shade)
        canvas.drawRect(bounds.left.toFloat(),maxOf(bounds.top,top).toFloat(),bounds.right.toFloat(),bounds.bottom.toFloat(),tint)
    }
    override fun getOutline(outline:Outline){outline.setRect(bounds.left,maxOf(bounds.top,top),bounds.right,bounds.bottom);outline.alpha=1f}
    override fun getPadding(padding:Rect):Boolean{padding.set(0,0,0,0);return false}
    override fun setAlpha(alpha:Int){tint.alpha=alpha;invalidateSelf()}
    override fun setColorFilter(filter:android.graphics.ColorFilter?){tint.colorFilter=filter;invalidateSelf()}
    @Deprecated("Android Drawable opacity") override fun getOpacity():Int=PixelFormat.TRANSLUCENT
}
