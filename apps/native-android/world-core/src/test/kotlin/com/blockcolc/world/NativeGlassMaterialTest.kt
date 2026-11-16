package com.blockcolc.world

import org.junit.Assert.*
import org.junit.Test

class NativeGlassMaterialTest {
    @Test fun matchesFormalClarityEndpointsAndNightCeiling(){
        val frosted=NativeGlassMaterial.forClarity(0,false)
        assertEquals(32f,frosted.blur,0f);assertEquals(.9f,frosted.tintAlpha,.00001f)
        val clear=NativeGlassMaterial.forClarity(100,false)
        assertEquals(2f,clear.blur,0f);assertEquals(.075f,clear.tintAlpha,.00001f)
        assertEquals(1.26f,clear.saturation,.00001f)
        val dark=NativeGlassMaterial.forClarity(100,true,true)
        assertEquals(.13f,dark.tintAlpha,.00001f);assertEquals(.92f,dark.brightness,0f);assertEquals(.3f,dark.ceiling,.00001f)
        assertEquals(1f,NativeGlassMaterial.forClarity(74,true,true).ceiling,0f)
        assertEquals(.2f,NativeGlassMaterial.forClarity(75,true,true).ceiling,0f)
    }
    @Test fun clarityNeverIncreasesScatteringOrTint(){
        for(dark in listOf(false,true))for(i in 1..100){
            val a=NativeGlassMaterial.forClarity(i-1,dark);val b=NativeGlassMaterial.forClarity(i,dark)
            assertTrue(b.blur<=a.blur);assertTrue(b.tintAlpha<=a.tintAlpha)
        }
    }
    @Test fun previousClarityKeepsWorldColoursWithoutAnAdditionalLuminanceVeil(){
        for(dark in listOf(false,true))for(clarity in 0..100){
            val day=NativeGlassMaterial.forClarity(clarity,dark)
            assertEquals("No extra white veil",0f,day.floor,0f)
            assertEquals("No extra daytime ceiling",1f,day.ceiling,0f)
            assertEquals(0f,NativeGlassMaterial.forClarity(clarity,dark,true).floor,0f)
        }
        assertEquals(.075f,NativeGlassMaterial.forClarity(100,false).tintAlpha,.00001f)
        assertEquals(.13f,NativeGlassMaterial.forClarity(100,true).tintAlpha,.00001f)
        assertEquals(.3f,NativeGlassMaterial.forClarity(100,false,true).ceiling,.00001f)
        assertFalse(NativeGlassMaterial.usesLightInk(0,false,true))
    }
}
