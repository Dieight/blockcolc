package com.blockcolc.world

import com.blockcolc.world.generation.BlockBox
import com.blockcolc.world.generation.BlockPoint
import com.blockcolc.world.generation.BlockTransform
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CancellationException
import kotlin.math.min
import kotlin.random.Random

class NativeSpatialHotPathTest {
    @Test fun transformedBoundsMatchCornerOracleIncludingReflectionsAndShears() {
        val random=Random(20261116)
        repeat(300){
            val matrix=DoubleArray(16){0.0}
            for(column in 0..2)for(row in 0..2)matrix[column*4+row]=random.nextDouble(-5.0,5.0)
            for(i in 12..14)matrix[i]=random.nextDouble(-10000.0,10000.0)
            matrix[15]=1.0
            val transform=BlockTransform.fromElements(matrix)
            val low=DoubleArray(3){random.nextDouble(-100.0,0.0)}
            val high=DoubleArray(3){random.nextDouble(0.0,100.0)}
            val box=BlockBox(BlockPoint(low[0],low[1],low[2]),BlockPoint(high[0],high[1],high[2]))
            val corners=(0..7).map{mask->transform.point(BlockPoint(if(mask and 4==0)low[0]else high[0],if(mask and 2==0)low[1]else high[1],if(mask and 1==0)low[2]else high[2]))}
            val result=transform.box(box)
            for(axis in 0..2){assertEquals(corners.minOf{it[axis]},result.min[axis],0.0);assertEquals(corners.maxOf{it[axis]},result.max[axis],0.0)}
        }
    }

    @Test fun largePickTreeRetainsTheNearestHitAndCooperativelyCancelsDuringItsScan() {
        var reads=0;var cancelAfter=Int.MAX_VALUE
        val bounds=object:PickBounds {
            override val size=65536
            override fun low(index:Int,axis:Int):Double {reads++;return if(axis==0)index*2.0 else -1.0}
            override fun high(index:Int,axis:Int)=if(axis==0)index*2.0+1 else 1.0
        }
        val tree=PickTree(bounds){reads>=cancelAfter}
        val ray=NativePickRay(BlockPoint(-5.0,0.0,0.0),BlockPoint(1.0,0.0,0.0))
        assertEquals(5.0,tree.visit(ray,Double.POSITIVE_INFINITY){i,before->min(before,bounds.near(i,ray,before))},0.0)
        reads=0;cancelAfter=9000
        assertThrows(CancellationException::class.java){PickTree(bounds){reads>=cancelAfter}}
        assertTrue("Cancellation must not wait for the full large scan",reads<25000)
    }

    @Test fun pickTreeRejectsAnInterruptedThreadEvenForEmptyInput() {
        val bounds=object:PickBounds {override val size=0;override fun low(index:Int,axis:Int)=0.0;override fun high(index:Int,axis:Int)=0.0}
        Thread.currentThread().interrupt()
        try{assertThrows(CancellationException::class.java){PickTree(bounds){false}}}
        finally{Thread.interrupted()}
    }
}
