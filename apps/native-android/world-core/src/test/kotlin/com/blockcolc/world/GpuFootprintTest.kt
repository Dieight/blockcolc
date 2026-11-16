package com.blockcolc.world

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import java.nio.ByteBuffer

class GpuFootprintTest {
    @Test fun nonPowerOfTwoMipChainsIncludeEveryNativeAllocationLevel() {
        assertEquals(4L,GpuFootprint.mipBytes(1,1));assertEquals(84L,GpuFootprint.mipBytes(4,4))
        assertEquals(72L,GpuFootprint.mipBytes(5,3))
        assertThrows(IllegalArgumentException::class.java){GpuFootprint.mipBytes(8192,8192)}
    }
    @Test fun budgetsFailBeforeAnyRendererCanAllocate() {
        for(bytes in listOf(-1L,257L*1024*1024))assertThrows(IllegalArgumentException::class.java){GpuFootprint(bytes,16,4)}
        assertThrows(IllegalArgumentException::class.java){GpuFootprint(0,65L*1024*1024,0)}
        assertThrows(IllegalArgumentException::class.java){GpuFootprint(0,0,129L*1024*1024)}
        val world=WorldPackets.read(javaClass.getResource("/codec-fixture.json")!!.readText(),ByteBuffer.wrap(javaClass.getResource("/codec-fixture.bin")!!.readBytes()))
        val estimate=GpuFootprint.read(world,JSONObject("{textures:[]}"))
        assertEquals(224L,estimate.instanceBytes);assertEquals(4L,estimate.textureBytes)
        assertEquals(world.geometries.single().vertexCount*64L+world.geometries.single().indexCount*4L,estimate.geometryBytes)
    }
    @Test fun uniformFloatGroundIsBudgetedOnceWithoutInventingAMipmapChain() {
        val metadata=JSONObject(javaClass.getResource("/codec-fixture.json")!!.readText())
        metadata.getJSONArray("materials").getJSONObject(0).put("recipe",JSONObject("""{"uniforms":{"weatherGround":{"texture":0},"alias":{"texture":0}}}"""))
        metadata.put("textures",org.json.JSONArray("""[{"id":0,"image":"ground","encoding":"r32f-le","colorSpace":"","width":3,"height":2}]"""))
        val world=WorldPackets.read(metadata.toString(),ByteBuffer.wrap(javaClass.getResource("/codec-fixture.bin")!!.readBytes()))
        assertEquals(28L,GpuFootprint.read(world,metadata).textureBytes)
    }
}
