package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.junit.Assert.*
import org.junit.Test
import java.nio.FloatBuffer

class NativeAnimalPickingTest {
    private fun packets()=NativeAnimalPackets.prepare(BlockBox(BlockPoint(-40.0,-4.0,-40.0),BlockPoint(40.0,40.0,40.0)))
    private fun pig(id:Int,z:Double=0.0)=NativeAnimalAgent(id,"pig","land",AnimalPoint(0.0,0.0,z),0.0,"rest",4.0,0.0)
    private val ray=NativePickRay(BlockPoint(0.0,.55,6.0),BlockPoint(0.0,0.0,-1.0))
    private fun occluder(opacity:Float=1f):NativePacketSource {
        val builder=NativePacketBuilder("world");val m=BlockTransform.translation(0.0,.5,2.0)
        builder.add(CuboidGeometry.create(),NativeRenderMaterial(opacity=opacity,transparent=opacity<1f),FloatBuffer.wrap(FloatArray(16){m[it].toFloat()}))
        return builder.build()
    }
    @Test fun tapsUseTheNearestLiveCuboidOrFaceAndIgnoreContactShadows(){
        val template=NativeAnimalPickTemplate(packets());val rig=AnimalRig();val a=pig(1);val b=pig(2,3.0)
        rig.update(listOf(a,b),0.0);val hit=template.snapshot(rig).pick(ray,NativeWorldPickIndex.EMPTY)
        assertEquals(2,hit!!.id);assertTrue(hit.distance in 2.0..3.0)
        val floorRay=NativePickRay(BlockPoint(2.0,4.0,0.0),BlockPoint(0.0,-1.0,0.0))
        assertNull(template.snapshot(rig).pick(floorRay,NativeWorldPickIndex.EMPTY))
    }
    @Test fun aTapSnapshotIsIndependentOfTheNextAnimationFrameAndVisibilityChange(){
        val template=NativeAnimalPickTemplate(packets());val rig=AnimalRig();val a=pig(1)
        rig.update(listOf(a),0.0);val snapshot=template.snapshot(rig)
        a.position=AnimalPoint(20.0,0.0,0.0);rig.update(listOf(a),1.0)
        assertEquals(1,snapshot.pick(ray,NativeWorldPickIndex.EMPTY)!!.id);assertNull(template.snapshot(rig).pick(ray,NativeWorldPickIndex.EMPTY))
        rig.update(listOf(a),1.0,emptySet());assertNull(template.snapshot(rig).pick(ray,NativeWorldPickIndex.EMPTY))
    }
    @Test fun opaqueTerrainAndBuildingsOccludeAnimalsButTranslucentWaterDoesNot(){
        val rig=AnimalRig();rig.update(listOf(pig(1)),0.0);val snapshot=NativeAnimalPickTemplate(packets()).snapshot(rig)
        val compiler=NativeWorldPickCompiler()
        val opaque=compiler.prepare(listOf(occluder()),withOcclusion=true)
        assertTrue(opaque.ids.isEmpty());assertNull(snapshot.pick(ray,opaque))
        val water=compiler.prepare(listOf(occluder(.4f)),withOcclusion=true);assertEquals(1,snapshot.pick(ray,water)!!.id)
        val nearOpaque=compiler.prepare(listOf(occluder(.9f)),withOcclusion=true);assertNull(snapshot.pick(ray,nearOpaque))
        compiler.clear()
    }
}
