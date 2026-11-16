package com.blockcolc.world

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.IntBuffer
import java.nio.DoubleBuffer

fun interface NativePacketAllocator { fun allocate(bytes:Int):ByteBuffer }

/** Platform storage policy is scoped to one generation job. No process-wide
 * allocator change can affect a concurrent renderer, test or another worker. */
object NativePacketBuffers {
    private val current=ThreadLocal<NativePacketAllocator?>()
    internal val hasPlatformAllocator:Boolean get()=current.get()!=null
    fun <T> using(allocator:NativePacketAllocator?,work:()->T):T {
        val previous=current.get();current.set(allocator)
        return try{work()}finally{if(previous==null)current.remove()else current.set(previous)}
    }
    internal fun allocate(bytes:Int):ByteBuffer {
        require(bytes in 16..WorldPackets.MAX_BYTES)
        val result=current.get()?.allocate(bytes)?:ByteBuffer.allocateDirect(bytes)
        require(result.isDirect&&!result.isReadOnly&&result.position()==0&&result.remaining()==bytes){"Invalid native packet allocation"}
        return result
    }
    internal fun floats(count:Int):FloatBuffer {
        require(count>=0&&count.toLong()*4<=WorldPackets.MAX_BYTES)
        return allocate(maxOf(16,count*4)).order(ByteOrder.LITTLE_ENDIAN).apply{limit(count*4)}.asFloatBuffer()
    }
    internal fun ints(count:Int):IntBuffer {
        require(count>=0&&count.toLong()*4<=WorldPackets.MAX_BYTES)
        return allocate(maxOf(16,count*4)).order(ByteOrder.LITTLE_ENDIAN).apply{limit(count*4)}.asIntBuffer()
    }
    internal fun doubles(count:Int):DoubleBuffer {
        require(count>=0&&count.toLong()*8<=WorldPackets.MAX_BYTES)
        return allocate(maxOf(16,count*8)).order(ByteOrder.LITTLE_ENDIAN).apply{limit(count*8)}.asDoubleBuffer()
    }
    internal fun frozen(input:ByteBuffer):ByteBuffer {
        val copy=allocate(maxOf(16,input.remaining()))
        copy.put(input.duplicate());copy.flip()
        return copy.asReadOnlyBuffer()
    }
}
