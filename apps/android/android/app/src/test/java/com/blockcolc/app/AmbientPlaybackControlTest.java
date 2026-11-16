package com.blockcolc.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class AmbientPlaybackControlTest {
    @Test public void explicitPauseSurvivesFocusAndConfigurationChanges() {
        AmbientPlaybackControl state = new AmbientPlaybackControl();
        state.focus(true); assertTrue(state.allowed());
        state.pause(); assertFalse(state.allowed());
        state.focus(true); assertFalse(state.allowed()); assertTrue(state.paused());
        state.focus(false); state.play(); assertFalse(state.allowed());
        state.focus(true); assertTrue(state.allowed());
    }
    @Test public void transientLossAndResumeNeverChangeUserIntent() {
        AmbientPlaybackControl state = new AmbientPlaybackControl();
        state.focus(true); state.focus(false); assertFalse(state.allowed());
        assertFalse(state.paused()); state.focus(true); assertTrue(state.allowed());
        state.pause(); state.focus(false); state.focus(true); assertFalse(state.allowed());
    }
}
