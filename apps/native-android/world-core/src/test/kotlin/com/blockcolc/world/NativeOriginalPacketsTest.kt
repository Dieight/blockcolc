package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CancellationException

class NativeOriginalPacketsTest {
    private val state=NativeSurfaceState(SurfaceEffects(listOf(.6f,.8f,0f),listOf(1f,.9f,.8f),listOf(.5f,.6f,.7f),.25f,0f),nightFactor=.7f)
    @Test fun eachCurrentBundledBlueprintPacksAllOriginalRoutesAndKeepsAnIndependentOwner(){
        val catalog=BuiltinBlueprintCatalog.load();val materials=NativeOriginalMaterials();val packets=NativeOriginalPackets(materials);val compiler=OriginalStructureCompiler();var routes=mutableSetOf<OriginalDrawRoute>();var count=0
        for(entry in catalog.entries){val blueprint=BlueprintSnapshot.read(catalog.content(entry.id).json(),entry.category in setOf("daily","holiday","birthday"))
            val recipe=BuildingPreparation.prepare(blueprint,"test:${entry.id}",10000,10000);val b=blueprint.bounds
            val structure=compiler.compile(recipe,BlockPoint(b.minX.toDouble(),b.minY.toDouble(),b.minZ.toDouble()));routes+=structure.batches.map{it.route}
            val source=packets.build("building:test:${entry.id}",structure,NativeStructurePlacement(BlockPoint(5.0,4.0,8.0),.7,Position2(-b.minX.toDouble(),-b.minZ.toDouble())),state)
            if(structure.batches.isEmpty())assertNull(source.world)else {
                val world=source.world!!;assertEquals(structure.batches.sumOf{it.instanceCount},world.packets.sumOf{it.count});assertTrue(source.textures.all{it.pixels().isReadOnly})
                assertTrue(world.packets.all{it.owner==source.owner});assertTrue(source.surfaces.all{it.pending.isEmpty()})
            };count++
        }
        assertEquals(47,count);assertTrue(routes.containsAll(setOf(OriginalDrawRoute.CUBE,OriginalDrawRoute.COMPONENT,OriginalDrawRoute.JOINED_GLASS,OriginalDrawRoute.DETAIL,OriginalDrawRoute.FLOWER)))
    }
    @Test fun distantBlueprintOriginsAreCancelledBeforeFloatTranslationAndFluidsKeepTheirPackedWords(){
        val origin=BlockPoint(1e12,0.0,-1e12);val voxels=listOf(RenderVoxel(origin.x+1,0.0,origin.z+1,"stone",0),RenderVoxel(origin.x+2,0.0,origin.z,"glass",0,"minecraft:water",mapOf("level" to "3")))
        val recipe=BuildingPreparation.staticStructure(voxels,"large-origin");val structure=OriginalStructureCompiler().compile(recipe,origin)
        val pose=NativeStructurePlacement(BlockPoint(11.0,4.0,-8.0),Math.PI/2,Position2(-origin.x,-origin.z));val source=NativeOriginalPackets().build("building:far-source",structure,pose,state)
        val world=source.world!!
        for(packet in world.packets){assertTrue(packet.bounds.min.x in 8f..14f);assertTrue(packet.bounds.max.z in -12f..-6f)
            val rows=world.instanceRows(packet);repeat(packet.count){val x=rows.getFloat(it*96+48);val z=rows.getFloat(it*96+56);assertTrue(x in 10f..14f);assertTrue(z in -12f..-7f)}}
        val fluid=structure.batches.single{it.route==OriginalDrawRoute.FLUID};val water=world.packets.single{source.surfaces[it.material].optics.fluidSurface}
        val rows=world.instanceRows(water);assertEquals(fluid.faceOcclusion().get().toFloat(),rows.getFloat(80),0f);assertEquals(fluid.materialResponse().get().toFloat(),rows.getFloat(84),0f)
        assertFalse(water.castShadow);assertTrue(water.receiveShadow)
    }
    @Test fun materialRolesPreserveAoColorWeatheringEmissionTextureSamplersAndShadowFlags(){
        val voxels=listOf(RenderVoxel(0.0,0.0,0.0,"wood",0,"minecraft:oak_log",emissiveKind="soul",emissiveLevel=10),RenderVoxel(1.0,0.0,0.0,"wood",0,"minecraft:oak_log"),
            RenderVoxel(2.0,0.0,0.0,"glass",0,"minecraft:glass"),RenderVoxel(0.0,1.0,0.0,"accent",0,"minecraft:poppy"))
        val recipe=BuildingPreparation.staticStructure(voxels,"roles");val mesh=OriginalStructureCompiler().compile(recipe);val materials=NativeOriginalMaterials()
        val emitting=mesh.batches.single{it.emission.level>0};val fresh=materials.batch(emitting,0.0,state);val worn=materials.batch(emitting,1.0,state)
        assertEquals(fresh.color.red*.72f,worn.color.red,1e-7f);assertEquals(minOf(1f,fresh.roughness+.1f),worn.roughness,1e-7f);assertEquals(.7f*(10/15f)*1.55f,worn.emissionStrength,1e-7f)
        assertEquals(LinearRgb.fromSrgb(0x65cfe3),worn.emission)
        val glass=materials.batch(mesh.batches.single{it.route==OriginalDrawRoute.JOINED_GLASS},0.0,state);assertEquals(1001,glass.texture!!.wrapS);assertEquals(1f,glass.texture!!.anisotropy,0f)
        val source=NativeOriginalPackets(materials).build("reward:roles",mesh,NativeStructurePlacement(BlockPoint(0.0,0.0,0.0)),state)
        for(packet in source.world!!.packets){val material=JSONObject(source.world.materials[packet.material]);if(material.getBoolean("transparent")||material.getBoolean("vertexColors"))assertFalse(packet.castShadow)
            val rows=source.world.instanceRows(packet);repeat(packet.count){assertEquals(1f,rows.getFloat(it*96+76),0f);assertTrue(rows.getFloat(it*96+64) in .6f..1f)}}
    }
    @Test fun terrainUsesWorldScaleWaterSamplingAndIndependentDepthPolicy(){
        val factory=NativeOriginalMaterials();val island=factory.terrain(TerrainMaterial.WATER,state);val coast=factory.terrain(TerrainMaterial.WATER,state,coast=true)
        assertEquals(1006,island.texture!!.magFilter);assertTrue(island.depthWrite);assertEquals(2,island.depthFunction);assertEquals(.7f,island.opacity,0f)
        assertFalse(coast.depthWrite);assertEquals(3,coast.depthFunction);assertEquals(.58f,coast.opacity,0f)
        assertEquals(2.2f,coast.surface.optics.night.gain,0f)
        val top=factory.terrain(TerrainMaterial.DIRT,state);val side=factory.terrain(TerrainMaterial.DIRT,state,side=true);assertEquals(top.color.red*.65f,side.color.red,0f)
    }
    @Test fun opaqueContactsKeepAoAndRetainNewlyExposedFacesAfterAnOwnerUpdate(){
        val neighbors = listOf(1 to 0, -1 to 0, 0 to 1, 0 to -1)
        val voxels = listOf(RenderVoxel(0.0,0.0,0.0,"stone",0),
            RenderVoxel(0.0,1.0,0.0,"stone",0), RenderVoxel(0.0,-1.0,0.0,"stone",0)) +
            neighbors.map { (x,z) -> RenderVoxel(x.toDouble(),0.0,z.toDouble(),"stone",0) }
        val recipe = BuildingPreparation.staticStructure(voxels,"occluded-center")
        val mesh = OriginalStructureCompiler().compile(recipe)
        val packets = NativeOriginalPackets()
        fun packed(excluded: Set<Int>, compact: Boolean): Map<Triple<Float,Float,Float>,Int> {
            val result = NativePacketBuilder("building:contact").also { builder ->
                packets.append(builder,mesh,NativeStructurePlacement(BlockPoint(0.0,0.0,0.0)),state,
                    skippedMembers=excluded,cubeContacts=voxels.takeIf { compact })
            }.build().world!!
            return buildMap {
                for (packet in result.packets) {
                    val rows = result.instanceRows(packet)
                    repeat(packet.count) { index ->
                        val offset = index*96
                        put(Triple(rows.getFloat(offset+48),rows.getFloat(offset+52),rows.getFloat(offset+56)),
                            rows.getFloat(offset+80).toInt())
                        assertEquals(0f,rows.getFloat(offset+88),0f)
                        assertEquals(0f,rows.getFloat(offset+92),0f)
                    }
                }
            }
        }
        val center = Triple(0f,0f,0f)
        val stock = packed(emptySet(),false)
        val compact = packed(emptySet(),true)
        assertEquals(stock.keys-center,compact.keys)
        compact.forEach { (position,ao) -> assertEquals(stock[position],ao and 4095) }
        val removed = setOf(1)
        val exposed = packed(removed,true)
        assertEquals(packed(removed,false).keys,exposed.keys)
        assertEquals(4,(exposed.getValue(center)-524288) shr 12)
    }
    @Test fun cancelledPackingDoesNotReturnAPartialOwner(){
        val recipe=BuildingPreparation.staticStructure(listOf(RenderVoxel(0.0,0.0,0.0,"stone",0)),"cancellation");val mesh=OriginalStructureCompiler().compile(recipe)
        assertThrows(CancellationException::class.java){NativeOriginalPackets().build("building:cancelled",mesh,NativeStructurePlacement(BlockPoint(0.0,0.0,0.0)),state,cancelled={true})}
    }
    @Test fun packedInstanceTransformsMatchImmutableDoubleProductsAcrossChunksAndSkippedMembers(){
        val prototype=OriginalStructureCompiler().compile(BuildingPreparation.staticStructure(listOf(RenderVoxel(0.0,0.0,0.0,"stone",0)),"transform-reference")).batches.single()
        val count=2051;val matrices=FloatArray(count*16)
        for(i in 0 until count){
            val scale=BlockTransform.fromElements(doubleArrayOf(if(i%2==0)-.75 else 1.25,0.0,0.0,0.0, .125,1.5,0.0,0.0, 0.0,.25,.625,0.0,0.0,0.0,0.0,1.0))
            val transform=BlockTransform.translation(i*.125,-i*.0625,i*.03125)*BlockTransform.rotationY(i*.013)*scale
            repeat(16){matrices[i*16+it]=transform[it].toFloat()}
        }
        val batch=OriginalDrawBatch(prototype.route,prototype.geometry,prototype.material,prototype.emission,IntArray(count){it},IntArray(count){it},matrices,FloatArray(count),IntArray(count))
        val origin=BlockPoint(1e12,0.0,-1e12)
        val structure=OriginalStructure("transform-reference",count,origin,listOf(batch),intArrayOf(),intArrayOf(),intArrayOf())
        for(angle in listOf(0.0,.73,-1.8))for(skip in listOf(emptySet(),(0 until count step 3).toSet())){
            val pose=NativeStructurePlacement(BlockPoint(11.0,4.0,-8.0),angle,Position2(-origin.x,-origin.z))
            val source=NativePacketBuilder("world").also{NativeOriginalPackets().append(it,structure,pose,state,skippedMembers=skip)}.build()
            val world=checkNotNull(source.world);val selected=(0 until count).filter{it !in skip};var at=0
            assertEquals(selected.size,world.packets.sumOf{it.count})
            for(packet in world.packets){val rows=world.section(packet.instances)
                repeat(packet.count){n->val index=selected[at++]
                    val expected=pose.parent(origin)*BlockTransform.fromElements(DoubleArray(16){matrices[index*16+it].toDouble()})
                    repeat(16){axis->assertEquals("instance $index matrix $axis",expected[axis].toFloat().toRawBits(),rows.getFloat(n*80+axis*4).toRawBits())}
                }
            }
            assertEquals(selected.size,at)
        }
    }
}
