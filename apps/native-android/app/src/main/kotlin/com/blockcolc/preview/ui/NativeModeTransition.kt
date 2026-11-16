package com.blockcolc.preview.ui

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlin.math.roundToInt

/** Last submitted world frame plus the UI layer recorded in that layout.
 * World crops translate as a whole: no per-axis scaling and no scene rebuild. */
internal data class NativeModeFrame(val world:ImageBitmap,val ui:ImageBitmap,val width:Int,val height:Int,val worldBottom:Int,val panelTop:Int,val navigationTop:Int,val worldWidth:Int=width)
internal data class NativeModeFrames(val source:NativeModeFrame,val target:NativeModeFrame?=null,val entering:Boolean)

internal const val NORMAL_WORLD_FRACTION=.45f
internal const val WIDE_WORLD_FRACTION=.55f

@Composable internal fun NativeModeCover(frames:NativeModeFrames,progress:Float,background:Color,modifier:Modifier=Modifier){
    Canvas(modifier){
        drawRect(background)
        val from=frames.source;val to=frames.target
        if(to==null){world(from,0f,1f);region(from,from.panelTop,from.height,0f,1f);return@Canvas}
        if(from.worldWidth!=from.width||to.worldWidth!=to.width){
            // Wide workbenches dock at the side. Blend complete, correctly
            // sized layers rather than stretching a half-width world frame.
            val p=progress.coerceIn(0f,1f)
            world(to,0f,1f);world(from,0f,1-p)
            region(from,0,from.height,0f,1-p);region(to,0,to.height,0f,p)
            return@Canvas
        }
        val p=progress.coerceIn(0f,1f);val dy=(to.worldBottom-from.worldBottom)/2f
        val edge=from.worldBottom+(to.worldBottom-from.worldBottom)*p
        clipRect(bottom=edge){
            world(to,dy*(p-1),1f)
            val alpha=if(frames.entering)(1-p/.36f).coerceIn(0f,1f)else (1-(p-.6f)/.4f).coerceIn(0f,1f)
            world(from,dy*p,alpha)
        }
        if(frames.entering){
            val shift=(to.worldBottom-from.worldBottom).coerceAtLeast(24)
            region(from,from.panelTop,from.navigationTop,shift*p,(1-p/.7f).coerceIn(0f,1f))
            region(to,to.panelTop,to.navigationTop,24f*(1-p),((p-.5f)/.5f).coerceIn(0f,1f))
        }else{
            val shift=(from.worldBottom-to.worldBottom).coerceAtLeast(24)
            region(from,from.panelTop,from.navigationTop,20f*p,(1-p/.45f).coerceIn(0f,1f))
            region(to,to.panelTop,to.navigationTop,shift*(1-p),((p-.35f)/.65f).coerceIn(0f,1f))
        }
        region(from,from.navigationTop,from.height,0f,(1-p/.32f).coerceIn(0f,1f))
        region(to,to.navigationTop,to.height,0f,((p-.66f)/.34f).coerceIn(0f,1f))
    }
}
private fun DrawScope.world(frame:NativeModeFrame,shift:Float,alpha:Float){
    bitmapRegion(frame.world,frame,0,frame.worldBottom,shift,alpha,frame.worldWidth)
}
private fun DrawScope.region(frame:NativeModeFrame,top:Int,bottom:Int,shift:Float,alpha:Float){
    bitmapRegion(frame.ui,frame,top,bottom,shift,alpha)
}
private fun DrawScope.bitmapRegion(bitmap:ImageBitmap,frame:NativeModeFrame,top:Int,bottom:Int,shift:Float,alpha:Float,width:Int=frame.width){
    if(bottom<=top||alpha<=0)return
    val y0=(top.toFloat()/frame.height*bitmap.height).roundToInt().coerceIn(0,bitmap.height)
    val y1=(bottom.toFloat()/frame.height*bitmap.height).roundToInt().coerceIn(y0,bitmap.height)
    if(y1==y0)return
    // A system-bar height change must not stretch the captured world/text.
    // Width stays fixed through this transition; rotation cancels the cover.
    val scale=size.width/frame.width
    drawImage(bitmap,srcOffset=IntOffset(0,y0),srcSize=IntSize(bitmap.width,y1-y0),
        dstOffset=IntOffset(0,((top+shift)*scale).roundToInt()),dstSize=IntSize((width*scale).roundToInt().coerceAtLeast(1),((bottom-top)*scale).roundToInt().coerceAtLeast(1)),
        alpha=alpha,filterQuality=FilterQuality.Low)
}
