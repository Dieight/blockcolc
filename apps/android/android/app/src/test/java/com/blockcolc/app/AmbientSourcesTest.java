package com.blockcolc.app;

import org.junit.Test;
import static org.junit.Assert.*;

public final class AmbientSourcesTest {
    @Test public void oneMainAndRain() {
        assertTrue(AmbientSources.valid(new String[]{"morning-birdsong", "rain"}));
        assertTrue(AmbientSources.valid(new String[]{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "rain"}));
        assertTrue(AmbientSources.valid(new String[]{"rain"}));
        assertTrue(AmbientSources.valid(new String[]{}));
    }
    @Test public void noExtraLayersOrLegacyBeds() {
        assertFalse(AmbientSources.valid(new String[]{"evening-lakeside", "morning-birdsong"}));
        assertFalse(AmbientSources.builtin("evening-lakeside"));
        assertFalse(AmbientSources.valid(new String[]{"evening-lakeside"}));
        assertFalse(AmbientSources.valid(new String[]{"rain", "rain"}));
        assertFalse(AmbientSources.valid(new String[]{"ocean"}));
        assertFalse(AmbientSources.valid(new String[]{"../../secret"}));
    }
}
