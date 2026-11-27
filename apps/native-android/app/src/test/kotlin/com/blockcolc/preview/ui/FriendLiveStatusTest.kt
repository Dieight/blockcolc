package com.blockcolc.preview.ui

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class FriendLiveStatusTest {
    private val start = Instant.parse("2026-11-27T02:00:00Z").toEpochMilli()

    @Test fun aCachedLiveCardStopsAtTheDeadlineEvenWithoutAnotherResponse() {
        val friend = JSONObject().put("focusing", true).put("estimated", true)
            .put("startedAt", Instant.ofEpochMilli(start).toString())
            .put("endsAt", Instant.ofEpochMilli(start + 25 * 60_000L).toString())
            .put("statusExpiresAt", Instant.ofEpochMilli(start + 25 * 60_000L + 90_000L).toString())
        val grace = friendLiveStatus(friend, start + 25 * 60_000L + 60_000L)
        assertEquals(25 * 60_000L, grace.estimatedMs)
        val stale = friendLiveStatus(friend, start + 111 * 60 * 60_000L)
        assertTrue(stale.stale)
        assertFalse(stale.focusing)
        assertNull(stale.estimatedMs)
    }

    @Test fun aConfirmedIdleStatusWinsOverLeftoverTaskFields() {
        val idle = JSONObject().put("focusing", false).put("currentName", "Old task")
            .put("estimated", true).put("startedAt", Instant.ofEpochMilli(start).toString())
        val view = friendLiveStatus(idle, start + 1000)
        assertTrue(view.idle)
        assertFalse(view.focusing)
        assertNull(view.estimatedMs)
        assertFalse(friendLiveStatus(JSONObject(idle.toString()).put("state", "rest"), start).idle)
    }
}
