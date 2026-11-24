package com.blockcolc.world.filament

import kotlin.math.roundToInt

/** Keep native UI/output sharp while applying the source world's pixel-ratio
 * budget to costly scene, bloom, and glass input attachments. */
data class SceneRenderSize(val width:Int,val height:Int) {
    companion object {
        fun forDisplay(width:Int,height:Int,density:Float,pixelRatioCap:Float,probe:Boolean=false):SceneRenderSize {
            require(width in 1..4096&&height in 1..4096)
            require(density.isFinite()&&density>0&&pixelRatioCap.isFinite()&&pixelRatioCap>0)
            val scale=if(probe)1f else minOf(1f,pixelRatioCap/density)
            return SceneRenderSize((width*scale).roundToInt().coerceAtLeast(1),(height*scale).roundToInt().coerceAtLeast(1))
        }
    }
}
