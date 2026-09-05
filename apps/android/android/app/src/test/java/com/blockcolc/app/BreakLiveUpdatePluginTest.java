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
}
