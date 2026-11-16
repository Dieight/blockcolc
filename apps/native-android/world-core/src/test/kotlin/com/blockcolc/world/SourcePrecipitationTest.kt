package com.blockcolc.world

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SourcePrecipitationTest {
    private fun oracle()=JSONObject(javaClass.getResource("/weather-oracle.json")!!.readText())
    @Test fun sourceFrustumFieldsMatchCurrentProductionAtEveryQuadrantAndZoom() {
        val rows=oracle().getJSONArray("fields");assertEquals(100,rows.length())
        for(i in 0 until rows.length()){
            val row=rows.getJSONObject(i);val field=PrecipitationMath.field(WeatherFieldInput.read(row.getJSONObject("input")));val expected=row.getJSONObject("output")
            for((key,actual) in listOf("centerX" to field.centerX,"centerZ" to field.centerZ,"spanX" to field.spanX,"spanZ" to field.spanZ))
                assertEquals("case $i $key",expected.getDouble(key),actual,1e-8)
            assertEquals(expected.getBoolean("usedFallback"),field.usedFallback)
        }
    }
    @Test fun particleMotionIncludingSnowDriftAndRainSpeedMatchesSource() {
        val rows=oracle().getJSONArray("motion");assertEquals(64,rows.length())
        for(i in 0 until rows.length()){
            val row=rows.getJSONObject(i);val v=row.getJSONObject("input");val e=row.getJSONObject("output")
            val m=PrecipitationMath.motion(v.getDouble("phase"),v.getDouble("elapsedMs"),v.getBoolean("snow"),v.getDouble("speed"))
            assertEquals(e.getDouble("phase"),m.phase,1e-10);assertEquals(e.getDouble("x"),m.x,1e-10);assertEquals(e.getDouble("z"),m.z,1e-10)
        }
    }
    @Test fun densityIsWorldVolumeBasedRatherThanRedistributedAtFixedParticleCount() {
        val rows=oracle().getJSONArray("density");assertEquals(24,rows.length())
        for(i in 0 until rows.length()){
            val row=rows.getJSONObject(i);val v=row.getJSONObject("input")
            assertEquals(row.getInt("output"),PrecipitationMath.count(v.getDouble("referenceCount"),v.getDouble("qualityDensity"),v.getDouble("spanX"),
                v.getDouble("spanZ"),v.getDouble("spanY"),v.getInt("capacity")))
        }
        assertEquals(0,PrecipitationMath.count(1.0,1.0,0.0,80.0,40.0,20))
    }
    @Test fun projectedCrossSectionMatchesSourceAtBothPhoneAndExportCssHeights() {
        val rows=oracle().getJSONArray("crossSection");assertEquals(18,rows.length())
        for(i in 0 until rows.length()){
            val row=rows.getJSONObject(i);val v=row.getJSONObject("input");val e=row.getJSONObject("output")
            val (scale,px)=PrecipitationMath.crossSection(v.getDouble("baseCrossSection"),v.getDouble("cameraDistance"),v.getDouble("fovDegrees"),
                v.getDouble("viewportHeightCss"),v.getDouble("targetProjectedCssPx"),v.getDouble("maximumScale"))
            assertEquals(e.getDouble("scale"),scale,1e-10);assertEquals(e.getDouble("projectedCssPx"),px,1e-10)
        }
    }
    @Test fun exactProgramsAndClosuresCannotBeReplacedByFlatGroundOrUnknownShader() {
        val rows=JSONArray(javaClass.getResource("/reviewed-weather-programs.json")!!.readText())
        for(i in 0 until rows.length()){
            val row=rows.getJSONObject(i);val definition=row.getJSONObject("definition");val u=row.getJSONObject("uniforms")
            val result=ReviewedSurfacePrograms.resolve(definition,u);assertTrue(result.pending.isEmpty())
            assertEquals(listOf("source-precipitation-v3"),result.applied);assertEquals(row.getBoolean("snow"),result.optics.precipitation!!.snow)
            assertEquals(listOf(-500.0,-400.0,1000.0,800.0),result.optics.precipitation!!.groundBounds)
            assertEquals(listOf("unreviewed-program"),ReviewedSurfacePrograms.resolve(JSONObject(definition.toString()).put("vertex",definition.getString("vertex")+" changed"),u).pending)
            for((key,value) in listOf("weatherSpan" to 0,"weatherSize" to "1","weatherField" to JSONArray("[0,10]"),
                "weatherGround" to JSONObject("{\"texture\":0.5}"),"weatherGroundBounds" to JSONArray("[0,0,-2,10]"))){
                assertThrows(IllegalArgumentException::class.java){SourcePrecipitation.read(JSONObject(u.toString()).put(key,value),false)}
            }
        }
    }
    @Test fun floatGroundPreservesSignedFractionalHeightsAndRejectsTruncatedOrInvalidPayloads() {
        val data=ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN);for(v in listOf(-2.5f,.125f,40f,3.75f))data.putFloat(v);data.flip()
        val ground=GroundHeights(2,2,data);assertEquals(-2.5f,ground.at(0.0,0.0),0f);assertEquals(3.75f,ground.at(1.0,1.0),0f)
        assertEquals(40f,ground.at(-1.0,2.0),0f);assertTrue(ground.bytes().isReadOnly)
        assertThrows(IllegalArgumentException::class.java){GroundHeights(3,2,data)}
        data.putFloat(0,Float.NaN);assertThrows(IllegalArgumentException::class.java){GroundHeights(2,2,data)}
    }
    @Test fun motionBlockUsesSourceMillisecondsAndValidatedCameraPopulation() {
        val spec=SourcePrecipitation(false,123456.0,.2,40.0,1.1,1.0,listOf(0.0,0.0),listOf(1.0,1.0),0,listOf(-500.0,-400.0,1000.0,800.0))
        val input=JSONObject("""{"schema":1,"rootRotationY":0,"bounds":[-500,500,-400,400],"framing":[100,120],"groundY":[-3,20],"qualityDensity":1,
            "animations":[{"kind":"rain","capacity":32768,"referenceCount":680,"baseCrossSection":0.03,"activeCount":0}]}""")
        val context=SourceWeatherContext.read(input);val state=WeatherFieldState(context)
        val frame=state.update(spec,context.populations.single(),doubleArrayOf(200.0,180.0,200.0),doubleArrayOf(0.0,0.0,0.0),34.0,.75,.1,3000.0,480.0)
        assertTrue(frame.count>0);val data=spec.motionData(frame)
        assertEquals(123456f,data[0],0f);assertEquals(.2f,data[1],0f);assertEquals(frame.size.toFloat(),data[4],0f)
        assertEquals(frame.count.toFloat(),data[14],0f);assertEquals(1000f,data[12],0f)
        assertThrows(IllegalArgumentException::class.java){SourceWeatherContext.read(JSONObject(input.toString()).put("rootRotationY",.1))}
        val fractional=JSONObject(input.toString());fractional.getJSONArray("animations").getJSONObject(0).put("capacity",32768.5)
        assertThrows(IllegalArgumentException::class.java){SourceWeatherContext.read(fractional)}
    }
    @Test fun packetVersionFourKeepsWeatherOffsetsAndIndicesSeparateFromOldPackedChannels() {
        val raw=javaClass.getResource("/codec-weather.json")!!.readText();val bytes=javaClass.getResource("/codec-weather.bin")!!.readBytes()
        val world=WorldPackets.read(raw,ByteBuffer.wrap(bytes));val p=world.packets.single();val rows=world.instanceRows(p)
        assertEquals(listOf("weatherPhase","weatherOffset"),p.auxChannels)
        assertEquals(.25f,rows.getFloat(80),0f);assertEquals(-.5f,rows.getFloat(84),0f);assertEquals(.125f,rows.getFloat(88),0f)
        assertEquals(1f,rows.getFloat(96+92),0f)
        for((channel,bad) in listOf(0 to -1f,0 to 1.1f,1 to .6f,2 to Float.NaN,3 to .5f,3 to 49152f)){
            val copy=bytes.copyOf();ByteBuffer.wrap(copy).order(ByteOrder.LITTLE_ENDIAN).putFloat(p.aux!!.offset+channel*4,bad)
            assertThrows(IllegalArgumentException::class.java){WorldPackets.read(raw,ByteBuffer.wrap(copy))}
        }
        val old=JSONObject(raw).put("version",3);val copy=bytes.copyOf();ByteBuffer.wrap(copy).order(ByteOrder.LITTLE_ENDIAN).putInt(4,3)
        assertThrows(IllegalArgumentException::class.java){WorldPackets.read(old.toString(),ByteBuffer.wrap(copy))}
        val legacy=WorldPackets.read(javaClass.getResource("/codec-v3.json")!!.readText(),ByteBuffer.wrap(javaClass.getResource("/codec-v3.bin")!!.readBytes()))
        assertEquals(listOf("cloudCenter","cloudVelocity"),legacy.packets.single().auxChannels)
    }
}
