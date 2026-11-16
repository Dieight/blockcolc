package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TodayFocusTimelineTest {
    private fun check(label:String,expected:JSONObject,actual:TodayFocusTimeline){
        assertEquals(label,expected.getString("date"),actual.date)
        assertEquals(label,expected.getLong("totalMs"),actual.totalMs)
        assertEquals(label,expected.getInt("completedRounds"),actual.completedRounds)
        assertEquals(label,if(expected.isNull("targetRounds"))null else expected.getInt("targetRounds"),actual.targetRounds)
        val rows=expected.getJSONArray("series");assertEquals(label,rows.length(),actual.series.size)
        for(i in 0 until rows.length()){
            val e=rows.getJSONObject(i);val a=actual.series[i]
            assertEquals(label,e.getString("key"),a.key);assertEquals(label,e.getString("title"),a.title)
            assertEquals(label,e.getLong("totalMs"),a.totalMs);assertEquals(label,e.getBoolean("unallocated"),a.unallocated)
            assertEquals(96,a.milliseconds.size)
            for(q in 0..95)assertEquals("$label/$i/$q",e.getJSONArray("milliseconds").getLong(q),a.milliseconds[q])
        }
    }
    @Test fun occupiedIntervalsMatchEveryFormalHistoryIncludingUnknownAttribution(){
        val oracle=JSONObject(javaClass.getResource("/presentation-oracle.json")!!.readText())
        val inputs=JSONObject(javaClass.getResource("/command-oracle.json")!!.readText()).getJSONArray("cases")
        val cases=oracle.getJSONArray("workspaces");var count=0;var withTime=0
        for(i in 0 until cases.length()){
            val c=cases.getJSONObject(i);val source=inputs.getJSONObject(c.getInt("caseIndex"))
            val state=DomainDocument.parse(source.getString("canonical"));val timelines=c.getJSONArray("timelines")
            for(j in 0 until timelines.length()){
                val expected=timelines.getJSONObject(j);val date=expected.getString("date")
                check(source.getString("name"),expected,TodayFocusProjection.from(state,date));count++
                if(expected.getLong("totalMs")>0)withTime++
            }
            check("workspace/$i",timelines.getJSONObject(0).takeIf{it.getString("date")==c.getString("today")}
                ?:(0 until timelines.length()).map{timelines.getJSONObject(it)}.first{it.getString("date")==c.getString("today")},
                WorkspaceProjection.from(state,c.getLong("now")).todayTimeline!!)
        }
        assertTrue(count>400);assertTrue(withTime>100)
    }
    @Test fun midnightDstRepeatedHoursQuarterOffsetsSubminutesAndDisabledGoalsMatchSource(){
        val cases=JSONObject(javaClass.getResource("/presentation-oracle.json")!!.readText()).getJSONArray("timelineBoundaries")
        assertEquals(8,cases.length())
        for(i in 0 until cases.length()){
            val c=cases.getJSONObject(i)
            check(c.getString("name"),c.getJSONObject("expected"),TodayFocusProjection.from(DomainDocument.parse(c.getString("inputCanonical")),c.getString("date")))
        }
        val empty=com.blockcolc.domain.DomainEngine.initial("UTC")
        for(date in listOf("2026-02-30","2026-1-01","not-a-date"))assertThrows(Exception::class.java){TodayFocusProjection.from(empty,date)}
    }
}
