package com.blockcolc.preview.world

import android.content.Context
import android.os.Process
import android.util.AtomicFile
import com.blockcolc.preview.NativeStartupTrace
import com.blockcolc.world.generation.OriginalStructure
import com.blockcolc.world.generation.OriginalStructureCodec
import com.blockcolc.world.generation.OriginalStructureStorage
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.CancellationException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Original building/reward geometry survives the process; current progress,
 * condition, source state and origin are all part of its content key. Writes
 * run below interactive priority and cannot retain a second complete town. */
internal class AndroidStructureCache(context:Context,directory:File,private val maximumEntries:Int=96,
    private val maximumBytes:Long=64L*1024*1024,private val writeDelayMs:Long=2000):OriginalStructureStorage,AutoCloseable {
    private val application=context.applicationContext
    private val folder=File(directory,"original-structures").canonicalFile
    private val gate=Any();private val diskGate=Any()
    private val writer=ScheduledThreadPoolExecutor(1){task->Thread({Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);task.run()},"blockcolc-structure-cache").apply{isDaemon=true}}.apply{removeOnCancelPolicy=true}
    private data class Pending(val file:AndroidDerivedFile<OriginalStructure>,val future:ScheduledFuture<*>,val bytes:Long)
    private val pending=LinkedHashMap<String,Pending>()
    @Volatile private var closed=false
    init{require(folder.path.startsWith(application.cacheDir.canonicalPath+File.separator));require(maximumEntries>0&&maximumBytes>=OriginalStructureCodec.HEADER_BYTES&&writeDelayMs>=0)}
    private fun artifact(key:String)=AndroidDerivedFile(application,folder,Format(key),minOf(maximumBytes,OriginalStructureCodec.MAX_BYTES.toLong()).toInt(),sharedExecutor=writer,ioGate=diskGate)
    override fun read(key:String,cancelled:()->Boolean):OriginalStructure?{
        if(closed)return null
        return try{artifact(key).read(key,cancelled)?.also{
            synchronized(diskGate){val file=File(folder,"$key.bin");val now=System.currentTimeMillis();if(now-file.lastModified()>=300000)file.setLastModified(now)}
            NativeStartupTrace.point("building-geometry-cache-hit")
        }}catch(error:CancellationException){throw error}catch(_:Exception){null}
    }
    override fun offer(key:String,value:OriginalStructure){
        if(value.sourceCount<128||value.estimatedBytes>OriginalStructureCodec.MAX_BYTES)return
        synchronized(gate){
            if(closed)return
            pending.entries.removeAll{it.value.future.isDone}
            if(key in pending||pending.size>=48||pending.values.sumOf{it.bytes}+value.estimatedBytes>24L*1024*1024)return
            val file=artifact(key);val future=file.scheduleWrite(key,value,writeDelayMs,::prune)?:return
            pending[key]=Pending(file,future,value.estimatedBytes)
        }
    }
    private fun prune(){
        val files=folder.listFiles()?.filter{it.name.matches(Regex("[a-f0-9]{64}\\.bin(?:\\.(?:new|bak))?"))}?:return
        files.filter{it.name.endsWith(".new")}.forEach{it.delete()}
        val entries=files.filterNot{it.name.endsWith(".new")}.groupBy{it.name.removeSuffix(".bak")}.entries.sortedByDescending{it.value.maxOf{f->f.lastModified()}}
        var count=0;var bytes=0L
        for((name,paths)in entries){val size=paths.sumOf{it.length()};if(count>=maximumEntries||size>maximumBytes-bytes)AtomicFile(File(folder,name)).delete()else{count++;bytes+=size}}
    }
    override fun close(){synchronized(gate){if(closed)return;closed=true;pending.values.forEach{it.file.close()};pending.clear();writer.shutdown()}}
    internal fun awaitWritesForTest(timeout:Long,unit:TimeUnit):Boolean{
        val futures=synchronized(gate){pending.values.map{it.future}};val until=System.nanoTime()+unit.toNanos(timeout)
        return try{for(future in futures)future.get(maxOf(0,until-System.nanoTime()),TimeUnit.NANOSECONDS);true}catch(_:java.util.concurrent.TimeoutException){false}
    }
    internal fun awaitTermination(timeout:Long,unit:TimeUnit)=writer.awaitTermination(timeout,unit)
    private class Format(key:String):DerivedFileFormat<OriginalStructure>{
        override val kind="structure"
        override val fileName="$key.bin"
        override val headerBytes=OriginalStructureCodec.HEADER_BYTES
        override val maximumBytes=OriginalStructureCodec.MAX_BYTES
        override fun isCandidate(key:String,header:ByteArray,length:Long)=OriginalStructureCodec.isCandidateHeader(key,header,length)
        override fun encode(key:String,value:OriginalStructure,allocate:(Int)->ByteBuffer,cancelled:()->Boolean)=OriginalStructureCodec.encodeBuffer(key,value,allocate,cancelled)?.let{listOf(it)}
        override fun decode(key:String,bytes:ByteBuffer,cancelled:()->Boolean)=OriginalStructureCodec.decodeBuffer(key,bytes,cancelled)
    }
}
