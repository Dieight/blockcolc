package com.blockcolc.world

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class SourceLightingTest {
    private fun environment(): JSONObject = JSONObject("""{
      "schema":1,"colorSpace":"linear-srgb","outputColorSpace":"srgb","toneMapping":4,
      "exposure":1.12,"clearColor":[0.1,0.2,0.3],"clearAlpha":1,"shadow":{"enabled":true},"gaps":[],"lights":[
      {"type":"DirectionalLight","visible":true,"intensity":1.8,"color":[1,0.9,0.7],"position":[2,3,4],"direction":[0,-1,0],"castShadow":true,
        "shadow":{"bias":-0.0001,"near":0.1,"far":200.1}},
      {"type":"HemisphereLight","visible":true,"intensity":0.73,"color":[0.8,0.9,1],"groundColor":[0.2,0.3,0.4],"position":[0,1,0],"direction":[0,1,0]},
      {"type":"PointLight","visible":false,"intensity":3,"color":[1,1,1],"position":[1,2,3],"castShadow":false,"distance":12,"decay":2}]}
    """)
    @Test fun sourceValuesAreNotReplacedWithPhysicalDaylightDefaults() {
        val frame = SourceLighting.read(environment())
        assertEquals(1.12f, frame.exposure, 1e-6f)
        assertEquals(1.8f, frame.lights.first().intensity, 1e-6f)
        assertEquals(2, frame.lights.size)
        assertEquals(listOf("source-shadow-filter"),frame.pending)
        assertEquals(.02f,frame.lights.first().shadowBiasWorld,1e-6f)
    }
    @Test fun shadowDepthBiasIsConvertedByTheActualOrthographicRange() {
        assertEquals(.6572455f,SourceLighting.orthographicShadowBiasWorld(-.00035f,.1f,1877.9444f),1e-6f)
        assertEquals(0f,SourceLighting.orthographicShadowBiasWorld(0f,.1f,3000f),0f)
        assertThrows(IllegalArgumentException::class.java) { SourceLighting.orthographicShadowBiasWorld(.001f,.1f,100f) }
        assertThrows(IllegalArgumentException::class.java) { SourceLighting.orthographicShadowBiasWorld(-.001f,100f,10f) }
    }
    @Test fun hemispherePolynomialMatchesSourceInAllDirections() {
        val frame = SourceLighting.read(environment()); val sh = frame.hemisphereCoefficients()
        for (step in 0..100) {
            val y = -1.0 + step / 50.0
            for (channel in 0..2) {
                val light = frame.lights[1]
                val expected = (light.groundColor[channel] * (1-y) *.5 + light.color[channel] * (1+y) *.5) * light.intensity / PI
                assertEquals(expected, (sh[channel] + sh[3+channel] * y), 1e-7)
            }
        }
    }
    @Test fun rotatedAndMultipleHemispheresAccumulateRatherThanLoseTheirDirection() {
        val input = environment(); val original = input.getJSONArray("lights").getJSONObject(1)
        val second = JSONObject(original.toString()).put("direction", JSONArray("[1,0,0]"))
        input.getJSONArray("lights").put(second)
        val sh = SourceLighting.read(input).hemisphereCoefficients()
        for (channel in 0..2) {
            assertEquals(sh[3+channel], sh[9+channel], 1e-7f)
            assertEquals(0f, sh[6+channel], 0f)
        }
    }
    @Test fun newPipelinesInvalidNumbersAndUnsupportedLightsAreRefused() {
        val changes = listOf<(JSONObject)->Unit>(
            { it.put("toneMapping", 0) }, { it.put("exposure", "1.0") },
            { it.getJSONArray("gaps").put("unported") },
            { it.getJSONArray("lights").getJSONObject(0).put("direction",JSONArray("[0,0,0]")) },
            { it.getJSONArray("lights").getJSONObject(0).put("type","SpotLight") })
        for (change in changes) assertThrows(IllegalArgumentException::class.java) { SourceLighting.read(environment().also(change)) }
    }
    @Test fun linearFogUsesViewDepthAndSourceSmoothstepWithoutColorCoercion() {
        val input=environment().put("fog",JSONObject("""{"type":"linear","near":24,"far":60,"color":[0.1,0.2,0.3]}"""))
        val fog=SourceLighting.read(input).fog!!
        assertEquals(0f,fog.factor(0f),0f);assertEquals(0f,fog.factor(24f),0f)
        assertEquals(.5f,fog.factor(42f),0f);assertEquals(1f,fog.factor(60f),0f)
        for((key,value) in listOf("near" to 61,"far" to "60","type" to "exp2","color" to JSONArray("[1,-1,0]"))){
            val copy=JSONObject(input.toString());copy.getJSONObject("fog").put(key,value)
            assertThrows(IllegalArgumentException::class.java){SourceLighting.read(copy)}
        }
    }
}
