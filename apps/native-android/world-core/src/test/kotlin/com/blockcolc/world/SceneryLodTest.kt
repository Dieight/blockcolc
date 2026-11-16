package com.blockcolc.world

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SceneryLodTest {
    @Test fun sourceHysteresisDoesNotFlickerBetweenThirtyAndFortyTwoPixels() {
        assertFalse(SceneryLod.full(29.9,true));assertTrue(SceneryLod.full(30.0,true))
        assertFalse(SceneryLod.full(42.0,false));assertTrue(SceneryLod.full(42.1,false))
        for(p in listOf(30.1,35.0,41.9)){assertTrue(SceneryLod.full(p,true));assertFalse(SceneryLod.full(p,false))}
    }
    @Test fun selectorUsesViewDepthAndLogicalRatherThanPhysicalPixels() {
        val lod=SceneryLod.read(JSONObject("{id:wreck,detail:full,center:[0,0,-100],width:10}"))
        val p=DrawPacket(0,"world","static",0,0,1,BufferRange(16,80),Bounds(Point3(0f,0f,0f),Point3(1f,1f,1f)),false,false,null,emptyList(),4,lod)
        val selector=ScenerySelector(listOf(p));val eye=doubleArrayOf(0.0,0.0,0.0);val target=doubleArrayOf(0.0,0.0,-1.0)
        assertEquals(mapOf("wreck" to false),selector.update(eye,target,90.0,500.0))
        assertEquals(25.0,selector.projectedPixels.getValue("wreck"),1e-6)
        assertTrue(selector.update(eye,target,90.0,700.0).isEmpty())
        assertEquals(mapOf("wreck" to true),selector.update(eye,target,90.0,900.0));assertEquals(2,selector.transitions)
        assertTrue(selector.update(eye,target,90.0,900.0).isEmpty())
    }
}
