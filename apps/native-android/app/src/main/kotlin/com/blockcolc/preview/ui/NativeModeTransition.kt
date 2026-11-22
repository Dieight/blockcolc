package com.blockcolc.preview.ui

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp

internal const val NORMAL_WORLD_FRACTION=.45f
internal const val WIDE_WORLD_FRACTION=.55f

internal fun minimalPanelWidth(available:Dp):Dp=
    (available*.34f).coerceIn(288.dp,330.dp).coerceAtMost(available*.54f)

internal fun minimalPanelHeight(available:Dp):Dp=
    (available*.34f).coerceIn(266.dp,304.dp).coerceAtMost(available*.85f)

internal data class NativeModeFrame(val world:ImageBitmap,val viewport:IntSize,val bottom:Int)

/** Hold only the outgoing world frame while the live surface changes size.
 * Its crop stays in screen coordinates for either side of a display cutout. */
@Composable internal fun NativeModeWorldCover(frame:NativeModeFrame?,opacity:State<Float>,background:Color,modifier:Modifier=Modifier){
    Canvas(modifier){
        val alpha=opacity.value
        if(alpha<=0f)return@Canvas
        drawRect(background,alpha=alpha)
        if(frame!=null){
            clipRect(right=minOf(size.width,frame.viewport.width.toFloat()),bottom=minOf(size.height,frame.bottom.toFloat())){
                drawImage(frame.world,dstSize=frame.viewport,alpha=alpha,filterQuality=FilterQuality.Low)
            }
        }
    }
}
