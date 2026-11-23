package com.blockcolc.presentation

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.pow

class GlassReadabilityTest {
    private fun luminance(c:List<Double>)=c.map{if(it<=.04045)it/12.92 else ((it+.055)/1.055).pow(2.4)}.let{it[0]*.2126+it[1]*.7152+it[2]*.0722}
    @Test fun worstCaseBlackAndWhiteSceneryCannotEraseGlassTextAtAnyTransparency(){
        // WCAG SC1.4.3 uses the underlying colours, before glyph antialiasing:
        // https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
        for(dark in listOf(false,true))for(percent in 0..100){
            val m=GlassReadability.matrix(dark);val coating=(1-percent/100.0)*.96
            val surface=if(dark)listOf(0x17,0x21,0x1c)else listOf(0xf5,0xf7,0xf1)
            for(channel in listOf(0.0,1.0)){
                val background=List(3){i->(channel*m[i*6]+m[i*5+4]/255.0)*(1-coating)+(surface[i]/255.0)*coating}
                val l=luminance(background);val ratio=if(dark)1.05/(l+.05)else(l+.05)/.05
                assertTrue("dark=$dark transparency=$percent scenery=$channel ratio=$ratio",ratio>=4.5)
            }
        }
    }
    @Test fun measuredSceneChoosesTheReadableInkOnClearGlass(){
        val white=doubleArrayOf(1.0,1.0,1.0)
        // Default 100% clarity in light theme leaves a 7.5% white coating.
        val clear=.075
        val deepWater=doubleArrayOf(0x1d/255.0,0x46/255.0,0x77/255.0)
        val sand=doubleArrayOf(0xec/255.0,0xd9/255.0,0xa2/255.0)
        val water=GlassReadability.backgroundLuminance(deepWater,white,clear)
        val beach=GlassReadability.backgroundLuminance(sand,white,clear)
        assertTrue("black on deep water stays below 4.5:1",GlassReadability.contrast(0.0,water)<4.5)
        assertTrue(GlassReadability.lightInk(water,null))
        assertTrue(GlassReadability.contrast(1.0,water)>=4.5)
        assertFalse(GlassReadability.lightInk(beach,null))
        assertTrue(GlassReadability.contrast(0.0,beach)>=4.5)
        // A full coating is the surface itself, whatever lies beneath.
        assertEquals(1.0,GlassReadability.backgroundLuminance(deepWater,white,1.0),1e-9)
    }
    @Test fun inkKeepsItsSideNearTheMidpointAndSwitchesOnAClearAdvantage(){
        // Luminance where black and white ink give the same contrast.
        val midpoint=Math.sqrt(1.05*.05)-.05
        assertTrue(GlassReadability.lightInk(midpoint-.002,false).not())
        assertTrue(GlassReadability.lightInk(midpoint+.002,true))
        assertTrue(GlassReadability.lightInk(midpoint-.002,true))
        assertFalse(GlassReadability.lightInk(midpoint+.002,false))
        assertTrue(GlassReadability.lightInk(.02,false))
        assertFalse(GlassReadability.lightInk(.6,true))
        assertEquals(1.0,GlassReadability.luminance(1.0,1.0,1.0),1e-9)
        assertEquals(0.0,GlassReadability.luminance(0.0,0.0,0.0),1e-9)
    }
    @Test fun legacyNightSwitchCouldPutWhiteInkOverALightSurfaceCoating(){
        val legacy=.42*.56+.95*(1-.56)*.96
        assertTrue(1.05/(luminance(listOf(legacy,legacy,legacy))+.05)<3)
        assertEquals(1f,GlassReadability.matrix(false)[18],0f)
        assertEquals(1f,GlassReadability.matrix(true)[18],0f)
    }
}
