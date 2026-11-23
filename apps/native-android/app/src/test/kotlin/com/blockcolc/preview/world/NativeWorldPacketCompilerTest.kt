package com.blockcolc.preview.world

import com.blockcolc.domain.*
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.world.*
import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CancellationException
import java.util.Base64

class NativeWorldPacketCompilerTest {
    @Test fun lowTierKeepsTheTerrainCellEdgesAndTheSameWorldLayout(){
        val planner=WorldPlanBuilder()
        val optimized=NativeWorldPacketCompiler()
        val original=NativeWorldPacketCompiler(signRasterizer=null,allocator=null,parallel=false,
            staticWorldCache=null,compactGeometry=false)
        try{
            val document=apply(initial(),"ConfigureWorldEnvironment","environmentStyle" to WorldEnvironment.VALLEY.wireValue)
            val world=planner.terrain(planner.prepare(WorldFacts.from(document)))
            val identity=WorldRequestIdentity("terrain-seams.db",0,1)
            val low=options.copy(quality=NativeLightingQuality.LOW)
            val reference=original.prepare(identity,world,low)
            val active=optimized.prepare(identity,world,low)
            assertEquals(reference.spatialKey,active.spatialKey)
            assertEquals(reference.scene.sources.first{it.owner=="world"}.geometryKeys,
                active.scene.sources.first{it.owner=="world"}.geometryKeys)
        }finally{original.close();optimized.close();planner.clear()}
    }
    @Test fun parallelPreparationRetainsEveryPacketAndTheCurrentOwnerReuse() {
        val builder=WorldPlanBuilder();val sequential=NativeWorldPacketCompiler();val parallel=NativeWorldPacketCompiler(parallel=true)
        fun fingerprint(source:NativePacketSource):String {
            val digest=java.security.MessageDigest.getInstance("SHA-256")
            fun text(value:Any?){digest.update(value.toString().toByteArray(Charsets.UTF_8));digest.update(0)}
            text(source.owner);text(source.layer);text(source.geometryKeys);text(source.surfaces)
            source.textures.forEach{ text(it.samplingIdentity) }
            source.world?.let{world->
                text(world.materials)
                for(g in world.geometries){text(g);digest.update(world.section(g.vertex));digest.update(world.section(g.index))}
                for(packet in world.packets){text(packet);digest.update(world.section(packet.instances));packet.aux?.let{digest.update(world.section(it))}}
            }
            return digest.digest().joinToString(""){"%02x".format(it.toInt() and 255)}
        }
        try {
            val world=builder.terrain(builder.prepare(WorldFacts.from(initial())))
            val identity=WorldRequestIdentity("parallel.db",0,1)
            val expected=sequential.prepare(identity,world,options)
            val actual=parallel.prepare(identity,world,options)
            assertEquals(expected.scene.sources.map(::fingerprint),actual.scene.sources.map(::fingerprint))
            assertEquals(expected.scene.camera.metadata().toString(),actual.scene.camera.metadata().toString())
            assertEquals(expected.scene.camera.aspect,actual.scene.camera.aspect,0.0)
            val again=parallel.prepare(identity,world,options)
            for(i in actual.scene.sources.indices)assertSame(actual.scene.sources[i],again.scene.sources[i])
        }finally{parallel.close();sequential.close();builder.clear()}
    }

    @Test fun equivalentSceneryFromANewCacheGenerationRetainsEveryCollisionOwnerAndBirthState(){
        val builder=WorldPlanBuilder();val animals=WorldAnimalPreparation()
        try{
            val state=apply(initial(),"ConfigureWorldEnvironment","environmentStyle" to WorldEnvironment.COAST.wireValue)
            val world=builder.terrain(builder.prepare(WorldFacts.from(state)))
            val first=checkNotNull(animals.prepare(world){false}).first
            val encoded=checkNotNull(SceneryCodec.encode(world.sceneryKey,world.scenery))
            val scenery=checkNotNull(SceneryCodec.decode(world.sceneryKey,encoded))
            assertNotSame(world.scenery,scenery)
            val rebuilt=WorldTerrainPlan(world.input,world.terrain,world.surfaces,world.rewards,world.reuse,world.cacheKey,
                scenery,"different-exclusion-generation",SceneryReuse.PERSISTENT)
            val next=checkNotNull(animals.prepare(rebuilt){false}).first
            assertTrue(first.prepared.owners.size>5)
            assertSame(first.prepared,next.prepared);assertSame(first.initial,next.initial)
            first.prepared.owners.forEach{(owner,solids)->assertSame(owner,solids,next.prepared.owners.getValue(owner))}
        }finally{animals.clear();builder.clear()}
    }
    @Test fun terrainPackAdoptionRetainsMeshAndRestoresOriginalSurfaceTextures(){
        val rows=JSONObject(javaClass.getResource("/native-resource-terrain-oracle.json")!!.readText()).getJSONArray("cases")
        val row=(0 until rows.length()).map{rows.getJSONObject(it)}.first{it.getString("name")=="terrain-gallery"}
        NativeResourceArchive.from(Base64.getDecoder().decode(row.getString("zip"))).use{archive->
            val assets=NativeResourceWorldAssets.prepare(ResourcePackStack.of(ResourcePackAssets.prepare(archive)))
            val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
            try{for((i,environment)in WorldEnvironment.entries.withIndex()){
                val document=apply(initial(),"ConfigureWorldEnvironment","environmentStyle" to environment.wireValue)
                val world=builder.terrain(builder.prepare(WorldFacts.from(document)))
                fun render(resources:NativeResourceWorldAssets?)=compiler.prepare(WorldRequestIdentity("terrain-pack.db",0,i.toLong()),world,options.copy(resources=resources))
                val original=render(null);val originalRoot=original.scene.sources.first{it.owner=="world"}
                val adopted=render(assets);val root=adopted.scene.sources.first{it.owner=="world"}
                val terrainGroups=TerrainMaterial.entries.count{world.terrain.topIndices(it).hasRemaining()}+
                    listOf(TerrainMaterial.DIRT,TerrainMaterial.STONE).count{world.terrain.sideIndices(it).hasRemaining()}
                for((kind,tile)in assets.terrain.tiles)if(world.terrain.topIndices(kind).hasRemaining()){
                    assertTrue("$environment $kind",root.textures.any{it.samplingIdentity==tile.texture.samplingIdentity})
                }
                assertEquals(originalRoot.geometryKeys.take(terrainGroups),root.geometryKeys.take(terrainGroups))
                assertEquals(original.terrainKey,adopted.terrainKey);assertEquals(original.spatialKey,adopted.spatialKey)
                val reused=render(assets);assertSame(root,reused.scene.sources.first{it.owner=="world"})
                val restored=render(null).scene.sources.first{it.owner=="world"}
                assertEquals(originalRoot.geometryKeys,restored.geometryKeys);assertEquals(originalRoot.textures.map{it.samplingIdentity},restored.textures.map{it.samplingIdentity})
            }}finally{compiler.clear();builder.clear()}
        }
    }
    @Test fun externalModelsAdoptThroughTheNormalWorldAndRemovingThePackRestoresOriginalRoutes(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
        val blueprint=JSONObject().put("schemaVersion",1).put("id","pack-building").put("title","Pack building")
            .put("bounds",JSONObject().put("minX",0).put("maxX",1).put("minY",0).put("maxY",1).put("minZ",0).put("maxZ",0))
            .put("voxels",JSONArray().put(JSONObject().put("x",0).put("y",0).put("z",0).put("materialId","stone").put("sourceBlockId","minecraft:test").put("stage","foundation").put("buildOrder",0))
                .put(JSONObject().put("x",1).put("y",1).put("z",0).put("materialId","wood").put("sourceBlockId","minecraft:missing").put("stage","walls").put("buildOrder",4000)))
        var document=apply(DomainEngine.initial("UTC"),"CreateProject","projectId" to "a","title" to "A","blueprintId" to "pack-building","importedBlueprint" to blueprint,
            "subtasks" to JSONArray().put(JSONObject().put("id","t-a").put("title","Task A")))
        document=apply(document,"StartFocus","sessionId" to "resource-s","subtaskId" to "t-a","plannedDurationMs" to 1000)
        document=apply(document,"CompleteFocus",at=now+1000)
        document=apply(document,"ReportSubtaskProgress","reportId" to "resource-r","subtaskId" to "t-a","focusSessionIds" to JSONArray(listOf("resource-s")),"progressBasisPoints" to 5000,at=now+1000)
        try{
            val world=builder.terrain(builder.prepare(WorldFacts.from(document)));val owner="building:a"
            assertEquals(2,world.input.buildings.single().recipe.intact.size)
            val ref=JSONObject(javaClass.getResource("/native-resource-blocks-oracle.json")!!.readText()).getJSONArray("cases").getJSONObject(0)
            NativeResourceArchive.from(Base64.getDecoder().decode(ref.getString("zip"))).use{archive->
                val resources=NativeResourceWorldAssets.prepare(ResourcePackStack.of(ResourcePackAssets.prepare(archive)))
                fun render(pack:NativeResourceWorldAssets?)=compiler.prepare(WorldRequestIdentity("resource.db",0,1),world,options.copy(resources=pack))
                val original=render(null);assertFalse(original.scene.sources.flatMap{it.surfaces}.any{it.optics.atlas!=null})
                val adopted=render(resources);val building=adopted.scene.sources.first{it.owner==owner}
                assertTrue(building.surfaces.any{it.optics.atlas!=null});assertTrue(building.world!!.geometries.any{it.vertexPreparation=="atlas-static-v1"})
                val reused=render(resources);for(i in adopted.scene.sources.indices)assertSame(adopted.scene.sources[i],reused.scene.sources[i])
                val restored=render(null);assertFalse(restored.scene.sources.flatMap{it.surfaces}.any{it.optics.atlas!=null})
                assertEquals(original.scene.sources.first{it.owner==owner}.geometryKeys,restored.scene.sources.first{it.owner==owner}.geometryKeys)
                assertEquals(original.spatialKey,restored.spatialKey);assertEquals(original.terrainKey,restored.terrainKey)
            }
        }finally{compiler.clear();builder.clear()}
    }
    private val now=DomainTime.millis("2026-10-25T04:00:00.000Z")
    private val options=WorldRenderOptions(now,"UTC",weather=NativeWeatherOverride(NativeWeatherKind.CLEAR))
    private fun apply(s:DomainDocument,type:String,vararg fields:Pair<String,Any?>,at:Long=now):DomainDocument {
        val result=DomainEngine.execute(s,DomainEngine.command(type,*fields),at);check(result.ok){"$type ${result.error}"};return result.state
    }
    private fun initial():DomainDocument {
        var state=DomainEngine.initial("UTC")
        for(id in listOf("a","b"))state=apply(state,"CreateProject","projectId" to id,"title" to id,"blueprintId" to "builtin-small-workshop",
            "subtasks" to JSONArray().put(JSONObject().put("id","t-$id").put("title","Task $id")))
        return state
    }
    @Test fun sharedAtmosphereChangesOnlyEnvironmentPacketsAndRejectsWrongWorldFacts(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
        try{
            val state=initial();val world=builder.terrain(builder.prepare(WorldFacts.from(state)))
            val input=NativeAtmosphereInputs("UTC",world.input.spatial.environment==WorldEnvironment.OCEAN,weather=NativeWeatherOverride(NativeWeatherKind.CLEAR))
            fun render(facts:NativeAtmosphereFacts)=compiler.prepare(WorldRequestIdentity("test.db",0,1),world,
                options.copy(zone=facts.inputs.zone,weather=facts.inputs.weather,coordinates=facts.inputs.coordinates,atmosphere=facts))
            val firstFacts=input.sample(now);val first=render(firstFacts)
            assertSame(firstFacts.weather,first.environment.weather);assertSame(firstFacts.sun,first.environment.sun)
            val stormFacts=input.copy(weather=NativeWeatherOverride(NativeWeatherKind.RAIN,true)).sample(now+60_000)
            val storm=render(stormFacts)
            assertSame(stormFacts.weather,storm.environment.weather)
            for(i in 0..2)assertSame(first.scene.sources[i],storm.scene.sources[i])
            assertNotSame(first.scene.sources[3],storm.scene.sources[3]);assertNotSame(first.scene.sources[4],storm.scene.sources[4])
            assertThrows(IllegalArgumentException::class.java){render(input.copy(ocean=!input.ocean).sample(now))}
            val again=render(stormFacts);for(i in storm.scene.sources.indices)assertSame(storm.scene.sources[i],again.scene.sources[i])
            val debugFacts=NativeWorldDebug(true,NativeDebugWeather.SNOW,0).project(input).sample(now+120_000)
            val debug=render(debugFacts);assertEquals(0,debug.environmentContext.timeMinutes)
            assertEquals(debugFacts.visualTime,debug.environmentContext.atmosphere.visualTime(debugFacts.time))
            for(i in 0..2)assertSame(first.scene.sources[i],debug.scene.sources[i])
            val restoredFacts=NativeWorldDebug().project(input).sample(now+180_000);val restored=render(restoredFacts)
            assertNull(restored.environmentContext.timeMinutes);assertSame(restoredFacts.sun,restored.environment.sun)
            for(i in 0..2)assertSame(first.scene.sources[i],restored.scene.sources[i])
        }finally{compiler.clear();builder.clear()}
    }
    @Test fun fourActualGeneratedEnvironmentsHaveTerrainRoadsSceneryAndIndependentBuildingOwners(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler();val base=initial()
        for((index,environment)in WorldEnvironment.entries.withIndex()){
            val state=apply(base,"ConfigureWorldEnvironment","environmentStyle" to environment.wireValue)
            val world=builder.terrain(builder.prepare(WorldFacts.from(state)));val frame=compiler.prepare(WorldRequestIdentity("test.db",0,index.toLong()),world,options)
            assertEquals(listOf("world","building:a","building:b",PacketOwners.CLOUDS,PacketOwners.PRECIPITATION,PacketOwners.SKY,PacketOwners.LIGHTNING,PacketOwners.ANIMALS,PacketOwners.INTERIOR),frame.scene.sources.map{it.owner});assertTrue(frame.scene.sources.first().world!!.packets.size>10)
            assertNull("Outdoor scene reserves no study geometry",frame.scene.sources.single{it.owner==PacketOwners.INTERIOR}.world)
            val animals=checkNotNull(frame.scene.animals);assertTrue(animals.initial.agents.isNotEmpty())
            assertEquals(world.scenery.objects.count{it.role!=SceneryRole.PATH&&it.role!=SceneryRole.GARDEN}+2,animals.prepared.owners.size)
            assertTrue(animals.initial.agents.all{it.walker==null&&it.route==null});assertEquals(environment==WorldEnvironment.VALLEY||environment==WorldEnvironment.COAST,animals.initial.agents.any{it.kind=="land"})
            assertTrue(frame.scene.sources.first().world!!.geometries.sumOf{it.vertexCount}>1000);assertEquals(world.sceneryKey,frame.sceneryKey)
            assertEquals("native-generated",frame.scene.camera.metadata().getString("sourceKind"));assertTrue(frame.scene.footprint.instanceBytes>0)
            assertTrue(frame.scene.sources.flatMap{it.surfaces}.all{it.pending.isEmpty()})
            assertEquals(environment==WorldEnvironment.FLOATING,frame.scene.environment.sky!!.floating)
            assertEquals(frame.environment.sky!!.night,frame.environment.surface.night)
        }
        builder.clear();compiler.clear()
    }
    @Test fun onlyProgressedOwnerChangesAndMetadataOnlyChangesRetainTheExactGpuInputIdentities(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler();var state=initial();var revision=0L
        fun render():NativeWorldFrame {val plan=builder.terrain(builder.prepare(WorldFacts.from(state)));return compiler.prepare(WorldRequestIdentity("test.db",0,revision++),plan,options)}
        val first=render();state=apply(state,"AddQuickNote","noteId" to "n","text" to "A note");state=apply(state,"RenameProject","title" to "Different title")
        val notes=render();for(i in first.scene.sources.indices)assertSame(first.scene.sources[i],notes.scene.sources[i])
        assertSame(first.scene.animals,notes.scene.animals)
        state=apply(state,"SwitchActiveProject","projectId" to "a");val selected=render()
        assertSame(first.scene.sources.first(),selected.scene.sources.first())
        // The current-outline policy follows the actual active building.
        assertNotSame(notes.scene.sources[1],selected.scene.sources[1]);assertNotSame(notes.scene.sources[2],selected.scene.sources[2])
        state=apply(state,"StartFocus","sessionId" to "s","subtaskId" to "t-a","plannedDurationMs" to 1000)
        state=apply(state,"CompleteFocus",at=now+1000);state=apply(state,"ReportSubtaskProgress","reportId" to "r","subtaskId" to "t-a","focusSessionIds" to JSONArray(listOf("s")),"progressBasisPoints" to 5000,at=now+1000)
        val progressed=render();assertSame(selected.scene.sources.first(),progressed.scene.sources.first());assertSame(selected.scene.sources[2],progressed.scene.sources[2]);assertNotSame(selected.scene.sources[1],progressed.scene.sources[1])
        assertSame(selected.scene.sources.last(),progressed.scene.sources.last())
        val beforeAnimals=selected.scene.animals!!.prepared;val afterAnimals=progressed.scene.animals!!.prepared
        assertSame(beforeAnimals.habitat.surfaces,afterAnimals.habitat.surfaces);assertSame(beforeAnimals.owners["building:b"],afterAnimals.owners["building:b"])
        assertNotSame(beforeAnimals.owners["building:a"],afterAnimals.owners["building:a"])
        assertNotEquals(notes.scene.presentationIdentity,progressed.scene.presentationIdentity)
        builder.clear();compiler.clear()
    }
    @Test fun outlineSettingsReuseEveryOwnerWhoseVisibilityDoesNotChange(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
        try{
            val world=builder.terrain(builder.prepare(WorldFacts.from(initial())));val identity=WorldRequestIdentity("test.db",0,1)
            fun render(value:NativeOutlineVisibility)=compiler.prepare(identity,world,options.copy(outlines=value))
            fun count(frame:NativeWorldFrame,owner:String)=frame.scene.sources.first{it.owner==owner}.world?.packets?.sumOf{it.count}?:0
            val current=render(NativeOutlineVisibility.CURRENT);val all=render(NativeOutlineVisibility.ALL)
            assertTrue(count(all,"building:a")>count(current,"building:a"));assertSame(current.scene.sources[2],all.scene.sources[2])
            assertSame(current.scene.sources.first(),all.scene.sources.first())
            val off=render(NativeOutlineVisibility.OFF)
            assertTrue(count(all,"building:b")>count(off,"building:b"));assertTrue(count(all,"building:a")>count(off,"building:a"))
            assertSame(current.scene.sources.first(),off.scene.sources.first())
            val restored=render(NativeOutlineVisibility.CURRENT)
            assertSame(off.scene.sources[1],restored.scene.sources[1]);assertEquals(count(current,"building:b"),count(restored,"building:b"))
            assertEquals(current.scene.camera.metadata().toString(),restored.scene.camera.metadata().toString())
        }finally{builder.clear();compiler.clear()}
    }
    @Test fun failedOrCancelledWorldPreparationCannotReplaceTheLastSuccessfulInputs(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler();val world=builder.terrain(builder.prepare(WorldFacts.from(initial())))
        val first=compiler.prepare(WorldRequestIdentity("test.db",0,1),world,options)
        assertThrows(CancellationException::class.java){compiler.prepare(WorldRequestIdentity("test.db",0,2),world,options,cancelled={true})}
        val next=compiler.prepare(WorldRequestIdentity("test.db",0,3),world,options);for(i in first.scene.sources.indices)assertSame(first.scene.sources[i],next.scene.sources[i])
        builder.clear();compiler.clear()
    }
    @Test fun aspectDependentCameraAndFogKeepEveryGeometryAndMaterialInput(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
        try{
            val world=builder.terrain(builder.prepare(WorldFacts.from(initial())))
            val first=compiler.prepare(WorldRequestIdentity("test.db",0,1),world,options.copy(aspect=.75))
            val next=compiler.prepare(WorldRequestIdentity("test.db",0,1),world,options.copy(aspect=1.45))
            assertNotEquals(first.scene.camera.fittedDistance,next.scene.camera.fittedDistance)
            assertNotEquals(first.scene.lighting.fog,next.scene.lighting.fog)
            assertEquals(first.scene.lighting,next.scene.lighting.copy(fog=first.scene.lighting.fog))
            for(i in first.scene.sources.indices)assertSame(first.scene.sources[i],next.scene.sources[i])
        }finally{builder.clear();compiler.clear()}
    }
    @Test fun dayNightAndStormChangeUniformsWithoutChangingAnyWorldPacketIdentity(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
        try{
            val world=builder.terrain(builder.prepare(WorldFacts.from(initial())))
            val noon=options.copy(time=DomainTime.millis("2026-10-25T12:00:00.000Z"))
            val first=compiler.prepare(WorldRequestIdentity("test.db",0,1),world,noon)
            val midnight=noon.copy(time=DomainTime.millis("2026-10-26T00:00:00.000Z"))
            val night=compiler.prepare(WorldRequestIdentity("test.db",0,1),world,midnight)
            val storm=compiler.prepare(WorldRequestIdentity("test.db",0,1),world,noon.copy(weather=NativeWeatherOverride(NativeWeatherKind.RAIN,true)))
            assertNotEquals(first.scene.lighting,night.scene.lighting);assertNotEquals(first.scene.lighting,storm.scene.lighting)
            assertNotEquals(first.scene.environment.surfaceState,night.scene.environment.surfaceState)
            assertTrue(first.scene.sources.flatMap{it.bindings}.any{it!=null})
            for(next in listOf(night,storm))for(i in first.scene.sources.indices)if(first.scene.sources[i].layer==NativePacketLayer.STATIC)assertSame(first.scene.sources[i],next.scene.sources[i])
            assertNotEquals(first.clouds.key,storm.clouds.key)
            assertNotEquals(first.precipitation.key,storm.precipitation.key);assertEquals(32768,storm.precipitation.capacity)
            assertSame(first.precipitationContext.ground,storm.precipitationContext.ground)
            val low=compiler.prepare(WorldRequestIdentity("test.db",0,1),world,noon.copy(quality=NativeLightingQuality.LOW))
            assertNotSame(first.scene.sources.first(),low.scene.sources.first())
        }finally{builder.clear();compiler.clear()}
    }
    @Test fun debugConditionUsesNormalFactsAndRetainsTerrainSceneryAndRestoredPacketIdentity(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
        try{
            var state=initial();state=apply(state,"SwitchActiveProject","projectId" to "a")
            state=apply(state,"StartFocus","sessionId" to "s","subtaskId" to "t-a","plannedDurationMs" to 1000)
            state=apply(state,"CompleteFocus",at=now+1000)
            state=apply(state,"ReportSubtaskProgress","reportId" to "r","subtaskId" to "t-a","focusSessionIds" to JSONArray(listOf("s")),"progressBasisPoints" to 8000,at=now+1000)
            val sourceHash=state.sha256;val facts=WorldFacts.from(state);val identity=WorldRequestIdentity("test.db",0,1)
            fun plan(condition:Int?)=builder.terrain(builder.prepare(facts,buildingCondition=condition))
            val normal=plan(null);val first=compiler.prepare(identity,normal,options)
            val damaged=plan(0);val next=compiler.prepare(identity,damaged,options)
            assertSame(facts,damaged.input.facts);assertEquals(sourceHash,state.sha256)
            assertSame(normal.input.spatial,damaged.input.spatial);assertSame(normal.terrain,damaged.terrain);assertSame(normal.scenery,damaged.scenery)
            assertEquals(normal.input.buildings.map{it.fact.condition},damaged.input.buildings.map{it.fact.condition})
            assertTrue(damaged.input.buildings.all{it.recipe.weathering==1.0})
            assertTrue(damaged.input.buildings.first().recipe.missing.isNotEmpty())
            val vines=damaged.input.buildings.first().recipe.vines;assertTrue(vines.isNotEmpty())
            val packetInput=checkNotNull(next.scene.sources[1].world);val expectedVineColor=LinearRgb.fromSrgb(0x3f7044)
            val vineCount=packetInput.packets.filter{packet->val color=JSONObject(packetInput.materials[packet.material]).getJSONArray("color")
                (0..2).all{color.getDouble(it).toFloat()==expectedVineColor[it]}}.sumOf{it.count}
            assertEquals(vines.size,vineCount)
            assertSame(first.scene.sources.first(),next.scene.sources.first())
            assertNotEquals(first.scene.sources[1].ownerIdentity,next.scene.sources[1].ownerIdentity)
            assertEquals(first.scene.camera.metadata().toString(),next.scene.camera.metadata().toString())
            val restored=plan(null);val final=compiler.prepare(identity,restored,options)
            assertSame(normal.terrain,restored.terrain);assertSame(normal.scenery,restored.scenery)
            // Upload identities are lifetime tokens, not content hashes. An
            // evicted building can be rebuilt with identical contents and a
            // fresh token; compare its complete immutable packet input.
            for((before,after)in first.scene.sources.zip(final.scene.sources)){
                assertEquals(before.owner,after.owner);assertEquals(before.textures.map{it.identity},after.textures.map{it.identity})
                assertEquals("${before.owner}: empty-owner parity",before.world==null,after.world==null)
                val a=before.world?:continue;val b=checkNotNull(after.world)
                assertEquals(a.materials,b.materials);assertEquals(a.geometries,b.geometries);assertEquals(a.packets,b.packets)
                assertEquals(a.section(BufferRange(0,a.byteSize)),b.section(BufferRange(0,b.byteSize)))
            }
            assertEquals(normal.input.buildings.map{it.recipe.weathering},restored.input.buildings.map{it.recipe.weathering})
            assertThrows(IllegalArgumentException::class.java){WorldTerrainOptions(buildingCondition=10001)}
            assertThrows(IllegalArgumentException::class.java){builder.prepare(facts,buildingCondition=-1)}
        }finally{builder.clear();compiler.clear()}
    }
}
