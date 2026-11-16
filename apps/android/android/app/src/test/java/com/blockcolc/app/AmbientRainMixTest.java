package com.blockcolc.app;
import org.junit.Test;
import static org.junit.Assert.*;

public final class AmbientRainMixTest {
    @Test public void boundedPeakBudgetAndNonlinearRain(){
        assertEquals(.3,AmbientRainMix.intensity(Double.NaN),0);
        assertEquals(0,AmbientRainMix.intensity(-1),0);
        assertEquals(1,AmbientRainMix.intensity(2),0);
        for(int i=0;i<=100;i++){
            double[] pair=AmbientRainMix.gains(i/100.0);
            assertTrue(pair[0]>=0&&pair[1]>=0);
            assertTrue(pair[0]+pair[1]+AmbientRainMix.MAIN_GAIN<=1);
        }
        assertTrue(AmbientRainMix.gains(0)[0]>0);
        assertEquals(0,AmbientRainMix.gains(.12)[1],0);
        assertEquals(0,AmbientRainMix.gains(1)[0],1e-12);
        assertTrue(AmbientRainMix.gains(1)[1]>AmbientRainMix.gains(.5)[1]);
    }
    @Test public void hysteresisSmoothChangeAndDryTail(){
        AmbientRainMix mix=new AmbientRainMix();mix.set(true,.3);
        double[] first=mix.step(60);assertTrue(first[0]>0&&first[0]<AmbientRainMix.gains(.3)[0]);
        mix.step(30000);mix.set(true,.32);assertArrayEquals(AmbientRainMix.gains(.3),mix.step(30000),1e-12);
        mix.set(true,1);double[] moving=mix.step(60);assertTrue(moving[0]>0&&moving[1]<AmbientRainMix.gains(1)[1]);
        assertEquals(AmbientRainMix.gains(1)[1],mix.step(30000)[1],1e-12);
        mix.set(false,0);for(double gain:mix.step(10000))assertTrue(gain<.0001);
    }
}
