package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.StrictJson
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WorkspaceOracleTest {
    private fun oracle()=JSONObject(javaClass.getResource("/presentation-oracle.json")!!.readText())
    @Test fun realFormalHistoriesKeepDatesGoalsActualTimeAndUnknownAttribution(){
        val formal=JSONObject(javaClass.getResource("/command-oracle.json")!!.readText()).getJSONArray("cases")
        val cases=oracle().getJSONArray("workspaces")
        for(i in 0 until cases.length()){
            val expected=cases.getJSONObject(i);val input=formal.getJSONObject(expected.getInt("caseIndex"))
            val document=DomainDocument.parse(input.getString("canonical"));val snapshot=document.json()
            val preparation=WorkspaceProjection.prepare(snapshot,expected.getLong("now"))
            val summary=preparation.summary
            assertEquals(WorkspaceDetails.PREPARING,summary.details)
            assertNull(summary.todayTimeline)
            assertTrue(summary.achievements.isEmpty()&&summary.memories.buildings.isEmpty())
            val projection=preparation.complete()
            assertEquals(WorkspaceDetails.READY,projection.details)
            assertEquals(summary.todayGoal,projection.todayGoal)
            assertEquals("Projection mutated its borrowed snapshot",document.canonical,StrictJson.render(snapshot))
            val label=input.getString("name")
            assertEquals(label,expected.getString("today"),projection.today)
            val goal=expected.getJSONObject("todayGoal")
            assertEquals(label,goal.getInt("targetPomodoros"),projection.todayGoal.target)
            assertEquals(label,goal.getBoolean("enabled"),projection.todayGoal.enabled)
            val ranges=expected.getJSONArray("ranges")
            for(j in 0 until ranges.length()){
                val truth=ranges.getJSONObject(j);val actual=projection.range(truth.getString("end"),truth.getString("start"))
                assertEquals(label,actual.copy(targets=emptyList()),summary.range(truth.getString("end"),truth.getString("start")))
                assertEquals(label,truth.getInt("minutes"),kotlin.math.floor(actual.durationMs/60000.0+.5).toInt())
                assertEquals(label,truth.getInt("completed")+truth.getInt("early"),actual.completed)
                assertEquals(label,truth.getInt("interrupted"),actual.interrupted)
                assertEquals(label,truth.getLong("goal"),actual.goal)
                assertEquals(label,truth.getInt("activeDays"),actual.activeDays)
                val targets=actual.targets.groupBy{it.projectId}.mapValues{(_,items)->items.sumOf{it.durationMs}}
                val rows=truth.getJSONArray("targets")
                val original=buildMap{
                    for(k in 0 until rows.length()){
                        val row=rows.getJSONObject(k)
                        val id=if(row.isNull("projectId"))null else row.getString("projectId")
                        put(id,row.getLong("durationMs"))
                    }
                }
                // This fixture has a full minute and 40 seconds of short time.
                // The two assigned rounds each receive 20 seconds of that time.
                val expectedTargets=if(label=="deferred:64")mapOf("habit" to 80000L,"host" to 20000L)else original
                assertEquals(label,expectedTargets,targets)
            }
            val achievements=expected.getJSONArray("achievements")
            assertEquals(20,projection.achievements.size)
            for(j in 0 until achievements.length()){
                val truth=achievements.getJSONObject(j);val actual=projection.achievements[j]
                assertEquals(label,truth.getString("id"),actual.definition.id);assertEquals(label,truth.getString("title"),actual.definition.title)
                assertEquals(label,truth.getString("description"),actual.definition.description);assertEquals(label,truth.getString("metric"),actual.definition.metric)
                assertEquals(label,truth.getInt("target"),actual.definition.target);assertEquals(label,truth.getString("unit"),actual.definition.unit)
                assertEquals(label,truth.getInt("progress"),actual.progress);assertEquals(label,truth.getBoolean("unlocked"),actual.unlocked)
                assertEquals(label,if(truth.isNull("unlockedAt"))null else truth.getString("unlockedAt"),actual.unlockedAt)
            }
        }
        assertTrue("Need actual historical states, not a single empty fixture",cases.length()>300)
    }
    @Test fun allFormalFlightSamplesAndMirroredArcsMatch(){
        val cases=oracle().getJSONArray("flights")
        for(i in 0 until cases.length()){
            val test=cases.getJSONObject(i);val result=SliderPhysics.flight(test.getDouble("x"),test.getDouble("dx"),test.getDouble("dy"),test.getDouble("width"));val expected=test.getJSONObject("result")
            for((key,value)in listOf("origin" to result.origin,"startY" to result.startY,"vx" to result.vx,"vy" to result.vy,"gravity" to result.gravity,"duration" to result.duration,"landing" to result.landing))assertEquals("$i/$key",expected.getDouble(key),value,1e-7)
            assertEquals(test.getInt("value"),SliderPhysics.landingValueAt(result.landing,test.getDouble("width"),0,100,5,result.vx))
            for(j in 0..4){val point=SliderPhysics.position(result,result.duration*j/4);val expectedPoint=test.getJSONArray("positions").getJSONObject(j);assertEquals(expectedPoint.getDouble("x"),point.x,1e-7);assertEquals(expectedPoint.getDouble("y"),point.y,1e-7)}
            if(test.getDouble("dy")>0&&test.getDouble("dx")==0.0){val up=SliderPhysics.flight(test.getDouble("x"),0.0,-test.getDouble("dy"),test.getDouble("width"));for(j in 0..4){assertEquals(-SliderPhysics.position(result,result.duration*j/4).y,SliderPhysics.position(up,up.duration*j/4).y,1e-7)}}
        }
        assertEquals(225,cases.length())
    }
    @Test fun defaultTargetsIncludeEmptyCalendarDaysAndClockDetentsUseTheApprovedQuarterSecond(){
        val state=com.blockcolc.domain.DomainEngine.initial("UTC")
        val now=com.blockcolc.domain.DomainTime.millis("2026-10-24T08:00:00.000Z")
        val projection=WorkspaceProjection.from(state,now)
        assertEquals(8,projection.todayGoal.target);assertEquals(24L,projection.range("2026-10-22","2026-10-24").goal)
        assertEquals(250L,ClockSelection.DWELL_MS)
        assertEquals(RoundDetent(1,now+25*60000),ClockSelection.detent(now,now+26*60000,now,25,5))
        assertEquals(RoundDetent(2,now+55*60000),ClockSelection.detent(now+26*60000,now+56*60000,now,25,5))
        assertNull(ClockSelection.detent(now+55*60000,now+56*60000,now,25,5))
        assertNull(ClockSelection.shift(now+5*60000,-1,now));assertEquals(now+86400000,ClockSelection.shift(null,9999,now))
    }
}
