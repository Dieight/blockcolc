package com.blockcolc.world

import org.junit.Assert.*
import org.junit.Test

class NativeViewportWindowTest {
    @Test fun fixedBufferProjectionAndPickingAgreeAcrossNormalImmersiveAndLandscapeWindows(){
        for(window in listOf(NativeViewportWindow(2400,144,800),NativeViewportWindow(2400,0,2400),NativeViewportWindow(1080,48,320))){
            for(ndc in listOf(-1.0,-.5,0.0,.5,1.0)){
                // Independent clip-space -> physical pixel equation. A point
                // at the camera centre must land in the measured visible band.
                val clipY=ndc*window.scaleY+2*window.shiftY
                val pixel=(1-clipY)*window.bufferHeight/2
                val expected=window.top+(1-ndc)*window.height/2
                assertEquals(expected,pixel,1e-8)
                assertEquals((1-ndc)*window.height/2,window.localY(pixel),1e-8)
                assertEquals(pixel,window.screenY(window.localY(pixel)),1e-8)
            }
            val width=1080.0;val aspect=width/window.height
            // Horizontal and vertical magnification are equal; no squeezed
            // world is hidden behind a correct-looking clipping rectangle.
            assertEquals(width/aspect,window.bufferHeight*window.scaleY,1e-8)
        }
    }
    @Test fun adjacentRotationMeasurementsStayInBoundsAndFullWindowIsIdentity(){
        val rotated=NativeViewportWindow.clamped(400,120,900)
        assertEquals(400,rotated.height);assertEquals(0,rotated.top)
        val full=NativeViewportWindow(900,0,900)
        assertEquals(1.0,full.scaleY,0.0);assertEquals(0.0,full.shiftY,0.0)
        assertThrows(IllegalArgumentException::class.java){NativeViewportWindow(900,100,900)}
    }
}
