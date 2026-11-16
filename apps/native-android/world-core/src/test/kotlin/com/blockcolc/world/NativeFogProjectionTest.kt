package com.blockcolc.world

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteOrder
import java.util.TimeZone

class NativeFogProjectionTest {
    @Test fun currentFormalWeatherAndExtentRangesMatchAcrossTheWholeCameraEnvelope(){
        val oracle=JSONObject(checkNotNull(javaClass.getResourceAsStream("/native-fog-oracle.json")).bufferedReader().use{it.readText()})
        assertTrue(oracle.getJSONObject("sourceHashes").has("packages/voxel/src/environment.ts"))
        val rows=oracle.getJSONArray("cases");assertEquals(1680,rows.length())
        repeat(rows.length()){i->val row=rows.getJSONObject(i);val expected=row.getJSONObject("range")
            val kind=NativeWeatherKind.entries.single{it.wire==row.getString("kind")}
            val actual=NativeFogProjection(kind,row.getDouble("core"),row.getDouble("extent")).range(row.getDouble("distance"))
            assertEquals("near $row",expected.getDouble("near"),actual.near,1e-8)
            assertEquals("far $row",expected.getDouble("far"),actual.far,1e-8)
        }
    }
    @Test fun environmentKeepsColourAndProjectionSeparateAndCannotEnableProjectionWithoutFog(){
        val time=1_792_886_400_000L;val zone=TimeZone.getTimeZone("UTC")
        val sample=NativeEnvironment.sample(time,zone,NativeLightingQuality.HIGH,40.0,720.0,160.0,
            override=NativeWeatherOverride(NativeWeatherKind.MIST))
        val projection=checkNotNull(sample.fogProjection)
        assertSame(projection,sample.uniforms().fogProjection)
        assertEquals(160*3.15,projection.range(160.0).far,1e-8)
        assertEquals(45*3.15,projection.range(45.0).far,1e-8)
        assertEquals((160*3.15).toFloat(),sample.lighting.fog!!.far,0f)
        assertThrows(IllegalArgumentException::class.java){NativeSceneEnvironment(sample.lighting.copy(fog=null),fogProjection=projection)}
        assertNull(NativeSceneEnvironment(sample.lighting).fogProjection)
        assertEquals(projection.range(1.0),projection.range(Double.NaN))
        assertEquals(projection.range(1.0),projection.range(Double.POSITIVE_INFINITY))
        assertThrows(IllegalArgumentException::class.java){NativeFogProjection(NativeWeatherKind.CLEAR,0.0,40.0)}
        assertThrows(IllegalArgumentException::class.java){NativeFogProjection(NativeWeatherKind.CLEAR,40.0,Double.NaN)}
    }
    private fun floats(value:WorldRuntimeUniforms):FloatArray {
        val bytes=value.bytes();assertEquals(WorldRuntimeUniforms.BYTES,bytes.remaining());assertEquals(0,bytes.position())
        return FloatArray(8).also{bytes.order(ByteOrder.nativeOrder()).asFloatBuffer().get(it)}
    }
    @Test fun cameraAndWeatherUpdatesPreserveAnimationClocksInTheExistingTwoTexels(){
        val value=WorldRuntimeUniforms();value.time(12.8f,true,33f,45_123f,67f)
        val clock=floats(value).take(5)
        value.fog(NativeFogRange(20.0,200.0));val projected=floats(value)
        assertEquals(clock,projected.take(5));assertEquals(listOf(20f,200f,1f),projected.drop(5))
        value.time(14f,false,34f,46_123f,68f)
        assertEquals(listOf(14f,-2f,34f,46_123f,68f,20f,200f,1f),floats(value).toList())
        value.fog(NativeFogProjection(NativeWeatherKind.MIST,40.0,720.0).range(45.0))
        assertEquals(listOf(14f,-2f,34f,46_123f,68f),floats(value).take(5))
        assertEquals(listOf(0f,141.75f,1f),floats(value).drop(5))
        assertEquals(32,WorldRuntimeUniforms.BYTES)
    }
    @Test fun disablingNativeProjectionRestoresFrozenSourceRangesWithoutChangingTheClock(){
        val value=WorldRuntimeUniforms();value.time(12f,true,1f,20f,3f);value.fog(NativeFogRange(2.0,3.0))
        val before=floats(value).take(5);value.fog(null)
        assertEquals(before,floats(value).take(5));assertEquals(listOf(0f,0f,0f),floats(value).drop(5))
        assertThrows(IllegalArgumentException::class.java){value.fog(NativeFogRange(1e300,2e300))}
        assertEquals(before,floats(value).take(5));assertEquals(listOf(0f,0f,0f),floats(value).drop(5))
        assertThrows(IllegalArgumentException::class.java){NativeFogRange(3.0,3.0)}
        assertThrows(IllegalArgumentException::class.java){NativeFogRange(-1.0,3.0)}
    }
}
