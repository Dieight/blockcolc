package com.blockcolc.audio

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest

data class ImportedAudio(val id:String,val name:String,val bytes:Long,val durationMs:Long)
class AudioFailure(val code:String,cause:Throwable?=null):IOException(code,cause)
interface AudioIndex {fun read():String?;fun write(value:String)}

/** Owns imported originals and one atomic index; independent of domain/backup.
 * Content is adopted before its index reference. Failed metadata writes keep
 * the previous index, and deletion commits metadata before unlinking content. */
class AudioLibrary(private val folder:File,private val index:AudioIndex,private val duration:(File)->Long) {
    companion object {
        const val MAX_BYTES=64L*1024*1024
        const val MAX_FILES=8
        const val MAX_DURATION=3L*60*60*1000
        private val idPattern=Regex("[a-f0-9]{64}")
        private fun hash(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt()and 255)}
        private fun render(items:List<ImportedAudio>):String=items.joinToString(",","[","]"){v->
            "{\"id\":"+JSONObject.quote(v.id)+",\"name\":"+JSONObject.quote(v.name)+",\"bytes\":"+v.bytes+",\"durationMs\":"+v.durationMs+"}"}
        private fun keys(value:JSONObject)=value.keys().asSequence().toSet()
        private fun integer(value:JSONObject,key:String):Long {val raw=value.get(key)
            if(raw !is Number||!raw.toDouble().isFinite()||raw.toDouble()!=raw.toLong().toDouble())throw AudioFailure("AUDIO_INDEX_INVALID")
            return raw.toLong()}
    }
    private fun file(id:String):File {if(!idPattern.matches(id))throw AudioFailure("AUDIO_INVALID_ID")
        val target=File(folder,id);if(target.canonicalFile.parentFile!=folder.canonicalFile)throw AudioFailure("AUDIO_INVALID_PATH");return target}
    @Synchronized fun list():List<ImportedAudio> {
        try{
            val wire=index.read()?:return emptyList()
            if(wire.length>32768)throw AudioFailure("AUDIO_INDEX_INVALID")
            val root=JSONObject(wire);if(keys(root)!=setOf("schema","items","sha256")||integer(root,"schema")!=1L)throw AudioFailure("AUDIO_INDEX_INVALID")
            val array=root.getJSONArray("items");if(array.length()>MAX_FILES)throw AudioFailure("AUDIO_INDEX_INVALID")
            val entries=(0 until array.length()).map{i->val item=array.getJSONObject(i)
                if(keys(item)!=setOf("id","name","bytes","durationMs"))throw AudioFailure("AUDIO_INDEX_INVALID")
                val v=ImportedAudio(item.get("id") as? String?:throw AudioFailure("AUDIO_INDEX_INVALID"),item.get("name") as? String?:throw AudioFailure("AUDIO_INDEX_INVALID"),integer(item,"bytes"),integer(item,"durationMs"))
                if(!idPattern.matches(v.id)||v.name.isBlank()||v.name.length>80||v.name.any{it.isISOControl()}||v.bytes !in 1..MAX_BYTES||v.durationMs !in 1..MAX_DURATION)throw AudioFailure("AUDIO_INDEX_INVALID")
                if(!file(v.id).isFile||file(v.id).length()!=v.bytes)throw AudioFailure("AUDIO_CONTENT_MISSING")
                v
            }
            if(entries.map{it.id}.distinct().size!=entries.size||root.getString("sha256")!=hash(render(entries).toByteArray(Charsets.UTF_8)))throw AudioFailure("AUDIO_INDEX_INVALID")
            return entries
        }catch(error:AudioFailure){throw error}catch(error:Exception){throw AudioFailure("AUDIO_INDEX_UNAVAILABLE",error)}
    }
    private fun write(items:List<ImportedAudio>){val body=render(items);index.write(JSONObject().put("schema",1).put("items",JSONArray(body))
        .put("sha256",hash(body.toByteArray(Charsets.UTF_8))).toString())}
    @Synchronized fun importAudio(name:String,open:()->InputStream):ImportedAudio {
        val before=list();if(before.size>=MAX_FILES)throw AudioFailure("AUDIO_LIBRARY_FULL")
        if(!folder.isDirectory&&!folder.mkdirs())throw AudioFailure("AUDIO_STORAGE_UNAVAILABLE")
        val temporary=File.createTempFile("import-",".part",folder)
        try{
            val digest=MessageDigest.getInstance("SHA-256");var bytes=0L
            open().use{input->FileOutputStream(temporary).use{output->val buffer=ByteArray(32768)
                while(true){val n=input.read(buffer);if(n<0)break;if(n==0)throw AudioFailure("AUDIO_READ_FAILED")
                    bytes+=n;if(bytes>MAX_BYTES)throw AudioFailure("AUDIO_TOO_LARGE");digest.update(buffer,0,n);output.write(buffer,0,n)};output.fd.sync()}}
            if(bytes==0L)throw AudioFailure("AUDIO_INVALID_MEDIA")
            val length=duration(temporary);if(length !in 1..MAX_DURATION)throw AudioFailure("AUDIO_INVALID_MEDIA")
            val id=digest.digest().joinToString(""){"%02x".format(it.toInt()and 255)}
            before.firstOrNull{it.id==id}?.let{return it}
            val target=file(id)
            if(target.exists()){
                if(!target.isFile||target.length()!=bytes||MessageDigest.getInstance("SHA-256").let{d->target.inputStream().use{input->val b=ByteArray(32768);while(true){val n=input.read(b);if(n<0)break;d.update(b,0,n)}};d.digest().joinToString(""){"%02x".format(it.toInt()and 255)}}!=id)throw AudioFailure("AUDIO_CONTENT_INVALID")
            }else if(!temporary.renameTo(target))throw AudioFailure("AUDIO_STORAGE_UNAVAILABLE")
            val title=name.filter{!it.isISOControl()}.trim().take(80).ifBlank{"Imported audio"}
            val result=ImportedAudio(id,title,bytes,length);write(before+result);return result
        }catch(error:AudioFailure){throw error}catch(error:Exception){throw AudioFailure("AUDIO_IMPORT_FAILED",error)}
        // Metadata failure can have an uncertain commit outcome. Retain the
        // content-addressed original; either index generation remains usable.
        finally{temporary.delete()}
    }
    @Synchronized fun remove(id:String){val before=list();val target=file(id)
        if(before.none{it.id==id})throw AudioFailure("AUDIO_NOT_FOUND")
        try{write(before.filter{it.id!=id})}catch(error:Exception){throw AudioFailure("AUDIO_DELETE_FAILED",error)}
        // A failed unlink leaves unreferenced recoverable content, never a live
        // index pointing to an absent original.
        target.delete()
    }
    @Synchronized fun playable(id:String):File {
        val item=list().singleOrNull{it.id==id}?:throw AudioFailure("AUDIO_NOT_FOUND");val target=file(item.id)
        val digest=MessageDigest.getInstance("SHA-256");target.inputStream().use{input->val buffer=ByteArray(32768);while(true){val n=input.read(buffer);if(n<0)break;digest.update(buffer,0,n)}}
        if(digest.digest().joinToString(""){"%02x".format(it.toInt()and 255)}!=id)throw AudioFailure("AUDIO_CONTENT_INVALID")
        return target
    }
}
