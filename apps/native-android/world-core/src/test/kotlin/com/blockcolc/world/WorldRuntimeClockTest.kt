package com.blockcolc.world

import org.junit.Assert.*
import org.junit.Test

class WorldRuntimeClockTest {
    @Test fun daylightAndCloudMotionDoNotAdvanceTheNightFieldAndItsMeteorCycle(){
        val clock=WorldRuntimeClock();assertFalse(clock.advance(0,false));assertTrue(clock.advance(1_000_000_000,false))
        assertEquals(0f,clock.seconds,0f);assertEquals(1f,clock.cloudSeconds,0f);assertEquals(1000.0,clock.weatherElapsedMs,0.0)
        clock.advance(2_000_000_000,true);assertEquals(0f,clock.seconds,0f)
        clock.advance(3_000_000_000,true);assertEquals(1f,clock.seconds,0f)
        clock.advance(4_000_000_000,false);clock.advance(70_000_000_000,false);assertEquals(1f,clock.seconds,0f)
        clock.pause();clock.advance(150_000_000_000,true);assertEquals(1f,clock.seconds,0f)
        clock.advance(151_000_000_000,true);assertEquals(2f,clock.seconds,0f)
    }
    @Test fun visibleTimeContinuesWithoutIntegratingPauseOrUnboundedStall() {
        val clock=WorldRuntimeClock();assertFalse(clock.advance(1_000_000_000));assertTrue(clock.advance(1_500_000_000))
        assertEquals(.5f,clock.seconds,0f);clock.pause();assertFalse(clock.advance(90_000_000_000))
        assertEquals(.5f,clock.seconds,0f);clock.advance(100_000_000_000);assertEquals(2.5f,clock.seconds,0f)
        assertEquals(10.5f,clock.weatherSeconds,0f);assertEquals(1.5f,clock.cloudSeconds,0f)
        assertEquals(.5f,clock.cascadeSeconds,0f)
    }
}
