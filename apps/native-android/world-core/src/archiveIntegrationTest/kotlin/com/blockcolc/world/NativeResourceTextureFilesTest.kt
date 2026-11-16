package com.blockcolc.world

import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class NativeResourceTextureFilesTest{
    @Test fun everyAcceptedTextureFromTheCurrentClientAndUserPacksDecodesOrRejectsLikeTheSource(){
        val reference=JSONObject(File(checkNotNull(System.getProperty("resourceTextureFilesOracle"))).readText());val rows=reference.getJSONArray("archives");val records=JSONArray()
        repeat(rows.length()){i->val row=rows.getJSONObject(i);val file=File(row.getString("path"));NativeResourceArchive.open(file).use{archive->
            assertEquals(row.getString("sha256"),archive.inputSha256);val start=System.nanoTime();val catalog=NativeResourceTextures.prepare(archive);val indexed=System.nanoTime()
            assertEquals(file.name,row.getInt("candidateTextureCount"),catalog.candidates)
            val expected=row.getJSONArray("textures");assertEquals(file.name,expected.length(),catalog.textures.size)
            val issues=JSONArray().also{out->catalog.issues.forEach{out.put(JSONObject().put("path",it.path).put("code",it.code))}};assertTrue("${file.name} issues",row.getJSONArray("issues").similar(issues))
            var decoded=0;var rejected=0
            repeat(expected.length()){n->val value=expected.getJSONObject(n);val metadata=JSONObject(value.toString());metadata.remove("rgbaSha256");metadata.remove("decodeError")
                val actual=catalog.textures[n];assertTrue("${file.name}/${actual.resourceId}",metadata.similar(actual.json()))
                if(value.optBoolean("decodeError")){assertThrows(IllegalArgumentException::class.java){catalog.decode(archive,actual.resourceId)};rejected++}
                else{val image=catalog.decode(archive,actual.resourceId);val digest=MessageDigest.getInstance("SHA-256");digest.update(image.rgba());val sha=digest.digest().joinToString(""){"%02x".format(it.toInt()and 255)}
                    assertEquals("${file.name}/${actual.resourceId}",value.getString("rgbaSha256"),sha);decoded++}
            }
            records.put(JSONObject().put("name",file.name).put("candidates",catalog.candidates).put("textures",catalog.textures.size).put("issues",catalog.issues.size)
                .put("decoded",decoded).put("decodeRejected",rejected).put("indexedMs",(indexed-start)/1e6).put("decodeAndVerifyMs",(System.nanoTime()-indexed)/1e6))
        }}
        File(checkNotNull(System.getProperty("resourceTextureResults"))).writeText(JSONObject().put("schema",1).put("passed",true).put("archives",records)
            .put("limits","Actual source byte comparison on local JVM; no GPU, Android visual or application performance acceptance").toString(2))
    }
}
