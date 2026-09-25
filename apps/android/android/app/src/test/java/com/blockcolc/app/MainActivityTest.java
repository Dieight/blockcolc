package com.blockcolc.app;

import androidx.core.graphics.Insets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MainActivityTest {
    @Test
    public void miniWindowPollingRunsOnlyWhileActivityIsStartedAndAlive() {
        assertTrue(MainActivity.shouldKeepMiniWindowPolling(true, false, false));
        assertFalse(MainActivity.shouldKeepMiniWindowPolling(false, false, false));
        assertFalse(MainActivity.shouldKeepMiniWindowPolling(true, true, false));
        assertFalse(MainActivity.shouldKeepMiniWindowPolling(true, false, true));
    }

    @Test
    public void safeAreaBridgeSkipsUnchangedCssAndCanBeForcedAfterPageLoad() {
        String script = "--native-safe-area-inset-top:24px";
        assertTrue(MainActivity.shouldPublishSafeAreaScript(null, script, false));
        assertFalse(MainActivity.shouldPublishSafeAreaScript(script, script, false));
        assertTrue(MainActivity.shouldPublishSafeAreaScript(script, "--native-safe-area-inset-top:0px", false));
        assertTrue(MainActivity.shouldPublishSafeAreaScript(script, script, true));
        assertFalse(MainActivity.shouldPublishSafeAreaScript(script, "", true));
        assertFalse(MainActivity.shouldPublishSafeAreaScript(script, null, true));
    }

    @Test
    public void safeAreaBridgeCoalescesQueuedInsetsAndRetainsForceRefresh() {
        MainActivity.SafeAreaUpdateGate gate = new MainActivity.SafeAreaUpdateGate();
        assertTrue(gate.offer(Insets.of(0, 1, 0, 0), false));
        for (int top = 2; top <= 100; top++) {
            assertFalse(gate.offer(Insets.of(0, top, 0, 0), top == 100));
        }

        MainActivity.SafeAreaUpdateGate.Update update = gate.consume();
        assertEquals(Insets.of(0, 100, 0, 0), update.insets);
        assertTrue(update.force);

        assertTrue(gate.offer(Insets.of(0, 0, 0, 0), false));
        MainActivity.SafeAreaUpdateGate.Update next = gate.consume();
        assertEquals(Insets.of(0, 0, 0, 0), next.insets);
        assertFalse(next.force);
    }
}
