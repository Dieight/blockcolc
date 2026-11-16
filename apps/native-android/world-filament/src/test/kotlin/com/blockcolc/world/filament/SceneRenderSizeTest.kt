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
}
