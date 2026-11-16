package com.blockcolc.world

import com.blockcolc.world.resource.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.CancellationException

class NativeResourceAtlasTest {
    private val reference by lazy{JSONObject(javaClass.getResource("/native-resource-atlas-oracle.json")!!.readText())}
    private fun options(o:JSONObject)=ResourceAtlasLimits(o.optInt("maxTextures",4096),o.optInt("maxPageSize",2048),o.optInt("maxPages",4),o.optInt("gutter",2),
        o.optInt("maxPngBytes",4194304),o.optInt("maxSourcePixelsPerTexture",1048576),o.optLong("maxDecodedBytes",134217728),o.optLong("reservedAtlasBytes",0),o.optLong("additionalWorkingSetBytes",0))
    private fun archive(row:JSONObject)=NativeResourceArchive.from(Base64.getDecoder().decode(row.getString("zip")))
    @Test fun formalAtlasAndSourceHashesAreCurrent(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/resource-pack/src/atlas.ts").isFile};val hashes=reference.getJSONObject("sourceHashes")
        assertTrue(hashes.has("packages/resource-pack/src/atlas.ts"));hashes.keys().forEach{p->val hash=MessageDigest.getInstance("SHA-256").digest(File(root,p).readBytes()).joinToString(""){"%02x".format(it.toInt()and 255)};assertEquals(p,hashes.getString(p),hash)}
    }
    @Test fun pagesPixelsAnimationAlphaAndMemoryAdmissionMatchTheFormalAtlas(){
        val rows=reference.getJSONArray("cases");assertTrue(rows.length()>40)
        repeat(rows.length()){i->val row=rows.getJSONObject(i);archive(row).use{source->val stack=ResourcePackStack.of(ResourcePackAssets.prepare(source));val opts=options(row.getJSONObject("limits"));val expected=row.getJSONObject("expected")
            val selected=row.optJSONArray("selectedIds")?.let{v->List(v.length()){v.getString(it)}.toSet()};val textures=stack.textures.values.filter{selected==null||it.resourceId in selected}.let{if(row.getBoolean("duplicate")&&it.isNotEmpty())it+it.first()else it}
            if(expected.has("error")){val e=assertThrows(row.getString("name"),ResourceAtlasException::class.java){NativeResourceAtlas.buildTextures(textures,opts)}
                assertEquals(row.getString("name"),expected.getString("error"),e.code);assertEquals(row.getString("name"),expected.optString("resourceId").ifEmpty{null},e.resourceId)}else{
                val atlas=NativeResourceAtlas.buildTextures(textures,opts);val actual=atlas.json()
                assertTrue(row.getString("name")+"\nexpected: $expected\nactual: $actual",expected.similar(actual))
                val expectedMapping=row.getJSONObject("mapping");val resolver=stack.resolver()
                val geometry=NativeResourceAtlasMapping.geometry(resolver.geometry("minecraft:test"),atlas).json()
                val cube=NativeResourceAtlasMapping.textures(resolver.textures("minecraft:test"),atlas).json()
                assertTrue(row.getString("name")+" geometry: $geometry",expectedMapping.getJSONObject("geometry").similar(geometry))
                assertTrue(row.getString("name")+" textures: $cube",expectedMapping.getJSONObject("textures").similar(cube))
            }
        }}
    }
    @Test fun pagesAndDescriptorsStayImmutableAndCancellationDoesNotPublishAnAtlas(){
        val row=reference.getJSONArray("cases").getJSONObject(0);archive(row).use{source->val stack=ResourcePackStack.of(ResourcePackAssets.prepare(source));val atlas=NativeResourceAtlas.build(stack)
            assertThrows(java.nio.ReadOnlyBufferException::class.java){atlas.pages.first().pixels().put(0,0.toByte())}
            assertThrows(UnsupportedOperationException::class.java){(atlas.entries as MutableList).clear()}
            assertThrows(UnsupportedOperationException::class.java){(atlas.memoryEstimate as MutableMap).clear()}
            assertThrows(CancellationException::class.java){NativeResourceAtlas.build(stack){true}}
            val before=atlas.json().toString();atlas.json().getJSONArray("entries").getJSONObject(0).put("page",99);assertEquals(before,atlas.json().toString())
            assertThrows(IllegalStateException::class.java){NativeResourceAtlas.build(stack,setOf("missing"))}
        }
    }
}
