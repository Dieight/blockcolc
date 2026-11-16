package com.blockcolc.world

/** Maps an equally scaled camera window into one fixed Surface buffer. The
 * Filament shift API takes half of the final NDC translation. Picking uses
 * the same window, so a visual move never changes the selected world ray. */
data class NativeViewportWindow(val bufferHeight:Int,val top:Int,val height:Int) {
    init{require(bufferHeight>0&&height>0&&top>=0&&top+height<=bufferHeight)}
    val scaleY:Double get()=height.toDouble()/bufferHeight
    val shiftY:Double get()=(bufferHeight-height-2.0*top)/(2.0*bufferHeight)
    fun localY(screenY:Double)=screenY-top
    fun screenY(localY:Double)=localY+top
    companion object {
        /** Surface and Compose measurements can arrive on adjacent frames
         * during rotation. Admit only their bounded common rectangle. */
        fun clamped(bufferHeight:Int,top:Int,height:Int):NativeViewportWindow {
            val h=height.coerceIn(1,bufferHeight.coerceAtLeast(1))
            return NativeViewportWindow(bufferHeight.coerceAtLeast(1),top.coerceIn(0,bufferHeight.coerceAtLeast(1)-h),h)
        }
    }
}
