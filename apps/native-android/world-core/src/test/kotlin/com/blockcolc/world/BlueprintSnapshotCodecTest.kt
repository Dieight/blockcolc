package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class BlueprintSnapshotCodecTest {
    private val sourceSha="38".repeat(32)
    private fun cell(x:Long,y:Long,z:Long)=JSONObject().put("x",x).put("y",y).put("z",z).put("materialId","wood").put("buildOrder",0).put("sourceBlockId","minecraft:oak_log")
    private fun snapshot(cells:JSONArray):BlueprintSnapshot {
        fun bound(axis:String,minimum:Boolean):Long {val values=(0 until cells.length()).map{cells.getJSONObject(it).getLong(axis)};return if(minimum)values.min()else values.max()}
        return BlueprintSnapshot.read(JSONObject().put("schemaVersion",1).put("id","codec-test").put("title","像素窗前😀 \"木屋\"")
            .put("bounds",JSONObject().put("minX",bound("x",true)).put("maxX",bound("x",false)).put("minY",bound("y",true)).put("maxY",bound("y",false)).put("minZ",bound("z",true)).put("maxZ",bound("z",false)))
            .put("voxels",cells))
    }
    private fun dense()=snapshot(JSONArray().also{rows->repeat(4096){i->rows.put(cell((i%64).toLong(),(i/64).toLong(),0)
        .put("buildOrder",i%10001).put("sourceBlockState",JSONObject().put("axis",if(i%2==0)"x" else "z")))}})
    private fun special():BlueprintSnapshot {
        val rows=JSONArray();repeat(6){i->rows.put(cell(9007199254740986L+i,-3,0).put("buildOrder",if(i==5)10000 else i))}
        rows.getJSONObject(0).put("sourceBlockId","minecraft:oak_wall_sign").put("sign",JSONObject()
            .put("front",JSONObject().put("lines",JSONArray().put("窗前😀").put("\"引号\"").put("\\").put("")).put("dyeColor","light_blue").put("glowing",true))
            .put("back",JSONObject().put("lines",JSONArray()).put("dyeColor","black").put("glowing",false)))
        rows.getJSONObject(1).put("sourceBlockId","minecraft:campfire").put("campfire",JSONObject().put("slots",JSONArray()
            .put(JSONObject().put("slot",1).put("itemId","minecraft:potato").put("count",2))
            .put(JSONObject().put("slot",0).put("itemId","minecraft:apple").put("count",1))))
        rows.getJSONObject(2).put("sourceBlockId","minecraft:moving_piston")
            .put("movingPistonMovedState",JSONObject().put("blockId","minecraft:oak_stairs").put("properties",JSONObject().put("facing","north").put("half","bottom")))
            .put("movingPistonPose",JSONObject().put("facing","east").put("progress",0.375).put("extending",true).put("source",false))
        rows.getJSONObject(3).put("sourceBlockId","minecraft:lantern").put("emissiveKind","lantern").put("emissiveLevel",15)
        rows.getJSONObject(4).put("sourceBlockState",JSONObject().put("axis","y"))
        rows.getJSONObject(5).put("sourceBlockId","minecraft:glass_pane").put("sourceBlockState",JSONObject().put("north","true").put("waterlogged","false"))
        return snapshot(rows)
    }
    private fun materialized(value:BlueprintSnapshot):Boolean {
        val field=value.javaClass.getDeclaredField("canonical\$delegate").apply{isAccessible=true}
        return (field.get(value) as Lazy<*>).isInitialized()
    }
    private fun compare(original:BlueprintSnapshot,decoded:BlueprintSnapshot){
        assertEquals(original.id,decoded.id);assertEquals(original.title,decoded.title);assertEquals(original.bounds,decoded.bounds)
        assertEquals(original.geometrySha,decoded.geometrySha);assertEquals(original.voxels,decoded.voxels)
        assertEquals(original.canonicalLength,decoded.canonicalLength)
        assertFalse("Restoration must not write the full JSON text",materialized(decoded))
        val recipe=BuildingPreparation.prepare(decoded,"codec-owner",5000,9400)
        assertEquals(original.geometrySha,recipe.blueprintGeometrySha)
        assertFalse("The real building path must keep JSON lazy",materialized(decoded))
        assertEquals(original.canonical,decoded.canonical)
        assertEquals(original.geometrySha,BlueprintSnapshot.read(decoded.json()).geometrySha)
    }
    @Test fun sharedKindsAndEverySpecialFieldKeepTheSameRenderInputAndOptionalWire(){
        for(original in listOf(dense(),special())){
            val key=BlueprintSnapshotCodec.key(sourceSha,false)
            val bytes=checkNotNull(BlueprintSnapshotCodec.encode(key,original))
            val decoded=checkNotNull(BlueprintSnapshotCodec.decode(key,bytes));compare(original,decoded)
            assertArrayEquals(bytes,BlueprintSnapshotCodec.encode(key,decoded))
            assertNull(BlueprintSnapshotCodec.decode(BlueprintSnapshotCodec.key("67".repeat(32),false),bytes))
            assertNull(BlueprintSnapshotCodec.decode(key,bytes,true))
        }
    }
    @Test fun fullDimensionOffsetsAndFarSafeOriginsDoNotLosePrecision(){
        val source=snapshot(JSONArray().put(cell(9007199254740896L,-9007199254740991L,-95))
            .put(cell(9007199254740991L,-9007199254740736L,0)))
        val key=BlueprintSnapshotCodec.key(sourceSha,false)
        compare(source,checkNotNull(BlueprintSnapshotCodec.decode(key,checkNotNull(BlueprintSnapshotCodec.encode(key,source)))))
    }
    private fun reseal(bytes:ByteArray):ByteArray=bytes.also{
        val hash=MessageDigest.getInstance("SHA-256").digest(it.copyOfRange(BlueprintSnapshotCodec.HEADER_BYTES,it.size));hash.copyInto(it,48)
    }
    private fun cellStart(bytes:ByteArray):Int {
        val b=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);b.position(80)
        val meta=b.int;b.position(b.position()+meta);val palette=b.int;b.position(b.position()+palette);b.int
        return b.position()
    }
    @Test fun corruptTruncatedAndResealedInvalidCellPayloadsAreRejected(){
        val key=BlueprintSnapshotCodec.key(sourceSha,false);val bytes=checkNotNull(BlueprintSnapshotCodec.encode(key,dense()))
        for(size in listOf(0,4,79,80,bytes.size-1))assertNull(BlueprintSnapshotCodec.decode(key,bytes.copyOf(size)))
        for(at in listOf(0,4,8,12,16,48,bytes.lastIndex)){
            val broken=bytes.copyOf();broken[at]=(broken[at].toInt()xor 1).toByte();assertNull(BlueprintSnapshotCodec.decode(key,broken))
        }
        val start=cellStart(bytes)
        for(kind in listOf("coordinate","kind","order","duplicate","count")){
            val broken=bytes.copyOf();val b=ByteBuffer.wrap(broken).order(ByteOrder.LITTLE_ENDIAN)
            when(kind){
                "coordinate"->broken[start]=96.toByte()
                "kind"->b.putShort(start+3,65535.toShort())
                "order"->b.putShort(start+5,10001.toShort())
                "duplicate"->broken.copyInto(broken,start+7,start,start+3)
                else->b.putInt(start-4,300001)
            }
            assertNull(kind,BlueprintSnapshotCodec.decode(key,reseal(broken)))
        }
    }
    @Test fun decodingOwnsItsCellsAndCancellationNeverAdoptsAPartialPacket(){
        val original=dense();val key=BlueprintSnapshotCodec.key(sourceSha,false);val bytes=checkNotNull(BlueprintSnapshotCodec.encode(key,original))
        val framed=ByteArray(bytes.size+8);bytes.copyInto(framed,4)
        val view=ByteBuffer.wrap(framed).apply{position(4);limit(4+bytes.size)}
        val decoded=checkNotNull(BlueprintSnapshotCodec.decodeBuffer(key,view,false));assertEquals(4,view.position())
        framed.fill(0);assertEquals(original.voxels,decoded.voxels);assertEquals(original.canonical,decoded.canonical)
        assertThrows(UnsupportedOperationException::class.java){(decoded.voxels as MutableList<RenderVoxel>).clear()}
        assertThrows(CancellationException::class.java){BlueprintSnapshotCodec.encode(key,original,cancelled={true})}
        assertThrows(CancellationException::class.java){BlueprintSnapshotCodec.decode(key,bytes,cancelled={true})}
    }
}
