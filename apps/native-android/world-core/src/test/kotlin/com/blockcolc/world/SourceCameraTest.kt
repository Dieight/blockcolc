package com.blockcolc.world

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SourceCameraTest {
    private fun source()=SourceCamera.read(JSONObject("""{"schema":1,"framingRadius":200,"visibility":[[-1200,-3,-1200],[1200,26,1200]],
        "skyBaseRadius":360,"skyFarRatio":0.82,"starRadiusRatio":0.91,"starNearMargin":1.5,"sourceSkyRadius":360}"""))
    @Test fun lowPitchDoesNotScaleTheOldNearPlaneAndClipAwayTheSea() {
        val c=source();val low=c.frame(doubleArrayOf(712.0,87.0,712.0),1010.0)
        assertEquals(43.92,low.near,1e-8);assertEquals(360.0,low.skyRadius,1e-8)
        assertTrue(low.far>2700)
        val high=c.frame(doubleArrayOf(344.0,387.0,344.0),617.0)
        assertEquals(259.92,high.near,1e-8);assertTrue(high.skyRadius>360)
    }
    @Test fun insideVolumeAndLongDistanceRemainBoundedAndKeepStarsBehindNearPlane() {
        val c=source();assertEquals(.5,c.frame(doubleArrayOf(0.0,10.0,0.0),1000.0).near,0.0)
        assertEquals(.1,c.frame(doubleArrayOf(0.0,10.0,0.0),10.0).near,0.0)
        val far=c.frame(doubleArrayOf(10000.0,10000.0,10000.0),17000.0)
        assertTrue(far.skyRadius*c.starRadiusRatio>=far.near*c.starNearMargin-1e-8)
        assertTrue(far.skyRadius<=far.far*c.skyFarRatio)
    }
}
