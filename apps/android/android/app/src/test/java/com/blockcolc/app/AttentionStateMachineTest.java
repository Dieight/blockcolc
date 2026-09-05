package com.blockcolc.app;

import static com.blockcolc.app.AttentionStateMachine.Transition.BACKGROUND;
import static com.blockcolc.app.AttentionStateMachine.Transition.FOREGROUND;
import static com.blockcolc.app.AttentionStateMachine.Transition.NONE;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AttentionStateMachineTest {
    @Test
    public void notificationShadeProducesOneLeaveAndOneReturn() {
        AttentionStateMachine state = new AttentionStateMachine();
        assertEquals(NONE, state.onResume());
        assertEquals(BACKGROUND, state.onWindowFocusChanged(false));
        assertEquals(NONE, state.onPause());
        assertEquals(NONE, state.onResume());
        assertEquals(FOREGROUND, state.onWindowFocusChanged(true));
    }

    @Test
    public void appBackgroundProducesOneLeaveDespiteCallbackOrdering() {
        AttentionStateMachine state = new AttentionStateMachine();
        assertEquals(NONE, state.onResume());
        assertEquals(BACKGROUND, state.onPause());
        assertEquals(NONE, state.onWindowFocusChanged(false));
        assertEquals(NONE, state.onResume());
        assertEquals(FOREGROUND, state.onWindowFocusChanged(true));
    }

    @Test
    public void areaPollingCannotDuplicateTheSamePhysicalTransition() {
        AttentionStateMachine state = new AttentionStateMachine();
        assertEquals(NONE, state.onResume());
        assertEquals(BACKGROUND, state.onMiniWindowChanged(true));
        assertEquals(NONE, state.onPause());
        assertEquals(NONE, state.onMiniWindowChanged(false));
        assertEquals(NONE, state.onResume());
        assertEquals(FOREGROUND, state.onWindowFocusChanged(true));
    }
}
