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
import java.nio.ReadOnlyBufferException
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class OriginalSupplementTest {
    companion object {private val oracle by lazy {JSONObject(OriginalSupplementTest::class.java.getResource("/original-supplement-oracle.json")!!.readText())}}
    private fun rows(array:JSONArray)=List(array.length()){array.getJSONObject(it)}
    private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
    private fun sha(values:FloatBuffer):String {val bytes=ByteBuffer.allocate(values.remaining()*4).order(ByteOrder.LITTLE_ENDIAN);while(values.hasRemaining())bytes.putFloat(values.get());return sha(bytes.array())}
    private fun sha(values:ByteBuffer)=sha(ByteArray(values.remaining()).also{values.get(it)})
    private fun voxel(v:JSONObject):RenderVoxel=RenderVoxel(v.optDouble("x",0.0),v.optDouble("y",0.0),v.optDouble("z",0.0),v.getString("materialId"),0,
        if(v.has("sourceBlockId"))v.getString("sourceBlockId")else null,v.optJSONObject("sourceBlockState")?.let{s->s.keys().asSequence().associateWith{s.getString(it)}})
    private fun geometry(label:String,expected:JSONObject,actual:BlockGeometry) {
        assertEquals(label,expected.getInt("vertices"),actual.vertexCount)
        val buffers=mapOf("position" to actual.positions(),"normal" to actual.normals(),"uv" to actual.textureCoordinates(),"color" to actual.colors())
        val attributes=expected.getJSONObject("attributes")
        assertEquals(label,attributes.keys().asSequence().toSet(),buffers.filterValues{it!=null}.keys)
        for((name,buffer)in buffers){if(buffer==null)continue;val e=attributes.getJSONObject(name);assertEquals("$label $name length",e.getInt("length"),buffer.remaining());assertEquals("$label $name",e.getString("sha"),sha(buffer))}
        val index=actual.indices()
        if(expected.isNull("indices"))assertNull(label,index)else{
            assertNotNull(label,index);val e=expected.getJSONObject("indices");assertEquals(label,e.getInt("length"),index!!.remaining())
            val bytes=ByteBuffer.allocate(index.remaining()*4).order(ByteOrder.LITTLE_ENDIAN);while(index.hasRemaining())bytes.putInt(index.get());assertEquals("$label all indices",e.getString("sha"),sha(bytes.array()))
        }
        if(expected.isNull("bounds"))assertNull(label,actual.bounds)else {
            val e=expected.getJSONArray("bounds");val a=actual.bounds!!
            for(i in 0..2){assertEquals(label,e.getDouble(i),a.min[i],0.0);assertEquals(label,e.getDouble(i+3),a.max[i],0.0)}
        }
    }
    @Test fun currentFormalFunctionsProduceTheOracleAndTheIdRegistryIsExact() {
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/renderer.ts").isFile}
        val hashes=oracle.getJSONObject("sourceHashes");for(name in hashes.keys())assertEquals("Stale supplement: $name",hashes.getString(name),sha(File(root,name).readBytes()))
        val ids=oracle.getJSONArray("ids");assertEquals(List(ids.length()){ids.getString(it)}.toSet(),OriginalBlockDetails.ids)
        assertTrue(oracle.getJSONArray("details").length()>300)
    }
    @Test fun cuboidsKeepTheSixFaceVertexOrderAndUvsRatherThanUnionBoxUvs() {
        for((i,c)in rows(oracle.getJSONArray("cubes")).withIndex()){val s=c.getJSONArray("size");geometry("cube $i",c.getJSONObject("geometry"),CuboidGeometry.create(s.getDouble(0),s.getDouble(1),s.getDouble(2)))}
    }
    @Test fun workstationsChestChainsPicklesOreAndAllBookshelfStatesKeepPartsPixelsAndOrientation() {
        val details=OriginalBlockDetails()
        for((i,c)in rows(oracle.getJSONArray("details")).withIndex()) {
            val v=voxel(c.getJSONObject("voxel"));val parts=details.parts(v);val label="detail $i ${v.sourceBlockId} ${v.sourceBlockState}"
            if(c.isNull("parts")){assertNull(label,parts);continue}
            assertNotNull(label,parts);val expected=c.getJSONArray("parts");assertEquals(label,expected.length(),parts!!.size)
            for((n,p)in parts.withIndex()){val a=expected.getJSONArray(n);for((axis,value)in listOf(p.x,p.y,p.z,p.width,p.height,p.depth).withIndex())assertEquals(label,a.getDouble(axis),value,0.0)}
            geometry(label,c.getJSONObject("geometry"),details.geometry(parts))
            assertEquals("$label pixels",c.getString("pixels"),sha(details.pixels(v).rgba()))
            val transform=details.transform(v);val matrix=FloatBuffer.wrap(FloatArray(16){transform[it].toFloat()});assertEquals("$label transform",c.getString("matrix"),sha(matrix))
        }
    }
    @Test fun originalFlowersAndEveryWheatAgeKeepActualVerticesNormalsAndLinearColors() {
        for((i,c)in rows(oracle.getJSONArray("flowers")).withIndex()) {
            val v=voxel(c.getJSONObject("voxel"));val key=OriginalFlowers.key(v);val label="flower $i ${v.sourceBlockId} ${v.sourceBlockState}"
            if(c.isNull("key")){assertNull(label,key);continue}
            assertEquals(label,c.getString("key"),key);assertEquals(label,c.getInt("age"),OriginalFlowers.age(v))
            geometry(label,c.getJSONObject("geometry"),OriginalFlowers.geometry(key!!))
        }
        assertEquals("minecraft:oxeye_daisy",OriginalFlowers.naturalId(-1.0));assertEquals("minecraft:poppy",OriginalFlowers.naturalId(-.9))
    }
    @Test fun connectedGlassKeepsOnlyOuterFacesAndUsesUnionBoundaryAtlasMasks() {
        for(c in rows(oracle.getJSONArray("accepts")))assertEquals(c.toString(),c.getBoolean("accepts"),ConnectedOriginalGlass.accepts(voxel(c.getJSONObject("voxel"))))
        for((i,c)in rows(oracle.getJSONArray("glass")).withIndex())geometry("glass $i",c.getJSONObject("geometry"),ConnectedOriginalGlass.surface(rows(c.getJSONArray("voxels")).map(::voxel)))
        assertEquals(oracle.getString("glassPixels"),sha(ConnectedOriginalGlass.pixels()))
    }
    @Test fun returnedAttributesTexturesAndRegistriesAreImmutableAndCancelledGeometryIsNotPublished() {
        val v=RenderVoxel(0.0,0.0,0.0,"glass",0,"minecraft:glass")
        val g=ConnectedOriginalGlass.surface(listOf(v));assertTrue(g.byteSize>0)
        assertThrows(ReadOnlyBufferException::class.java){g.positions().put(0,99f)}
        assertThrows(ReadOnlyBufferException::class.java){g.indices()!!.put(0,99)}
        assertThrows(ReadOnlyBufferException::class.java){ConnectedOriginalGlass.pixels().put(0,99.toByte())}
        assertThrows(ReadOnlyBufferException::class.java){OriginalBlockDetails().pixels(v.copy(sourceBlockId="minecraft:chest")).rgba().put(0,99.toByte())}
        assertThrows(UnsupportedOperationException::class.java){(OriginalFlowers.colors as MutableMap).clear()}
        assertThrows(UnsupportedOperationException::class.java){(OriginalBlockDetails.ids as MutableSet).clear()}
        assertThrows(CancellationException::class.java){ConnectedOriginalGlass.surface(listOf(v),cancelled={true})}
        assertThrows(IllegalArgumentException::class.java){ConnectedOriginalGlass.surface(listOf(v),maximumVertices=4)}
        assertThrows(IllegalArgumentException::class.java){CuboidGeometry.create(Double.NaN)}
    }
}
