package com.blockcolc.world.filament

import com.blockcolc.world.AtlasTimeline
import com.blockcolc.world.NativePixelTexture
import com.blockcolc.world.SourceAtlas
import java.nio.ByteBuffer

/** A cutout with a fixed alpha mask can use the static shadow pass even
 * when its RGB tiles animate. Only tiles reached by a caster are inspected. */
internal class ShadowAtlasMask(private val timeline: AtlasTimeline) {
    private val varying = mutableMapOf<Int, Boolean>()
    private var pixelsRemaining = 262_144L

    fun varies(index: Int, atlas: SourceAtlas, texture: NativePixelTexture?): Boolean {
        if (index !in timeline.active) return false
        return varying.getOrPut(index) {
            val sequence = timeline.sequences.firstOrNull { it.index == index } ?: return@getOrPut false
            val frames = sequence.frames.map { it.index }.distinct()
            if (frames.size < 2) return@getOrPut false
            // Large HD atlases retain their live shadow. Bound startup work
            // independently of a pack's texture resolution and frame count.
            val cost = atlas.cell.toLong() * atlas.cell.toLong() * frames.size
            if (texture == null || cost > pixelsRemaining) return@getOrPut true
            pixelsRemaining -= cost
            val pixels = texture.pixels()
            val first = alphaSignature(pixels, texture.width, atlas, frames.first())
            frames.drop(1).any { alphaSignature(pixels, texture.width, atlas, it) != first }
        }
    }

    private fun alphaSignature(pixels: ByteBuffer, width: Int, atlas: SourceAtlas, frame: Int): Long {
        val cell = atlas.cell.toInt()
        val columns = atlas.columns.toInt()
        val left = frame % columns * cell
        val top = frame / columns * cell
        // FNV-1a across the complete alpha cell, including its padded edges.
        var hash = -3750763034362895579L
        for (y in top until top + cell) {
            for (x in left until left + cell) {
                hash = (hash xor (pixels.get((y * width + x) * 4 + 3).toLong() and 255)) * 1099511628211L
            }
        }
        return hash
    }

}
