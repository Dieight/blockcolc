package com.blockcolc.world

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SurfaceOpticsTest {
    private fun uniforms()=JSONObject(javaClass.getResource("/reviewed-program.json")!!.readText()).getJSONObject("uniforms")
    @Test fun sourceNightUniformsAreValidatedWithoutCoercion() {
        val night=NightField.read(uniforms());assertEquals(0f,night.stars,0f);assertEquals(-1f,night.meteor,0f)
        for((key,value) in listOf("bcSkyStars" to 1.1,"bcSkyDensity" to "1","bcSkyTime" to -1,
            "bcSkyMeteor" to 2,"bcSkyReflectionGain" to 9,"bcSkyGalaxyNormal" to JSONArray("[0,0,0]"),
            "bcSkyColdDirection" to JSONArray("[1,0]"))) {
            assertThrows(IllegalArgumentException::class.java){NightField.read(uniforms().put(key,value))}
        }
    }
    @Test fun skyHasNoReflectionGainAndMoonPhaseKeepsSourceOrientation(){
        val raw=uniforms();raw.remove("bcSkyReflectionGain");assertEquals(1f,NightField.read(raw,false).gain,0f)
        val moon=JSONObject("""{"uMoonIllumination":0.25,"uMoonWaxing":-1,"uMoonBrightLimbAngle":1.4}""")
        assertEquals(.25f,MoonPhase.read(moon).illumination,0f);assertEquals(-1f,MoonPhase.read(moon).waxing,0f)
        assertThrows(IllegalArgumentException::class.java){MoonPhase.read(JSONObject(moon.toString()).put("uMoonIllumination",2))}
    }
    @Test fun cloudyWaterSuppressesSpecularWithoutChangingOtherMaterials() {
        assertEquals(.34f,SurfaceOptics.NONE.roughness(.34f),1e-6f)
        assertEquals(.05f,SurfaceOptics.NONE.metallic(.05f),1e-6f)
        assertEquals(1f,SurfaceOptics(clearSky=0f).roughness(.34f),0f)
        assertEquals(0f,SurfaceOptics(clearSky=0f).metallic(.05f),0f)
        assertEquals(.67f,SurfaceOptics(clearSky=.5f).roughness(.34f),1e-6f)
        assertEquals(.025f,SurfaceOptics(clearSky=.5f).metallic(.05f),1e-6f)
    }
    @Test fun distanceOpacityKeepsNearWaterClearAndFarWaterOpaque() {
        val optics=SurfaceOptics(distanceOpacity=true)
        assertEquals(.7f,optics.opacity(.7f,0f),0f);assertEquals(.7f,optics.opacity(.7f,24f),0f)
        assertEquals(.85f,optics.opacity(.7f,42f),1e-6f);assertEquals(1f,optics.opacity(.7f,60f),0f)
        assertEquals(1f,optics.opacity(.7f,100f),0f);assertEquals(.7f,SurfaceOptics.NONE.opacity(.7f,100f),0f)
    }
    @Test fun packedCornersDisplaceOnlyActiveUpperVertices() {
        val corners=63+(42 shl 6)+(21 shl 12)
        assertEquals(.5f,FluidSurface.positionY(-.5f,.5f,-.5f,1000001,corners),0f)
        assertEquals(42/63f-.5f,FluidSurface.positionY(.5f,.5f,-.5f,1000001,corners),0f)
        assertEquals(21/63f-.5f,FluidSurface.positionY(.5f,.5f,.5f,1000001,corners),0f)
        assertEquals(-.5f,FluidSurface.positionY(-.5f,.5f,.5f,1000001,corners),0f)
        assertEquals(-.5f,FluidSurface.positionY(.5f,-.5f,.5f,1000001,corners),0f)
        assertEquals(.5f,FluidSurface.positionY(.5f,.5f,.5f,0,corners),0f)
    }
    @Test fun flowingUvPreservesFourCornersAndAnglePeriod() {
        val active=1000000+32768
        val expected=listOf(listOf(.25f,.25f),listOf(.75f,.25f),listOf(.25f,.75f),listOf(.75f,.75f))
        val positions=listOf(-.5f to -.5f,.5f to -.5f,-.5f to .5f,.5f to .5f)
        for((index,p) in positions.withIndex()){
            assertEquals(expected[index],FluidSurface.topUv(p.first,p.second,active))
            val periodic=FluidSurface.topUv(p.first,p.second,active+4096)!!
            for(channel in 0..1)assertEquals(expected[index][channel],periodic[channel],1e-6f)
        }
        val rotated=FluidSurface.topUv(-.5f,-.5f,active+1024)!!
        assertEquals(.25f,rotated[0],1e-6f);assertEquals(.75f,rotated[1],1e-6f)
        assertNull(FluidSurface.topUv(-.5f,-.5f,1000000+65536));assertNull(FluidSurface.topUv(-.5f,-.5f,0))
    }
}
