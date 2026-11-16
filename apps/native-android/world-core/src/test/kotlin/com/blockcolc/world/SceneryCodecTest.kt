package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class SceneryCodecTest {
    private val key="12".repeat(32)
    private fun scene():WorldScenery {
        val b=SceneryBlocksBuilder();b.put(0,0,0,"oak_log","wood",true,mapOf("axis" to "y"));b.put(0,1,0,"glass_pane","glass",false)
        return WorldScenery(SceneryRect(-4.0,2.0,33.0,29.0),listOf(SceneryObject("scenery:cache:tree:0",SceneryRole.TREE,1.0,4.0,-3.0,5.0,5.0,b.result())))
    }
    @Test fun mappedEncodingIsByteIdenticalAndDecodedSceneryDoesNotBorrowFileStorage(){
        val original=scene();val expected=SceneryCodec.encode(key,original)!!
        val encoded=SceneryCodec.encodeBuffer(key,original,{ByteBuffer.allocateDirect(it)})!!
        assertTrue(encoded.isReadOnly);assertTrue(encoded.isDirect)
        assertArrayEquals(expected,ByteArray(encoded.remaining()).also{encoded.duplicate().get(it)})
        val source=ByteBuffer.allocateDirect(expected.size+8).apply{position(4);put(expected);limit(position());position(4)}
        val restored=SceneryCodec.decodeBuffer(key,source)!!;assertEquals(4,source.position())
        source.put(4,0.toByte());assertNull(SceneryCodec.decodeBuffer(key,source))
        assertArrayEquals(expected,SceneryCodec.encode(key,restored))
    }
    @Test fun paletteAndSourceSubsetSurviveWithoutSharingMutableFileBytesOrMaps() {
        val original=scene();val bytes=SceneryCodec.encode(key,original)!!
        assertTrue(SceneryCodec.isCandidateHeader(key,bytes.copyOfRange(0,80),bytes.size.toLong()))
        assertFalse(SceneryCodec.isCandidateHeader("00".repeat(32),bytes.copyOfRange(0,80),bytes.size.toLong()))
        val decoded=SceneryCodec.decode(key,bytes)!!;bytes.fill(0)
        val o=decoded.objects.single();assertEquals(original.village,decoded.village)
        assertEquals(original.objects.single().id,o.id);assertEquals(original.objects.single().rect,o.rect);assertEquals(original.objects.single().blocks.voxels,o.blocks.voxels)
        assertSame(o.blocks.voxels[0],o.blocks.distantVoxels.single())
        assertThrows(UnsupportedOperationException::class.java){(o.blocks.voxels[0].sourceBlockState as MutableMap)["axis"]="x"}
        assertThrows(UnsupportedOperationException::class.java){(o.blocks.voxels as MutableList).clear()}
        val empty=WorldScenery(null,emptyList());assertTrue(SceneryCodec.decode(key,SceneryCodec.encode(key,empty)!!)!!.objects.isEmpty())
    }
    private fun corrupted(original:ByteArray,change:(ByteBuffer)->Unit):ByteArray {
        val bytes=original.copyOf();change(ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN))
        val hash=MessageDigest.getInstance("SHA-256");hash.update(bytes,80,bytes.size-80);hash.digest().copyInto(bytes,48)
        return bytes
    }
    private data class Positions(val firstId:Int,val role:Int,val x:Int,val width:Int,val count:Int,val kind:Int,val farCount:Int,val farIndex:Int)
    private fun positions(bytes:ByteArray):Positions {
        val b=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);b.position(80)
        b.int;val hasVillage=b.int;if(hasVillage!=0)b.position(b.position()+32)
        fun text(){val length=b.int;b.position(b.position()+length)}
        repeat(b.int){text();text();val size=b.int;repeat(maxOf(0,size)){text();text()}}
        val id=b.position();text();val role=b.position();b.int;val x=b.position();b.position(b.position()+24);val width=b.position();b.position(b.position()+16)
        val count=b.position();val n=b.int;val kind=b.position()+24;b.position(b.position()+n*28);val farCount=b.position();b.int
        return Positions(id,role,x,width,count,kind,farCount,b.position())
    }
    @Test fun evenRechecksummedMalformedCountsStatesCoordinatesAndSubsetIndicesAreRejected() {
        val bytes=SceneryCodec.encode(key,scene())!!;val p=positions(bytes)
        val mutations=listOf<(ByteBuffer)->Unit>(
            {it.putInt(80,-1)}, {it.putInt(84,2)}, {it.putInt(p.firstId,SceneryCodec.MAX_BYTES)},
            {it.putInt(p.role,999)}, {it.putDouble(p.x,Double.NaN)}, {it.putDouble(p.width,0.0)},
            {it.putInt(p.count,Int.MAX_VALUE)}, {it.putInt(p.kind,9999)}, {it.putInt(p.farCount,9999)}, {it.putInt(p.farIndex,9999)},
            {it.put(p.firstId+4,0xff.toByte())})
        for((index,change)in mutations.withIndex())assertNull("Malformed cache $index",SceneryCodec.decode(key,corrupted(bytes,change)))
        assertNull(SceneryCodec.decode("00".repeat(32),bytes));assertNull(SceneryCodec.decode(key,bytes.copyOf(bytes.size-1)))
        assertNull(SceneryCodec.decode(key,bytes.copyOf().also{it[it.lastIndex]=(it.last().toInt() xor 1).toByte()}))
        assertNull(SceneryCodec.decode(key,ByteArray(SceneryCodec.MAX_BYTES+1)))
    }
    @Test fun artifactBoundsInvalidModelsAndCancellationNeverBecomePartialScenes() {
        val scene=scene();val o=scene.objects.single()
        assertNull(SceneryCodec.encode(key,WorldScenery(null,listOf(o,o))))
        val tooMany=WorldScenery(null,List(8193){o.copy(id="scenery:large:$it")})
        assertNull(SceneryCodec.encode(key,tooMany))
        assertNull(SceneryCodec.encode(key,WorldScenery(null,listOf(o.copy(x=Double.NaN)))))
        val invalid=o.blocks.voxels.map{it.copy(buildOrder=10)}
        val wrongOrder=WorldScenery(null,listOf(o.copy(blocks=SceneryBlockSet(invalid,emptyList()))))
        assertNull(SceneryCodec.encode(key,wrongOrder))
        assertThrows(CancellationException::class.java){SceneryCodec.encode(key,scene){true}}
        val bytes=SceneryCodec.encode(key,scene)!!
        assertThrows(CancellationException::class.java){SceneryCodec.decode(key,bytes){true}}
        var count=0;assertThrows(CancellationException::class.java){SceneryCodec.decode(key,bytes){++count>2}}
    }
    @Test fun keyRetainsAllActualProtectionRoadTreeAndCompositionInputs() {
        val terrain=SteppedTerrain.generate(emptyList(),emptyList());val surfaces=TerrainSurfaceTable.from(terrain)
        fun input(seed:String="seed",rects:List<SceneryRect> = emptyList(),roads:List<RoadCell> = emptyList(),trees:List<TerrainTree> = emptyList(),normal:TerrainPlanBounds?=null,radius:Double?=null)=
            WorldSceneryInput(WorldEnvironment.COAST,seed,surfaces,rects,roads,trees,normal,radius)
        val base=SceneryInputKey.key(key,input());assertEquals(base,SceneryInputKey.key(key,input()))
        val variants=listOf(input(seed="other"),input(rects=listOf(SceneryRect(1.0,2.0,3.0,4.0))),input(roads=listOf(RoadCell(1,2))),
            input(trees=listOf(TerrainTree(1.0,2.0,3.0,1.0))),input(normal=terrain.nearDetailBounds),input(radius=26.0))
        for(v in variants)assertNotEquals(base,SceneryInputKey.key(key,v))
        assertNotEquals(base,SceneryInputKey.key("34".repeat(32),input()))
        val a=SceneryRect(1.0,2.0,3.0,4.0);val b=a.copy(x=3.0)
        assertNotEquals(SceneryInputKey.key(key,input(rects=listOf(a,b))),SceneryInputKey.key(key,input(rects=listOf(b,a))))
    }
}
