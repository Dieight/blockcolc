package com.blockcolc.preview.world

import org.junit.Assert.*
import org.junit.Test

class NativeQualitySelectionTest {
    @Test fun pixelSharesThePaperSceneAndOtherTiersKeepTheirOwn(){
        assertEquals("paper",nativeSceneQuality("pixel"))
        for(tier in listOf("paper","performance","balanced","cinematic"))assertEquals(tier,nativeSceneQuality(tier))
    }
    @Test fun deviceOnlyStylesTravelAsPerformanceAndSurviveTheRoundTrip(){
        assertEquals("performance",cloudLightingQuality("pixel"))
        assertEquals("performance",cloudLightingQuality("paper"))
        assertEquals("balanced",cloudLightingQuality("balanced"))
        assertEquals("pixel",adoptedLightingQuality("pixel","performance"))
        assertEquals("paper",adoptedLightingQuality("paper","performance"))
        // A real change made on another device still wins.
        assertEquals("cinematic",adoptedLightingQuality("pixel","cinematic"))
        assertEquals("performance",adoptedLightingQuality("balanced","performance"))
    }
    @Test fun automaticChoiceNeverPicksThePixelStyle(){
        val weakest=WorldDeviceCapabilities(lowRam=true,ramMiB=1024,glesVersion=0x20000,vulkanLevelOne=false,mediaPerformanceClass=0)
        assertEquals("paper",automaticQuality(weakest))
    }
}
