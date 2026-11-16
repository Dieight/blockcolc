package com.blockcolc.app;

import org.junit.Test;
import static org.junit.Assert.*;

public final class AmbientSourcesTest {
    @Test public void oneMainAndRain() {
        assertTrue(AmbientSources.valid(new String[]{"forest-birds", "rain"}));
        assertTrue(AmbientSources.valid(new String[]{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "rain"}));
        assertTrue(AmbientSources.valid(new String[]{"rain"}));
        assertTrue(AmbientSources.valid(new String[]{}));
    }
    @Test public void noExtraLayersOrLegacyBeds() {
        assertFalse(AmbientSources.valid(new String[]{"evening-lakeside", "morning-birdsong"}));
        assertFalse(AmbientSources.builtin("evening-lakeside"));
        for (String retired : new String[]{"morning-birdsong", "calm-ocean"}) {
            assertFalse(AmbientSources.builtin(retired));
            assertNull(AmbientSources.asset(retired));
            assertFalse(AmbientSources.valid(new String[]{retired}));
        }
        assertFalse(AmbientSources.valid(new String[]{"evening-lakeside"}));
        assertFalse(AmbientSources.valid(new String[]{"rain", "rain"}));
        assertFalse(AmbientSources.valid(new String[]{"ocean"}));
        assertFalse(AmbientSources.valid(new String[]{"../../secret"}));
    }
    @Test public void fullRecordingsAndBothRainLayersAreStreamingAssets() {
        for (String source : new String[]{"shore-waves", "forest-birds"}) {
            assertTrue(AmbientSources.builtin(source));
            assertEquals("public/audio/" + source + ".ogg", AmbientSources.asset(source));
            assertTrue(AmbientSources.valid(new String[]{source, "rain"}));
            assertTrue(AmbientSources.valid(new String[]{source}));
            assertFalse(AmbientSources.valid(new String[]{source, "morning-birdsong"}));
            assertFalse(AmbientSources.valid(new String[]{source, source}));
        }
        assertNull(AmbientSources.asset("rain"));
        assertFalse(AmbientSources.valid(new String[]{"rain-light"}));
        assertEquals("public/audio/rain-light.ogg",AmbientSources.rainAsset(0));
        assertEquals("public/audio/rain-heavy.ogg",AmbientSources.rainAsset(1));
        assertNull(AmbientSources.asset("../calm-ocean"));
        assertNull(AmbientSources.asset("a".repeat(64)));
    }
}
