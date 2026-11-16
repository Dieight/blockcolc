package com.blockcolc.world

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AtlasAnimationTest {
    private fun cases()=JSONArray(javaClass.getResource("/atlas-animation-oracle.json")!!.readText())
    @Test fun nativeTimelineMatchesActualProductionSampling(){
        val rows=cases();var count=0
        for(i in 0 until rows.length()){val row=rows.getJSONObject(i);val timeline=AtlasTimeline.read(row.getJSONObject("input"));val steps=row.getJSONArray("steps")
            for(j in 0 until steps.length()){val s=steps.getJSONObject(j)
                assertEquals(s.getBoolean("changed"),timeline.sample(s.getDouble("elapsed"),s.getBoolean("freeze")))
                fun bytes(a:JSONArray)=ByteArray(a.length()){a.getInt(it).toByte()}
                assertArrayEquals(bytes(s.getJSONArray("pixels")),timeline.pixels);assertArrayEquals(bytes(s.getJSONArray("blend")),timeline.blendPixels);count++}
        };assertEquals(204,count)
    }
    @Test fun changedScheduleAndBadFrozenStateAreRefusedBeforeGpuAllocation(){
        val input=cases().getJSONObject(0).getJSONObject("input")
        for(change in listOf<(JSONObject)->Unit>({it.put("lookupPixelsSha256","bad")},{it.put("width",0)},
            {it.getJSONArray("sequences").getJSONObject(0).put("totalTicks",8)},
            {it.getJSONArray("sequences").getJSONObject(0).getJSONArray("frames").getJSONObject(0).put("textureIndex",12)})){
            val bad=JSONObject(input.toString());change(bad);assertThrows(IllegalArgumentException::class.java){AtlasTimeline.read(bad)}}
    }
}
