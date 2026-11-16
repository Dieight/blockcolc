package com.blockcolc.app;

/** User pause is separate from OS audio focus. A late focus gain or a volume /
 * weather update must not restart audio that the user explicitly paused. */
final class AmbientPlaybackControl {
    private boolean paused, focused;
    boolean paused() { return paused; }
    boolean allowed() { return !paused && focused; }
    void pause() { paused = true; focused = false; }
    void play() { paused = false; }
    void focus(boolean value) { focused = value; }
}
