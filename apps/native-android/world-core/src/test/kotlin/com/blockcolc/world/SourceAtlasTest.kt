package com.blockcolc.world

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SourceAtlasTest {
    @Test fun sevenActualAtlasProgramsRequireExactSourcesAndKeepTheirOperations(){
        val rows=JSONObject(javaClass.getResource("/reviewed-atlas-programs.json")!!.readText()).getJSONArray("programs")
        assertEquals(7,rows.length())
        for(i in 0 until rows.length()){
            val r=rows.getJSONObject(i);val d=r.getJSONObject("definition");val u=r.getJSONObject("uniforms")
            val coverage=ReviewedSurfacePrograms.resolve(d,u);assertTrue(coverage.pending.isEmpty());assertNotNull(coverage.optics.atlas)
            val shape=d.getString("cacheKey").startsWith("blockcolc-atlas-geometry-")
            assertEquals(shape,coverage.optics.atlas!!.shape);assertEquals(!shape,coverage.optics.fluidSurface)
            if(u.has("blockcolcWaterClearSky")){assertNotNull(coverage.optics.clearSky);assertEquals(NightField.NONE,coverage.optics.night)}
            else assertTrue(coverage.applied.contains("night-sky-reflection-v6"))
            for(field in listOf("vertex","fragment","cacheKey","type")){
                val bad=JSONObject(d.toString()).put(field,d.getString(field)+" changed")
                assertEquals(listOf("unreviewed-program"),ReviewedSurfacePrograms.resolve(bad,u).pending)
            }
        }
    }
    @Test fun atlasSamplerIdsAndDimensionsCannotBeCoerced(){
        val u=JSONObject(javaClass.getResource("/reviewed-atlas-programs.json")!!.readText()).getJSONArray("programs").getJSONObject(0).getJSONObject("uniforms")
        for(key in listOf("blockcolcAtlasColumns","blockcolcAtlasCellSize")){
            val bad=JSONObject(u.toString()).put(key,"4");assertThrows(IllegalArgumentException::class.java){SourceAtlas.read(bad,false)}
        }
    }
}
