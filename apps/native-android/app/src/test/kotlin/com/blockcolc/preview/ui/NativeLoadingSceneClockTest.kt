package com.blockcolc.preview.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class NativeLoadingSceneClockTest {
    private fun ns(seconds:Double)=(seconds*1_000_000_000).toLong()

    @Test fun houseHandoffRetainsElapsedTimeEvenWhenAFrameDidNotNeedRepainting() {
        val choice=NativeLoadingChoice(tomato=false,house=0)
        val storage=Any()
        val world=Any()
        choice.attach(storage,0)
        choice.sample(storage,ns(2.8))
        assertEquals(2.8f,choice.phase,.001f)
        choice.attach(world,ns(3.0))
        choice.sample(world,ns(3.0))
        assertSame(storage,choice.leader)
        choice.detach(storage,ns(3.1))
        assertSame(world,choice.leader)
        choice.sample(world,ns(3.2))
        assertEquals(2.8f,choice.phase,.001f)
        choice.detach(world,ns(3.2))

        val resumed=Any()
        choice.attach(resumed,ns(40.0))
        choice.sample(resumed,ns(41.7))
        assertEquals(4.9f,choice.phase,.001f)
    }

    @Test fun tomatoRepaintsForGrowthAndMovementAndReusesHeldFrames() {
        val choice=NativeLoadingChoice(tomato=true)
        val lease=Any()
        choice.attach(lease,0)
        choice.sample(lease,ns(.8))
        assertEquals(0f,choice.phase,0f)
        choice.sample(lease,ns(1.2))
        choice.sample(lease,ns(1.7))
        assertEquals(1.2f,choice.phase,.001f)
        choice.sample(lease,ns(3.1))
        choice.sample(lease,ns(3.8))
        assertEquals(3.1f,choice.phase,.001f)
        choice.sample(lease,ns(5.8))
        choice.sample(lease,ns(5.9))
        assertEquals(5.9f,choice.phase,.001f)
        choice.sample(lease,ns(7.6))
        choice.sample(lease,ns(7.65))
        assertEquals(7.6f,choice.phase,.001f)
        choice.sample(lease,ns(8.0))
        assertEquals(8.0f,choice.phase,.001f)
    }
}
