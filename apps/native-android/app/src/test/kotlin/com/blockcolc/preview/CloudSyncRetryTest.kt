package com.blockcolc.preview

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CloudSyncRetryTest {
    @Test fun showsOnlyOnTheThirdFailureAndHonorsIgnoringTheCurrentEpisode(){
        val first=CloudSyncRetry().failed("REQUEST_TIMEOUT")
        val second=first.failed("NETWORK_UNAVAILABLE")
        val third=second.failed("NETWORK_UNAVAILABLE")
        assertNull(first.visibleError)
        assertNull(second.visibleError)
        assertEquals("NETWORK_UNAVAILABLE",third.visibleError)
        assertNull(third.copy(ignored=true).failed("REQUEST_TIMEOUT").visibleError)
        assertNull(CloudSyncRetry().visibleError)
    }

    @Test fun countdownRoundsUpUntilTheActualScheduledDeadline(){
        val waiting=CloudSyncRetry(nextAt=20_000)
        assertEquals(10L,waiting.secondsUntilRetry(10_000))
        assertEquals(2L,waiting.secondsUntilRetry(18_999))
        assertEquals(1L,waiting.secondsUntilRetry(19_999))
        assertEquals(0L,waiting.secondsUntilRetry(20_001))
        assertNull(waiting.copy(nextAt=null,inFlight=true).secondsUntilRetry(20_001))
    }
}
