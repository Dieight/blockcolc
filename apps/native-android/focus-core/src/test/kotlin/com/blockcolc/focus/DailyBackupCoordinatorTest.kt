package com.blockcolc.focus

import com.blockcolc.domain.DomainTime
import org.junit.Assert.*
import org.junit.Test

class DailyBackupCoordinatorTest {
    private class Clock(var wall:Long=DomainTime.millis("2026-10-27T15:59:59.000Z"),var mono:Long=0){
        val dates=mutableListOf<String>();val failures=mutableListOf<Boolean>();var fail=false
        val coordinator=DailyBackupCoordinator({wall},{mono},{date,_->dates+=date;if(fail)error("disk")},{failures+=it})
        init{coordinator.context("db:0","Asia/Shanghai");coordinator.foreground(true)}
    }
    @Test fun startupAndMidnightUseThePreviousApplicationDayOnce(){
        val c=Clock();assertEquals(1000L,c.coordinator.check());assertEquals(listOf("2026-10-26"),c.dates)
        c.coordinator.check();assertEquals(1,c.dates.size)
        c.wall+=1000;c.mono+=1000;assertEquals(86400000L,c.coordinator.check());assertEquals("2026-10-27",c.dates.last())
    }
    @Test fun hiddenMidnightResumesWithNoBackgroundCapture(){
        val c=Clock();c.coordinator.check();c.coordinator.foreground(false);c.wall+=86401000
        assertNull(c.coordinator.check());assertEquals(1,c.dates.size)
        c.coordinator.foreground(true);c.coordinator.check();assertEquals("2026-10-28",c.dates.last())
    }
    @Test fun startupGraceDefersOnlyTheCaptureAndKeepsTheMidnightSchedule(){
        val c=Clock(DomainTime.millis("2026-10-27T15:59:50.000Z"))
        assertEquals(2000L,c.coordinator.check(2000))
        assertTrue(c.dates.isEmpty())
        c.wall+=1950;c.mono+=1950
        assertEquals(100L,c.coordinator.check(2050))
        c.wall+=100;c.mono+=100
        assertEquals(7950L,c.coordinator.check(2000))
        assertEquals(listOf("2026-10-26"),c.dates)
        c.wall+=7950;c.mono+=7950
        assertEquals(86400000L,c.coordinator.check(2000))
        assertEquals(listOf("2026-10-26","2026-10-27"),c.dates)
    }
    @Test fun failedSaveRetriesByMonotonicTimeAfterTheClockMovesBack(){
        val c=Clock(DomainTime.millis("2026-10-27T08:00:00.000Z"));c.fail=true;assertEquals(60000L,c.coordinator.check())
        c.wall-=86400000; c.mono+=1000;assertEquals(59000L,c.coordinator.check());assertEquals(1,c.dates.size)
        c.fail=false;c.mono+=59000;c.coordinator.check();assertEquals(2,c.dates.size);assertEquals(listOf(true,false),c.failures)
    }
    @Test fun replacementAndApplicationZoneInvalidateCompletion(){
        val c=Clock(DomainTime.millis("2026-10-27T16:00:00.000Z"));c.coordinator.check();assertEquals("2026-10-27",c.dates.single());c.coordinator.context("db:1","Asia/Shanghai");c.coordinator.check()
        assertEquals(2,c.dates.size);c.coordinator.context("db:1","America/New_York");c.coordinator.check()
        assertEquals("2026-10-26",c.dates.last());assertEquals(3,c.dates.size)
    }
    @Test fun dstUsesTheNextLocalMidnightAndNeverTheDeviceZone(){
        val c=Clock(DomainTime.millis("2026-03-08T05:00:00.000Z"));c.coordinator.context("db:0","America/New_York")
        assertEquals(23*3600000L,c.coordinator.check());assertEquals(listOf("2026-03-07"),c.dates)
    }
    @Test fun noContextOrForegroundNeverCaptures(){
        var calls=0;val c=DailyBackupCoordinator({0},{0},{_,_->calls++})
        assertNull(c.check());c.foreground(true);assertNull(c.check());assertEquals(0,calls)
    }
}
