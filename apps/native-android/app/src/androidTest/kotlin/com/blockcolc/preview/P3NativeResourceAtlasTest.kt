package com.blockcolc.preview

import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class P3NativeResourceAtlasTest {
    private fun equal(expected:Any?,actual:Any?,path:String){when(expected){
        null,JSONObject.NULL->assertTrue(path,actual==null||actual===JSONObject.NULL)
        is JSONObject->{assertTrue(path,actual is JSONObject);actual as JSONObject;val keys=expected.keys().asSequence().toSet();assertEquals(path,keys,actual.keys().asSequence().toSet());keys.forEach{equal(expected.get(it),actual.get(it),"$path.$it")}}
        is JSONArray->{assertTrue(path,actual is JSONArray);actual as JSONArray;assertEquals(path,expected.length(),actual.length());repeat(expected.length()){equal(expected.get(it),actual.get(it),"$path[$it]")}}
        is Number->{assertTrue(path,actual is Number);assertEquals(path,expected.toDouble(),(actual as Number).toDouble(),0.0)}
        else->assertEquals(path,expected,actual)
    }}
    private fun options(o:JSONObject)=ResourceAtlasLimits(o.optInt("maxTextures",4096),o.optInt("maxPageSize",2048),o.optInt("maxPages",4),o.optInt("gutter",2),
        o.optInt("maxPngBytes",4194304),o.optInt("maxSourcePixelsPerTexture",1048576),o.optLong("maxDecodedBytes",134217728),o.optLong("reservedAtlasBytes",0),o.optLong("additionalWorkingSetBytes",0))
    @Test fun exactNativeAtlasPixelsAnimationUvsAndMemoryBudgetsMatchTheSourceOnAndroid(){
        val reference=JSONObject(javaClass.getResourceAsStream("/native-resource-atlas-oracle.json")!!.bufferedReader().use{it.readText()});val rows=reference.getJSONArray("cases");assertEquals(46,rows.length())
        var accepted=0;var rejected=0;var pages=0;var mappings=0
        repeat(rows.length()){i->val row=rows.getJSONObject(i);val name=row.getString("name");NativeResourceArchive.from(Base64.decode(row.getString("zip"),Base64.DEFAULT)).use{archive->
            val stack=ResourcePackStack.of(ResourcePackAssets.prepare(archive));val selected=row.optJSONArray("selectedIds")?.let{v->List(v.length()){v.getString(it)}.toSet()}
            val textures=stack.textures.values.filter{selected==null||it.resourceId in selected}.let{if(row.getBoolean("duplicate")&&it.isNotEmpty())it+it.first()else it};val expected=row.getJSONObject("expected")
            if(expected.has("error")){val error=assertThrows(name,ResourceAtlasException::class.java){NativeResourceAtlas.buildTextures(textures,options(row.getJSONObject("limits")))}
                assertEquals(name,expected.getString("error"),error.code);assertEquals(name,expected.optString("resourceId").ifEmpty{null},error.resourceId);rejected++}
            else{val atlas=NativeResourceAtlas.buildTextures(textures,options(row.getJSONObject("limits")));equal(expected,atlas.json(),name);accepted++;pages+=atlas.pages.size
                val resolver=stack.resolver();val mapping=row.getJSONObject("mapping")
                equal(mapping.getJSONObject("geometry"),NativeResourceAtlasMapping.geometry(resolver.geometry("minecraft:test"),atlas).json(),"$name.geometry")
                equal(mapping.getJSONObject("textures"),NativeResourceAtlasMapping.textures(resolver.textures("minecraft:test"),atlas).json(),"$name.textures");mappings+=2
            }
        }}
        val label=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
        File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir,"p3-world-resource-atlas.json").writeText(JSONObject().put("schema",1).put("caseLabel",label)
            .put("cases",rows.length()).put("accepted",accepted).put("rejected",rejected).put("pages",pages).put("mappingComparisons",mappings).put("sourceHashes",reference.getJSONObject("sourceHashes")).toString())
    }
}
