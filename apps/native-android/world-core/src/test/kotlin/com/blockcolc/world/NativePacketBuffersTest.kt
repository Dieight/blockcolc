package com.blockcolc.world

import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test

class NativePacketBuffersTest {
    @Test fun planarScratchAndOutputUseTheScopedAllocatorAndKeepReadOnlyIndependentViews(){
        val allocations=mutableListOf<Int>()
        val points=java.nio.DoubleBuffer.wrap(doubleArrayOf(0.0,0.0,0.0,1.0,0.0,0.0,1.0,0.0,1.0,0.0,0.0,1.0))
        val indices=java.nio.IntBuffer.wrap(intArrayOf(0,2,1,0,3,2))
        val geometry=NativePacketBuffers.using(NativePacketAllocator{size->
            allocations+=size
            // Allocators need not return zeroed storage. Normal accumulation
            // and remapping must not depend on fresh anonymous zero pages.
            ByteBuffer.allocateDirect(size).apply{repeat(size){put(it,0x7f.toByte())}}
        }){com.blockcolc.world.generation.NativePlanarGeometry.groups(points,listOf(indices)).single()!!}
        assertEquals(9,allocations.size);assertEquals(0,points.position());assertEquals(0,indices.position())
        assertEquals(4,geometry.vertexCount)
        val normal=geometry.normals()
        repeat(4){assertEquals(0f,normal.get(),0f);assertEquals(1f,normal.get(),0f);assertEquals(0f,normal.get(),0f)}
        val read=geometry.positions();read.position(3);assertEquals(0,geometry.positions().position())
        assertTrue(read.isDirect);assertTrue(read.isReadOnly)
        assertThrows(java.nio.ReadOnlyBufferException::class.java){read.put(0,7f)}
        assertTrue(geometry.indices()!!.isReadOnly)
        assertEquals(0,NativePacketBuffers.ints(0).remaining())
    }
    @Test fun allocationScopeIsNestedExceptionSafeAndConfinedToTheGenerationThread(){
        val outer=mutableListOf<ByteBuffer>();val inner=mutableListOf<ByteBuffer>()
        fun allocator(list:MutableList<ByteBuffer>)=NativePacketAllocator{ByteBuffer.allocateDirect(it).also(list::add)}
        NativePacketBuffers.using(allocator(outer)){
            assertSame(NativePacketBuffers.allocate(16),outer.single())
            val other=AtomicReference<ByteBuffer>()
            Thread{other.set(NativePacketBuffers.allocate(16))}.apply{start();join(5000);assertFalse(isAlive)}
            assertNotSame(outer.single(),other.get());assertEquals(1,outer.size)
            val problem=IllegalStateException("cancelled job")
            assertSame(problem,assertThrows(IllegalStateException::class.java){NativePacketBuffers.using(allocator(inner)){
                assertSame(NativePacketBuffers.allocate(32),inner.single());throw problem
            }})
            assertSame(NativePacketBuffers.allocate(48),outer.last());assertEquals(2,outer.size)
        }
        assertFalse(outer.any{it===NativePacketBuffers.allocate(16)})
    }
    @Test fun invalidPlatformStorageCannotReachThePacketWriter(){
        for(value in listOf(ByteBuffer.allocate(16),ByteBuffer.allocateDirect(16).asReadOnlyBuffer(),ByteBuffer.allocateDirect(32),ByteBuffer.allocateDirect(16).apply{position(1)})){
            assertThrows(IllegalArgumentException::class.java){NativePacketBuffers.using(NativePacketAllocator{value}){NativePacketBuffers.allocate(16)}}
        }
        assertTrue(NativePacketBuffers.allocate(16).isDirect)
    }
    @Test fun frozenPixelsKeepOffsetsAndContentIndependentOfTheMutableCaller(){
        val source=ByteBuffer.allocate(32).apply{repeat(32){put(it.toByte())};position(4);limit(20)}
        val allocated=mutableListOf<Int>()
        val frozen=NativePacketBuffers.using(NativePacketAllocator{bytes->allocated+=bytes;ByteBuffer.allocateDirect(bytes)}){
            NativePixelTexture(2,2,source,mipmaps=false,minFilter=1003)
        }
        assertEquals(listOf(16),allocated);assertEquals(4,source.position());assertEquals(20,source.limit())
        source.put(4,99.toByte());assertEquals(4,frozen.pixels().get().toInt())
        val read=frozen.pixels();read.position(9);assertEquals(0,frozen.pixels().position());assertTrue(read.isReadOnly)
        val empty=NativePacketBuffers.floats(0);assertEquals(0,empty.remaining())
    }
}
