package com.blockcolc.world

import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.CancellationException

class NativeResourceStackTest {
    private val reference by lazy{JSONObject(javaClass.getResource("/native-resource-stack-oracle.json")!!.readText())}
    private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt()and 255)}
    private fun imageSha(image:ResourcePngImage)=MessageDigest.getInstance("SHA-256").also{it.update(image.rgba())}.digest().joinToString(""){"%02x".format(it.toInt()and 255)}
    private fun assertJson(name:String,expected:JSONObject,actual:JSONObject)=assertTrue(name+"\nexpected: $expected\nactual: $actual",expected.similar(actual))
    private fun checkStack(name:String,expected:JSONObject,stack:ResourcePackStack){
        assertJson("$name pack",expected.getJSONObject("pack"),stack.pack.json())
        val models=JSONArray().also{a->stack.blocks.models.forEach{a.put(it.json())}};assertTrue("$name models",expected.getJSONArray("models").similar(models))
        val states=JSONArray().also{a->stack.blocks.blockStates.forEach{a.put(it.json())}};assertTrue("$name states",expected.getJSONArray("blockStates").similar(states))
        val summary=stack.summary();val issues=summary.getJSONArray("issues");repeat(issues.length()){issues.getJSONObject(it).remove("source")}
        assertJson("$name summary",expected.getJSONObject("summary"),summary)
        val textures=expected.getJSONArray("textures");assertEquals(textures.length(),stack.textures.size)
        repeat(textures.length()){i->val row=textures.getJSONObject(i);val id=row.getString("resourceId");val value=stack.textures.getValue(id)
            val metadata=JSONObject(row.toString());metadata.remove("pngSha256");assertJson("$name/$id",metadata,value.descriptor.json())
            assertEquals("$name/$id bytes",row.getString("pngSha256"),sha(value.source.archive.read(value.descriptor.archivePath)))
        }
        val specials=expected.getJSONArray("specialTextures");assertEquals(specials.length(),stack.specialTextures.size)
        repeat(specials.length()){i->val row=specials.getJSONObject(i);val id=row.getString("resourceId");val value=stack.specialTextures.getValue(id)
            val metadata=JSONObject(row.toString());metadata.remove("rgbaSha256");assertJson("$name/$id",metadata,value.descriptor.json());assertEquals("$name/$id pixels",row.getString("rgbaSha256"),imageSha(value.decode()))}
        val maps=expected.getJSONArray("colormaps");assertEquals(maps.length(),stack.colormaps.size)
        repeat(maps.length()){i->val row=maps.getJSONObject(i);val id=row.getString("resourceId");val value=stack.colormaps.getValue(id)
            val metadata=JSONObject(row.toString());metadata.remove("rgbaSha256");assertJson("$name/$id",metadata,value.descriptor.json());assertEquals("$name/$id pixels",row.getString("rgbaSha256"),imageSha(value.decode()))}
    }
    @Test fun oracleUsesTheCurrentSpecialTextureColormapAndLayeringSources(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/resource-pack/src/special-textures.ts").isFile}
        val hashes=reference.getJSONObject("sourceHashes");for(p in listOf("special-textures","colormap","layering"))assertTrue(hashes.has("packages/resource-pack/src/$p.ts"))
        hashes.keys().forEach{p->assertEquals(p,hashes.getString(p),sha(File(root,p).readBytes()))}
    }
    @Test fun admittedExtrasPixelsOverlayPriorityAndSummaryCountsMatchTheSource(){
        val rows=reference.getJSONArray("cases");assertEquals(10,rows.length())
        repeat(rows.length()){i->val row=rows.getJSONObject(i);val sources=row.getJSONArray("archives");val archives=ArrayList<NativeResourceArchive>()
            try{var stack:ResourcePackStack?=null
                repeat(sources.length()){n->val archive=NativeResourceArchive.from(Base64.getDecoder().decode(sources.getString(n)));archives+=archive
                    val asset=ResourcePackAssets.prepare(archive);stack=stack?.let{ResourcePackStack.layer(it,asset)}?:ResourcePackStack.of(asset)}
                val actual=checkNotNull(stack);checkStack(row.getString("name"),row.getJSONObject("expected"),actual)
                val queries=row.getJSONArray("queries");repeat(queries.length()){n->val q=queries.getJSONObject(n);val id=q.getString("blockId");val resolver=actual.resolver()
                    assertJson(row.getString("name")+" geometry",q.getJSONObject("geometry"),resolver.geometry(id).json());assertJson(row.getString("name")+" textures",q.getJSONObject("textures"),resolver.textures(id).json())}
            }finally{archives.reversed().forEach{it.close()}}
        }
    }
    @Test fun specialPathWhitelistIsExact(){
        val paths=reference.getJSONArray("allowedPaths");repeat(paths.length()){val row=paths.getJSONObject(it);assertEquals(row.getString("path"),row.getBoolean("expected"),NativeResourcePackExtras.isAllowedSpecialTexturePath(row.getString("path")))}
    }
    @Test fun layerChangesNeverMutateTheBaseAndDecodingRetainsTheCorrectArchive(){
        val row=reference.getJSONArray("cases").getJSONObject(1);val input=row.getJSONArray("archives");val archives=(0 until input.length()).map{NativeResourceArchive.from(Base64.getDecoder().decode(input.getString(it)))}
        try{val base=ResourcePackAssets.prepare(archives[0]);val overlay=ResourcePackAssets.prepare(archives[1]);val initial=ResourcePackStack.of(base);val identity=initial.identity
            val stacked=ResourcePackStack.layer(initial,overlay);assertNotEquals(identity,stacked.identity);assertEquals(identity,initial.identity);assertEquals(16,initial.textures.values.single().descriptor.width);assertEquals(32,stacked.textures.values.single().descriptor.width)
            assertSame(overlay,stacked.textures.values.single().source);assertSame(base,initial.textures.values.single().source)
            assertThrows(UnsupportedOperationException::class.java){(stacked.textures as MutableMap).clear()}
            assertThrows(CancellationException::class.java){ResourcePackAssets.prepare(archives[0]){true}}
            assertThrows(CancellationException::class.java){stacked.textures.values.single().decode{true}}
            assertThrows(CancellationException::class.java){initial.specialTextures.values.first().decode{true}}
            var long=initial;repeat(7){long=ResourcePackStack.layer(long,overlay)};assertThrows(IllegalArgumentException::class.java){ResourcePackStack.layer(long,overlay)}
        }finally{archives.reversed().forEach{it.close()}}
    }
}
