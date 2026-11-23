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
    @Test fun legacyNightSwitchCouldPutWhiteInkOverALightSurfaceCoating(){
        val legacy=.42*.56+.95*(1-.56)*.96
        assertTrue(1.05/(luminance(listOf(legacy,legacy,legacy))+.05)<3)
        assertEquals(1f,GlassReadability.matrix(false)[18],0f)
        assertEquals(1f,GlassReadability.matrix(true)[18],0f)
    }
}
