package com.blockcolc.world

import com.blockcolc.world.generation.TerrainCornerIndex
import org.junit.Assert.*
import org.junit.Test

class TerrainCornerIndexTest {
    @Test fun crossedLinesCloseOnlyTheirActualCornersAndKeepInsertionOrder(){
        val points=TerrainCornerIndex()
        points.addHeight(-0.0,2.0,0.0);points.addHeight(0.0,2.0,3.0)
        points.addHeight(1.0,2.0,0.0);points.addHeight(1.0,2.0,3.0)
        points.addHeight(0.0,3.0,0.0);points.addHeight(0.0,3.0,3.0)
        points.prepareLines();assertEquals(3,points.size);assertEquals(0.0,points.x(0),0.0)
        points.spansAlong(true,0.0,1.989,2.011,0.0,1.0)
        points.spansAlong(false,2.0,-.011,1.011,2.0,3.0)
        assertEquals(1.0,points.uncoveredStart(0)!!,0.0)
        assertEquals(0.0,points.uncoveredStart(1)!!,0.0)
        assertEquals(0.0,points.uncoveredStart(2)!!,0.0)
        points.spanAt(0.0,2.0,1.0,2.0);assertNull(points.uncoveredStart(0))
        points.spanAt(9.0,9.0,0.0,3.0);assertEquals(3,points.size)
    }
    @Test fun denseCoverageUsesBoundedNumericStorageAcrossGrowthAndTwoSortedViews(){
        val points=TerrainCornerIndex()
        for(x in 127 downTo 0)for(z in 0..127){points.addHeight(x.toDouble(),z.toDouble(),0.0);points.addHeight(x.toDouble(),z.toDouble(),2.0)}
        points.prepareLines()
        for(x in 0..127)points.spansAlong(true,x.toDouble(),0.0,127.0,0.0,1.0)
        for(z in 127 downTo 0)points.spansAlong(false,z.toDouble(),0.0,127.0,1.0,2.0)
        assertEquals(16384,points.size);assertEquals(127.0,points.x(0),0.0)
        for(i in 0 until points.size)assertNull(points.uncoveredStart(i))
        assertTrue("Corner and side coverage must not retain boxed graph storage",points.storageBytes<points.size*160L)
    }
}
