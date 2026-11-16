package com.blockcolc.world

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WorldPacketBulkValidationTest {
    private fun largeFixture():Pair<JSONObject,ByteArray>{
        val manifest=JSONObject(javaClass.getResource("/codec-fixture.json")!!.readText())
        var data=javaClass.getResource("/codec-fixture.bin")!!.readBytes()
        val meshes=manifest.getJSONArray("geometries");assertEquals(1,meshes.length())
        val mesh=meshes.getJSONObject(0)
        fun expand(field:String,countField:String,factor:Int){
            val range=mesh.getJSONObject(field);val offset=range.getInt("offset");val length=range.getInt("bytes");val end=offset+length
            val extra=length*(factor-1);val next=ByteArray(data.size+extra)
            System.arraycopy(data,0,next,0,end)
            repeat(factor-1){System.arraycopy(data,offset,next,end+it*length,length)}
            System.arraycopy(data,end,next,end+extra,data.size-end)
            fun move(item:JSONObject){if(item.getInt("offset")>=end)item.put("offset",item.getInt("offset")+extra)}
            for(i in 0 until meshes.length()){val row=meshes.getJSONObject(i);move(row.getJSONObject("vertex"));move(row.getJSONObject("index"))}
            val packets=manifest.getJSONArray("packets")
            for(i in 0 until packets.length()){val row=packets.getJSONObject(i);move(row.getJSONObject("instances"));row.optJSONObject("aux")?.let(::move)}
            range.put("bytes",length*factor);mesh.put(countField,mesh.getInt(countField)*factor)
            ByteBuffer.wrap(next).order(ByteOrder.LITTLE_ENDIAN).putInt(8,next.size)
            data=next
        }
        expand("vertex","vertexCount",100)
        expand("index","indexCount",500)
        return manifest to data
    }
    @Test fun allChunksAndTheirTailsStillRejectCorruptGeometry(){
        val (manifest,data)=largeFixture();WorldPackets.read(manifest.toString(),ByteBuffer.wrap(data))
        val geometry=manifest.getJSONArray("geometries").getJSONObject(0)
        val vertices=geometry.getJSONObject("vertex");val indices=geometry.getJSONObject("index")
        assertTrue(vertices.getInt("bytes")/4>8192);assertTrue(indices.getInt("bytes")/4>8192)
        for(value in listOf(Float.NaN,Float.POSITIVE_INFINITY,Float.NEGATIVE_INFINITY)){
            val corrupt=data.copyOf();ByteBuffer.wrap(corrupt).order(ByteOrder.LITTLE_ENDIAN).putFloat(vertices.getInt("offset")+vertices.getInt("bytes")-4,value)
            assertThrows(IllegalArgumentException::class.java){WorldPackets.read(manifest.toString(),ByteBuffer.wrap(corrupt))}
        }
        for(value in listOf(-1,geometry.getInt("vertexCount"))){
            val corrupt=data.copyOf();ByteBuffer.wrap(corrupt).order(ByteOrder.LITTLE_ENDIAN).putInt(indices.getInt("offset")+indices.getInt("bytes")-4,value)
            assertThrows(IllegalArgumentException::class.java){WorldPackets.read(manifest.toString(),ByteBuffer.wrap(corrupt))}
        }
    }
    @Test fun typedValidationPreservesCallerPositionForHeapDirectAndReadOnlySlices(){
        val (manifest,data)=largeFixture()
        for(direct in listOf(false,true)){
            val storage=if(direct)ByteBuffer.allocateDirect(data.size+32)else ByteBuffer.allocate(data.size+32)
            storage.position(12);storage.put(data);storage.position(12);storage.limit(12+data.size)
            for(input in listOf(storage,storage.asReadOnlyBuffer())){
                val beforePosition=input.position();val beforeLimit=input.limit();val world=WorldPackets.read(manifest.toString(),input)
                assertEquals(beforePosition,input.position());assertEquals(beforeLimit,input.limit())
                assertEquals(data.size,world.byteSize);assertTrue(world.section(world.geometries.single().vertex).isReadOnly)
            }
        }
    }
}
