package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class TerrainMeshCodecTest {
    private val key="12".repeat(32)
    private fun simple()=SteppedTerrain.generate(emptyList(),emptyList())
    @Test fun freshlyGeneratedTerrainPublishesDirectlyWithoutChangingItsEncodedMesh(){
        val expected=TerrainMeshCodec.encode(key,simple())!!
        val generated=NativePacketBuffers.using(NativePacketAllocator{ByteBuffer.allocateDirect(it)}){
            val terrain=simple()
            assertTrue(terrain.positions().isDirect)
            assertTrue(terrain.positions().isReadOnly)
            assertTrue(terrain.topIndices(TerrainMaterial.GRASS).isDirect)
            assertSame(terrain,terrain.inNativeStorage())
            terrain
        }
        assertArrayEquals(expected,TerrainMeshCodec.encode(key,generated))
    }
    @Test fun scopedTerrainStorageKeepsEveryEncodedBitAndOwnsIndependentReadOnlyViews(){
        for(environment in WorldEnvironment.entries){
        val support=SettlementSupport.align(VillageLayout.generate(listOf(VillageInput(0,FootprintBounds(-3,3,-4,4)))),environment)
        val original=SteppedTerrain.generate(support.placements,VillageLayout.roads(support.placements),support.pads,null,TerrainOptions(environment,worldSeed="native-storage"))
        assertSame(original,original.inNativeStorage())
        val expected=TerrainMeshCodec.encode(key,original)!!;val sizes=mutableListOf<Int>()
        val mapped=NativePacketBuffers.using(NativePacketAllocator{bytes->sizes+=bytes;ByteBuffer.allocateDirect(bytes)}){
            val mesh=original.inNativeStorage();assertSame(mesh,mesh.inNativeStorage());mesh
        }
        assertTrue(sizes.isNotEmpty());assertTrue(mapped.positions().isDirect);assertTrue(mapped.positions().isReadOnly)
        mapped.positions().position(3);assertEquals(0,mapped.positions().position())
        assertArrayEquals(expected,TerrainMeshCodec.encode(key,mapped))
        val decoded=TerrainMeshCodec.decode(key,expected)!!
        val remapped=NativePacketBuffers.using(NativePacketAllocator{ByteBuffer.allocateDirect(it)}){decoded.inNativeStorage()}
        assertArrayEquals(expected,TerrainMeshCodec.encode(key,remapped))
        assertThrows(CancellationException::class.java){original.inNativeStorage{true}}
        assertArrayEquals(expected,TerrainMeshCodec.encode(key,original))
        }
    }
    @Test fun mappedEncodingKeepsTheExactFormatAndOffsetDecodingNeverRetainsTheInput(){
        val mesh=simple();val expected=TerrainMeshCodec.encode(key,mesh)!!
        val encoded=TerrainMeshCodec.encodeBuffer(key,mesh,{ByteBuffer.allocateDirect(it)})!!
        assertTrue(encoded.isDirect);assertTrue(encoded.isReadOnly)
        assertArrayEquals(expected,ByteArray(encoded.remaining()).also{encoded.duplicate().get(it)})
        val source=ByteBuffer.allocateDirect(expected.size+8).apply{position(4);put(expected);limit(position());position(4)}
        val restored=TerrainMeshCodec.decodeBuffer(key,source)!!
        assertEquals(4,source.position());source.put(4,0.toByte())
        assertArrayEquals(expected,TerrainMeshCodec.encode(key,restored))
        assertNull(TerrainMeshCodec.decodeBuffer(key,source))
    }
    private fun resign(bytes:ByteArray):ByteArray {
        val digest=MessageDigest.getInstance("SHA-256");digest.update(bytes,80,bytes.size-80);digest.digest().copyInto(bytes,48);return bytes
    }
    @Test fun generatorIdentityMatchesCurrentSourceAndKeysUseActualSpatialInputs() {
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/terrain.ts").isFile}
        val module=File(root,"apps/native-android/world-core")
        val files=File(module,"src/main/kotlin/com/blockcolc/world/generation").walkTopDown().filter{it.isFile&&it.extension=="kt"}.toList()+File(module,"build.gradle")+File(module,"../build.gradle")
        val digest=MessageDigest.getInstance("SHA-256")
        for(file in files.sortedBy{it.relativeTo(module).invariantSeparatorsPath}) {
            digest.update(file.relativeTo(module).invariantSeparatorsPath.toByteArray(Charsets.UTF_8));digest.update(0.toByte());digest.update(file.readBytes());digest.update(0.toByte())
        }
        assertEquals(digest.digest().joinToString(""){"%02x".format(it.toInt() and 255)},TerrainInputKey.generatorIdentity)
        val bounds=FootprintBounds(-3,3,-4,4)
        val aligned=SettlementSupport.align(VillageLayout.generate(listOf(VillageInput(0,bounds),VillageInput(1,bounds))),WorldEnvironment.OCEAN)
        val placements=aligned.placements;val roads=VillageLayout.roads(placements);val options=TerrainOptions(WorldEnvironment.OCEAN)
        val original=TerrainInputKey.key(placements,roads,aligned.pads,null,options)
        assertEquals(original,TerrainInputKey.key(placements.map{it.copy(settlementIndex=99,rotationY=2.3,blueprintOffset=Position2(9.0,2.0),entrance=RoadCell(99,99))},roads,aligned.pads,null,options))
        assertNotEquals(original,TerrainInputKey.key(placements.reversed(),roads,aligned.pads,null,options))
        assertNotEquals(original,TerrainInputKey.key(placements,roads.reversed(),aligned.pads,null,options))
        assertNotEquals(original,TerrainInputKey.key(placements,roads,aligned.pads,Position2(64.0,64.0),options))
        assertNotEquals(original,TerrainInputKey.key(placements,roads,aligned.pads,null,options.copy(worldSeed="different")))
        assertNotEquals(original,TerrainInputKey.key(placements,roads,aligned.pads,null,options.copy(refinedFar=false)))
        assertNotEquals(original,TerrainInputKey.key(placements,roads,aligned.pads,null,options.copy(environment=WorldEnvironment.COAST)))
        assertThrows(IllegalArgumentException::class.java){TerrainInputKey.key(placements,roads,aligned.pads,Position2(Double.NaN,1.0),options)}
    }
    @Test fun roundTripDoesNotAliasInputAndRejectsStaleIdentityTruncationAndChangedBytes() {
        val mesh=simple();val encoded=TerrainMeshCodec.encode(key,mesh)!!
        assertTrue(encoded.size<TerrainMeshCodec.MAX_BYTES)
        val decoded=TerrainMeshCodec.decode(key,encoded)!!;val first=decoded.positions()[0]
        assertEquals(mesh.cellCount,decoded.cellCount);assertEquals(mesh.triangleCount,decoded.triangleCount)
        assertEquals(mesh.bounds,decoded.bounds);assertEquals(mesh.hydrology,decoded.hydrology)
        assertNull(TerrainMeshCodec.decode("34".repeat(32),encoded))
        for(length in 0 until 316 step 11)assertNull(TerrainMeshCodec.decode(key,encoded.copyOf(length)))
        assertNull(TerrainMeshCodec.decode(key,encoded.copyOf(encoded.size-1)))
        assertNull(TerrainMeshCodec.decode(key,encoded.copyOf().also{it[it.lastIndex]=(it.last()+1).toByte()}))
        encoded.fill(0);assertEquals(first,decoded.positions()[0],0.0)
    }
    @Test fun evenSelfChecksummedMalformedCountsCoordinatesAndTopologyAreNotRestored() {
        val source=TerrainMeshCodec.encode(key,simple())!!
        fun damaged(edit:(ByteBuffer)->Unit):ByteArray=source.copyOf().also{edit(ByteBuffer.wrap(it).order(ByteOrder.LITTLE_ENDIAN));resign(it)}
        for(offset in listOf(0,4,8))assertNull(TerrainMeshCodec.decode(key,damaged{it.putInt(offset,99)}))
        assertNull(TerrainMeshCodec.decode(key,damaged{it.putInt(80,-1)}))
        assertNull(TerrainMeshCodec.decode(key,damaged{it.putDouble(84,Double.NaN)}))
        assertNull(TerrainMeshCodec.decode(key,damaged{it.putInt(196,Int.MAX_VALUE)}))
        assertNull(TerrainMeshCodec.decode(key,damaged{it.putInt(260,Int.MAX_VALUE)}))
        assertNull(TerrainMeshCodec.decode(key,damaged{it.putInt(264,2)}))
        assertNull(TerrainMeshCodec.decode(key,damaged{it.putInt(268,129)}))
        assertNull(TerrainMeshCodec.decode(key,damaged{it.putInt(272,Int.MAX_VALUE)}))
        assertNull(TerrainMeshCodec.decode(key,damaged{it.putInt(276,-1)}))
        assertNull(TerrainMeshCodec.decode(key,damaged{it.putDouble(316,Double.POSITIVE_INFINITY)}))
        val positions=ByteBuffer.wrap(source).order(ByteOrder.LITTLE_ENDIAN).getInt(272);val indices=316+positions*8
        assertNull(TerrainMeshCodec.decode(key,damaged{it.putInt(indices+4,positions/3)}))
        assertNull(TerrainMeshCodec.decode(key,damaged{val b=it.getInt(indices+4);val c=it.getInt(indices+8);it.putInt(indices+4,c);it.putInt(indices+8,b)}))
        val trailing=source.copyOf(source.size+4);ByteBuffer.wrap(trailing).order(ByteOrder.LITTLE_ENDIAN).putInt(12,trailing.size);resign(trailing)
        assertNull(TerrainMeshCodec.decode(key,trailing))
    }
    @Test fun cancellationNeverReturnsAPartialPayloadOrMesh() {
        val mesh=simple();val payload=TerrainMeshCodec.encode(key,mesh)!!
        assertThrows(CancellationException::class.java){TerrainMeshCodec.encode(key,mesh){true}}
        assertThrows(CancellationException::class.java){TerrainMeshCodec.decode(key,payload){true}}
        var checks=0;assertThrows(CancellationException::class.java){TerrainMeshCodec.encode(key,mesh){++checks>5}}
        checks=0;assertThrows(CancellationException::class.java){TerrainMeshCodec.decode(key,payload){++checks>5}}
        assertNotNull(TerrainMeshCodec.decode(key,payload))
    }
}
