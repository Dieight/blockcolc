package com.blockcolc.world.resource

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.CancellationException

data class StoredNativeResourcePack(val id:String,val name:String,val importedAt:Long,val bytes:Long,val packFormat:Long,val clientJar:Boolean,
    val textures:Int,val models:Int,val states:Int,val specialTextures:Int,val colormaps:Int,val issues:Int)
enum class ResourceContentState{PRESENT,MISSING,CHANGED}
class ResourceLibraryState internal constructor(val revision:Long,val selectionInitialized:Boolean,val activeId:String?,val baseId:String?,items:List<StoredNativeResourcePack>){
    val items:List<StoredNativeResourcePack> = Collections.unmodifiableList(items.toList())
}
interface ResourceLibraryIndex{fun read():String?;fun write(canonical:String)}
class ResourceLibraryFailure(val code:String,cause:Throwable?=null):IOException(code,cause)
class ResourceLibraryLease internal constructor(val state:ResourceLibraryState,val stack:ResourcePackStack?,private val archives:List<NativeResourceArchive>):AutoCloseable{
    override fun close(){archives.reversed().forEach{it.close()}}
}

/** Single IO-owner local library, independent of task data and backups. It
 * never extracts an archive path or deletes a caller's source file. */
class ResourcePackLibrary(private val folder:File,private val index:ResourceLibraryIndex,private val clock:()->Long={System.currentTimeMillis()}){
    companion object{
        const val MAX_INDEX_BYTES=1024*1024
        const val MAX_FILES=512
        private val idPattern=Regex("[a-f0-9]{64}")
        private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt()and 255)}
        private fun hash(file:File,cancelled:()->Boolean):String{
            val digest=MessageDigest.getInstance("SHA-256")
            file.inputStream().use{input->val bytes=ByteArray(32768);while(true){checkpoint(cancelled);val n=input.read(bytes);if(n<0)break;if(n==0)throw ResourceLibraryFailure("RESOURCE_READ_FAILED");digest.update(bytes,0,n)}}
            return digest.digest().joinToString(""){"%02x".format(it.toInt()and 255)}
        }
        private fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Resource library operation superseded")}
        private fun keys(o:JSONObject)=o.keys().asSequence().toSet()
        private fun itemJson(v:StoredNativeResourcePack)=JSONObject().put("id",v.id).put("name",v.name).put("importedAt",v.importedAt).put("bytes",v.bytes)
            .put("packFormat",v.packFormat).put("clientJar",v.clientJar).put("textures",v.textures).put("models",v.models).put("states",v.states)
            .put("specialTextures",v.specialTextures).put("colormaps",v.colormaps).put("issues",v.issues)
        private fun itemsJson(items:List<StoredNativeResourcePack>)=JSONArray().also{a->items.forEach{a.put(itemJson(it))}}
        private fun body(s:ResourceLibraryState)=JSONObject().put("revision",s.revision).put("selectionInitialized",s.selectionInitialized)
            .put("activeId",s.activeId?:JSONObject.NULL).put("baseId",s.baseId?:JSONObject.NULL).put("items",itemsJson(s.items))
        // Explicit ordered rendering also works on Android's JSONObject implementation.
        private fun render(s:ResourceLibraryState):String{
            val items=s.items.joinToString(",","[","]"){v->"["+listOf(JSONObject.quote(v.id),JSONObject.quote(v.name),v.importedAt,v.bytes,v.packFormat,v.clientJar,v.textures,v.models,v.states,v.specialTextures,v.colormaps,v.issues).joinToString(",")+"]"}
            return "[${s.revision},${s.selectionInitialized},${s.activeId?.let(JSONObject::quote)?:"null"},${s.baseId?.let(JSONObject::quote)?:"null"},$items]"
        }
    }
    private fun content(id:String):File{
        if(!idPattern.matches(id))throw ResourceLibraryFailure("RESOURCE_INVALID_ID")
        val file=File(folder,"$id.pack")
        if(file.canonicalFile.parentFile!=folder.canonicalFile)throw ResourceLibraryFailure("RESOURCE_INVALID_PATH")
        return file
    }
    private fun parse(text:String?):ResourceLibraryState{
        if(text==null)return ResourceLibraryState(0,false,null,null,emptyList())
        try{
            val bytes=text.toByteArray(Charsets.UTF_8);require(bytes.size<=MAX_INDEX_BYTES)
            val root=ResourceJson.parse(bytes) as? JSONObject?:error("Index must be an object")
            require(keys(root)==setOf("schema","payload","sha256"));require(root.get("schema") is Number&&root.getDouble("schema")==1.0)
            val o=root.getJSONObject("payload");require(keys(o)==setOf("revision","selectionInitialized","activeId","baseId","items"))
            fun integer(o:JSONObject,key:String,min:Long=0,max:Long=9007199254740991):Long{
                val raw=o.get(key);require(raw is Number&&raw.toDouble().isFinite()&&raw.toDouble()==raw.toLong().toDouble()&&raw.toLong() in min..max);return raw.toLong()
            }
            fun optionalId(key:String):String?=if(o.isNull(key))null else(o.get(key) as? String)?.also{require(idPattern.matches(it))}?:error("Invalid identity")
            val array=o.getJSONArray("items");require(array.length()<=MAX_FILES)
            val items=List(array.length()){i->val x=array.getJSONObject(i)
                require(keys(x)==setOf("id","name","importedAt","bytes","packFormat","clientJar","textures","models","states","specialTextures","colormaps","issues"))
                val id=x.get("id") as? String?:error("Invalid identity");val name=x.get("name") as? String?:error("Invalid name")
                require(idPattern.matches(id)&&name.isNotBlank()&&name.length<=120&&name.none{it.isISOControl()});val jar=x.get("clientJar") as? Boolean?:error("Invalid input type")
                StoredNativeResourcePack(id,name,integer(x,"importedAt"),integer(x,"bytes",1,if(jar)NativeResourceArchive.MAX_JAR_BYTES.toLong()else ResourceArchiveLimits().maxInputBytes.toLong()),
                    integer(x,"packFormat",1),jar,integer(x,"textures",0,50000).toInt(),integer(x,"models",0,50000).toInt(),integer(x,"states",0,50000).toInt(),
                    integer(x,"specialTextures",0,512).toInt(),integer(x,"colormaps",0,3).toInt(),integer(x,"issues",0,200000).toInt())
            }
            require(items.map{it.id}.distinct().size==items.size)
            val state=ResourceLibraryState(integer(o,"revision"),o.get("selectionInitialized") as? Boolean?:error("Invalid selection"),optionalId("activeId"),optionalId("baseId"),items)
            require(state.activeId==null||items.any{it.id==state.activeId});require(state.baseId==null||items.any{it.id==state.baseId})
            require(state.selectionInitialized||items.isEmpty()&&state.activeId==null&&state.baseId==null)
            require(root.getString("sha256")==sha(render(state).toByteArray(Charsets.UTF_8)))
            return state
        }catch(error:ResourceLibraryFailure){throw error}catch(error:Exception){throw ResourceLibraryFailure("RESOURCE_INDEX_INVALID",error)}
    }
    @Synchronized fun snapshot():ResourceLibraryState{
        val state=try{parse(index.read())}catch(error:ResourceLibraryFailure){throw error}catch(error:Exception){throw ResourceLibraryFailure("RESOURCE_INDEX_UNAVAILABLE",error)}
        return state
    }
    @Synchronized fun inspectContents():Map<String,ResourceContentState> = Collections.unmodifiableMap(snapshot().items.associate{item->
        val file=content(item.id);item.id to if(!file.isFile)ResourceContentState.MISSING else if(file.length()!=item.bytes)ResourceContentState.CHANGED else ResourceContentState.PRESENT})
    private fun commit(state:ResourceLibraryState):ResourceLibraryState{
        try{
            val expected=render(state);val canonical=JSONObject().put("schema",1).put("payload",body(state)).put("sha256",sha(expected.toByteArray(Charsets.UTF_8))).toString()
            require(canonical.toByteArray(Charsets.UTF_8).size<=MAX_INDEX_BYTES)
            index.write(canonical)
            check(render(parse(index.read()))==expected){"Resource index commit could not be verified"}
            return state
        }catch(error:Exception){throw ResourceLibraryFailure("RESOURCE_INDEX_COMMIT_UNCONFIRMED",error)}
    }
    private fun next(s:ResourceLibraryState,active:String?=s.activeId,base:String?=s.baseId,items:List<StoredNativeResourcePack> = s.items):ResourceLibraryState{
        if(s.revision>=9007199254740991)throw ResourceLibraryFailure("RESOURCE_REVISION_EXHAUSTED")
        return ResourceLibraryState(s.revision+1,true,active,base,items)
    }
    @Synchronized fun importPack(name:String,open:()->InputStream,cancelled:()->Boolean={false}):StoredNativeResourcePack{
        checkpoint(cancelled);val before=snapshot()
        if(!folder.isDirectory&&!folder.mkdirs())throw ResourceLibraryFailure("RESOURCE_STORAGE_UNAVAILABLE")
        val temporary=File.createTempFile("resource-import-",".part",folder)
        try{
            var size=0L;val digest=MessageDigest.getInstance("SHA-256")
            open().use{input->FileOutputStream(temporary).use{output->val buffer=ByteArray(32768)
                while(true){checkpoint(cancelled);val n=input.read(buffer);if(n<0)break;if(n==0)throw ResourceLibraryFailure("RESOURCE_READ_FAILED")
                    size+=n;if(size>NativeResourceArchive.MAX_JAR_BYTES)throw ResourceLibraryFailure("RESOURCE_INPUT_TOO_LARGE")
                    digest.update(buffer,0,n);output.write(buffer,0,n)};output.fd.sync()}}
            val id=digest.digest().joinToString(""){"%02x".format(it.toInt()and 255)}
            val existing=before.items.firstOrNull{it.id==id}
            if(existing!=null){
                if(size!=existing.bytes)throw ResourceLibraryFailure("RESOURCE_CONTENT_INVALID")
                val file=content(id)
                if(file.isFile&&file.length()==existing.bytes&&hash(file,cancelled)==id)return existing
            }
            if(existing==null&&before.items.size>=MAX_FILES)throw ResourceLibraryFailure("RESOURCE_LIBRARY_FULL")
            val item=NativeResourceArchive.open(temporary,cancelled=cancelled).use{archive->
                check(archive.inputSha256==id);val assets=ResourcePackAssets.prepare(archive,cancelled)
                val total=assets.textures.textures.size+assets.blocks.models.size+assets.extras.specialTextures.size+assets.extras.colormaps.size
                if(total==0)throw ResourceLibraryFailure("RESOURCE_NO_USABLE_ASSETS")
                val title=name.filter{!it.isISOControl()}.trim().take(120).ifBlank{"Imported resource pack"}
                StoredNativeResourcePack(id,title,clock().also{require(it in 0..9007199254740991)},size,archive.pack.packFormat,archive.clientJar,
                    assets.textures.textures.size,assets.blocks.models.size,assets.blocks.blockStates.size,assets.extras.specialTextures.size,assets.extras.colormaps.size,
                    assets.textures.issues.size+assets.blocks.issues.size+assets.extras.issues.size)
            }
            checkpoint(cancelled);val target=content(id)
            if(target.exists()){
                if(!target.isFile)throw ResourceLibraryFailure("RESOURCE_CONTENT_INVALID")
                if(target.length()!=size||hash(target,cancelled)!=id){
                    if(existing==null)throw ResourceLibraryFailure("RESOURCE_CONTENT_INVALID")
                    // A validated reimport repairs its own content identity.
                    // Retain damaged bytes separately, including on a failed
                    // replacement; never overwrite them with a partial stream.
                    val retained=File.createTempFile("resource-damaged-",".pack",folder)
                    if(!retained.delete()||!target.renameTo(retained))throw ResourceLibraryFailure("RESOURCE_STORAGE_UNAVAILABLE")
                    if(!temporary.renameTo(target)){
                        if(!target.exists())retained.renameTo(target)
                        throw ResourceLibraryFailure("RESOURCE_STORAGE_UNAVAILABLE")
                    }
                }
            }else if(!temporary.renameTo(target))throw ResourceLibraryFailure("RESOURCE_STORAGE_UNAVAILABLE")
            if(existing!=null)return existing // Selection and metadata stay unchanged.
            // Once content is adopted it is retained even if the index writer
            // reports an uncertain outcome. Retrying resolves by content ID.
            commit(next(before,active=if(before.selectionInitialized)before.activeId else id,items=before.items+item))
            return item
        }catch(error:CancellationException){throw error}catch(error:ResourceLibraryFailure){throw error}
        catch(error:ResourcePackException){throw error}catch(error:Exception){throw ResourceLibraryFailure("RESOURCE_IMPORT_FAILED",error)}
        finally{temporary.delete()}
    }
    @Synchronized fun select(id:String?,base:Boolean=false):ResourceLibraryState{
        val before=snapshot();if(id!=null&&before.items.none{it.id==id})throw ResourceLibraryFailure("RESOURCE_NOT_FOUND")
        if(before.selectionInitialized&&id==(if(base)before.baseId else before.activeId))return before
        return commit(if(base)next(before,base=id)else next(before,active=id))
    }
    @Synchronized fun remove(id:String):ResourceLibraryState{
        val before=snapshot();if(before.items.none{it.id==id})throw ResourceLibraryFailure("RESOURCE_NOT_FOUND")
        val target=content(id);val result=commit(next(before,active=before.activeId?.takeUnless{it==id},base=before.baseId?.takeUnless{it==id},items=before.items.filter{it.id!=id}))
        target.delete();return result // A failed unlink leaves a recoverable orphan.
    }
    @Synchronized fun useOriginal():ResourceLibraryState{
        val before=snapshot();if(before.selectionInitialized&&before.activeId==null&&before.baseId==null)return before
        return commit(next(before,active=null,base=null))
    }
    @Synchronized fun openSelection(cancelled:()->Boolean={false}):ResourceLibraryLease{
        checkpoint(cancelled);val state=snapshot();val ids=listOfNotNull(state.baseId,state.activeId).distinct()
        val opened=ArrayList<NativeResourceArchive>()
        try{
            val assets=ids.map{id->checkpoint(cancelled);val file=content(id);val item=state.items.single{it.id==id}
                if(!file.isFile)throw ResourceLibraryFailure("RESOURCE_CONTENT_MISSING")
                if(file.length()!=item.bytes)throw ResourceLibraryFailure("RESOURCE_CONTENT_INVALID")
                val archive=NativeResourceArchive.open(file,cancelled=cancelled);opened+=archive
                if(archive.inputSha256!=id)throw ResourceLibraryFailure("RESOURCE_CONTENT_INVALID")
                ResourcePackAssets.prepare(archive,cancelled)}
            val stack=if(assets.isEmpty())null else assets.drop(1).fold(ResourcePackStack.of(assets.first(),cancelled)){lower,upper->ResourcePackStack.layer(lower,upper,cancelled)}
            checkpoint(cancelled);return ResourceLibraryLease(state,stack,opened.toList())
        }catch(error:Exception){opened.reversed().forEach{it.close()};throw error}
    }
}
