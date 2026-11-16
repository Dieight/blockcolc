package com.blockcolc.app;

/** Shared playback policy, independent of the player and Android clock. */
final class AmbientPlaybackTiming {
    static int gapMs(double random){return (int)Math.round(12000+18000*Math.max(0,Math.min(1,Double.isNaN(random)||Double.isInfinite(random)?.5:random)));}
    static float fadeGain(long positionMs,long durationMs){
        if(durationMs<=0)return 0;
        double fade=Math.min(1500,durationMs/4.0);
        return (float)Math.max(0,Math.min(1,Math.min(positionMs/fade,(durationMs-positionMs)/fade)));
    }
}
