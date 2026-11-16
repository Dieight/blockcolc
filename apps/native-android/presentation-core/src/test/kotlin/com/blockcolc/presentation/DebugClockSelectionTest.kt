package com.blockcolc.presentation

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class DebugClockSelectionTest {
    @Test fun localVisualClockHandlesDstWithoutMovingTheRealReferenceDate(){
        val spring=Instant.parse("2026-03-08T06:59:30Z").toEpochMilli()
        assertEquals(Instant.parse("2026-03-08T07:30:00Z").toEpochMilli(),ClockSelection.timeOfDay(150,spring,"America/New_York"))
        val autumn=Instant.parse("2026-11-01T17:00:00Z").toEpochMilli()
        assertEquals(Instant.parse("2026-11-01T05:30:00Z").toEpochMilli(),ClockSelection.timeOfDay(90,autumn,"America/New_York"))
    }
    @Test fun sharedClockShellUsesFiveMinuteStepsAndClampsWithinOneLocalDay(){
        val reference=Instant.parse("2026-10-26T16:00:00Z").toEpochMilli();val zone="Asia/Shanghai"
        val midnight=reference;val noon=ClockSelection.timeOfDay(720,reference,zone)
        assertEquals(ClockSelection.timeOfDay(725,reference,zone),ClockSelection.shiftTimeOfDay(noon,1,reference,zone))
        assertEquals(ClockSelection.timeOfDay(715,reference,zone),ClockSelection.shiftTimeOfDay(noon,-1,reference,zone))
        assertEquals(midnight,ClockSelection.shiftTimeOfDay(noon,Int.MIN_VALUE,reference,zone))
        assertEquals(ClockSelection.timeOfDay(1435,reference,zone),ClockSelection.shiftTimeOfDay(noon,Int.MAX_VALUE,reference,zone))
        assertEquals(ClockSelection.timeOfDay(5,reference,zone),ClockSelection.shiftTimeOfDay(null,1,reference,zone))
        for(minutes in listOf(-1,1440))assertThrows(IllegalArgumentException::class.java){ClockSelection.timeOfDay(minutes,reference,zone)}
    }
}
