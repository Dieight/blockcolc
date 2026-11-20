package com.blockcolc.preview.world

import android.content.Context
import android.util.AtomicFile
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

data class DerivedFileStats(val reads:Long,val hits:Long,val queuedWrites:Long,val commits:Long,val failures:Long,val oversized:Long)

/** Formats put their body SHA-256 in the last 32 header bytes. File I/O,
 * atomic adoption and queue cancellation are shared, not copied per artifact. */
internal interface DerivedFileFormat<T:Any> {
    val kind:String
    val fileName:String
    val headerBytes:Int
    val maximumBytes:Int
    fun isCandidate(key:String,header:ByteArray,length:Long):Boolean
    fun encode(key:String,value:T,allocate:(Int)->ByteBuffer,cancelled:()->Boolean):List<ByteBuffer>?
    fun decode(key:String,bytes:ByteBuffer,cancelled:()->Boolean):T?
}

/** Only a recomputable current artifact in app-private cache storage. No
 * archives, user imports, backup roots or business database are touched. A
 * bounded latest-write queue retains at most the running and next snapshot. */
internal class AndroidDerivedFile<T:Any>(
    context:Context,
    directory:File,
    private val format:DerivedFileFormat<T>,
    private val maximumBytes:Int=format.maximumBytes,
    private val sharedExecutor:ScheduledThreadPoolExecutor?=null,
    private val ioGate:Any=Any(),
    private val mapReadOnly:Boolean=false
):AutoCloseable {
    private val gate=Any()
    private val file:AtomicFile
    private val folder:File
    private val buffers=AndroidPacketBuffers(context)
    private val executor=sharedExecutor?:ScheduledThreadPoolExecutor(1){r->Thread(r,"blockcolc-${format.kind}-cache").apply{isDaemon=true}}.apply{removeOnCancelPolicy=true}
    private var sequence=0L;private var closed=false;private var pending:ScheduledFuture<*>?=null
    private val reads=AtomicLong();private val hits=AtomicLong();private val queued=AtomicLong();private val commits=AtomicLong();private val failures=AtomicLong();private val oversized=AtomicLong()
    val stats get()=DerivedFileStats(reads.get(),hits.get(),queued.get(),commits.get(),failures.get(),oversized.get())
    init {
        require(format.headerBytes>=32&&maximumBytes in format.headerBytes..format.maximumBytes)
        require(format.fileName.matches(Regex("[a-z0-9-]+\\.bin")))
        val root=context.cacheDir.canonicalFile;folder=directory.canonicalFile
        require(folder.path.startsWith(root.path+File.separator)){"Derived cache must stay in a private cache subdirectory"}
        file=AtomicFile(File(folder,format.fileName))
    }
    private fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Derived cache superseded")}
    private fun readFully(input:FileInputStream,bytes:ByteArray,start:Int,end:Int,cancelled:()->Boolean) {
        var offset=start
        while(offset<end){checkpoint(cancelled);val n=input.read(bytes,offset,minOf(65536,end-offset));require(n>0){"Truncated derived cache"};offset+=n}
    }
    fun read(key:String,cancelled:()->Boolean):T? {
        checkpoint(cancelled);if(synchronized(gate){closed})return null;reads.incrementAndGet()
        try {
            val bytes=synchronized(ioGate) {
                if(!file.baseFile.exists()&&!File(file.baseFile.path+".bak").exists())return null
                file.openRead().use{input->
                    val length=input.channel.size();if(length>maximumBytes||length<format.headerBytes)return null
                    val header=ByteArray(format.headerBytes);readFully(input,header,0,header.size,cancelled)
                    if(!format.isCandidate(key,header,length))return null
                    // Atomic replacement moves whole files. A mapped reader
                    // keeps its own inode after a later cache is published.
                    if(mapReadOnly)return@use input.channel.map(FileChannel.MapMode.READ_ONLY,0,length)
                    val data=buffers.allocate(length.toInt());data.put(header)
                    while(data.hasRemaining()){checkpoint(cancelled);val end=minOf(data.limit(),data.position()+65536);val limit=data.limit();data.limit(end)
                        try{require(input.channel.read(data)>0){"Truncated derived cache"}}finally{data.limit(limit)}}
                    require(input.read()== -1);data.flip();data.asReadOnlyBuffer()
                }
            }
            return format.decode(key,bytes,cancelled)?.also{hits.incrementAndGet()}
        }catch(error:CancellationException){throw error}
        catch(error:OutOfMemoryError){failures.incrementAndGet();Log.w("BlockcolcWorld","Derived cache read exceeded available memory; regenerate",error);return null}
        catch(error:Exception){failures.incrementAndGet();Log.w("BlockcolcWorld","Derived ${format.kind} read unavailable; regenerate",error);return null}
    }
    fun write(key:String,value:T) {
        scheduleWrite(key,value,0){}
    }
    fun scheduleWrite(key:String,value:T,delayMs:Long,committed:()->Unit):ScheduledFuture<*>? {
        require(key.matches(Regex("[a-f0-9]{64}")))
        return synchronized(gate) {
            if(closed)return null
            val ticket=++sequence;queued.incrementAndGet();pending?.cancel(false)
            executor.schedule({
                fun cancelled()=synchronized(gate){closed||sequence!=ticket}
                try {
                    checkpoint(::cancelled)
                    val parts=format.encode(key,value,{size->if(size>maximumBytes)throw DerivedFileTooLarge();buffers.allocate(size)},::cancelled)
                    val length=parts?.sumOf{it.remaining().toLong()}?:0
                    if(parts==null||length !in format.headerBytes.toLong()..maximumBytes.toLong()){oversized.incrementAndGet();return@schedule}
                    val size=length.toInt();val expectedHeader=ByteArray(format.headerBytes).also{parts.first().duplicate().get(it)}
                    synchronized(ioGate) {
                        checkpoint(::cancelled);check(folder.isDirectory||folder.mkdirs()){"Cannot create derived cache folder"}
                        val output=file.startWrite()
                        try {
                            val chunk=ByteArray(65536)
                            for(part in parts){
                                val remaining=part.duplicate()
                                while(remaining.hasRemaining()){checkpoint(::cancelled);val n=minOf(chunk.size,remaining.remaining());remaining.get(chunk,0,n);output.write(chunk,0,n)}
                            }
                            output.fd.sync();checkpoint(::cancelled);file.finishWrite(output)
                        }catch(error:Throwable){file.failWrite(output);throw error}
                        // AtomicFile can log rather than throw on rename/sync
                        // failures. Verify the adopted header and body digest.
                        file.openRead().use{input->
                            require(input.channel.size()==size.toLong())
                            val header=ByteArray(format.headerBytes);readFully(input,header,0,header.size,::cancelled)
                            require(header.contentEquals(expectedHeader))
                            val digest=MessageDigest.getInstance("SHA-256");val buffer=ByteArray(65536);var count=header.size
                            while(true){checkpoint(::cancelled);val n=input.read(buffer);if(n<0)break;digest.update(buffer,0,n);count+=n;require(count<=size)}
                            require(count==size&&MessageDigest.isEqual(digest.digest(),expectedHeader.copyOfRange(format.headerBytes-32,format.headerBytes)))
                        }
                        commits.incrementAndGet()
                        committed()
                    }
                }catch(_:CancellationException){/* Valid older roots remain keyed; never adopt a partial write. */}
                catch(_:DerivedFileTooLarge){oversized.incrementAndGet()}
                catch(error:OutOfMemoryError){failures.incrementAndGet();Log.w("BlockcolcWorld","Derived cache write exceeded available memory; live world retained",error)}
                catch(error:Exception){failures.incrementAndGet();Log.w("BlockcolcWorld","Derived ${format.kind} write unavailable; live world retained",error)}
            },delayMs,TimeUnit.MILLISECONDS).also{pending=it}
        }
    }
    override fun close()=synchronized(gate){if(!closed){closed=true;sequence++;pending?.cancel(false);pending=null;if(sharedExecutor==null)executor.shutdown()}}
    internal fun awaitWritesForTest(timeout:Long,unit:TimeUnit):Boolean {
        val latch=CountDownLatch(1);executor.execute{latch.countDown()};return latch.await(timeout,unit)
    }
    internal fun awaitTermination(timeout:Long,unit:TimeUnit)=executor.awaitTermination(timeout,unit)
}
private class DerivedFileTooLarge:IllegalArgumentException()
