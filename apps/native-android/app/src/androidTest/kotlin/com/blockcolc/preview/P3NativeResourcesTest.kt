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
import java.util.concurrent.CancellationException

/** Synthetic formal-source inputs only. No Activity, saved state, or user resource pack is opened. */
class P3NativeResourcesTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val label get() = InstrumentationRegistry.getArguments().getString("p3Group") ?: "standalone"
    private fun reference(name:String)=JSONObject(javaClass.getResourceAsStream("/$name")!!.bufferedReader().use{it.readText()})
    private fun bytes(row:JSONObject,key:String)=Base64.decode(row.getString(key),Base64.DEFAULT)
    private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt()and 255)}
    private fun limits(v:JSONObject)=ResourceArchiveLimits(v.optInt("maxInputBytes",32*1024*1024),v.optInt("maxFileCount",16384),
        v.optInt("maxSingleFileBytes",4*1024*1024),v.optInt("maxTotalUncompressedBytes",64*1024*1024),v.optInt("maxPackMetadataBytes",64*1024))

    // Android's JSONObject has neither similar() nor stable object-key order.
    private fun equalJson(expected:Any?,actual:Any?,path:String="root") {
        when(expected){
            null,JSONObject.NULL -> assertTrue(path,actual==null||actual===JSONObject.NULL)
            is JSONObject -> {
                assertTrue(path,actual is JSONObject);actual as JSONObject
                val keys=expected.keys().asSequence().toSet();assertEquals(path,keys,actual.keys().asSequence().toSet())
                keys.forEach{equalJson(expected.get(it),actual.get(it),"$path.$it")}
            }
            is JSONArray -> {
                assertTrue(path,actual is JSONArray);actual as JSONArray;assertEquals(path,expected.length(),actual.length())
                repeat(expected.length()){equalJson(expected.get(it),actual.get(it),"$path[$it]")}
            }
            is Number -> {assertTrue(path,actual is Number);assertEquals(path,expected.toDouble(),(actual as Number).toDouble(),0.0)}
            else -> assertEquals(path,expected,actual)
        }
    }
    private fun report(name:String,result:JSONObject){
        File(context.filesDir,name).writeText(result.put("schema",1).put("caseLabel",label).put("source","formal-source-synthetic-oracle").toString())
    }

    @Test fun archivesHaveTheSameMetadataOverlayFilesAndRejectionCodesOnAndroid(){
        val source=reference("native-resource-archive-oracle.json");val rows=source.getJSONArray("cases");assertEquals(39,rows.length())
        var accepted=0;var rejected=0;var verifiedFiles=0
        val directory=File(context.cacheDir,"resource-archive-$label");check(directory.mkdirs()||directory.isDirectory)
        try{
            repeat(rows.length()){i->
                val row=rows.getJSONObject(i);val expected=row.getJSONObject("expected");val input=bytes(row,"zip");val constraints=limits(row.getJSONObject("limits"));val name=row.getString("name")
                val disk=File(directory,"case-$i.zip");disk.writeBytes(input)
                try{
                    if(expected.has("error")){
                        for(open in listOf<()->NativeResourceArchive>({NativeResourceArchive.from(input,constraints)},{NativeResourceArchive.open(disk,constraints)})){
                            val failure=assertThrows(name,ResourcePackException::class.java){open().close()};assertEquals(name,expected.getString("error"),failure.code)
                        };rejected++
                    }else{
                        NativeResourceArchive.from(input,constraints).use{memory->NativeResourceArchive.open(disk,constraints).use{file->
                            equalJson(expected.getJSONObject("pack"),file.pack.json(),name);equalJson(memory.pack.json(),file.pack.json(),name)
                            assertEquals(expected.getInt("archiveFileCount"),file.archiveFileCount);assertEquals(sha(input),file.inputSha256)
                            val files=expected.getJSONArray("files");assertEquals(List(files.length()){files.getJSONObject(it).getString("path")},file.paths)
                            repeat(files.length()){n->val entry=files.getJSONObject(n);val p=entry.getString("path");val got=file.read(p)
                                assertEquals("$name/$p",entry.getInt("size"),got.size);assertEquals("$name/$p",entry.getString("sha256"),sha(got));assertArrayEquals(got,memory.read(p));verifiedFiles++}
                            assertThrows(CancellationException::class.java){file.read(file.paths.first()){true}}
                            val changed=file.pack.json().put("description","mutated");assertNotEquals(changed.opt("description"),file.pack.json().opt("description"))
                        }};accepted++
                    }
                    assertTrue("Caller file survives close",disk.isFile)
                }finally{assertTrue(disk.delete())}
            }
        }finally{assertTrue(directory.delete())}
        assertEquals(8,accepted);assertEquals(31,rejected)
        report("p3-world-resource-archives.json",JSONObject().put("cases",rows.length()).put("accepted",accepted).put("rejected",rejected)
            .put("verifiedFiles",verifiedFiles).put("sourceHashes",source.getJSONObject("sourceHashes")).put("fileAndMemoryInputsAgree",true).put("callerFilesPreserved",true))
    }

    @Test fun pngPixelsAnimationAndTextureSelectionMatchTheFormalDecoderOnAndroid(){
        val source=reference("native-resource-textures-oracle.json");val pngs=source.getJSONArray("pngCases");assertEquals(42,pngs.length())
        var decoded=0;var rejected=0
        repeat(pngs.length()){i->val row=pngs.getJSONObject(i);val input=bytes(row,"png");val expected=row.getJSONObject("expected");val inspect=ResourcePng.inspect(input)
            if(row.isNull("inspection"))assertNull(inspect)else{val e=row.getJSONObject("inspection");assertEquals(e.getLong("width"),inspect!!.width);assertEquals(e.getLong("height"),inspect.height)}
            if(expected.optBoolean("error")){assertThrows(row.getString("name"),IllegalArgumentException::class.java){ResourcePng.decode(input)};rejected++}else{
                val got=ResourcePng.decode(input);assertEquals(expected.getInt("width"),got.width);assertEquals(expected.getInt("height"),got.height)
                val actual=ByteArray(got.rgba().remaining()).also{got.rgba().get(it)};assertArrayEquals(row.getString("name"),bytes(expected,"rgba"),actual)
                assertThrows(java.nio.ReadOnlyBufferException::class.java){got.rgba().put(0,0.toByte())}
                assertThrows(CancellationException::class.java){ResourcePng.decode(input){true}};decoded++
            }
        }
        val animations=source.getJSONArray("animationCases");assertEquals(16,animations.length())
        repeat(animations.length()){i->val row=animations.getJSONObject(i);val metadata=if(row.isNull("metadata"))null else row.getJSONObject("metadata");val expected=row.getJSONObject("expected")
            if(expected.optBoolean("error"))assertThrows(row.getString("name"),IllegalArgumentException::class.java){ResourceAnimationParser.normalize(metadata,row.getInt("width"),row.getInt("height"))}
            else equalJson(expected.opt("animation"),ResourceAnimationParser.normalize(metadata,row.getInt("width"),row.getInt("height"))?.json(),row.getString("name"))
        }
        val catalogs=source.getJSONArray("catalogCases");assertEquals(3,catalogs.length())
        repeat(catalogs.length()){i->val row=catalogs.getJSONObject(i);NativeResourceArchive.from(bytes(row,"zip")).use{archive->
            val catalog=NativeResourceTextures.prepare(archive);val expected=row.getJSONObject("expected");assertEquals(expected.getInt("candidateTextureCount"),catalog.candidates)
            equalJson(expected.getJSONArray("textures"),JSONArray().also{a->catalog.textures.forEach{a.put(it.json())}},row.getString("name"))
            equalJson(expected.getJSONArray("issues"),JSONArray().also{a->catalog.issues.forEach{a.put(JSONObject().put("path",it.path).put("code",it.code))}},row.getString("name"))
        }}
        report("p3-world-resource-textures.json",JSONObject().put("pngCases",pngs.length()).put("decoded",decoded).put("rejected",rejected)
            .put("animationCases",animations.length()).put("catalogCases",catalogs.length()).put("sourceHashes",source.getJSONObject("sourceHashes")))
    }
}
