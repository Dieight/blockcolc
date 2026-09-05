package com.blockcolc.app;

/**
 * Collapses Android's overlapping lifecycle and window-focus callbacks into
 * one physical attention transition. The activity may resume before its
 * window regains focus, especially while the notification shade is closing,
 * so a resume alone must never emit a foreground transition.
 */
final class AttentionStateMachine {
    enum Transition { NONE, BACKGROUND, FOREGROUND }

    private boolean resumed = false;
    private boolean windowFocused = true;
    private boolean waitingForWindowFocus = false;
    private boolean multiWindow = false;
    private boolean miniWindow = false;
    private boolean attending = true;

    Transition onResume() {
        resumed = true;
        return evaluate();
    }

    Transition onPause() {
        resumed = false;
        waitingForWindowFocus = true;
        return evaluate();
    }

    Transition onWindowFocusChanged(boolean hasFocus) {
        windowFocused = hasFocus;
        if (hasFocus) waitingForWindowFocus = false;
        return evaluate();
    }

    Transition onMultiWindowModeChanged(boolean active) {
        multiWindow = active;
        return evaluate();
    }

    Transition onMiniWindowChanged(boolean active) {
        miniWindow = active;
        return evaluate();
    }

    private Transition evaluate() {
        boolean next = resumed
            && windowFocused
            && !waitingForWindowFocus
            && !multiWindow
            && !miniWindow;
        if (next == attending) return Transition.NONE;
        attending = next;
        return next ? Transition.FOREGROUND : Transition.BACKGROUND;
    }
}
