package com.blockcolc.world

import com.blockcolc.world.generation.BlockPoint
import org.junit.Assert.*
import org.junit.Test

class NativeInteriorTest {
    private fun camera()=NativeSceneCamera(BlockPoint(0.0,4.0,0.0),BlockPoint(50.0,40.0,50.0),100.0,40.0,
        SourceCamera(40.0,listOf(listOf(-30.0,0.0,-30.0),listOf(30.0,25.0,30.0)),360.0,.82,.91,1.5,360.0))
    private val buildings=listOf(NativeOrbitTarget("a",BlockPoint(-20.0,0.0,-12.0),20.0,20.0,15.0),NativeOrbitTarget("b",BlockPoint(20.0,2.0,12.0),15.0,20.0,22.0))
    @Test fun distantRewardDoesNotMoveTheDeskAndTheActualWindowAspectControlsTheFit(){
        val compiler=NativeInteriorCompiler();val plain=compiler.prepare(camera(),buildings,emptyList())
        val distant=compiler.prepare(camera(),buildings+NativeOrbitTarget("reward:far",BlockPoint(300.0,0.0,250.0),8.0,8.0,8.0),emptyList())
        assertEquals(plain.pose,distant.pose)
        val portrait=compiler.prepare(camera(),buildings,emptyList(),aspect=.5)
        val wide=compiler.prepare(camera(),buildings,emptyList(),aspect=1.5)
        assertTrue(portrait.pose.sceneDistance>wide.pose.sceneDistance)
        assertTrue(wide.pose.eye.z>buildings.maxOf{it.position.z+it.depth/2})
    }
    @Test fun sharedBlocksSealTheWindowAndRoofAndKeepTheBedHeadAtTheWall(){
        val scene=NativeInteriorCompiler().prepare(camera(),buildings,listOf(NativeInteriorItem("bed",-3.5,0.0,3.0)))
        val cells=scene.blocks
        for(x in -4..3)for(y in 1..3)assertTrue(cells.any{it.x==x+.5&&it.y==y+.5&&it.z== -4.5&&it.sourceBlockId=="minecraft:glass"})
        for(x in -5..4)for(z in -5..4){
            assertTrue(cells.any{it.x==x+.5&&it.y==4.5&&it.z==z+.5})
            assertTrue(cells.any{it.x==x+.5&&it.y== -.5&&it.z==z+.5})
        }
        assertTrue(cells.any{it.sourceBlockId=="minecraft:oak_stairs"})
        val bed=cells.filter{it.sourceBlockId=="minecraft:red_bed"}
        assertEquals(2,bed.size)
        assertEquals(3.5,bed.single{it.sourceBlockState?.get("part")=="head"}.z,0.0)
        assertEquals(2.5,bed.single{it.sourceBlockState?.get("part")=="foot"}.z,0.0)
        assertTrue(bed.all{it.sourceBlockState?.get("facing")=="south"})
        assertEquals(-4.0,bed.minOf{it.x}-.5,0.0)
        assertEquals(4.0,bed.maxOf{it.z}+.5,0.0)
        assertEquals(NativeInteriorBlocks.VIEW_Z,cells.single{it.sourceBlockId=="minecraft:oak_stairs"}.z,0.0)
        assertTrue(cells.filter{it.sourceBlockId=="minecraft:lantern"}.all{kotlin.math.abs(it.x)>.85})
        assertEquals(1.62,NativeInteriorBlocks.EYE_HEIGHT,0.0)
        assertEquals(1.0,NativeInteriorBlocks.DESK_HEIGHT,0.0)
        assertTrue(scene.source.world!!.materials.all{!org.json.JSONObject(it).getBoolean("fog")})
    }
    @Test fun studyIsOneBoundedIndependentOwnerAndContainsNoBlueprintOrTerrainSource(){
        val scene=NativeInteriorCompiler().prepare(camera(),buildings,emptyList())
        assertEquals(PacketOwners.INTERIOR,scene.source.owner);assertEquals(NativePacketLayer.STATIC,scene.source.layer)
        assertTrue(scene.source.world!!.packets.isNotEmpty());assertTrue(scene.source.world!!.packets.all{it.owner==PacketOwners.INTERIOR})
        assertTrue(scene.source.world!!.packets.sumOf{it.count}<500)
        assertTrue(scene.items.isEmpty());assertTrue(scene.pose.eye.z>buildings.maxOf{it.position.z+it.depth/2})
        assertNull(NativeInteriorCompiler.empty().world)
    }
    @Test fun interiorLookAndZoomKeepTheEyeFixedAndRestoreThePreviousOutdoorPivot(){
        val nav=NativeWorldNavigation(camera(),buildings,.6);assertTrue(nav.focus("b"));nav.drag(12.0,4.0);val outdoor=nav.frame
        val study=NativeInteriorCompiler().prepare(camera(),buildings,listOf(NativeInteriorItem("bed",-2.4,0.0,2.6)))
        nav.interior(study.pose);val first=nav.frame;nav.drag(230.0,25.0);nav.pinch(100.0,150.0)
        assertTrue("Window fog must use the town distance, not a one-block look vector",nav.atmosphericDistance>50)
        assertEquals(study.pose.sceneDistance,nav.atmosphericDistance,0.0)
        assertEquals(first.eye,nav.frame.eye);assertNotEquals(first.target,nav.frame.target);assertTrue(nav.indoors)
        assertFalse(nav.focus("a"));nav.resetView();assertEquals(first.target,nav.frame.target)
        nav.interior(null);assertEquals(outdoor,nav.frame)
    }
    @Test fun furniturePacketsHaveRealModelsAndBadDisplayInputsAreRejected(){
        val compiler=NativeInteriorCompiler();val bare=compiler.prepare(camera(),buildings,emptyList())
        val furnished=compiler.prepare(camera(),buildings,listOf(NativeInteriorItem("bed",-2.4,0.0,2.6),NativeInteriorItem("bookcase",-3.2,0.0,.4)))
        assertTrue(furnished.source.world!!.packets.sumOf{it.count}>bare.source.world!!.packets.sumOf{it.count})
        assertEquals(bare.pose,furnished.pose)
        assertThrows(IllegalArgumentException::class.java){NativeInteriorItem("x",Double.NaN,0.0,0.0)}
        assertThrows(IllegalStateException::class.java){compiler.prepare(camera(),buildings,listOf(NativeInteriorItem("locked-unknown",0.0,0.0,0.0)))}
    }
    @Test fun everyEarnedFurnishingHasABoundedNativeModel(){
        val ids=listOf("bed","bookcase","plant","workshop-miniature","clock","reading-chair","globe","settlement-miniature","map","cabinet","mug","calendar","record-player","books","floor-lamp","armchair","town-miniature","travel-frame","windmill-miniature","goal-trophy")
        val compiler=NativeInteriorCompiler()
        for(id in ids){val scene=compiler.prepare(camera(),buildings,listOf(NativeInteriorItem(id,0.0,0.0,0.0)))
            assertEquals(id,scene.items.single().id);assertTrue(id,scene.source.world!!.packets.sumOf{it.count} in 200..600)}
    }
}
