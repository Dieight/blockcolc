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
        /** Pixel style: one scene pixel per [cellDp], shown with nearest sampling,
         * so the blocks keep the same physical size on every display density. */
        const val PIXEL_CELL_DP=4f
        fun forPixels(width:Int,height:Int,density:Float,cellDp:Float=PIXEL_CELL_DP):SceneRenderSize {
            require(width in 1..4096&&height in 1..4096)
            require(density.isFinite()&&density>0&&cellDp.isFinite()&&cellDp>0)
            val cell=(cellDp*density).coerceAtLeast(1f)
            return SceneRenderSize(kotlin.math.ceil(width/cell).toInt().coerceAtLeast(1),kotlin.math.ceil(height/cell).toInt().coerceAtLeast(1))
        }
    }
}
