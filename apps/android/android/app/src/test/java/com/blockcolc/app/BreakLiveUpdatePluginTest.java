package com.blockcolc.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class BreakLiveUpdatePluginTest {
    @Test
    public void sameUpdateKeySuppressesOnlyTheExactActiveTimer() {
        assertTrue(BreakLiveUpdatePlugin.sameUpdateKey("focus\u0000session", "focus\u0000session"));
        assertFalse(BreakLiveUpdatePlugin.sameUpdateKey("focus\u0000session", "break\u0000session"));
        assertFalse(BreakLiveUpdatePlugin.sameUpdateKey(null, "focus"));
        assertFalse(BreakLiveUpdatePlugin.sameUpdateKey("", ""));
    }

    @Test
    public void kindSpecificCleanupCannotCancelTheOtherTimerState() {
        assertTrue(BreakLiveUpdatePlugin.sameKind("focus", "focus"));
        assertTrue(BreakLiveUpdatePlugin.sameKind("break", "break"));
        assertFalse(BreakLiveUpdatePlugin.sameKind("focus", "break"));
        assertFalse(BreakLiveUpdatePlugin.sameKind("break", "focus"));
        // Pre-upgrade notifications had no kind and were always break updates.
        assertTrue(BreakLiveUpdatePlugin.sameKind(null, "break"));
        assertFalse(BreakLiveUpdatePlugin.sameKind(null, "focus"));
    }

    @Test
    public void timerTagIsStableForOneTimerAndChangesForTheNext() {
        assertTrue(BreakLiveUpdatePlugin.timerTag("focus\u0000session-a")
            .equals(BreakLiveUpdatePlugin.timerTag("focus\u0000session-a")));
        assertFalse(BreakLiveUpdatePlugin.timerTag("focus\u0000session-a")
            .equals(BreakLiveUpdatePlugin.timerTag("break\u0000session-a")));
        assertFalse(BreakLiveUpdatePlugin.timerTag("focus\u0000session-a")
            .equals(BreakLiveUpdatePlugin.timerTag("focus\u0000session-b")));
    }

    @Test
    public void deadlineIsOnlyOwnedByReturnToFocusBreaks() {
        assertTrue(BreakLiveUpdatePlugin.shouldScheduleDeadline("break", true));
        assertFalse(BreakLiveUpdatePlugin.shouldScheduleDeadline("break", false));
        assertFalse(BreakLiveUpdatePlugin.shouldScheduleDeadline("focus", true));
    }

    @Test
    public void deadlineRequestIdentityIsStableAndReachabilityIsAbsolute() {
        assertTrue(BreakLiveUpdatePlugin.deadlineRequestCode("break\u0000session-a")
            == BreakLiveUpdatePlugin.deadlineRequestCode("break\u0000session-a"));
        assertFalse(BreakLiveUpdatePlugin.deadlineRequestCode("break\u0000session-a")
            == BreakLiveUpdatePlugin.deadlineRequestCode("break\u0000session-b"));
        assertTrue(BreakLiveUpdatePlugin.deadlineReached(1000L, 1000L));
        assertFalse(BreakLiveUpdatePlugin.deadlineReached(1000L, 999L));
    }

    @Test
    public void automaticContinuationEventsRequireStableOpaqueIdentityAndAbsoluteTime() {
        assertTrue(BreakLiveUpdatePlugin.validAutomaticContinuationEvent(
            "authorization-a:round:3", "authorization-a", 1000L
        ));
        assertFalse(BreakLiveUpdatePlugin.validAutomaticContinuationEvent(
            "authorization-a/round/3", "authorization-a", 1000L
        ));
        assertFalse(BreakLiveUpdatePlugin.validAutomaticContinuationEvent(
            "authorization-a:round:3", "", 1000L
        ));
        assertFalse(BreakLiveUpdatePlugin.validAutomaticContinuationEvent(
            "authorization-a:round:3", "authorization-a", 0L
        ));
    }

    @Test
    public void automaticContinuationAlarmIdentityIsRepeatable() {
        assertTrue(BreakLiveUpdatePlugin.automaticContinuationRequestCode("authorization-a:round:3")
            == BreakLiveUpdatePlugin.automaticContinuationRequestCode("authorization-a:round:3"));
        assertFalse(BreakLiveUpdatePlugin.automaticContinuationRequestCode("authorization-a:round:3")
            == BreakLiveUpdatePlugin.automaticContinuationRequestCode("authorization-a:round:4"));
    }
}
