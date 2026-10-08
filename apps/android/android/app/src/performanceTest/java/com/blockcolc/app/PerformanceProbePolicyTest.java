package com.blockcolc.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class PerformanceProbePolicyTest {
    @Test public void inputIsNotJavaScriptOrTaskText() {
        assertTrue(PerformanceProbePolicy.validId("perf-57_cold1"));
        for (String id : new String[]{null, "", "a');fetch('/secret')", "含任务标题", new String(new char[49])}) assertFalse(PerformanceProbePolicy.validId(id));
        assertFalse(PerformanceProbePolicy.KEYS.contains("title"));
        assertFalse(PerformanceProbePolicy.KEYS.contains("activeResourcePackId"));
        assertFalse(PerformanceProbePolicy.KEYS.contains("location"));
        assertFalse(PerformanceProbePolicy.TARGETS.contains("start-focus"));
    }
    @Test public void screenLeaseExpiresAndReleasesInBackground() {
        assertTrue(PerformanceProbePolicy.canKeepScreenOn(true, true, 99, 100));
        assertFalse(PerformanceProbePolicy.canKeepScreenOn(true, true, 100, 100));
        assertFalse(PerformanceProbePolicy.canKeepScreenOn(false, true, 0, 100));
        assertFalse(PerformanceProbePolicy.canKeepScreenOn(true, false, 0, 100));
    }
    @Test public void nonFiniteOrExcessiveNumbersCannotEnterLogs() {
        assertTrue(PerformanceProbePolicy.validNumber(-50));
        assertFalse(PerformanceProbePolicy.validNumber(Double.NaN));
        assertFalse(PerformanceProbePolicy.validNumber(Double.POSITIVE_INFINITY));
        assertFalse(PerformanceProbePolicy.validNumber(1e15));
    }
}
