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
import java.nio.IntBuffer
import java.nio.ReadOnlyBufferException
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class OriginalGeometryCompilerTest {
    companion object {private val oracle by lazy{JSONObject(OriginalGeometryCompilerTest::class.java.getResource("/original-compiler-oracle.json")!!.readText())}}
    private fun rows(a:JSONArray)=List(a.length()){a.getJSONObject(it)}
    private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
    private fun sha(values:FloatBuffer):String {val bytes=ByteBuffer.allocate(values.remaining()*4).order(ByteOrder.LITTLE_ENDIAN);while(values.hasRemaining())bytes.putFloat(values.get());return sha(bytes.array())}
    private fun indices(b:IntBuffer)=List(b.remaining()){b.get()}
    private fun voxel(v:JSONObject):RenderVoxel {
        val state=v.optJSONObject("sourceBlockState")?.let{raw->raw.keys().asSequence().associateWith{raw.getString(it)}}
        return RenderVoxel(v.getDouble("x"),v.getDouble("y"),v.getDouble("z"),v.getString("materialId"),0,if(v.isNull("sourceBlockId"))null else v.getString("sourceBlockId"),state,
            emissiveKind=if(v.has("emissiveKind"))v.getString("emissiveKind")else null,emissiveLevel=if(v.has("emissiveLevel"))v.getInt("emissiveLevel")else null)
    }
    private fun limit(c:JSONObject,key:String)=c.get(key).let{if(it is Number)it.toDouble()else it.toString().toDouble()}
    @Test fun expectedCompilerIsHoistedFromCurrentRendererRatherThanDuplicatedOrNativeGenerated() {
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/renderer.ts").isFile}
        val hashes=oracle.getJSONObject("sourceHashes")
        for(name in hashes.keys())assertEquals("Stale original compiler source: $name",hashes.getString(name),sha(File(root,name).readBytes()))
        assertEquals(20,oracle.getJSONArray("cases").length())
    }
    private fun emission(expected:Any,actual:SourceBlockEmission?) {
        if(expected==JSONObject.NULL){assertNull(actual);return};val e=expected as JSONObject;assertNotNull(actual)
        assertEquals(e.getString("kind"),actual!!.kind);assertEquals(e.getInt("level"),actual.level);assertEquals(e.getInt("color"),actual.color)
    }
    @Test fun explicitZeroLegacyKindsAndDerivedLanternCandleEmissionsMatchFormalProjection() {
        val cases=rows(oracle.getJSONArray("emissions"));assertTrue(cases.size>1200)
        for(c in cases) {
            val v=voxel(c.getJSONObject("voxel"));val e=c.getJSONObject("effective");val actual=OriginalEmission.effective(v)
            assertEquals(e.getString("kind"),actual.kind);assertEquals(e.getInt("level"),actual.level)
            emission(c.get("lantern"),OriginalEmission.lantern(v));emission(c.get("candle"),OriginalEmission.candle(v))
        }
    }
    @Test fun fullBatchedGeometryMaterialsMatricesAndBothBudgetsMatchTheActualRendererCompiler() {
        val compiler=OriginalGeometryCompiler();val cases=rows(oracle.getJSONArray("cases"));var batches=0
        for(c in cases) {
            val name=c.getString("name");val actual=compiler.compile(rows(c.getJSONArray("voxels")).map(::voxel),limit(c,"topologies"),limit(c,"materials"));val e=c.getJSONObject("result")
            assertEquals(name,e.getInt("topologies"),actual.topologies);assertEquals(name,e.getInt("topologyOverflow"),actual.topologyOverflow)
            assertEquals(name,e.getInt("materialGroups"),actual.batches.size);assertEquals(name,e.getInt("materialOverflow"),actual.materialOverflow);assertEquals(name,e.getInt("fallbackCount"),actual.fallbackCount)
            assertEquals(name,e.getJSONArray("handled").let{a->List(a.length()){a.getInt(it)}},indices(actual.handledIndices()))
            val expected=rows(e.getJSONArray("batches"));assertEquals(name,expected.size,actual.batches.size)
            for((index,b)in actual.batches.withIndex()) {
                val g=expected[index];val label="$name batch $index"
                assertEquals(label,g.getString("topologyKey"),b.topologyKey);assertEquals(label,g.getString("materialId"),b.material.key)
                assertEquals(label,g.getString("emissiveKind"),b.emission.kind);assertEquals(label,g.getInt("emissiveLevel"),b.emission.level)
                assertEquals(label,g.getJSONArray("indices").let{a->List(a.length()){a.getInt(it)}},indices(b.voxelIndices()))
                assertEquals("$label all actual matrices",g.getString("matrices"),sha(b.matrices()))
                for((attr,buffer)in mapOf("position" to b.geometry.positions(),"normal" to b.geometry.normals(),"uv" to b.geometry.textureCoordinates())) {
                    val expectedAttribute=g.getJSONObject("attributes").getJSONObject(attr)
                    assertEquals(label,expectedAttribute.getInt("length"),buffer.remaining());assertEquals("$label $attr",expectedAttribute.getString("sha"),sha(buffer))
                }
            };batches+=actual.batches.size
        }
        assertTrue(batches>100)
    }
    @Test fun sharedSurfacesAreBoundedButEachOwnerKeepsItsOwnStateTransformAndImmutableRows() {
        val cache=OriginalSurfaceCache(8192);val compiler=OriginalGeometryCompiler(surfaces=cache)
        val original=RenderVoxel(0.0,0.0,0.0,"wood",0,"minecraft:oak_sign",mapOf("rotation" to "0","waterlogged" to "false"))
        val first=compiler.compile(listOf(original));val other=compiler.compile(listOf(original.copy(x=12.0,sourceBlockState=mapOf("rotation" to "4","waterlogged" to "false"))))
        assertEquals(2,first.batches.size);assertEquals(first.batches.size,other.batches.size)
        for((i,b)in first.batches.withIndex()) {
            assertSame(b.geometry,other.batches[i].geometry);assertNotEquals(sha(b.matrices()),sha(other.batches[i].matrices()))
            assertThrows(ReadOnlyBufferException::class.java){b.voxelIndices().put(0,99)};assertThrows(ReadOnlyBufferException::class.java){b.matrices().put(0,99f)}
        }
        assertTrue(cache.retainedBytes<=8192);assertTrue(cache.size>0)
        assertThrows(UnsupportedOperationException::class.java){(first.batches as MutableList).clear()}
        assertThrows(CancellationException::class.java){compiler.compile(listOf(original),cancelled={true})}
        var checks=0;assertThrows(CancellationException::class.java){compiler.compile(List(1024){original.copy(x=it.toDouble())},cancelled={++checks>3})}
        compiler.clear();assertEquals(0,cache.size);assertEquals(0L,cache.retainedBytes)
        assertTrue(first.batches.first().geometry.vertexCount>0)
    }
}
