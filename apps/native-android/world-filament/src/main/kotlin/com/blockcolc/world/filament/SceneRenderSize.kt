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
        const val PIXEL_CELL_DP=4f
    }
}

/** Pad a raster to whole physical cells, then crop only its outer edges.
 * The camera and both output paths use this same screen-to-raster transform. */
internal data class PixelGrid(val width: Int, val height: Int, val cell: Int) {
    init { require(width in 1..4096 && height in 1..4096 && cell in 1..4096) }

    val raster = SceneRenderSize((width + cell - 1) / cell, (height + cell - 1) / cell)
    private val paddedWidth = raster.width * cell
    private val paddedHeight = raster.height * cell
    val scaleX = width.toDouble() / paddedWidth
    val scaleY = height.toDouble() / paddedHeight
    val offsetX = ((paddedWidth - width) / 2).toDouble() / paddedWidth
    val offsetY = ((paddedHeight - height) / 2).toDouble() / paddedHeight
    val shiftX get() = offsetX + (scaleX - 1.0) / 2.0
    val shiftY get() = offsetY + (scaleY - 1.0) / 2.0

    companion object {
        fun forDisplay(width: Int, height: Int, density: Float, cellDp: Float): PixelGrid {
            require(density.isFinite() && density > 0 && cellDp.isFinite() && cellDp > 0)
            return PixelGrid(width, height, (density * cellDp).roundToInt().coerceIn(1, 4096))
        }
    }
}
