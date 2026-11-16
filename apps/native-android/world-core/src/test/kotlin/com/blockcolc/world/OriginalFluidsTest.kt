package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class OriginalFluidsTest {
    companion object {private val oracle by lazy{JSONObject(OriginalFluidsTest::class.java.getResource("/fluid-oracle.json")!!.readText())}}
    private fun rows(a:JSONArray)=List(a.length()){a.getJSONObject(it)}
    private fun voxel(v:JSONObject)=RenderVoxel(v.getDouble("x"),v.getDouble("y"),v.getDouble("z"),v.getString("materialId"),v.optInt("buildOrder",0),
        if(v.has("sourceBlockId"))v.getString("sourceBlockId")else null,v.optJSONObject("sourceBlockState")?.let{s->s.keys().asSequence().associateWith{s.getString(it)}})
    private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
    private fun sha(buffer:FloatBuffer):String {val bytes=ByteBuffer.allocate(buffer.remaining()*4).order(ByteOrder.LITTLE_ENDIAN);while(buffer.hasRemaining())bytes.putFloat(buffer.get());return sha(bytes.array())}
    @Test fun currentSourcePlanningAndSourceGeometryProduceTheExpectedInputs() {
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/renderer.ts").isFile}
        val hashes=oracle.getJSONObject("sourceHashes");for(name in hashes.keys())assertEquals("Stale fluid source: $name",hashes.getString(name),sha(File(root,name).readBytes()))
        assertTrue(oracle.getJSONArray("cases").length()>80);assertEquals(126,oracle.getJSONArray("geometries").length())
    }
    @Test fun weightedCornerSamplingAndPartialBlockRulesMatchTheFormalJavaApproximation() {
        for(c in rows(oracle.getJSONArray("averages"))){val a=c.getJSONArray("input");assertEquals(c.toString(),c.getDouble("expected"),OriginalFluids.average(a.getDouble(0),a.getDouble(1),a.getDouble(2),a.getDouble(3)),0.0)}
        for(c in rows(oracle.getJSONArray("partialIds")))assertEquals(c.toString(),c.getBoolean("partial"),OriginalFluids.partial(if(c.isNull("id"))null else c.getString("id")))
    }
    @Test fun sourceLevelsSlopesNeighborsAndWaterloggedCellsKeepAllEntriesMasksAndPackedShaderInputs() {
        val planner=OriginalFluids();var entries=0
        for(c in rows(oracle.getJSONArray("cases"))) {
            val label=c.getString("name");val voxels=rows(c.getJSONArray("voxels")).map(::voxel)
            val limit=c.get("limit").let{if(it is Number)it.toDouble()else it.toString().toDouble()}
            val actual=if(c.getBoolean("waterlogged"))planner.waterlogged(voxels,limit)else planner.free(voxels,if(c.isNull("neighbors"))voxels else rows(c.getJSONArray("neighbors")).map(::voxel))
            val expected=rows(c.getJSONArray("entries"));assertEquals(label,expected.size,actual.entries.size)
            for((i,e)in actual.entries.withIndex()) {
                val source=expected[i];val key="$label entry $i";assertEquals(key,source.getInt("sourceIndex"),e.sourceIndex)
                assertEquals(key,source.getString("kind"),e.kind.name.lowercase());assertEquals(key,source.getDouble("height"),e.height,0.0);assertEquals(key,source.getInt("faceMask"),e.faceMask)
                assertEquals(key,source.getBoolean("flowing"),e.flowing);assertEquals(key,source.getDouble("flowAngle"),e.flowAngle,1e-12)
                for(corner in 0..3)assertEquals(key,source.getJSONArray("corners").getDouble(corner),e.corners[corner],0.0)
                assertEquals(key,source.getInt("packedCorners"),e.packedCorners);assertEquals(key,source.getInt("packedMetadata"),e.packedMetadata)
            }
            val batches=rows(c.getJSONArray("batches"));assertEquals(label,batches.size,actual.batches.size)
            for((i,batch)in actual.batches.withIndex()) {
                val source=batches[i];assertEquals(label,source.getString("kind"),batch.kind.name.lowercase());assertEquals(label,source.getDouble("height"),batch.height,0.0)
                assertEquals(label,source.getInt("faceMask"),batch.faceMask);assertEquals(label,c.getBoolean("waterlogged"),batch.waterlogged)
                assertEquals(label,source.getJSONArray("indices").let{a->List(a.length()){a.getInt(it)}},batch.entries.map{it.sourceIndex});assertTrue(batch.entries.size<=4096)
            }
            assertEquals(label,actual.entries.map{it.sourceIndex}.sorted(),actual.batches.flatMap{it.entries}.map{it.sourceIndex}.sorted());entries+=actual.entries.size
        }
        assertTrue(entries>4900)
    }
    @Test fun insetFaceMaskedGeometryKeepsTheActualRenderedCubeAttributes() {
        for(c in rows(oracle.getJSONArray("geometries"))) {
            val label="mask ${c.getInt("faceMask")} waterlogged ${c.getBoolean("waterlogged")}";val g=OriginalFluids.geometry(c.getInt("faceMask"),c.getBoolean("waterlogged"))
            assertEquals(label,c.getInt("vertices"),g.vertexCount)
            for((name,buffer)in mapOf("position" to g.positions(),"normal" to g.normals(),"uv" to g.textureCoordinates()!!))assertEquals("$label $name",c.getJSONObject("attributes").getString(name),sha(buffer))
            val b=c.getJSONArray("bounds");for(axis in 0..2){assertEquals(label,b.getDouble(axis),g.bounds!!.min[axis],0.0);assertEquals(label,b.getDouble(axis+3),g.bounds!!.max[axis],0.0)}
            assertNull(g.indices())
        }
    }
    @Test fun cancellationAndPublishedCollectionsDoNotLeakPartialOrMutablePlans() {
        val voxels=List(512){RenderVoxel(it.toDouble(),0.0,0.0,"stone",0,"minecraft:water",mapOf("level" to "0"))};val planner=OriginalFluids()
        val result=planner.free(voxels);assertThrows(UnsupportedOperationException::class.java){(result.entries as MutableList).clear()}
        assertThrows(UnsupportedOperationException::class.java){(result.batches.first().entries as MutableList).clear()}
        assertThrows(CancellationException::class.java){planner.free(voxels,cancelled={true})}
        var checks=0;assertThrows(CancellationException::class.java){planner.waterlogged(voxels.map{it.copy(sourceBlockState=mapOf("waterlogged" to "true"))},cancelled={++checks>4})}
        assertEquals(512,result.entries.size)
    }
}
