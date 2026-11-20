package com.blockcolc.preview.world

import android.content.Context
import android.os.Process
import android.util.AtomicFile
import com.blockcolc.preview.NativeStartupTrace
import com.blockcolc.world.generation.BlueprintSnapshot
import com.blockcolc.world.generation.BlueprintSnapshotCodec
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.CancellationException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** Content-addressed render inputs. Keep a bounded background write queue so
 * reconstructing a large village cannot pin an entire second world in memory. */
internal class AndroidBlueprintCache(
    context:Context,
    directory:File,
    private val maximumEntries:Int=64,
    private val maximumBytes:Long=64L*1024*1024,
    private val writeDelayMs:Long=2000
):BlueprintRenderCache,AutoCloseable {
    private val application=context.applicationContext
    private val folder=File(directory,"blueprint-render").canonicalFile
    private val queueGate=Any()
    @Volatile private var closed=false
    private val writer=ScheduledThreadPoolExecutor(1){task->
        Thread({
            Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
            task.run()
        },"blockcolc-blueprint-cache").apply{isDaemon=true}
    }.apply{removeOnCancelPolicy=true}
    private data class Pending(
        val file:AndroidDerivedFile<BlueprintSnapshot>,
        val future:ScheduledFuture<*>,
        val retainedBytes:Long
    )
    private val pending=LinkedHashMap<String,Pending>()

    init {
        require(folder.path.startsWith(application.cacheDir.canonicalPath+File.separator))
        require(maximumEntries>0&&maximumBytes>=BlueprintSnapshotCodec.HEADER_BYTES&&writeDelayMs>=0)
    }

    private fun artifact(key:String,decoration:Boolean)=AndroidDerivedFile(
        application,folder,Format(key,decoration),
        minOf(maximumBytes,BlueprintSnapshotCodec.MAX_BYTES.toLong()).toInt(),
        sharedExecutor=writer,ioGate=diskGate
    )

    override fun read(sourceSha:String,decoration:Boolean,cancelled:()->Boolean):BlueprintSnapshot? {
        if(closed)return null
        return try {
            val key=BlueprintSnapshotCodec.key(sourceSha,decoration)
            artifact(key,decoration).read(key,cancelled)?.also {
                synchronized(diskGate) {
                    val file=File(folder,"$key.bin")
                    val now=System.currentTimeMillis()
                    val modified=file.lastModified()
                    if(modified>0&&now-modified>=300_000)file.setLastModified(now)
                }
                NativeStartupTrace.point("blueprint-render-cache-hit")
            }
        }catch(error:CancellationException){throw error}
        catch(_:Exception){null}
    }

    override fun offer(sourceSha:String,decoration:Boolean,blueprint:BlueprintSnapshot) {
        if(blueprint.voxels.size<256)return
        val retainedBytes=512L+blueprint.canonicalLength*2L+blueprint.voxels.size*320L
        synchronized(queueGate) {
            if(closed)return
            pending.entries.removeAll{it.value.future.isDone}
            if(pending.size>=12||pending.values.sumOf{it.retainedBytes}+retainedBytes>32L*1024*1024)return
            try {
                val key=BlueprintSnapshotCodec.key(sourceSha,decoration)
                if(key in pending)return
                val file=artifact(key,decoration)
                val future=file.scheduleWrite(key,blueprint,writeDelayMs,::prune)?:return
                pending[key]=Pending(file,future,retainedBytes)
            }catch(_:Exception){ /* Cache admission is optional. */ }
        }
    }

    // Runs after a verified commit, inside the common AtomicFile I/O lock.
    private fun prune() {
        val files=folder.listFiles()?.filter{derivedName.matches(it.name)}?:return
        for(file in files)if(file.name.endsWith(".new"))file.delete()
        val entries=files.filterNot{it.name.endsWith(".new")}.groupBy{it.name.removeSuffix(".bak")}
            .entries.sortedByDescending{(_,paths)->paths.maxOf{it.lastModified()}}
        var count=0
        var bytes=0L
        for((name,paths)in entries) {
            val length=paths.sumOf{it.length()}
            if(count>=maximumEntries||length>maximumBytes-bytes) {
                AtomicFile(File(folder,name)).delete()
            }else{
                count++
                bytes+=length
            }
        }
    }

    override fun close() {
        synchronized(queueGate) {
            if(closed)return
            closed=true
            for(entry in pending.values)entry.file.close()
            pending.clear()
            writer.shutdown()
        }
    }

    internal fun awaitWritesForTest(timeout:Long,unit:TimeUnit):Boolean {
        val futures=synchronized(queueGate){pending.values.map{it.future}}
        val deadline=System.nanoTime()+unit.toNanos(timeout)
        return try {
            for(future in futures)future.get(maxOf(0,deadline-System.nanoTime()),TimeUnit.NANOSECONDS)
            true
        }catch(_:TimeoutException){false}
    }

    internal fun awaitTermination(timeout:Long,unit:TimeUnit)=writer.awaitTermination(timeout,unit)

    private class Format(key:String,private val decoration:Boolean):DerivedFileFormat<BlueprintSnapshot> {
        override val kind="blueprint"
        override val fileName="$key.bin"
        override val headerBytes=BlueprintSnapshotCodec.HEADER_BYTES
        override val maximumBytes=BlueprintSnapshotCodec.MAX_BYTES
        override fun isCandidate(key:String,header:ByteArray,length:Long)=BlueprintSnapshotCodec.isCandidateHeader(key,decoration,header,length)
        override fun encode(key:String,value:BlueprintSnapshot,allocate:(Int)->ByteBuffer,cancelled:()->Boolean)=
            BlueprintSnapshotCodec.encodeBuffer(key,value,decoration,allocate,cancelled)?.let{listOf(it)}
        override fun decode(key:String,bytes:ByteBuffer,cancelled:()->Boolean)=
            BlueprintSnapshotCodec.decodeBuffer(key,bytes,decoration,cancelled)
    }

    private companion object {
        val diskGate=Any()
        val derivedName=Regex("[a-f0-9]{64}\\.bin(?:\\.(?:new|bak))?")
    }
}
