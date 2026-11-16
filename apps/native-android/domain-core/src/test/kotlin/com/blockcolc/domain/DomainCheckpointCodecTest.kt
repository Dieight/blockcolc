package com.blockcolc.domain

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.*
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class DomainCheckpointCodecTest {
    private val key=SecretKeySpec(ByteArray(32){(it+1).toByte()},"HmacSHA256")
    private val content=StrictJson.sha("actual rows in this test")
    private fun domain():DomainDocument {
        val command=DomainEngine.command("CreateProject","projectId" to "work","title" to "工坊","blueprintId" to "window","subtasks" to JSONArray().put(JSONObject().put("id","first").put("title","第一步")))
        val root=DomainEngine.execute(DomainEngine.initial("UTC"),command,0).state.json()
        root.getJSONObject("worldSettings").put("worldSeed","海🦉\"\\\n".repeat(60000))
        val body=JSONObject().put("schemaVersion",1).put("id","window").put("title","玻璃窗")
            .put("bounds",JSONObject().put("minX",0).put("maxX",0).put("minY",0).put("maxY",0).put("minZ",0).put("maxZ",0))
            .put("voxels",JSONArray().put(JSONObject().put("x",0).put("y",0).put("z",0).put("materialId","glass").put("stage","foundation").put("buildOrder",0)))
        root.getJSONArray("projects").getJSONObject(0).put("importedBlueprint",body)
        root.getJSONArray("buildingBlueprintResources").put(JSONObject().put("id","window").put("displayName","玻璃窗").put("blueprint",body).put("importedAt","1970-01-01T00:00:00.000Z"))
        return DomainDocument.fromOwnedJson(root)
    }
    private fun run(block:(File,DomainDocument,ByteArray)->Unit){
        val file=File.createTempFile("blockcolc-checkpoint-",".bin");val doc=domain()
        try{
            assertTrue(DomainCheckpointCodec.validator.matches(Regex("[a-f0-9]{64}")))
            assertTrue(DomainCheckpointCodec.eligible(doc))
            file.outputStream().use{DomainCheckpointCodec.write(it,key,content,doc)}
            assertTrue(file.length()<16_384)
            block(file,doc,file.readBytes())
        }finally{check(file.delete())}
    }
    private fun parts(doc:DomainDocument):List<String>{
        val body=checkNotNull(doc.blueprintCanonical("projects","work"))
        return doc.canonical.split(body).flatMapIndexed{index,part->if(index==0)listOf(part)else listOf(body,part)}
    }
    @Test fun authenticatedLargeDocumentRetainsAllViewsOwnedBodiesAndFutureCommands()=run{file,doc,_->
        val restored=checkNotNull(DomainCheckpointCodec.read(file,key,content,doc.sha256){parts(doc)})
        assertEquals(doc,restored);assertEquals(doc.sha256,restored.sha256)
        assertEquals(doc.projectionJson().toString(),restored.projectionJson().toString())
        assertEquals(doc.focusControlJson().toString(),restored.focusControlJson().toString())
        assertEquals(doc.registeredDailyRewardIds(),restored.registeredDailyRewardIds())
        assertEquals(doc.birthdayObservationJson().toString(),restored.birthdayObservationJson().toString())
        assertEquals(doc.blueprintCanonical("projects","work"),restored.blueprintCanonical("projects","work"))
        val start=DomainEngine.command("StartFocus","sessionId" to "session","projectId" to "work","subtaskId" to "first","plannedDurationMs" to 60000)
        assertEquals(DomainEngine.execute(doc,start,1000),DomainEngine.execute(restored,start,1000))
        restored.json().getJSONArray("projects").getJSONObject(0).put("title","changed")
        assertEquals(doc,restored)
        assertNull(DomainCheckpointCodec.read(file,key,content,doc.sha256){parts(doc).dropLast(1)})
    }
    @Test fun wrongKeysContentsVersionsTruncationAndTrailingBytesAreMisses()=run{file,doc,bytes->
        assertNull(DomainCheckpointCodec.read(file,key,StrictJson.sha("changed rows"),doc.sha256){parts(doc)})
        assertNull(DomainCheckpointCodec.read(file,key,content,StrictJson.sha("changed domain")){parts(doc)})
        assertNull(DomainCheckpointCodec.read(file,SecretKeySpec(ByteArray(32),"HmacSHA256"),content,doc.sha256){parts(doc)})
        for(bad in listOf(bytes.copyOf(bytes.size-1),bytes+byteArrayOf(0),bytes.copyOf().also{it[it.size/2]=(it[it.size/2].toInt()xor 1).toByte()})){
            file.writeBytes(bad);assertNull(DomainCheckpointCodec.read(file,key,content,doc.sha256){parts(doc)})
        }
        val old=bytes.copyOf();old[7]=0;file.writeBytes(resign(old.copyOf(old.size-32)))
        assertNull(DomainCheckpointCodec.read(file,key,content,doc.sha256){parts(doc)})
        val changedValidator=bytes.copyOf();changedValidator[12]=if(changedValidator[12]=='a'.code.toByte())'b'.code.toByte()else'a'.code.toByte()
        file.writeBytes(resign(changedValidator.copyOf(changedValidator.size-32)))
        assertNull(DomainCheckpointCodec.read(file,key,content,doc.sha256){parts(doc)})
    }
    @Test fun authenticatedMalformedLengthsAndOffsetsCannotConstructADocument()=run{file,doc,bytes->
        val badLength=bytes.copyOf(bytes.size-32);for(i in 8..11)badLength[i]=0x7f
        file.writeBytes(resign(badLength));assertNull(DomainCheckpointCodec.read(file,key,content,doc.sha256){parts(doc)})
        val input=DataInputStream(ByteArrayInputStream(bytes,0,bytes.size-32));val magic=input.readInt();val version=input.readInt()
        fun text():String{val n=input.readInt();return ByteArray(n).also{input.readFully(it)}.toString(Charsets.UTF_8)}
        val fields=List(4){text()}.toMutableList()
        val metadata=StrictJson.parse(fields.last()) as JSONObject
        metadata.getJSONObject("roots").getJSONArray("activeFocusSession").put(0,-1)
        fields[fields.lastIndex]=StrictJson.render(metadata)
        val body=ByteArrayOutputStream();val out=DataOutputStream(body);out.writeInt(magic);out.writeInt(version)
        fields.forEach{value->val encoded=value.toByteArray(Charsets.UTF_8);out.writeInt(encoded.size);out.write(encoded)}
        file.writeBytes(resign(body.toByteArray()));assertNull(DomainCheckpointCodec.read(file,key,content,doc.sha256){parts(doc)})
    }
    @Test fun blueprintHeadersRequireTheVerifiedAssetIdentityAndTheOriginalLimits()=run{file,doc,_->
        val body=checkNotNull(doc.blueprintCanonical("projects","work"));val sha=StrictJson.sha(body)
        val assets=StrictJson.sha("set of verified addresses")
        file.outputStream().use{DomainCheckpointCodec.writeBlueprints(it,key,assets,doc,mapOf(sha to ("projects" to "work")))}
        val proofs=checkNotNull(DomainCheckpointCodec.readBlueprints(file,key,assets))
        assertEquals("window",proofs.proof(sha,false)?.header?.getString("id"))
        assertNull(proofs.proof(sha,true))
        assertNull(proofs.proof(StrictJson.sha("new body"),false))
        assertNull(DomainCheckpointCodec.readBlueprints(file,key,StrictJson.sha("other set")))
        val bytes=file.readBytes();bytes[bytes.lastIndex]=(bytes.last().toInt()xor 1).toByte();file.writeBytes(bytes)
        assertNull(DomainCheckpointCodec.readBlueprints(file,key,assets))
    }
    private fun resign(payload:ByteArray):ByteArray=payload+Mac.getInstance("HmacSHA256").apply{init(key)}.doFinal(payload)
}
