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

class BoxSurfaceMesherTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/original-shape-oracle.json")!!.readText())}
    private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
    private fun sha(values:FloatBuffer):String {
        val bytes=ByteBuffer.allocate(values.remaining()*4).order(ByteOrder.LITTLE_ENDIAN)
        while(values.hasRemaining())bytes.putFloat(values.get());return sha(bytes.array())
    }
    private fun point(value:JSONArray)=BlockPoint(value.getDouble(0),value.getDouble(1),value.getDouble(2))
    private fun box(value:JSONObject)=BlockBox(point(value.getJSONArray("min")),point(value.getJSONArray("max")))
    @Test fun oracleIsTheCurrentFormalMesherAndPinnedThreePackageNotNativeOutput() {
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/original-static-shapes.ts").isFile}
        val sources=oracle.getJSONObject("sourceHashes")
        for(name in sources.keys())assertEquals("Stale box geometry oracle: $name",sources.getString(name),sha(File(root,name).readBytes()))
        assertEquals(23,oracle.getJSONObject("registry").length())
        assertTrue(oracle.getJSONArray("plans").length()>600)
    }
    @Test fun everyOriginalComponentAndArbitraryUnionMatchesAllSourceFloat32AttributesAndWinding() {
        val cases=oracle.getJSONArray("geometries");assertTrue(cases.length()>80);var vertices=0
        for(index in 0 until cases.length()) {
            val c=cases.getJSONObject(index);val boxes=c.getJSONArray("boxes");val mesh=BoxSurfaceMesher.create(List(boxes.length()){box(boxes.getJSONObject(it))})
            val attrs=c.getJSONObject("attributes");val buffers=mapOf("position" to mesh.positions(),"normal" to mesh.normals(),"uv" to mesh.textureCoordinates())
            for((name,buffer)in buffers) {
                val e=attrs.getJSONObject(name);assertEquals("mesh $index $name length",e.getInt("length"),buffer.remaining())
                assertEquals("mesh $index $name complete upload",e.getString("sha"),sha(buffer))
            }
            assertEquals(attrs.getJSONObject("position").getInt("length")/3,mesh.vertexCount);assertEquals(mesh.vertexCount*32L,mesh.byteSize)
            if(c.isNull("bounds"))assertNull(mesh.bounds)else {
                val bounds=c.getJSONArray("bounds");assertEquals(point(bounds.getJSONArray(0)),mesh.bounds!!.min);assertEquals(point(bounds.getJSONArray(1)),mesh.bounds!!.max)
            }
            vertices+=mesh.vertexCount
        }
        assertTrue(vertices>10000)
    }
    @Test fun adjacentBlocksCullTheirSharedSurfaceAndPublishedColumnsCannotBeChanged() {
        val left=BlockBox(BlockPoint(-.5,-.5,-.5),BlockPoint(0.0,.5,.5));val right=BlockBox(BlockPoint(0.0,-.5,-.5),BlockPoint(.5,.5,.5))
        val input=mutableListOf(left,right);val mesh=BoxSurfaceMesher.create(input);input.clear()
        val positions=mesh.positions();val normals=mesh.normals()
        repeat(mesh.vertexCount){i->if(positions[i*3]==0f)assertNotEquals("No internal +/-X face at the join",1f,kotlin.math.abs(normals[i*3]))}
        assertThrows(ReadOnlyBufferException::class.java){mesh.positions().put(0,9f)}
        assertThrows(ReadOnlyBufferException::class.java){mesh.normals().put(0,9f)}
        assertThrows(ReadOnlyBufferException::class.java){mesh.textureCoordinates().put(0,9f)}
        assertFalse(mesh.positions().hasArray());assertTrue(mesh.vertexCount>0)
    }
    @Test fun invalidGpuCoordinatesBudgetsAndCancellationNeverReturnPartialGeometry() {
        val box=BlockBox(BlockPoint(-.5,-.5,-.5),BlockPoint(.5,.5,.5))
        assertThrows(IllegalArgumentException::class.java){BlockPoint(Double.NaN,0.0,0.0)}
        assertThrows(IllegalArgumentException::class.java){BlockBox(BlockPoint(1.0,0.0,0.0),BlockPoint(0.0,0.0,0.0))}
        assertThrows(IllegalArgumentException::class.java){BoxSurfaceMesher.create(listOf(box),35)}
        assertThrows(IllegalArgumentException::class.java){BoxSurfaceMesher.create(List(257){box})}
        assertThrows(IllegalArgumentException::class.java){BoxSurfaceMesher.create(listOf(BlockBox(BlockPoint(0.0,0.0,0.0),BlockPoint(Double.MAX_VALUE,1.0,1.0))))}
        assertThrows(CancellationException::class.java){BoxSurfaceMesher.create(listOf(box),cancelled={true})}
        var checks=0;assertThrows(CancellationException::class.java){BoxSurfaceMesher.create(listOf(box),cancelled={++checks>2})}
        assertEquals(0,BoxSurfaceMesher.create(emptyList(),0).vertexCount)
    }
}
