package com.blockcolc.world

import com.blockcolc.world.generation.*
import java.nio.ByteBuffer
import java.nio.FloatBuffer
import org.junit.Assert.*
import org.junit.Test

class NativePickStorageTest {
    private fun source(id:String,x:Double):NativePacketSource {
        val matrix=BlockTransform.translation(x,0.0,0.0)
        return NativePacketBuilder("building:$id").also{builder->builder.add(CuboidGeometry.create(1.0,1.0,1.0),
            NativeRenderMaterial(),FloatBuffer.wrap(FloatArray(16){matrix[it].toFloat()}))}.build()
    }
    @Test fun sharedGeometryOwnsOneCompactStorageBlockAndStillPicksExactFacesAfterCacheRetirement(){
        val a=source("a",0.0);val b=source("b",4.0)
        assertEquals(a.geometryKeys,b.geometryKeys)
        val allocations=mutableListOf<Int>()
        val compiler=NativeWorldPickCompiler()
        val index=NativePacketBuffers.using(NativePacketAllocator{bytes->allocations+=bytes;ByteBuffer.allocateDirect(bytes)}){
            compiler.prepare(listOf(a,b))
        }
        val geometry=a.world!!.geometries.single()
        assertEquals(listOf(geometry.vertexCount*12+geometry.indexCount*4+geometry.indexCount/3*24,152,152),allocations)
        assertTrue(index.estimatedBytes>=allocations.sum())
        val ray=NativePickRay(BlockPoint(0.0,0.0,5.0),BlockPoint(0.0,0.0,-1.0))
        assertEquals("a",index.pick(ray)!!.id)
        assertEquals(5.0-geometry.bounds.max.z,index.pick(ray)!!.distance,1e-6)
        allocations.clear()
        NativePacketBuffers.using(NativePacketAllocator{bytes->allocations+=bytes;ByteBuffer.allocateDirect(bytes)}){compiler.prepare(listOf(b))}
        assertTrue(allocations.isEmpty())
        compiler.clear()
        assertEquals("a",index.pick(ray)!!.id)
    }
    @Test fun bvhBudgetTracksTheActualBalancedLeafAllocation(){
        assertEquals(0L,PickTree.storageBytes(0))
        assertEquals(8*4L+64,PickTree.storageBytes(8))
        assertEquals(9*4L+3*64,PickTree.storageBytes(9))
        // 48 triangles partition into eight six-triangle leaves, not six
        // eight-triangle leaves. The tree has 15 nodes, each 64 scalar bytes.
        assertEquals(48*4L+15*64,PickTree.storageBytes(48))
    }
    @Test fun largePackedBoundsAvoidRepeatedPartitionReadsAndKeepExactNearestHits(){
        var reads=0
        val bounds=object:PickBounds{
            override val size=4096
            private fun coordinate(index:Int,axis:Int)=when(axis){0->(index%16)*2.0;1->(index/256)*2.0;else->(index/16%16)*2.0}
            override fun low(index:Int,axis:Int):Double{reads++;return coordinate(index,axis)}
            override fun high(index:Int,axis:Int):Double{reads++;return coordinate(index,axis)+1.0}
        }
        val tree=PickTree(bounds){false}
        assertTrue("Packed reads during preparation: $reads",reads<bounds.size*90)
        reads=0
        val spatial=PickTree(bounds,spatialOrder=true){false}
        assertEquals("Spatial build reads each bound three times",bounds.size*18,reads)
        for(x in listOf(-1.0,.5,8.5,18.5,30.5,34.0))for(y in listOf(.5,10.5,30.5)){
            val ray=NativePickRay(BlockPoint(x,y,40.0),BlockPoint(0.0,0.0,-1.0))
            val expected=(0 until bounds.size).minOf{bounds.near(it,ray,Double.POSITIVE_INFINITY)}
            for(candidate in listOf(tree,spatial)){
                val actual=candidate.visit(ray,Double.POSITIVE_INFINITY){index,before->minOf(before,bounds.near(index,ray,before))}
                assertEquals(expected,actual,0.0)
            }
        }
    }
}
