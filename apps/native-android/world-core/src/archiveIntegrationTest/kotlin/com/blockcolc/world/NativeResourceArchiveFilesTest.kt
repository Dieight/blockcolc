package com.blockcolc.world

import com.blockcolc.world.resource.NativeResourceArchive
import com.blockcolc.world.resource.ResourcePackException
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

/** Explicit local-fixture task. These user archives are neither required by
 * normal tests nor bundled in either Android APK. */
class NativeResourceArchiveFilesTest{
    private fun sha(b:ByteArray)=MessageDigest.getInstance("SHA-256").digest(b).joinToString(""){"%02x".format(it.toInt()and 255)}
    @Test fun currentJavaClientAndSuppliedPacksMatchEveryEffectiveSourceFile(){
        val reference=JSONObject(File(checkNotNull(System.getProperty("resourceArchiveFilesOracle"))).readText())
        val rows=reference.getJSONArray("archives");assertTrue(rows.length()>0);val records=JSONArray()
        repeat(rows.length()){i->val row=rows.getJSONObject(i);val file=File(row.getString("path"));val expected=row.getJSONObject("expected");val start=System.nanoTime()
            if(expected.has("error")){
                val error=assertThrows(ResourcePackException::class.java){NativeResourceArchive.open(file).close()};assertEquals(file.name,expected.getString("error"),error.code)
                records.put(JSONObject().put("name",file.name).put("inputBytes",file.length()).put("expectedRejection",error.code))
            }else NativeResourceArchive.open(file).use{archive->
                val opened=System.nanoTime();assertEquals(row.getString("sha256"),archive.inputSha256);assertTrue(file.name,expected.getJSONObject("pack").similar(archive.pack.json()))
                val files=expected.getJSONArray("files");assertEquals(expected.getInt("archiveFileCount"),archive.archiveFileCount)
                assertEquals(file.name,List(files.length()){files.getJSONObject(it).getString("path")},archive.paths)
                repeat(files.length()){n->val f=files.getJSONObject(n);val path=f.getString("path");val content=archive.read(path)
                    assertEquals("${file.name}/$path",f.getInt("size"),content.size);assertEquals("${file.name}/$path",f.getString("sha256"),sha(content))}
                records.put(JSONObject().put("name",file.name).put("inputBytes",file.length()).put("effectiveFiles",files.length()).put("selectedBytes",archive.selectedBytes)
                    .put("indexedMs",(opened-start)/1e6).put("readAndVerifiedMs",(System.nanoTime()-opened)/1e6).put("clientJar",archive.clientJar))
            }
        }
        File(checkNotNull(System.getProperty("resourceArchiveResults"))).writeText(JSONObject().put("schema",1).put("sourceOracle",System.getProperty("resourceArchiveFilesOracle"))
            .put("passed",true).put("archives",records).put("limits","Local JVM observations; not a P4 performance benchmark or Android visual acceptance").toString(2))
    }
}
