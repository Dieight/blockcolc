package com.blockcolc.world.filament

import com.blockcolc.world.AtlasFrame
import com.blockcolc.world.AtlasSequence
import com.blockcolc.world.AtlasTimeline
import com.blockcolc.world.NativePixelTexture
import com.blockcolc.world.SourceAtlas
import java.nio.ByteBuffer
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShadowAtlasMaskTest {
    @Test fun rgbAnimationKeepsADepthInvariantTileInTheStaticMap() {
        val mask = ShadowAtlasMask(timeline())
        val atlasPixels = texture(255, 255, 0, 255)

        assertFalse(mask.varies(0, atlas, atlasPixels))
        assertTrue(mask.varies(2, atlas, atlasPixels))
    }

    @Test fun alphaAnimationAndUnknownFramePixelsKeepLiveShadows() {
        val mask = ShadowAtlasMask(timeline(interpolate = true))
        val atlasPixels = texture(255, 0, 255, 255)

        assertTrue(mask.varies(0, atlas, atlasPixels))
        assertFalse(mask.varies(1, atlas, atlasPixels))
        assertTrue(mask.varies(2, atlas, null))
    }

    private val atlas = SourceAtlas(true, listOf(4f, 1f), 4f, 1f, 1, 2, listOf(4f, 1f))

    private fun timeline(interpolate: Boolean = false) = AtlasTimeline("test", 1, 2, 4, 1, 4, listOf(
        AtlasSequence(0, 2, interpolate, listOf(AtlasFrame(0, 1), AtlasFrame(1, 1))),
        AtlasSequence(2, 2, false, listOf(AtlasFrame(2, 1), AtlasFrame(3, 1))),
    ), setOf(0, 2))

    private fun texture(vararg alpha: Int): NativePixelTexture {
        val pixels = ByteBuffer.allocate(4 * alpha.size)
        for ((index, value) in alpha.withIndex()) {
            pixels.put(index.toByte()).put(0).put(0).put(value.toByte())
        }
        pixels.flip()
        return NativePixelTexture(alpha.size, 1, pixels)
    }
}
