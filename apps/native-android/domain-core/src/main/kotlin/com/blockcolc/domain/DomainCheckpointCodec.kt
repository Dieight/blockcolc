package com.blockcolc.domain

import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.OutputStream
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.SecretKey

/** Detached headers from an authenticated checkpoint of content-addressed
 * blueprint bodies. Lookups require the caller to verify actual body bytes. */
class BlueprintReadProofs internal constructor(private val headers:Map<String,Header>,private val scans:Map<String,Scan> = emptyMap()){
    internal data class Header(val body:JSONObject,val voxelCount:Int,val decoration:Boolean)
    /** A fresh scan belongs to this exact immutable String and these bounds. */
    class Scan internal constructor(internal val wire:String,internal val decoration:Boolean,
        private val result:DomainValidation.BlueprintProof?){
        internal fun proof()=result?.let{it.copy(header=StrictJson.copy(it.header) as JSONObject)}
    }

    internal fun proof(sha:String,decoration:Boolean):DomainValidation.BlueprintProof? =
        headers[sha]?.takeIf{!decoration||it.decoration}?.let{
            DomainValidation.BlueprintProof(StrictJson.copy(it.body) as JSONObject,it.voxelCount,it.decoration)
        }
    internal fun scan(sha:String,wire:String,decoration:Boolean)=scans[sha]?.takeIf{it.wire===wire&&it.decoration==decoration}

    companion object {
        /** Null result inside a Scan means the owned decoder must read the
         * full tree (e.g. legacy spelling or an invalid voxel). */
        fun scanCurrentWire(wire:String,decoration:Boolean)=Scan(wire,decoration,DomainValidation.proveCanonicalBlueprint(wire,"$.blueprint",decoration))
        fun fromCompletedScans(scans:Map<String,Scan>)=BlueprintReadProofs(emptyMap(),scans.toMap())
    }
}

/** Private authenticated indexes. SQLite supplies the actual canonical
 * strings. Only previously validated metadata is written to these files. */
object DomainCheckpointCodec {
    private const val METADATA_BYTES=1024*1024
    private const val MAX_BYTES=METADATA_BYTES+512
    private const val DOCUMENT_MAGIC=0x42434443
    private const val BLUEPRINT_MAGIC=0x42434250
    private const val VERSION=2
    private val hash=Regex("[a-f0-9]{64}")
    val validator:String by lazy {
        DomainCheckpointCodec::class.java.getResourceAsStream("/domain-checkpoint-validator.sha256")?.use{it.readBytes().toString(Charsets.UTF_8)}?.takeIf{hash.matches(it)}?:""
    }

    fun eligible(domain:DomainDocument)=validator.isNotEmpty()&&domain.canSpliceStartedFocus&&
        domain.canonicalLength in (DomainDocument.SNAPSHOT_CHARACTERS+1)..32*1024*1024

    fun write(output:OutputStream,key:SecretKey,contentDigest:String,domain:DomainDocument):Long {
        require(eligible(domain)&&hash.matches(contentDigest))
        return writeFields(output,key,DOCUMENT_MAGIC,listOf(validator,contentDigest,domain.sha256,StrictJson.render(domain.checkpointMetadata())))
    }

    /** Only invoke parts once the file authenticates and every input matches. */
    fun read(file:File,key:SecretKey,contentDigest:String,domainSha:String,parts:()->List<String>):DomainDocument?=try{
        require(validator.isNotEmpty()&&hash.matches(contentDigest)&&hash.matches(domainSha))
        val metadata=readFields(file,key,DOCUMENT_MAGIC,listOf(validator,contentDigest,domainSha))
        val wire=PipelineCost.section("checkpoint.assemble-wire"){CanonicalWire(parts())}
        PipelineCost.section("checkpoint.domain-sha"){require(wire.sha256()==domainSha)}
        DomainDocument.fromCheckpoint(wire,metadata,domainSha)
    }catch(_:Exception){null}

    fun writeBlueprints(output:OutputStream,key:SecretKey,assetDigest:String,domain:DomainDocument,
                        owners:Map<String,Pair<String,String>>):Long {
        require(validator.isNotEmpty()&&hash.matches(assetDigest)&&owners.isNotEmpty()&&owners.keys.all(hash::matches))
        return writeFields(output,key,BLUEPRINT_MAGIC,listOf(validator,assetDigest,StrictJson.render(domain.checkpointBlueprints(owners))))
    }

    fun readBlueprints(file:File,key:SecretKey,assetDigest:String):BlueprintReadProofs?=try{
        require(validator.isNotEmpty()&&hash.matches(assetDigest))
        val rows=readFields(file,key,BLUEPRINT_MAGIC,listOf(validator,assetDigest))
        require(rows.length() in 1..4096)
        val headers=rows.keys().asSequence().associateWith{sha->
            require(hash.matches(sha))
            val row=JsonChecks.shape(rows.get(sha),"$.blueprintCheckpoint","header voxelCount decoration")
            val header=JsonChecks.shape(row.get("header"),"$.blueprintCheckpoint.header","bounds id schemaVersion title")
            val decoration=JsonChecks.bool(row.get("decoration"),"$.blueprintCheckpoint.decoration")
            val count=JsonChecks.int(row.get("voxelCount"),"$.blueprintCheckpoint.voxelCount",1,if(decoration)2000 else 300000).toInt()
            DomainValidation.checkBlueprintHeader(header,"$.blueprintCheckpoint.header")
            BlueprintReadProofs.Header(header,count,decoration)
        }
        BlueprintReadProofs(headers)
    }catch(_:Exception){null}

    private fun mac(key:SecretKey)=Mac.getInstance("HmacSHA256").apply{init(key)}

    private fun writeFields(output:OutputStream,key:SecretKey,magic:Int,fields:List<String>):Long {
        val buffer=ByteArrayOutputStream()
        val data=DataOutputStream(buffer)
        data.writeInt(magic);data.writeInt(VERSION)
        for(value in fields){
            val size=StrictJson.utf8Size(value)
            require(size<=METADATA_BYTES)
            data.writeInt(size.toInt())
            data.write(value.toByteArray(Charsets.UTF_8))
        }
        val payload=buffer.toByteArray()
        require(payload.size+32<=MAX_BYTES)
        output.write(payload)
        output.write(mac(key).doFinal(payload))
        output.flush()
        return payload.size.toLong()+32
    }

    private fun readFields(file:File,key:SecretKey,magic:Int,identity:List<String>):JSONObject {
        val length=file.length()
        require(length in 128..MAX_BYTES.toLong())
        val bytes=ByteArray(length.toInt())
        PipelineCost.section("checkpoint.read-file"){
            DataInputStream(file.inputStream().buffered()).use{it.readFully(bytes);require(it.read()==-1)}
        }
        val payload=bytes.size-32
        PipelineCost.section("checkpoint.authenticate"){
            val auth=mac(key);auth.update(bytes,0,payload)
            require(MessageDigest.isEqual(auth.doFinal(),bytes.copyOfRange(payload,bytes.size)))
        }
        val data=DataInputStream(ByteArrayInputStream(bytes,0,payload))
        require(data.readInt()==magic&&data.readInt()==VERSION)
        fun text(max:Int):String {
            val size=data.readInt()
            require(size in 0..max&&size<=data.available())
            return StrictJson.decode(ByteArray(size).also(data::readFully),max)
        }
        for(expected in identity)require(text(64)==expected)
        val metadata=StrictJson.parse(text(METADATA_BYTES),METADATA_BYTES) as JSONObject
        require(data.read()==-1)
        return metadata
    }
}
