package com.blockcolc.presentation

import com.blockcolc.domain.StrictJson
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class PresentationOracleTest {
    private fun oracle()=JSONObject(javaClass.getResource("/presentation-oracle.json")!!.readText())
    @Test fun generatedTruthComesFromCurrentFormalSources(){
        val input=oracle().getJSONObject("sourceHashes")
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/domain/src/index.ts").isFile}
        input.keys().forEach{name->
            val digest=MessageDigest.getInstance("SHA-256").digest(File(root,name).readBytes()).joinToString(""){"%02x".format(it.toInt() and 255)}
            assertEquals("Stale formal presentation oracle: $name",input.getString(name),digest)
        }
    }
    @Test fun allFormalPreferencesAndLegacyDefaultsMatch(){
        // The current native product always starts progressively. This is the
        // sole retired legacy preference; all remaining formal values match.
        fun current(wire:String)=StrictJson.render(JSONObject(wire).apply{remove("progressiveStartup")})
        val truth=oracle();assertEquals(current(truth.getString("defaults")),ClientPreferences().canonical())
        val cases=truth.getJSONArray("preferences")
        for(i in 0 until cases.length()){
            val c=cases.getJSONObject(i);val parsed=ClientPreferences.parse(c.get("input"));assertEquals(c.getString("name"),current(c.getString("canonical")),parsed.canonical())
            assertEquals(parsed,ClientPreferences.parseText(parsed.canonical()))
        }
        val legacy=JSONObject(ClientPreferences().canonical()).put("progressiveStartup",false)
        assertEquals(ClientPreferences(),ClientPreferences.parse(legacy))
        legacy.put("progressiveStartup",true)
        assertEquals(ClientPreferences(),ClientPreferences.parse(legacy))
        assertFalse(JSONObject(ClientPreferences.parse(legacy).canonical()).has("progressiveStartup"))
    }
    @Test fun exactEndSchedulesIncludeShortFocusAndTerminalRestWithoutInventingARound(){
        val cases=oracle().getJSONArray("schedules")
        for(i in 0 until cases.length()){
            val c=cases.getJSONObject(i);val actual=runCatching{EndTimeSchedule.forDuration(c.getLong("durationMs"),c.getInt("focusMinutes"),c.getInt("breakMinutes"),c.getInt("maxRounds"))}
            if(c.optBoolean("rejected")){assertTrue(c.toString(),actual.isFailure);continue}
            val result=actual.getOrThrow()
            if(c.isNull("result")){assertNull(result);continue}
            result!!;val expected=c.getJSONObject("result")
            assertEquals(c.toString(),expected.getInt("rounds"),result.rounds);assertEquals(expected.getInt("breaks"),result.breaks);assertEquals(expected.getLong("usableMs"),result.usableMs)
        }
        assertEquals(EndTimeSchedule(1,1,27*60000L),EndTimeSchedule.forDuration(27*60000L,25,5))
    }
}
