package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.junit.Assert.*
import org.junit.Test

class NativePlanarCompactionTest {
    @Test fun compactionKeepsHolesHeightsMaterialBoundariesAndVerticalFaces() {
        val mesh = TerrainMeshBuilder {}
        fun top(x: Double,z: Double,material: TerrainMaterial,y: Double = 0.0) =
            mesh.top(doubleArrayOf(x,y,z, x,y,z+1, x+1,y,z+1, x+1,y,z),material)
        top(0.0,0.0,TerrainMaterial.GRASS)
        top(1.0,0.0,TerrainMaterial.GRASS)
        top(0.0,1.0,TerrainMaterial.GRASS)
        top(1.0,1.0,TerrainMaterial.WATER)
        top(2.0,0.0,TerrainMaterial.GRASS,1.0)
        top(3.0,0.0,TerrainMaterial.DIRT,1.0)
        mesh.side(doubleArrayOf(2.0,0.0,0.0, 2.0,0.0,1.0, 2.0,1.0,1.0, 2.0,1.0,0.0),TerrainMaterial.DIRT)
        val footprint = TerrainPlanBounds(0.0,4.0,0.0,2.0)
        val source = mesh.finish(6,TerrainBounds(0.0,4.0,0.0,1.0,0.0,2.0),footprint,footprint,emptyList(),
            TerrainLodCounts(6,0,0),TerrainWaterStats(0,0,0,0,0,0,0.0,0,1.0,6.0),null,null)
        val original = NativePlanarGeometry.terrain(source)
        val compact = NativePlanarGeometry.terrain(source,compactOpaqueTops=true)
        val grass = TerrainMaterial.GRASS.ordinal
        assertEquals(24,original[grass]!!.indices()!!.remaining())
        val merged = compact[grass]!!
        assertEquals(18,merged.indices()!!.remaining())
        val p = merged.positions()
        val uv = merged.textureCoordinates()!!
        val normals = merged.normals()
        repeat(merged.vertexCount) { i ->
            assertEquals(p[i*3]/4,uv[i*2],0f)
            assertEquals(p[i*3+2]/4,uv[i*2+1],0f)
            assertEquals(1f,normals[i*3+1],0f)
            assertTrue(p[i*3] <= 1 || p[i*3+2] <= 1)
        }
        for (i in compact.indices.filter { it != grass }) {
            assertEquals(original[i]?.positions(),compact[i]?.positions())
            assertEquals(original[i]?.indices(),compact[i]?.indices())
        }
    }
}
