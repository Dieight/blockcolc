package com.blockcolc.app;
import org.junit.Test;
import static org.junit.Assert.*;
public final class AmbientPlaybackTimingTest {
    @Test public void boundedRandomSilence(){assertEquals(12000,AmbientPlaybackTiming.gapMs(-1));assertEquals(21000,AmbientPlaybackTiming.gapMs(.5));assertEquals(30000,AmbientPlaybackTiming.gapMs(1));assertEquals(21000,AmbientPlaybackTiming.gapMs(Double.NaN));}
    @Test public void fadesAtBothEndsWithoutShorteningTheRecording(){
        assertEquals(0,AmbientPlaybackTiming.fadeGain(0,180000),0);assertEquals(.5f,AmbientPlaybackTiming.fadeGain(750,180000),.0001);
        assertEquals(1,AmbientPlaybackTiming.fadeGain(90000,180000),0);assertEquals(.5f,AmbientPlaybackTiming.fadeGain(179250,180000),.0001);assertEquals(0,AmbientPlaybackTiming.fadeGain(180000,180000),0);
        assertEquals(1,AmbientPlaybackTiming.fadeGain(500,1000),0);assertEquals(0,AmbientPlaybackTiming.fadeGain(0,0),0);
    }
}
