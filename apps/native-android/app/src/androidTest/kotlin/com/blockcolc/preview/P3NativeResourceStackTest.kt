package com.blockcolc.preview

import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class P3NativeResourceStackTest {
    private fun equal(expected:Any?,actual:Any?,path:String){when(expected){
        null,JSONObject.NULL->assertTrue(path,actual==null||actual===JSONObject.NULL)
        is JSONObject->{assertTrue(path,actual is JSONObject);actual as JSONObject;val keys=expected.keys().asSequence().toSet();assertEquals(path,keys,actual.keys().asSequence().toSet());keys.forEach{equal(expected.get(it),actual.get(it),"$path.$it")}}
        is JSONArray->{assertTrue(path,actual is JSONArray);actual as JSONArray;assertEquals(path,expected.length(),actual.length());repeat(expected.length()){equal(expected.get(it),actual.get(it),"$path[$it]")}}
        is Number->{assertTrue(path,actual is Number);assertEquals(path,expected.toDouble(),(actual as Number).toDouble(),0.0)}
        else->assertEquals(path,expected,actual)
    }}
    private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt()and 255)}
    private fun pixels(image:ResourcePngImage)=MessageDigest.getInstance("SHA-256").also{it.update(image.rgba())}.digest().joinToString(""){"%02x".format(it.toInt()and 255)}
    @Test fun layeringSpecialTexturesAndColormapsKeepSourceOwnershipAndBoundsOnAndroid(){
        val reference=JSONObject(javaClass.getResourceAsStream("/native-resource-stack-oracle.json")!!.bufferedReader().use{it.readText()});val rows=reference.getJSONArray("cases");assertEquals(10,rows.length())
        var checkedTextures=0;var checkedSpecial=0;var checkedColormaps=0
        repeat(rows.length()){i->val row=rows.getJSONObject(i);val sources=row.getJSONArray("archives");val archives=ArrayList<NativeResourceArchive>()
            try{var stack:ResourcePackStack?=null
                repeat(sources.length()){n->val archive=NativeResourceArchive.from(Base64.decode(sources.getString(n),Base64.DEFAULT));archives+=archive
                    val assets=ResourcePackAssets.prepare(archive);stack=stack?.let{ResourcePackStack.layer(it,assets)}?:ResourcePackStack.of(assets)}
                val got=checkNotNull(stack);val expected=row.getJSONObject("expected");val name=row.getString("name")
                equal(expected.getJSONObject("pack"),got.pack.json(),"$name.pack")
                equal(expected.getJSONArray("blockStates"),JSONArray().also{a->got.blocks.blockStates.forEach{a.put(it.json())}},"$name.states")
                equal(expected.getJSONArray("models"),JSONArray().also{a->got.blocks.models.forEach{a.put(it.json())}},"$name.models")
                val summary=got.summary();val issues=summary.getJSONArray("issues");repeat(issues.length()){issues.getJSONObject(it).remove("source")};equal(expected.getJSONObject("summary"),summary,"$name.summary")
                val textures=expected.getJSONArray("textures");assertEquals(textures.length(),got.textures.size)
                repeat(textures.length()){n->val e=textures.getJSONObject(n);val id=e.getString("resourceId");val value=got.textures.getValue(id);val metadata=JSONObject(e.toString());metadata.remove("pngSha256")
                    equal(metadata,value.descriptor.json(),"$name/$id");assertEquals(e.getString("pngSha256"),sha(value.source.archive.read(value.descriptor.archivePath)));checkedTextures++}
                val special=expected.getJSONArray("specialTextures");assertEquals(special.length(),got.specialTextures.size)
                repeat(special.length()){n->val e=special.getJSONObject(n);val id=e.getString("resourceId");val value=got.specialTextures.getValue(id);val metadata=JSONObject(e.toString());metadata.remove("rgbaSha256")
                    equal(metadata,value.descriptor.json(),"$name/$id");assertEquals("$name/$id",e.getString("rgbaSha256"),pixels(value.decode()));checkedSpecial++}
                val maps=expected.getJSONArray("colormaps");assertEquals(maps.length(),got.colormaps.size)
                repeat(maps.length()){n->val e=maps.getJSONObject(n);val id=e.getString("resourceId");val value=got.colormaps.getValue(id);val metadata=JSONObject(e.toString());metadata.remove("rgbaSha256")
                    equal(metadata,value.descriptor.json(),"$name/$id");assertEquals(e.getString("rgbaSha256"),pixels(value.decode()));checkedColormaps++}
                val queries=row.getJSONArray("queries");repeat(queries.length()){n->val e=queries.getJSONObject(n);val id=e.getString("blockId");val resolver=got.resolver()
                    equal(e.getJSONObject("geometry"),resolver.geometry(id).json(),"$name.geometry");equal(e.getJSONObject("textures"),resolver.textures(id).json(),"$name.textures")}
            }finally{archives.reversed().forEach{it.close()}}
        }
        val allowed=reference.getJSONArray("allowedPaths");repeat(allowed.length()){i->val e=allowed.getJSONObject(i);assertEquals(e.getBoolean("expected"),NativeResourcePackExtras.isAllowedSpecialTexturePath(e.getString("path")))}
        val label=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
        File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir,"p3-world-resource-stack.json").writeText(JSONObject().put("schema",1).put("caseLabel",label)
            .put("cases",rows.length()).put("whitelistCases",allowed.length()).put("checkedTextures",checkedTextures).put("checkedSpecialTextures",checkedSpecial)
            .put("checkedColormaps",checkedColormaps).put("sourceHashes",reference.getJSONObject("sourceHashes")).toString())
    }
}
