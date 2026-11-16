package com.blockcolc.storage.android

import android.content.Context
import android.util.AtomicFile
import com.blockcolc.domain.BlueprintReadProofs
import com.blockcolc.domain.DomainCheckpointCodec
import com.blockcolc.domain.DomainDocument
import com.blockcolc.storage.BlueprintCheckpointSource
import com.blockcolc.storage.DomainReadCache
import java.io.File
import java.io.OutputStream
import java.util.concurrent.Executors

/** Two recent document indexes and two independent blueprint sets. One
 * background worker coalesces offers and writes each file atomically. */
class AndroidDomainReadCache(context:Context,scope:String="domain-read-cache-v1"):DomainReadCache,AutoCloseable {
    init{require(scope.matches(Regex("[a-z0-9-]{1,80}")))}
    private val directory=File(context.cacheDir,scope)
    private val keys=AndroidDomainCheckpointKey(context,scope)
    private val worker=Executors.newSingleThreadExecutor{task->Thread({android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);task.run()},"blockcolc-read-cache")}
    init {
        // Unlock the small key while the state actor reads actual SQLite rows.
        // A fresh install does no keystore work until it has a cache to write.
        if(keys.hasWrappedKey())worker.execute{keys.read()}
    }
    private val lock=Any();private val io=Any()
    private data class Offer(val content:String,val domain:DomainDocument,val blueprints:BlueprintCheckpointSource?)
    private var closed=false;private var scheduled=false;private var pending:Offer?=null
    private val known=linkedSetOf<String>()
    private val documents=Regex("[a-f0-9]{64}-[a-f0-9]{64}\\.bin")
    private val assets=Regex("blueprints-[a-f0-9]{64}\\.bin")
    private fun documentName(content:String,sha:String)="$content-$sha.bin".also{require(documents.matches(it))}
    private fun assetName(digest:String)="blueprints-$digest.bin".also{require(assets.matches(it))}

    override fun indexesAbsent(contentDigest:String,domainSha:String,assetDigest:String):Boolean =
        listOf(documentName(contentDigest,domainSha),assetName(assetDigest)).none{id->
            File(directory,id).exists()||File(directory,"$id.bak").exists()||File(directory,"$id.new").exists()
        }

    override fun read(contentDigest:String,domainSha:String,parts:()->List<String>):DomainDocument? =
        readFile(documentName(contentDigest,domainSha)){file,key->DomainCheckpointCodec.read(file,key,contentDigest,domainSha,parts)}

    override fun readBlueprints(assetDigest:String):BlueprintReadProofs? =
        readFile(assetName(assetDigest)){file,key->DomainCheckpointCodec.readBlueprints(file,key,assetDigest)}

    private fun <T> readFile(id:String,decode:(File,javax.crypto.SecretKey)->T?):T? {
        val result=try{
            synchronized(io){
                val atomic=AtomicFile(File(directory,id))
                // An absent cache does not require keystore access.
                atomic.openRead().use{}
                keys.read()?.let{key->decode(atomic.baseFile,key)}?.also{atomic.baseFile.setLastModified(System.currentTimeMillis())}
            }
        }catch(_:Exception){null}
        synchronized(lock){if(result==null)known.remove(id)else known.add(id)}
        return result
    }

    override fun offer(contentDigest:String,domain:DomainDocument,blueprints:BlueprintCheckpointSource?){
        if(!DomainCheckpointCodec.eligible(domain))return
        val id=documentName(contentDigest,domain.sha256)
        val blueprintFile=blueprints?.let{assetName(it.digest)}
        synchronized(lock){
            if(closed||id in known&&(blueprintFile==null||blueprintFile in known))return
            pending=Offer(contentDigest,domain,blueprints)
            if(scheduled)return
            scheduled=true
            try{worker.execute(::drain)}catch(error:Exception){scheduled=false;pending=null;throw error}
        }
    }

    private fun drain(){
        while(true){
            val next=synchronized(lock){if(closed){pending=null;scheduled=false;null}else pending.also{pending=null;if(it==null)scheduled=false}}?:return
            next.blueprints?.let{source->
                writeFile(assetName(source.digest),assets){out,key->DomainCheckpointCodec.writeBlueprints(out,key,source.digest,next.domain,source.owners)}
            }
            writeFile(documentName(next.content,next.domain.sha256),documents){out,key->DomainCheckpointCodec.write(out,key,next.content,next.domain)}
        }
    }

    private fun writeFile(id:String,group:Regex,encode:(OutputStream,javax.crypto.SecretKey)->Unit){
        if(synchronized(lock){id in known})return
        try{
            synchronized(io){
                check(directory.isDirectory||directory.mkdirs())
                val atomic=AtomicFile(File(directory,id));val key=keys.create();val stream=atomic.startWrite()
                try{encode(stream,key);atomic.finishWrite(stream)}
                catch(error:Exception){atomic.failWrite(stream);throw error}
                synchronized(lock){known.add(id)}
                val files=directory.listFiles().orEmpty().filter{it.isFile&&group.matches(it.name)}.sortedByDescending{it.lastModified()}
                for(file in files.drop(2))if(file.delete()){
                    AtomicFile(file).delete()
                    synchronized(lock){known.remove(file.name)}
                }
            }
        }catch(_:Exception){/* A cache failure does not affect committed facts. */}
    }
    /** Not used by UI; lets owned integration tests await completed file IO. */
    fun flush():java.util.concurrent.Future<*> = worker.submit{}
    override fun close(){synchronized(lock){closed=true;pending=null};worker.shutdown()}
}
