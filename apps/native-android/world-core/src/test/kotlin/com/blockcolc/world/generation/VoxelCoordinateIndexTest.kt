package com.blockcolc.world.generation

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CancellationException

class VoxelCoordinateIndexTest {
    private fun voxel(x:Double,y:Double,z:Double,index:Int)=RenderVoxel(x,y,z,"stone",index,"minecraft:stone")
    @Test fun denseFractionalAndDuplicateCoordinatesMatchLastWriteLookupWithoutPerCellNodes(){
        val values=List(40000){i->voxel((i%401-200)/2.0,(i%7)/3.0,(i/401-50)/2.0,i)}+
            listOf(voxel(-0.0,0.0,0.0,40000),voxel(0.0,-0.0,0.0,40001))
        val expected=HashMap<List<Double>,RenderVoxel>()
        fun key(x:Double,y:Double,z:Double)=listOf(x,y,z).map{if(it==0.0)0.0 else it}
        values.forEach{expected[key(it.x,it.y,it.z)]=it}
        val actual=VoxelCoordinateIndex(values)
        for(v in values)assertSame(expected[key(v.x,v.y,v.z)],actual[v.x,v.y,v.z])
        assertNull(actual[99999.0,2.0,3.0]);assertTrue(actual.storageBytes<values.size*16L)
        val even=VoxelCoordinateIndex(values,{it.buildOrder%2==0})
        val admitted=values.filter{it.buildOrder%2==0}.associateBy{key(it.x,it.y,it.z)}
        for(v in values)assertSame(admitted[key(v.x,v.y,v.z)],even[v.x,v.y,v.z])
    }
    @Test fun cancellationIsObservedBeforeAndDuringDenseAdmission(){
        val values=List(10000){voxel(it.toDouble(),0.0,0.0,it)}
        assertThrows(CancellationException::class.java){VoxelCoordinateIndex(values,cancelled={true})}
        var calls=0
        assertThrows(CancellationException::class.java){VoxelCoordinateIndex(values,cancelled={++calls>100})}
    }
}
