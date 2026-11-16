package com.blockcolc.world

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class NativeWorldDebugTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-world-debug-oracle.json")!!.readText())}
    @Test fun referenceWasGeneratedByTheCurrentFormalProjection(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"apps/web/src/world-debug.ts").isFile}
        val hashes=oracle.getJSONObject("sourceHashes")
        hashes.keys().forEach{file->val digest=MessageDigest.getInstance("SHA-256").digest(File(root,file).readBytes()).joinToString(""){"%02x".format(it.toInt()and 255)}
            assertEquals(file,hashes.getString(file),digest)}
    }
    @Test fun allFormalWeatherTimeAndDstCasesMatchAndDisabledControlsRestoreNormalInputs(){
        val cases=oracle.getJSONArray("cases");assertEquals(336,cases.length())
        repeat(cases.length()){i->
            val item=cases.getJSONObject(i);val settings=item.getJSONObject("settings")
            val debug=NativeWorldDebug(settings.getBoolean("enabled"),NativeDebugWeather.entries.first{it.wire==settings.getString("weather")},
                if(settings.isNull("timeMinutes"))null else settings.getInt("timeMinutes"))
            val provider=NativeWeatherOverride(NativeWeatherKind.RAIN,false,.9,.35)
            val base=NativeAtmosphereInputs(item.getString("zone"),true,NativeCoordinates(39.92,116.41),provider)
            val projected=debug.project(base);val time=item.getLong("now")
            if(item.isNull("result")){assertSame(base,projected);assertEquals(time,projected.visualTime(time))}
            else{
                val result=item.getJSONObject("result")
                assertEquals(if(result.isNull("date"))time else result.getLong("date"),projected.visualTime(time))
                if(result.isNull("weather"))assertSame(provider,projected.weather)else{
                    val expected=result.getJSONObject("weather");val actual=projected.weather!!
                    assertEquals(expected.getString("kind"),actual.kind.wire);assertEquals(expected.optBoolean("thunderstorm"),actual.thunderstorm)
                    assertEquals(expected.getDouble("cloudIntensity"),actual.cloudIntensity!!,0.0)
                    assertEquals(expected.getDouble("precipitationIntensity"),actual.precipitationIntensity!!,0.0)
                }
                assertEquals(base,debug.copy(enabled=false).project(base))
            }
            assertEquals(base.coordinates,projected.coordinates)
        }
    }
    @Test fun debugChangesVisualFactsButNotTheObservedClockOrSceneOwnershipInputs(){
        val now=java.time.Instant.parse("2026-10-26T15:59:30Z").toEpochMilli()
        val base=NativeAtmosphereInputs("Asia/Shanghai",true)
        val debug=NativeWorldDebug(true,NativeDebugWeather.STORM,720)
        val facts=debug.project(base).sample(now)
        assertEquals(now,facts.time);assertEquals(java.time.Instant.parse("2026-10-26T04:00:00Z").toEpochMilli(),facts.visualTime)
        assertEquals(NativeEnvironment.localSun(facts.visualTime,java.util.TimeZone.getTimeZone(base.zone)).sunPosition,facts.sun.sunPosition)
        assertTrue(facts.weather.thunderstorm);assertEquals("2026-10-26",facts.weather.localDate)
        val before=NativeEnvironmentContext(base.zone,NativeLightingQuality.HIGH,25.0,160.0,55.0,true,skyOptions=NativeSkyOptions(floating=true))
        assertThrows(IllegalArgumentException::class.java){before.project(facts)}
        val next=before.adopting(facts)
        assertEquals(before.copy(weather=facts.inputs.weather,timeMinutes=720),next)
        assertSame(facts.sun,next.project(facts).sun)
        val restored=debug.copy(enabled=false).project(base).sample(now)
        assertEquals(before,next.adopting(restored));assertEquals(now,restored.visualTime)
        for(minutes in listOf(-1,1440)){
            assertThrows(IllegalArgumentException::class.java){NativeWorldDebug(timeMinutes=minutes)}
            assertThrows(IllegalArgumentException::class.java){NativeAtmosphereInputs("UTC",timeMinutes=minutes)}
        }
    }
    @Test fun conditionOverrideMatchesTheRendererAndNeverChangesAtmosphereOrDisabledFacts(){
        val cases=oracle.getJSONArray("decayCases");assertEquals(14,cases.length())
        val normal=NativeAtmosphereInputs("UTC",weather=NativeWeatherOverride(NativeWeatherKind.SNOW))
        repeat(cases.length()){index->val item=cases.getJSONObject(index);val settings=item.getJSONObject("settings")
            val value=NativeWorldDebug(settings.getBoolean("enabled"),decayAmount=if(settings.isNull("decayAmount"))null else settings.getDouble("decayAmount"))
            assertEquals(if(item.isNull("condition"))null else item.getInt("condition"),value.buildingCondition)
            assertEquals(normal,value.project(normal));assertNull(value.copy(enabled=false).buildingCondition)
        }
        for(value in listOf(-.01,1.01,Double.NaN,Double.POSITIVE_INFINITY))assertThrows(IllegalArgumentException::class.java){NativeWorldDebug(decayAmount=value)}
    }
}
