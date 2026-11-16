package com.blockcolc.world

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SourcePostTest {
    private fun input()=JSONObject("""{"bloom":{"enabled":true,"scale":0.5,"sampleCount":2,"threshold":0.72,"softKnee":0.22,"strength":0.32},
      "worldColor":{"saturation":100,"brightness":100,"contrast":100}}""")
    @Test fun sourceBloomParametersAndSampleCountAreNotEngineDefaults(){
        val p=SourcePost.read(input());assertTrue(p.bloom);assertEquals(.32f,p.strength,0f);assertEquals(2,p.samples)
        assertEquals(.72f,p.threshold,0f);assertEquals(.22f,p.knee,0f)
    }
    @Test fun disabledSourceStillValidatesAllParameters(){
        assertFalse(SourcePost.read(input().also{it.getJSONObject("bloom").put("enabled",false)}).bloom)
        for((key,value) in listOf("enabled" to "true","scale" to 1,"sampleCount" to 1,"sampleCount" to 2.5,
            "threshold" to -1,"softKnee" to "0.2","strength" to 1.1)){
            val p=input();p.getJSONObject("bloom").put(key,value)
            assertThrows(IllegalArgumentException::class.java){SourcePost.read(p)}
        }
    }
    @Test fun nonNeutralWorldColorIsRetainedAndMalformedOrUnboundedValuesAreRejected(){
        val valid=input();valid.getJSONObject("worldColor").put("saturation",90).put("brightness",110).put("contrast",105)
        assertEquals(SourceWorldColor(90,110,105),SourcePost.read(valid).worldColor)
        for((key,value) in listOf("saturation" to 49,"brightness" to "100","contrast" to 121,"saturation" to 90.5)){
            val p=input();p.getJSONObject("worldColor").put(key,value)
            assertThrows(IllegalArgumentException::class.java){SourcePost.read(p)}
        }
    }
    @Test fun nativeQualityUsesTheFormalBloomThresholdsAndWorldColorDoesNotAlterItsShape(){
        assertEquals(SourcePost.NONE.copy(direct=true,samples=4),SourcePost.native(NativeLightingQuality.LOW));assertEquals(SourcePost.NONE.copy(direct=true,samples=4),SourcePost.native(NativeLightingQuality.BALANCED))
        assertEquals(SourcePost(true,.72f,.22f,.32f,2),SourcePost.native(NativeLightingQuality.HIGH))
        assertEquals(4,SourcePost.native(NativeLightingQuality.LOW).sceneSamples);assertEquals(4,SourcePost.native(NativeLightingQuality.BALANCED).sceneSamples)
        assertEquals(2,SourcePost.native(NativeLightingQuality.HIGH).sceneSamples);assertEquals(1,SourcePost.NONE.sceneSamples)
        assertThrows(IllegalArgumentException::class.java){SourcePost(true,Float.NaN,.2f,.3f,2)}
        assertThrows(IllegalArgumentException::class.java){SourcePost(true,.7f,.2f,.3f,1)}
        assertThrows(IllegalArgumentException::class.java){SourcePost(true,.7f,.2f,.3f,2,direct=true)}
    }
}
