package com.blockcolc.world

import com.blockcolc.world.generation.BlockPoint
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class NativeStormTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-storm-oracle.json")!!.readText())}
    @Test fun referenceExecutesTheCurrentRendererLightningAndThreeGeometry(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/renderer.ts").isFile}
        val hashes=oracle.getJSONObject("sourceHashes")
        hashes.keys().forEach{file->assertEquals(file,hashes.getString(file),MessageDigest.getInstance("SHA-256").digest(File(root,file).readBytes()).joinToString(""){"%02x".format(it.toInt()and 255)})}
    }
    @Test fun scheduleGeometryAndAfterglowMatchTheActualSourceAcrossSeedsAndContexts(){
        val traces=oracle.getJSONArray("traces");assertEquals(12,traces.length())
        repeat(traces.length()){index->
            val trace=traces.getJSONObject(index);val c=trace.getJSONObject("context")
            val runtime=NativeStormRuntime(NativeStormContext(BlockPoint(c.getDouble("x"),c.getDouble("y"),c.getDouble("z")),c.getDouble("width"),c.getDouble("depth"),c.getDouble("cloudBaseY"),c.optBoolean("preview")))
            val actions=trace.getJSONArray("actions")
            repeat(actions.length()){at->
                val action=actions.getJSONObject(at)
                if(action.has("configure")){
                    val weather=action.getJSONObject("configure");runtime.configure(NativeStormWeather(weather.getBoolean("thunderstorm"),weather.getLong("seed")),action.getDouble("now"))
                }else{
                    val expected=action.getJSONObject("frame");val frame=runtime.update(expected.getDouble("now"),expected.getBoolean("motion"))
                    assertEquals(expected.getLong("strikeCount"),runtime.strikeCount)
                    if(expected.isNull("nextAt"))assertEquals(Double.POSITIVE_INFINITY,runtime.nextStrikeAtMs,0.0)else assertEquals(expected.getDouble("nextAt"),runtime.nextStrikeAtMs,1e-8)
                    assertEquals(expected.getDouble("opacity"),frame.opacity,1e-12);assertEquals(expected.getDouble("flashIntensity"),frame.flashIntensity,1e-12)
                    val vertices=expected.getJSONArray("vertices")
                    assertEquals(vertices.length(),frame.burst?.vertices?.size?:0)
                    frame.burst?.let{burst->
                        val flash=expected.getJSONArray("flashPosition")
                        repeat(3){axis->assertEquals(flash.getDouble(axis),burst.flashPosition[axis],1e-8)}
                        repeat(vertices.length()){v->repeat(3){axis->assertEquals("Trace $index / $at / $v / $axis",vertices.getJSONArray(v).getDouble(axis),burst.vertices[v][axis],1e-8)}}
                        val matrices=NativeLightningRows.matrices(burst.vertices,1.0);val expectedMatrices=expected.getJSONArray("matrices")
                        assertEquals(expectedMatrices.length(),matrices.size)
                        for(element in matrices.indices)assertEquals("Pose $index / $at / $element",expectedMatrices.getDouble(element),matrices[element].toDouble(),2e-4)
                    }
                }
            }
            runtime.close()
        }
    }
    @Test fun unchangedMinuteObservationsDoNotResetTheFirstStrikeOrTheActiveBolt(){
        val runtime=NativeStormRuntime(NativeStormContext(BlockPoint(0.0,0.0,0.0),30.0,20.0,25.0));val weather=NativeStormWeather(true,0L)
        runtime.configure(weather,0.0);val deadline=runtime.nextStrikeAtMs
        repeat(16){runtime.configure(weather,it*100.0)};assertEquals(deadline,runtime.nextStrikeAtMs,0.0)
        val burst=runtime.update(deadline,true).burst!!;assertEquals(9,burst.vertices.size)
        runtime.configure(weather,deadline+1);assertSame(burst,runtime.update(deadline+1,true).burst)
        assertThrows(UnsupportedOperationException::class.java){(burst.vertices as MutableList).clear()}
        runtime.close();assertEquals(NativeStormFrame.NONE,runtime.update(0.0,true));assertThrows(IllegalStateException::class.java){runtime.configure(weather,deadline+2)}
    }
    @Test fun suppressionNeverConsumesStrikesAndAGiantGapDoesNotReplayMissedEvents(){
        val runtime=NativeStormRuntime(NativeStormContext(BlockPoint(0.0,0.0,0.0),30.0,20.0,25.0));runtime.configure(NativeStormWeather(true,1),0.0)
        val first=runtime.nextStrikeAtMs
        assertEquals(NativeStormFrame.NONE,runtime.update(100_000.0,false));assertEquals(0,runtime.strikeCount);assertEquals(first,runtime.nextStrikeAtMs,0.0)
        assertNotNull(runtime.update(1e9,true).burst);assertEquals(1,runtime.strikeCount)
        runtime.configure(NativeStormWeather(false,1),1e9+1);assertEquals(NativeStormFrame.NONE,runtime.update(1e9+1,true));assertEquals(Double.POSITIVE_INFINITY,runtime.nextStrikeAtMs,0.0)
    }
    @Test fun malformedAndBackdatedInputsFailBeforeReplacingAValidState(){
        assertThrows(IllegalArgumentException::class.java){NativeStormWeather(true,-1)}
        assertThrows(IllegalArgumentException::class.java){NativeStormWeather(true,0x1_0000_0000L)}
        assertThrows(IllegalArgumentException::class.java){NativeStormContext(BlockPoint(0.0,100.0,0.0),20.0,20.0,0.0)}
        val runtime=NativeStormRuntime(NativeStormContext(BlockPoint(0.0,0.0,0.0),20.0,20.0,25.0));runtime.configure(NativeStormWeather(true,1),100.0)
        val deadline=runtime.nextStrikeAtMs
        for(time in listOf(Double.NaN,-1.0,99.0,Double.POSITIVE_INFINITY))assertThrows(IllegalArgumentException::class.java){runtime.update(time,true)}
        assertEquals(deadline,runtime.nextStrikeAtMs,0.0);assertNotNull(runtime.update(deadline,true).burst)
    }
}
