package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.preview.world.AndroidPacketBuffers
import com.blockcolc.world.*
import com.blockcolc.world.generation.CuboidGeometry
import java.io.File
import java.nio.FloatBuffer
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class P3NativePacketBuffersTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun source():NativePacketSource {
        val matrix=FloatBuffer.wrap(FloatArray(16){if(it in listOf(0,5,10,15))1f else 0f})
        return NativePacketBuilder("building:mapped-test").also{it.add(CuboidGeometry.create(),NativeRenderMaterial(),matrix)}.build()
    }
    @Test fun privateMappedPacketsRemainReadableAndIdenticalAfterTheirStagingFileIsUnlinked(){
        val directory=File(context.cacheDir,"p3-packets-${UUID.randomUUID()}")
        try{
            val allocator=AndroidPacketBuffers(context,directory,16)
            val expected=source()
            val actual=NativePacketBuffers.using(allocator){source()}
            assertTrue(allocator.mappedBytes>0)
            assertTrue(directory.isDirectory);assertTrue(directory.list()!!.isEmpty())
            assertEquals(expected.geometryKeys,actual.geometryKeys)
            val before=expected.world!!;val after=actual.world!!
            assertEquals(before.byteSize,after.byteSize)
            assertEquals(before.geometries,after.geometries);assertEquals(before.materials,after.materials);assertEquals(before.packets,after.packets)
            for(g in before.geometries){assertEquals(before.section(g.vertex),after.section(g.vertex));assertEquals(before.section(g.index),after.section(g.index))}
            assertEquals(before.instanceRows(before.packets.single()),after.instanceRows(after.packets.single()))
        }finally{if(directory.exists()){assertTrue(directory.list()!!.isEmpty());assertTrue(directory.delete())}}
    }
    @Test fun aSmallAllocationNeedsNoStagingAndAnInvalidDirectoryDoesNotFallBackToAHugeHeapBuffer(){
        val invalid=File(context.filesDir,"p3-packets-${UUID.randomUUID()}")
        val allocator=AndroidPacketBuffers(context,invalid,1024)
        val small=allocator.allocate(16);small.putLong(0,1234);assertEquals(1234L,small.getLong(0));assertEquals(0L,allocator.mappedBytes)
        assertFalse(invalid.exists())
        assertThrows(IllegalArgumentException::class.java){allocator.allocate(1024)}
        assertFalse(invalid.exists())
    }
    @Test fun mappedDerivedTerrainFilesKeepTheirByteFormatAndAtomicReadback(){
        val directory=File(context.cacheDir,"p3-derived-${UUID.randomUUID()}")
        val cache=com.blockcolc.preview.world.AndroidTerrainCache(context,directory)
        val mesh=com.blockcolc.world.generation.SteppedTerrain.generate(emptyList(),emptyList())
        val key="12".repeat(32);val expected=com.blockcolc.world.generation.TerrainMeshCodec.encode(key,mesh)!!
        try{
            cache.write(key,mesh);assertTrue(cache.awaitWritesForTest(30,TimeUnit.SECONDS));assertEquals(1L,cache.stats.commits)
            val file=File(directory,"terrain-v1.bin")
            val actualHash=java.security.MessageDigest.getInstance("SHA-256").apply{file.inputStream().use{input->val buffer=ByteArray(65536);while(true){val n=input.read(buffer);if(n<0)break;update(buffer,0,n)}}}.digest()
            assertArrayEquals(java.security.MessageDigest.getInstance("SHA-256").digest(expected),actualHash)
            val restored=checkNotNull(cache.read(key){false});assertEquals(mesh.positions(),restored.positions());assertEquals(1L,cache.stats.hits)
            assertNull(cache.read("34".repeat(32)){false})
        }finally{
            cache.close();assertTrue(cache.awaitTermination(30,TimeUnit.SECONDS))
            for(file in directory.listFiles().orEmpty()){require(file.name in setOf("terrain-v1.bin","terrain-v1.bin.bak","terrain-v1.bin.new"));assertTrue(file.delete())}
            if(directory.exists())assertTrue(directory.delete())
        }
    }
}
