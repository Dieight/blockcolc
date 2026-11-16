package com.blockcolc.world

import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class NativeResourceAtlasFilesTest {
    @Test fun actualClientAndLayeredPacksHaveTheSameNativeResolutionAtlasPixelsAndAdmission(){
        val source=JSONObject(File(checkNotNull(System.getProperty("resourceAtlasFilesOracle"))).readText());val rows=source.getJSONArray("archives");assertEquals(5,rows.length())
        val opened=ArrayList<NativeResourceArchive>();val records=JSONArray()
        try{var base:ResourcePackStack?=null
            repeat(rows.length()){i->val row=rows.getJSONObject(i);val file=File(row.getString("path"));val archive=NativeResourceArchive.open(file);opened+=archive
                assertEquals(row.getString("sha256"),archive.inputSha256);val assets=ResourcePackAssets.prepare(archive)
                val stack=if(base==null)ResourcePackStack.of(assets).also{base=it}else ResourcePackStack.layer(checkNotNull(base),assets)
                val expected=row.getJSONObject("expected");val record=JSONObject().put("name",file.name).put("textures",stack.textures.size);val start=System.nanoTime()
                if(expected.has("error")){val error=assertThrows(ResourceAtlasException::class.java){NativeResourceAtlas.build(stack)}
                    assertEquals(file.name,expected.getString("error"),error.code);assertEquals(expected.optString("resourceId").ifEmpty{null},error.resourceId);record.put("rejected",error.code)}
                else{val atlas=NativeResourceAtlas.build(stack);val actual=atlas.json()
                    assertEquals(file.name,expected.getInt("textureSize"),atlas.textureSize);assertTrue(file.name+" metadata/pixel digest/memory",expected.similar(actual))
                    record.put("entries",atlas.entries.size).put("pages",atlas.pages.size).put("pageBytes",atlas.memoryEstimate.getValue("pageRgbaBytes"))
                        .put("estimatedPeakBytes",atlas.memoryEstimate.getValue("estimatedPeakBytes")).put("pageSha256",JSONArray(atlas.pages.map{it.sha256}))}
                records.put(record.put("buildAndVerifyMs",(System.nanoTime()-start)/1e6))
            }
        }finally{opened.reversed().forEach{it.close()}}
        File(checkNotNull(System.getProperty("resourceAtlasResults"))).writeText(JSONObject().put("schema",1).put("passed",true).put("archives",records)
            .put("scope","Exact complete native-resolution atlas metadata, page RGBA SHA, animation and conservative memory estimates on local JVM. No GPU rendering or device performance acceptance.").toString(2))
    }
}
