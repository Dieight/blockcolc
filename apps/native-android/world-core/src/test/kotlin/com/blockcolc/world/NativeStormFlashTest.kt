package com.blockcolc.world

import com.blockcolc.world.generation.BlockPoint
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeStormFlashTest {
    @Test fun finiteFalloffNormalAndColorMatchTheActualThreeShader(){
        val samples=JSONObject(javaClass.getResource("/native-storm-oracle.json")!!.readText()).getJSONArray("flashes")
        assertEquals(126,samples.length())
        repeat(samples.length()){index->val s=samples.getJSONObject(index)
            fun p(key:String)=s.getJSONArray(key).let{BlockPoint(it.getDouble(0),it.getDouble(1),it.getDouble(2))}
            val actual=NativeStormFlash(p("position"),s.getDouble("intensity").toFloat()).diffuse(p("point"),p("normal"))
            for(channel in 0..2){val expected=s.getJSONArray("diffuse").getDouble(channel)
                assertEquals("$index / $channel",expected,actual[channel],maxOf(1e-12,expected*2e-7))}
        }
    }
    @Test fun suppressionClearsTheLightAndBurstPositionFollowsItsGroundTarget(){
        val runtime=NativeStormRuntime(NativeStormContext(BlockPoint(200.0,4.0,300.0),20.0,20.0,25.0))
        runtime.configure(NativeStormWeather(true,12),0.0);val at=runtime.nextStrikeAtMs
        val frame=runtime.update(at,true);val flash=NativeStormFlash.from(frame)
        assertEquals(9.0,flash.position.y,0.0);assertEquals(2.58f,flash.intensity,1e-6f)
        assertEquals(NativeStormFlash.NONE,NativeStormFlash.from(runtime.update(at+1,false)))
        assertEquals(NativeStormFlash.NONE,NativeStormFlash.from(runtime.update(at+2,true)))
    }
    @Test fun invalidIntensityAndPositionFailBeforeGpuAdoption(){
        for(intensity in listOf(-1f,Float.NaN,Float.POSITIVE_INFINITY,4f))assertThrows(IllegalArgumentException::class.java){NativeStormFlash(BlockPoint(0.0,0.0,0.0),intensity)}
        assertThrows(IllegalArgumentException::class.java){NativeStormFlash(BlockPoint(Double.NaN,0.0,0.0),1f)}
    }
}
