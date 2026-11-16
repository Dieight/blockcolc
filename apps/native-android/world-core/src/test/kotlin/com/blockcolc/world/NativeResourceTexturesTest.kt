package com.blockcolc.world

import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.ReadOnlyBufferException
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.CancellationException

class NativeResourceTexturesTest{
    private val reference by lazy{JSONObject(javaClass.getResource("/native-resource-textures-oracle.json")!!.readText())}
    private fun bytes(row:JSONObject,key:String)=Base64.getDecoder().decode(row.getString(key))
    @Test fun actualSourcePngAndMetadataImplementationsAreReferenced(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/resource-pack/src/png.ts").isFile};val hashes=reference.getJSONObject("sourceHashes")
        assertTrue(hashes.has("packages/resource-pack/src/png.ts"));assertTrue(hashes.has("packages/resource-pack/src/index.ts"))
        hashes.keys().forEach{f->val sha=MessageDigest.getInstance("SHA-256").digest(File(root,f).readBytes()).joinToString(""){"%02x".format(it.toInt()and 255)};assertEquals(f,hashes.getString(f),sha)}
    }
    @Test fun everyPngFilterColourDepthAndTransparencyMatchesTheActualSourceDecoder(){
        val rows=reference.getJSONArray("pngCases");assertTrue(rows.length()>=40)
        repeat(rows.length()){i->val row=rows.getJSONObject(i);val input=bytes(row,"png");val expected=row.getJSONObject("expected");val inspect=ResourcePng.inspect(input)
            if(row.isNull("inspection"))assertNull(row.getString("name"),inspect)else{val e=row.getJSONObject("inspection");assertEquals(e.getLong("width"),inspect!!.width);assertEquals(e.getLong("height"),inspect.height)}
            if(expected.optBoolean("error"))assertThrows(row.getString("name"),IllegalArgumentException::class.java){ResourcePng.decode(input)}else{
                val got=ResourcePng.decode(input);assertEquals(expected.getInt("width"),got.width);assertEquals(expected.getInt("height"),got.height)
                val actual=ByteArray(got.rgba().remaining()).also{got.rgba().get(it)};assertArrayEquals(row.getString("name"),bytes(expected,"rgba"),actual)
            }
        }
    }
    @Test fun animationFramesBoundsDefaultsAndGridOrderMatchTheSource(){
        val rows=reference.getJSONArray("animationCases");assertTrue(rows.length()>=16)
        repeat(rows.length()){i->val row=rows.getJSONObject(i);val metadata=if(row.isNull("metadata"))null else row.getJSONObject("metadata");val expected=row.getJSONObject("expected")
            if(expected.optBoolean("error"))assertThrows(row.getString("name"),IllegalArgumentException::class.java){ResourceAnimationParser.normalize(metadata,row.getInt("width"),row.getInt("height"))}else{
                val got=ResourceAnimationParser.normalize(metadata,row.getInt("width"),row.getInt("height"))
                if(expected.isNull("animation"))assertNull(got)else assertTrue(row.getString("name"),expected.getJSONObject("animation").similar(got!!.json()))
            }
        }
    }
    @Test fun archiveTextureSelectionFallbackAndOrphansMatchTheProductionParser(){
        val rows=reference.getJSONArray("catalogCases");assertEquals(3,rows.length())
        repeat(rows.length()){i->val row=rows.getJSONObject(i);NativeResourceArchive.from(bytes(row,"zip")).use{archive->
            val got=NativeResourceTextures.prepare(archive);val expected=row.getJSONObject("expected");assertEquals(expected.getInt("candidateTextureCount"),got.candidates)
            val textures=JSONArray().also{out->got.textures.forEach{out.put(it.json())}};assertTrue(row.getString("name"),expected.getJSONArray("textures").similar(textures))
            val issues=JSONArray().also{out->got.issues.forEach{out.put(JSONObject().put("path",it.path).put("code",it.code))}};assertTrue(row.getString("name"),expected.getJSONArray("issues").similar(issues))
        }}
    }
    @Test fun decodedPixelsAreReadOnlyAndBudgetsApplyBeforeImageAllocation(){
        val input=bytes(reference.getJSONArray("pngCases").getJSONObject(0),"png");val image=ResourcePng.decode(input)
        assertThrows(ReadOnlyBufferException::class.java){image.rgba().put(0,0)}
        assertThrows(IllegalArgumentException::class.java){ResourcePng.decode(input,ResourcePngLimits(maxPixels=1))}
        assertThrows(IllegalArgumentException::class.java){ResourcePng.decode(input,expectedWidth=1)}
        assertThrows(IllegalArgumentException::class.java){ResourcePng.decode(input,expectedHeight=1)}
        assertThrows(IllegalArgumentException::class.java){ResourcePngLimits(maxDecodedBytes=0)}
    }
    @Test fun imageAndCatalogCancellationDoesNotPublishAHalfResult(){
        val input=bytes(reference.getJSONArray("pngCases").getJSONObject(0),"png")
        assertThrows(CancellationException::class.java){ResourcePng.decode(input){true}}
        val row=reference.getJSONArray("catalogCases").getJSONObject(0);NativeResourceArchive.from(bytes(row,"zip")).use{archive->
            assertThrows(CancellationException::class.java){NativeResourceTextures.prepare(archive){true}}
            val catalog=NativeResourceTextures.prepare(archive);assertEquals(7,catalog.textures.size)
            assertThrows(CancellationException::class.java){catalog.decode(archive,catalog.textures[0].resourceId){true}}
            NativeResourceArchive.from(bytes(reference.getJSONArray("catalogCases").getJSONObject(1),"zip")).use{other->assertThrows(IllegalArgumentException::class.java){catalog.decode(other,catalog.textures[0].resourceId)}}
        }
    }
}
