package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.DoubleBuffer
import java.nio.IntBuffer
import java.util.TimeZone
import java.util.concurrent.CancellationException

class NativeEnvironmentTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-environment-oracle.json")!!.readText())}
    private fun position(expected:JSONObject,actual:NativeCelestialPosition){assertEquals(expected.getDouble("azimuthDeg"),actual.azimuthDeg,2e-7);assertEquals(expected.getDouble("altitudeDeg"),actual.altitudeDeg,2e-7)}
    private fun lunar(expected:JSONObject,actual:NativeLunarIllumination){assertEquals(expected.getDouble("fraction"),actual.fraction,2e-9);assertEquals(expected.getDouble("phase"),actual.phase,2e-9);assertEquals(expected.getDouble("angleDeg"),actual.angleDeg,2e-7);assertEquals(expected.getBoolean("waxing"),actual.waxing)}
    private fun state(expected:JSONObject,actual:NativeSunState){
        assertEquals(expected.getString("phase"),actual.phase)
        for((name,p)in listOf("position" to actual.position,"sunPosition" to actual.sunPosition,"moonPosition" to actual.moonPosition))repeat(3){assertEquals(name,expected.getJSONArray(name).getDouble(it),p[it],2e-7)}
        val colors=mapOf("color" to actual.color,"skyColor" to actual.skyColor,"skyZenithColor" to actual.skyZenithColor,"skyHorizonColor" to actual.skyHorizonColor,
            "skyLowerColor" to actual.skyLowerColor,"cloudColor" to actual.cloudColor,"fogColor" to actual.fogColor,"hemisphereSkyColor" to actual.hemisphereSkyColor,"hemisphereGroundColor" to actual.hemisphereGroundColor)
        for((name,color)in colors)assertEquals(name,expected.getInt(name),color)
        val numbers=mapOf("sunVisibility" to actual.sunVisibility,"moonVisibility" to actual.moonVisibility,"starVisibility" to actual.starVisibility,"intensity" to actual.intensity,
            "hemisphereIntensity" to actual.hemisphereIntensity,"exposure" to actual.exposure,"nightFactor" to actual.nightFactor)
        for((name,n)in numbers)assertEquals(name,expected.getDouble(name),n,2e-8)
        assertEquals(expected.getDouble("moonIllumination"),actual.lunar.fraction,2e-9)
    }
    @Test fun ephemerisMatchesTheActualSunCalc2SourceAcrossEpochsAndLatitudes(){
        val cases=oracle.getJSONArray("ephemeris");assertEquals(180,cases.length())
        repeat(cases.length()){i->val c=cases.getJSONObject(i);val p=c.getJSONObject("coordinates");val coordinates=NativeCoordinates(p.getDouble("latitude"),p.getDouble("longitude"));val time=c.getLong("time")
            position(c.getJSONObject("sun"),NativeEphemeris.sunPosition(time,coordinates));position(c.getJSONObject("moon"),NativeEphemeris.moonPosition(time,coordinates));lunar(c.getJSONObject("lunar"),NativeEphemeris.illumination(time))
            state(c.getJSONObject("state"),NativeEnvironment.astronomySun(time,coordinates))}
    }
    @Test fun localLightingRetainsLocalTimeTwilightNightFloorAndMoonPhase(){
        val cases=oracle.getJSONArray("local");assertTrue(cases.length()>1000)
        repeat(cases.length()){i->val c=cases.getJSONObject(i);state(c.getJSONObject("state"),NativeEnvironment.localSun(c.getLong("time"),TimeZone.getTimeZone(c.getString("zone"))))}
    }
    @Test fun localWeatherRetainsIndependentEnvironmentProbabilitiesAndThunderSignal(){
        val cases=oracle.getJSONArray("weather");assertEquals(740,cases.length());val kinds=mutableSetOf<NativeWeatherKind>()
        repeat(cases.length()){i->val c=cases.getJSONObject(i);val s=c.getJSONObject("state");val n=NativeEnvironment.localWeather(c.getString("date"),c.getBoolean("ocean"));kinds+=n.kind
            assertEquals(s.getString("kind"),n.kind.wire);assertEquals(s.getLong("seed"),n.seed);assertEquals(s.getBoolean("thunderstorm"),n.thunderstorm)
            assertEquals(s.getInt("cloudCount"),n.cloudCount);assertEquals(s.getDouble("cloudIntensity"),n.cloudIntensity,0.0);assertEquals(s.getInt("rainDropCount"),n.rainDropCount)}
        assertEquals(setOf(NativeWeatherKind.CLEAR,NativeWeatherKind.CLOUDY,NativeWeatherKind.RAIN,NativeWeatherKind.MIST),kinds)
        assertThrows(IllegalArgumentException::class.java){NativeEnvironment.localWeather("2026-02-31")}
    }
    @Test fun planarUploadPreservesSourceFloatPositionsNormalsUvsAndCompactsOnlyUnusedVertices(){
        val cases=oracle.getJSONArray("planar")
        repeat(cases.length()){i->val c=cases.getJSONObject(i);val raw=c.getJSONArray("positions");val indices=c.getJSONArray("indices");val order=linkedSetOf<Int>();repeat(indices.length()){order+=indices.getInt(it)}
            val source=DoubleBuffer.wrap(DoubleArray(raw.length()){raw.getDouble(it)});val index=IntBuffer.wrap(IntArray(indices.length()){indices.getInt(it)})
            val g=NativePlanarGeometry.groups(source,listOf(index)).single()!!;assertEquals(order.size,g.vertexCount);val actuals=listOf(g.positions(),g.normals(),g.textureCoordinates()!!)
            for((a,key)in listOf("position","normal","uv").withIndex()){val expected=c.getJSONArray(key);val dimensions=if(a==2)2 else 3;for(vertex in order)repeat(dimensions){assertEquals(key,expected.getDouble(vertex*dimensions+it).toFloat(),actuals[a].get(),0f)}}
            assertEquals(0,source.position());assertEquals(0,index.position());assertTrue(g.positions().isReadOnly)
        }
        assertThrows(CancellationException::class.java){NativePlanarGeometry.groups(DoubleBuffer.allocate(0),emptyList(),cancelled={true})}
    }
    @Test fun environmentUsesClockAndWeatherButNeverUiThemeAndKeepsNonClearReflectionsSuppressed(){
        val time=java.time.Instant.parse("2026-10-25T04:00:00Z").toEpochMilli();val zone=TimeZone.getTimeZone("Asia/Shanghai")
        val clear=NativeEnvironment.sample(time,zone,NativeLightingQuality.HIGH,30.0,1200.0,70.0,override=NativeWeatherOverride(NativeWeatherKind.CLEAR))
        val rain=NativeEnvironment.sample(time,zone,NativeLightingQuality.HIGH,30.0,1200.0,70.0,override=NativeWeatherOverride(NativeWeatherKind.RAIN,true))
        assertTrue(rain.lighting.lights.first().intensity<clear.lighting.lights.first().intensity);assertEquals(0f,rain.surface.clearSky,0f);assertEquals(1f,clear.surface.clearSky,0f)
        assertTrue(rain.lighting.clearColor.sum()<clear.lighting.clearColor.sum());assertTrue(clear.lighting.fog!!.far>1200)
        assertThrows(IllegalArgumentException::class.java){NativeCoordinates(91.0,0.0)}
    }
}
