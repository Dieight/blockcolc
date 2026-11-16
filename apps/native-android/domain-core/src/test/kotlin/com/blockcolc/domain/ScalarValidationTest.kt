package com.blockcolc.domain

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ScalarValidationTest {
    @Test fun lazyScalarPathsRetainExactFailuresWithoutAllocatingSuccessfulPaths(){
        var paths=0
        assertEquals(7,JsonChecks.integer(7,0,10){paths++;"$.voxel.x"})
        assertEquals("mc:stone",JsonChecks.nonBlank("mc:stone"){paths++;"$.voxel.sourceBlockId"})
        assertEquals(0,paths)
        for(value in listOf<Any>("7",Double.NaN,-1,11,1.5)){
            val failure=assertThrows(StateInputException::class.java){JsonChecks.integer(value,0,10){paths++;"$.voxel.x"}}
            assertEquals("$.voxel.x",failure.path)
        }
        for(value in listOf<Any>(JSONObject.NULL," \ufeff")){
            val failure=assertThrows(StateInputException::class.java){JsonChecks.nonBlank(value){paths++;"$.voxel.sourceBlockId"}}
            assertEquals("$.voxel.sourceBlockId",failure.path)
        }
        assertEquals(7,paths)
    }
    @Test fun warmGrammarStillRejectsUnknownMissingAndMistypedFields(){
        repeat(3){JsonChecks.shape(JSONObject().put("id","x").put("enabled",true),"$.ok","id enabled","note")}
        for(x in listOf(JSONObject().put("id","x").put("enabled",true).put("extra",1),JSONObject().put("id","x"))){
            assertTrue(runCatching{JsonChecks.shape(x,"$.bad","id enabled","note")}.exceptionOrNull() is StateInputException)
        }
        JsonChecks.choice("active","$.ok","active paused")
        assertTrue(runCatching{JsonChecks.choice("deleted","$.bad","active paused")}.isFailure)
    }
    @Test fun scalarCachesUseExactValidTextAndPreserveErrorPathsAfterEviction(){
        repeat(300){DomainTime.format(1790832000000L+it)}
        val good="2026-10-01T08:00:00.000Z"
        repeat(3){assertEquals(good,JsonChecks.instant(good,"$.ok"));assertEquals(1790841600000L,JsonChecks.millis(good));JsonChecks.date("2026-10-01","$.ok")}
        for(bad in listOf("2026-10-01T08:00:00Z","2026-10-01T08:00:00.000+00:00","2026-13-01T08:00:00.000Z")){
            val error=runCatching{JsonChecks.instant(bad,"$.current")}.exceptionOrNull() as StateInputException
            assertEquals("$.current",error.path)
        }
        for(bad in listOf("2026-02-30","2026-1-01","0099-01-01")){
            val error=runCatching{JsonChecks.date(bad,"$.date")}.exceptionOrNull() as StateInputException;assertEquals("$.date",error.path)
        }
        assertTrue(runCatching{JsonChecks.instant(JSONObject.NULL,"$.notText")}.isFailure)
    }
    @Test fun canonicalInstantFastPathAgreesWithEpochAndRetainsWireStrictness(){
        val samples=listOf("0000-02-29T00:00:00.001Z","1582-10-10T01:02:03.040Z","1900-03-01T00:00:00.000Z",
            "1969-12-31T23:59:59.999Z","1970-01-01T00:00:00.000Z","2000-02-29T13:15:49.001Z","9999-12-31T23:59:59.999Z",
            "+010000-01-01T00:00:00.123Z","-000001-12-31T23:59:59.999Z")
        for(wire in samples){
            val epoch=java.time.Instant.parse(wire).toEpochMilli()
            assertEquals(epoch,DomainTime.millis(wire));assertEquals(wire,DomainTime.format(epoch))
        }
        for(wire in listOf("1900-02-29T13:15:49.001Z","2026-04-31T00:00:00.000Z","2026-01-01T24:00:00.000Z",
            "2016-12-31T23:59:60.000Z","2026-01-01T00:00:00.1Z","2026-01-01t00:00:00.000z","2026-01-01T00:00:00.０００Z")){
            assertEquals("$.event.at",assertThrows(StateInputException::class.java){JsonChecks.instant(wire,"$.event.at")}.path)
        }
    }
    @Test fun repeatedLocalDatesRespectDstAliasesAndLargeFixedOffsets(){
        repeat(2){
            assertEquals("2026-03-07",DomainTime.localDate("2026-03-08T05:30:00.000Z","America/Chicago"))
            assertEquals("2026-03-09",DomainTime.localDate("2026-03-10T04:30:00.000Z","CST"))
            assertEquals("2026-03-10",DomainTime.localDate("2026-03-10T05:30:00.000Z","america/chicago"))
            assertEquals("2026-01-02",DomainTime.localDate("2026-01-01T00:01:00.000Z","+23:59"))
            assertEquals("2025-12-31",DomainTime.localDate("2026-01-01T12:00:00.000Z","-2359"))
        }
        assertEquals("$.event.zone",assertThrows(StateInputException::class.java){JsonChecks.zone("+24:00","$.event.zone")}.path)
    }
    @Test fun pipelineObservationAlwaysReleasesItsThreadLocal(){
        val spans=mutableListOf<Pair<String,Boolean>>()
        assertTrue(runCatching{PipelineCost.collect({name,_,_,ok->spans.add(name to ok)}){PipelineCost.section("failed"){error("failure")}}}.isFailure)
        assertEquals(listOf("failed" to false),spans)
        PipelineCost.section("not-observed"){null};assertEquals(1,spans.size)
        var calls=0;assertNull(PipelineCost.collect(null){PipelineCost.section("null"){calls++;null}});assertEquals(1,calls)
    }
    @Test fun holidayArithmeticReuseIsKeyedByBothHolidayAndYear(){
        assertEquals("2026-02-17",HolidayDates.date("spring-festival",2026).toString())
        assertEquals("2025-01-29",HolidayDates.date("spring-festival",2025).toString())
        val first=HolidayDates.onDate("2026-02-17");assertTrue(first.contains("spring-festival" to 2026))
        assertFalse(HolidayDates.onDate("2026-02-20").contains("spring-festival" to 2026))
        assertTrue(HolidayDates.onDate("2027-01-01").contains("new-year" to 2027))
        repeat(15){HolidayDates.ids.forEach{id->HolidayDates.date(id,2020+it)}}
        assertEquals(first,HolidayDates.onDate("2026-02-17"))
        assertTrue(runCatching{HolidayDates.date("unknown",2026)}.isFailure)
        assertTrue(runCatching{HolidayDates.date("new-year",99)}.isFailure)
    }
}
