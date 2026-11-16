package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.junit.Assert.*
import org.junit.Test
import java.nio.FloatBuffer

class NativeSceneEnvironmentTest {
    private val context=NativeEnvironmentContext("UTC",NativeLightingQuality.HIGH,24.0,110.0,45.0,weather=NativeWeatherOverride(NativeWeatherKind.CLEAR))
    private fun sample(hour:Int)=context.sample(1_792_886_400_000L+hour*3_600_000L)
    private fun structure(voxels:List<RenderVoxel>)=OriginalStructureCompiler().compile(BuildingPreparation.staticStructure(voxels,"environment-test"))
    @Test fun distinctDaytimeZeroEmissionsRetainTheirLevelsForNightWithoutRepacking(){
        val mesh=structure(listOf(RenderVoxel(0.0,0.0,0.0,"wood",0,"minecraft:oak_log",emissiveKind="soul",emissiveLevel=10),
            RenderVoxel(2.0,0.0,0.0,"wood",0,"minecraft:oak_log",emissiveKind="soul",emissiveLevel=15)))
        val source=NativeOriginalPackets().build("building:lights",mesh,NativeStructurePlacement(BlockPoint(0.0,0.0,0.0)),NativeSurfaceState())
        val bound=source.bindings.filterNotNull().filter{it.nightEmissionMaximum!=null}
        assertEquals(2,bound.size)
        assertEquals(2,source.world!!.packets.map{it.material}.distinct().size)
        assertTrue(bound.all{it.emission(NativeSurfaceState(nightFactor=0f),0f)==0f})
        val night=bound.map{it.emission(NativeSurfaceState(nightFactor=1f),0f)}.sorted()
        assertEquals((10/15f)*1.55f,night[0],1e-7f);assertEquals(1.55f,night[1],1e-7f)
    }
    @Test fun runtimeBindingsMatchFreshOriginalMaterialsAcrossNightAndWeatherWithoutChangingTheirBase(){
        val factory=NativeOriginalMaterials()
        val mesh=structure(listOf(RenderVoxel(0.0,0.0,0.0,"wood",0,"minecraft:oak_log",emissiveKind="light",emissiveLevel=12),
            RenderVoxel(2.0,0.0,0.0,"glass",0,"minecraft:glass"),RenderVoxel(4.0,0.0,0.0,"stone",0,"minecraft:water"),
            RenderVoxel(6.0,0.0,0.0,"stone",0,"minecraft:lava"),RenderVoxel(8.0,0.0,0.0,"accent",0,"minecraft:poppy")))
        val states=listOf(sample(0).surface,sample(12).surface,context.copy(weather=NativeWeatherOverride(NativeWeatherKind.RAIN,true)).sample(1_792_886_400_000L).surface)
        for(batch in mesh.batches){val base=factory.batch(batch,0.0,NativeSurfaceState())
            for(state in states){val fresh=factory.batch(batch,0.0,state)
                assertEquals(fresh.surface,base.environment?.surface?.resolve(state)?:base.surface)
                assertEquals(fresh.emissionStrength,base.environment?.emission(state,base.emissionStrength)?:base.emissionStrength,1e-7f)
                assertSame(base.texture,fresh.texture)
            }
        }
        val water=factory.terrain(TerrainMaterial.WATER,NativeSurfaceState())
        val cloudy=NativeSurfaceState(clearSky=0f);val optics=water.environment!!.surface!!.resolve(cloudy).optics
        assertEquals(1f,optics.roughness(water.roughness),0f);assertEquals(0f,optics.metallic(water.metalness),0f)
    }
    @Test fun environmentSnapshotFreezesProducerListsAndRejectsInvalidRuntimeValues(){
        val sample=sample(0);val direction=sample.surface.effects.direction.toMutableList();val tint=sample.lighting.clearColor.toMutableList()
        val frozen=NativeSceneEnvironment(sample.lighting.copy(clearColor=tint),sample.surface.copy(effects=sample.surface.effects.copy(direction=direction)))
        val oldDirection=direction.toList();val oldTint=tint.toList();direction[0]=123f;tint[0]=123f
        assertEquals(oldDirection,frozen.surfaceState!!.effects.direction);assertEquals(oldTint,frozen.lighting.clearColor)
        assertThrows(UnsupportedOperationException::class.java){(frozen.surfaceState!!.effects.direction as MutableList).clear()}
        assertThrows(IllegalArgumentException::class.java){NativeSceneEnvironment(sample.lighting.copy(exposure=Float.NaN),sample.surface)}
        assertThrows(IllegalArgumentException::class.java){NativeSceneEnvironment(sample.lighting,sample.surface.copy(effects=sample.surface.effects.copy(direction=listOf(0f,0f,0f))))}
        assertThrows(IllegalArgumentException::class.java){NativeEnvironmentContext("not-a-zone",NativeLightingQuality.HIGH,24.0,110.0,45.0)}
    }
    @Test fun boundSourcesCannotBeAdmittedWithoutAnExplicitEnvironment(){
        val material=NativeRenderMaterial(environment=NativeMaterialBinding(NativeSurfaceBinding(.025f)))
        val builder=NativePacketBuilder("world");builder.add(CuboidGeometry.create(),material,FloatBuffer.wrap(FloatArray(16){if(it in listOf(0,5,10,15))1f else 0f}))
        val source=builder.build();val sample=sample(0)
        val camera=NativeSceneCamera(BlockPoint(0.0,0.0,0.0),BlockPoint(10.0,10.0,10.0),30.0,40.0,SourceCamera(20.0,listOf(listOf(-20.0,-5.0,-20.0),listOf(20.0,15.0,20.0)),120.0,.82,.91,1.5,120.0))
        assertThrows(IllegalArgumentException::class.java){NativeGeneratedScene(listOf(source),sample.lighting,SourcePost.NONE,camera,0,1)}
        assertNotNull(NativeGeneratedScene(listOf(source),sample.lighting,SourcePost.NONE,camera,0,1,sample.surface).environment.surfaceState)
    }
}
