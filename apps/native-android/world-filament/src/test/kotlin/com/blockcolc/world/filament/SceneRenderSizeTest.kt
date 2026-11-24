package com.blockcolc.world.filament

import org.junit.Assert.*
import org.junit.Test

class SceneRenderSizeTest {
    @Test fun densePhonesUseTheSourceWorldBudgetWithoutChangingDisplayGeometry(){
        val actual=SceneRenderSize.forDisplay(1440,3200,3.5f,2f)
        assertEquals(SceneRenderSize(823,1829),actual)
        assertTrue(actual.width.toDouble()*actual.height<1440.0*3200/2)
        assertEquals(1440.0/3200,actual.width.toDouble()/actual.height,.001)
    }
    @Test fun lowerDensityAndExactColourProbesKeepTheirOriginalPixelGrid(){
        assertEquals(SceneRenderSize(720,960),SceneRenderSize.forDisplay(720,960,1f,2f))
        assertEquals(SceneRenderSize(1440,3200),SceneRenderSize.forDisplay(1440,3200,3.5f,2f,true))
        assertEquals(SceneRenderSize(1,1),SceneRenderSize.forDisplay(1,1,4f,1.25f))
    }
    @Test fun pixelStyleKeepsFourDpBlocksOnEveryDensity(){
        // 1080 x 2400 at 2.75x is 393 x 873 dp: about 98 x 218 blocks.
        assertEquals(SceneRenderSize(99,219),SceneRenderSize.forPixels(1080,2400,2.75f))
        // The same phone width in dp gives the same block count at 3x.
        assertEquals(SceneRenderSize(90,200),SceneRenderSize.forPixels(1080,2400,3f))
        assertEquals(SceneRenderSize(90,200),SceneRenderSize.forPixels(720,1600,2f))
        // A wider cell for tuning; never fewer than one scene pixel.
        assertEquals(SceneRenderSize(72,160),SceneRenderSize.forPixels(1080,2400,3f,cellDp=5f))
        assertEquals(SceneRenderSize(1,1),SceneRenderSize.forPixels(1,1,.5f,cellDp=.5f))
        val pixel=SceneRenderSize.forPixels(1080,2400,2.75f);val paper=SceneRenderSize.forDisplay(1080,2400,2.75f,1.5f)
        assertTrue(pixel.width*pixel.height*30<paper.width*paper.height)
    }
}
