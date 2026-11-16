package com.blockcolc.preview.world

import android.content.Context
import android.os.Looper
import com.blockcolc.world.NativePacketAllocator
import com.blockcolc.world.WorldPackets
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.channels.FileChannel

/** Android allocateDirect consumes ART's non-moving heap. Large immutable
 * packet payloads instead use a private mapping of an immediately unlinked
 * sparse file. Private writes stay in memory: no full-world disk write or
 * persistent asset is introduced. Views retain the mapping until retired. */
class AndroidPacketBuffers(context:Context,private val directory:File=File(context.cacheDir,"native-packet-staging"),
    private val threshold:Int=64*1024):NativePacketAllocator {
    private val application=context.applicationContext
    private val cache by lazy(LazyThreadSafetyMode.NONE){application.cacheDir.canonicalFile}
    var mappedBytes=0L;private set
    var directBytes=0L;private set
    init{require(threshold in 16..WorldPackets.MAX_BYTES)}
    @Synchronized override fun allocate(bytes:Int):ByteBuffer {
        check(Looper.myLooper()!=Looper.getMainLooper()){"World packet storage must run on the generation worker"}
        require(bytes in 16..WorldPackets.MAX_BYTES)
        if(bytes<threshold)return ByteBuffer.allocateDirect(bytes).also{directBytes+=bytes}
        val target=directory.canonicalFile
        require(target.parentFile==cache&&target.name.matches(Regex("[a-zA-Z0-9-]{1,80}"))){"Packet staging must remain in its private cache directory"}
        if(!target.isDirectory&&!target.mkdirs())throw IOException("Cannot prepare packet staging")
        val file=File.createTempFile("packet-",".tmp",target)
        var failure:Throwable?=null
        try{
            val result=RandomAccessFile(file,"rw").use{output->
                output.setLength(bytes.toLong())
                output.channel.map(FileChannel.MapMode.PRIVATE,0,bytes.toLong())
            }
            if(!file.delete())throw IOException("Cannot unlink packet staging")
            mappedBytes+=bytes
            return result
        }catch(error:Throwable){failure=error;throw error}
        finally{if(file.exists()&&!file.delete()){
            val cleanup=IOException("Packet staging cleanup failed")
            if(failure!=null)failure.addSuppressed(cleanup)else throw cleanup
        }}
    }
}
