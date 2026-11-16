package com.blockcolc.world

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.TimeZone

class NativeMaterialUniformsTest {
    private fun sample(quality:NativeLightingQuality=NativeLightingQuality.HIGH)=NativeEnvironment.sample(1_792_886_400_000L,
        TimeZone.getTimeZone("UTC"),quality,40.0,240.0,100.0,override=NativeWeatherOverride(NativeWeatherKind.CLEAR))
    @Test fun directExposureAndMaterialPolicyUseOnlyPreviouslyUnusedSkyChannels(){
        val sky=checkNotNull(sample().sky)
        for(role in listOf(null)+NativeSkyRole.entries){
            val legacy=NativeMaterialUniforms.pack(role,sky,1.1f,false,true)
            val direct=NativeMaterialUniforms.pack(role,sky,1.6f,true,true)
            assertEquals(16,direct.size);assertEquals(1.6f,direct[7],0f);assertEquals(1f,direct[11],0f)
            for(i in 0..15)if(i !in listOf(7,11))assertEquals("$role channel $i",legacy[i],direct[i],0f)
            assertEquals(0f,legacy[11],0f)
        }
        assertEquals(2f,NativeMaterialUniforms.pack(null,null,1f,true,false)[11],0f)
        assertThrows(IllegalArgumentException::class.java){NativeMaterialUniforms.pack(null,null,Float.NaN,true,true)}
    }
    @Test fun celestialAndDomePoliciesMatchTheFormalMaterialsWithoutChangingSkyCoordinates(){
        val sky=checkNotNull(sample().sky);val source=NativeSkyCompiler().prepare(false);val materials=checkNotNull(source.world).materials.map(::JSONObject)
        for((index,role)in NativeSkyRole.entries.withIndex()){
            assertEquals(role==NativeSkyRole.DOME,materials[index].getBoolean("toneMapped"))
            val data=NativeMaterialUniforms.pack(role,sky,1.4f,true,materials[index].getBoolean("toneMapped"))
            assertEquals(if(role==NativeSkyRole.DOME)1f else 2f,data[3],0f)
            assertEquals(if(role==NativeSkyRole.DOME)1f else 2f,data[11],0f)
            val direction=if(role==NativeSkyRole.SUN)sky.sunDirection else sky.moonDirection
            if(role!=NativeSkyRole.DOME){val radius=NativeSky.RADIUS*NativeSky.CELESTIAL_RATIO
                assertEquals((direction.x*radius).toFloat(),data[12],0f);assertEquals((direction.y*radius).toFloat(),data[13],0f);assertEquals((direction.z*radius).toFloat(),data[14],0f)}
        }
    }
    @Test fun samplingKeepsTheColourPathTiedToTheQualityAndCannotMutateEarlierUniformBlocks(){
        assertTrue(sample(NativeLightingQuality.LOW).uniforms().directColor)
        assertTrue(sample(NativeLightingQuality.BALANCED).uniforms().directColor)
        assertFalse(sample().uniforms().directColor)
        val first=NativeMaterialUniforms.pack(null,null,1f,true,true);first[7]=99f
        assertEquals(1f,NativeMaterialUniforms.pack(null,null,1f,true,true)[7],0f)
        assertEquals(0f,NativeColorEncoding.srgb(0f),0f);assertEquals(1f,NativeColorEncoding.srgb(1f),1e-5f)
        assertThrows(IllegalArgumentException::class.java){NativeColorEncoding.srgb(Float.NaN)}
    }
}
