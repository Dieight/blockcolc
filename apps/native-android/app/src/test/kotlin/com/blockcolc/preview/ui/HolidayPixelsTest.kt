package com.blockcolc.preview.ui

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class HolidayPixelsTest {
    @Test fun everyIntegerPixelAndColorMatchesTheActualFormalArtwork(){
        val glyphs=JSONObject(javaClass.getResource("/reward-presentation-oracle.json")!!.readText()).getJSONObject("glyphs")
        assertTrue(glyphs.length()>35)
        glyphs.keys().forEach{name->val expected=glyphs.getJSONObject(name);val actual=HolidayPixels.glyph(name)
            val rows=expected.getJSONArray("rows");val colors=expected.getJSONArray("colors")
            assertEquals(name,List(rows.length()){rows.getString(it)},actual.rows)
            assertEquals(name,List(colors.length()){colors.getLong(it)},actual.colors)
            assertTrue(actual.rows.all{it.length<=12&&it.all{pixel->pixel=='.'||pixel in 'a'..'c'}})
        }
    }
}
