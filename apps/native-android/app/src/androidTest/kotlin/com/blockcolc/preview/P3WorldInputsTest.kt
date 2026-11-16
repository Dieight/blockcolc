package com.blockcolc.preview

import com.blockcolc.world.generation.*
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.preview.world.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

/** Reads the actual APK's Java resources, not a JVM filesystem or a copied
 * diagnostic world. Does not open any user/preview database or Activity. */
class P3WorldInputsTest {
    @Test fun bundledBlueprintsAreAvailableAndVerifiedOnAndroid(){
        val catalog=BuiltinBlueprintCatalog.load()
        assertEquals(3,catalog.entries.count{it.category=="native"})
        assertTrue(catalog.entries.count{it.category=="supplemental"}>=16)
        assertTrue(catalog.entries.count{it.category=="daily"}>=6)
        assertEquals(20,catalog.entries.count{it.category=="holiday"})
        assertEquals(1,catalog.entries.count{it.category=="birthday"})
        for(entry in catalog.entries){
            val raw=catalog.content(entry.id).json()
            assertEquals(entry.id,raw.getString("id"));assertEquals(entry.voxelCount,raw.getJSONArray("voxels").length())
            val source=BlueprintSnapshot.read(raw,entry.category in setOf("daily","holiday","birthday"))
            val recipe=BuildingPreparation.prepare(source,"android:${entry.id}",5371,6543)
            assertEquals(BuildingPreparation.key(source,"android:${entry.id}",5371,6543),recipe.key)
            assertTrue(recipe.intact.all{it.buildOrder<=5371})
        }
        val buildings=catalog.entries.filter{it.category=="native"||it.category=="supplemental"}
        val placements=VillageLayout.generate(buildings.mapIndexed{index,entry->VillageInput(index.toLong(),entry.bounds.footprint)})
        assertEquals(buildings.size,placements.size)
        val roads=VillageLayout.roads(placements)
        assertTrue(roads.isNotEmpty())
        val reward=catalog.entries.first{it.category=="daily"}
        val decorations=VillageLayout.decorations(listOf(DecorationInput("reward","${reward.id}","2026-10-25","p0",reward.bounds.footprint,Position2(0.0,0.0),0)),
            placements.mapIndexed{i,p->DecorationHost("p$i",p)},roads)
        assertEquals(1,decorations.size);assertEquals("reward",decorations.single().input.rewardId)
        assertEquals("builtin-unknown-placeholder",catalog.resolve("unknown-import-identity").entry.id)
    }

    @Test fun businessFactsReachTheCpuPlannerAndStaleAndroidDeliveriesCannotAdoptThem(){
        val catalog=BuiltinBlueprintCatalog.load();val native=catalog.entries.filter{it.category=="native"}
        val now=DomainTime.millis("2026-10-25T08:00:00.000Z")
        var state=DomainEngine.initial("UTC")
        fun command(type:String,vararg fields:Pair<String,Any?>,at:Long=now){
            val result=DomainEngine.execute(state,DomainEngine.command(type,*fields),at)
            assertTrue("$type: ${result.error}",result.ok);state=result.state
        }
        for(index in 0 until 25)command("CreateProject","projectId" to "p$index","title" to "P$index","blueprintId" to native[index%native.size].id,
            "subtasks" to JSONArray().put(JSONObject().put("id","t$index").put("title","T$index")))
        fun source(material:String)=JSONObject().put("schemaVersion",1).put("id","saved-probe").put("title","Saved source")
            .put("bounds",JSONObject().put("minX",0).put("maxX",1).put("minY",0).put("maxY",1).put("minZ",0).put("maxZ",0))
            .put("voxels",JSONArray().put(JSONObject().put("x",0).put("y",0).put("z",0).put("materialId","stone").put("stage","foundation").put("buildOrder",0))
                .put(JSONObject().put("x",1).put("y",1).put("z",0).put("materialId",material).put("stage","walls").put("buildOrder",4000)))
        for((id,material)in listOf("a" to "wood","b" to "glass"))command("CreateProject","projectId" to id,"title" to id,"blueprintId" to "saved-probe",
            "importedBlueprint" to source(material),"subtasks" to JSONArray().put(JSONObject().put("id","t-$id").put("title",id)))
        command("ConfigureBirthday","enabled" to true,"month" to 10,"day" to 25);command("ObserveBirthday")
        command("ImportDecorationBlueprint","blueprint" to source("wood").put("id","probe-reward"))
        command("SetDailyGoal","date" to "2026-10-25","targetPomodoros" to 1)
        command("StartFocus","sessionId" to "s","subtaskId" to "t-b","plannedDurationMs" to 1000)
        command("CompleteFocus",at=now+1000)
        val original=state.canonical
        val plan=WorldPlanBuilder().prepare(WorldFacts.from(state))
        assertEquals(27,plan.buildings.size);assertEquals(27,plan.spatial.village.pads.size)
        assertEquals(2,plan.rewards.size)
        assertTrue(plan.spatial.village.placements.all{it.worldPosition.y>=4})
        assertNotEquals(plan.buildings.first{it.fact.id=="a"}.blueprint.geometrySha,plan.buildings.first{it.fact.id=="b"}.blueprint.geometrySha)
        val queue=LinkedBlockingQueue<Runnable>();val results=ArrayList<PreparedWorldRequest>()
        val worker=WorldGenerationWorker({queue.add(it)})
        try{
            val old=WorldRequestIdentity("in-memory-only",0,1);val current=old.copy(revision=2)
            worker.request(old,state,results::add){throw AssertionError(it)}
            val stale=queue.poll(20,TimeUnit.SECONDS)?:throw AssertionError("First CPU result is missing")
            worker.request(current,state,results::add){throw AssertionError(it)}
            val latest=queue.poll(20,TimeUnit.SECONDS)?:throw AssertionError("Latest CPU result is missing")
            stale.run();assertTrue(results.isEmpty())
            latest.run();assertEquals(listOf(current),results.map{it.identity})
            assertEquals(27,results.single().plan.buildings.size)
            val world=results.single().terrainWorld
            assertTrue(world.terrain.cellCount>1000);assertEquals(2,world.rewards.size)
            assertEquals(world.terrain.cellCount,world.surfaces.length)
            for(reward in world.rewards){assertTrue(reward.support.placement.worldPosition.y.isFinite());assertEquals(reward.source.fact.rewardId,reward.support.placement.input.rewardId)}
        }finally{worker.close();assertTrue(worker.awaitTermination(20,TimeUnit.SECONDS))}
        assertEquals(original,state.canonical)
    }

    @Test fun fourLiveTerrainGeneratorsMatchFormalUploadBuffersOnAndroid(){
        val fixture=JSONObject(javaClass.getResource("/terrain-device-oracle.json")!!.readText())
        assertEquals(1,fixture.getInt("schema"));assertTrue(fixture.getString("producerSha").matches(Regex("[a-f0-9]{64}")))
        val cases=fixture.getJSONArray("cases");assertEquals(4,cases.length())
        fun rows(a:JSONArray)=List(a.length()){a.getJSONObject(it)}
        fun hash(count:Int,value:(Int)->Int):String{
            val digest=MessageDigest.getInstance("SHA-256");val buffer=ByteBuffer.allocate(8192).order(ByteOrder.LITTLE_ENDIAN)
            for(i in 0 until count){if(buffer.remaining()<4){digest.update(buffer.array(),0,buffer.position());buffer.clear()};buffer.putInt(value(i))}
            digest.update(buffer.array(),0,buffer.position())
            return digest.digest().joinToString(""){"%02x".format(it.toInt() and 255)}
        }
        for(index in 0 until cases.length()){
            val c=cases.getJSONObject(index);val environment=WorldEnvironment.fromWire(c.getString("environment"))
            val placements=rows(c.getJSONArray("placements")).map{value->
                val p=value.getJSONObject("worldPosition");val f=value.getJSONObject("footprint");val o=value.getJSONObject("blueprintOffset");val e=value.getJSONObject("entrance")
                VillagePlacement(value.getLong("settlementIndex"),Position3(p.getDouble("x"),p.getDouble("y"),p.getDouble("z")),value.getDouble("rotationY"),
                    Footprint(f.getDouble("width"),f.getDouble("depth")),Position2(o.getDouble("x"),o.getDouble("z")),RoadCell(e.getInt("x"),e.getInt("z")))
            }
            val roads=rows(c.getJSONArray("roads")).map{RoadCell(it.getInt("x"),it.getInt("z"))}
            val pads=rows(c.getJSONArray("pads")).map{TerrainPad(it.getDouble("x"),it.getDouble("z"),it.getDouble("width"),it.getDouble("depth"),it.getDouble("groundLevel"))}
            val terrain=SteppedTerrain.generate(placements,roads,pads,options=TerrainOptions(environment,c.getString("seed")))
            val geometry=c.getJSONObject("geometry");val coordinates=terrain.positions()
            assertEquals(environment.wireValue,geometry.getInt("vertexCount"),terrain.vertexCount)
            assertEquals(environment.wireValue,geometry.getString("positions"),hash(coordinates.limit()){java.lang.Float.floatToRawIntBits(coordinates[it].toFloat())})
            for(material in TerrainMaterial.entries){
                val truth=geometry.getJSONObject("tops").getJSONObject(material.wireValue);val indices=terrain.topIndices(material)
                assertEquals(truth.getInt("length"),indices.limit());assertEquals(truth.getString("sha"),hash(indices.limit()){indices[it]})
            }
            for(material in listOf(TerrainMaterial.DIRT,TerrainMaterial.STONE)){
                val truth=geometry.getJSONObject("sides").getJSONObject(material.wireValue);val indices=terrain.sideIndices(material)
                assertEquals(truth.getInt("length"),indices.limit());assertEquals(truth.getString("sha"),hash(indices.limit()){indices[it]})
            }
            val metadata=c.getJSONObject("metadata");assertEquals(metadata.getInt("cellCount"),terrain.cellCount);assertEquals(metadata.getInt("triangleCount"),terrain.triangleCount)
            assertEquals(metadata.getJSONArray("naturalTrees").length(),terrain.naturalTrees.size)
            val table=TerrainSurfaceTable.from(terrain);assertEquals(c.getJSONObject("surface").getInt("length"),table.length)
            for(probe in rows(c.getJSONObject("surface").getJSONArray("points"))){
                val actual=table.sample(probe.getDouble("x"),probe.getDouble("z"))
                if(probe.isNull("surface"))assertNull(actual)else{
                    val expected=probe.getJSONObject("surface");assertNotNull(actual);assertEquals(expected.getDouble("supportY"),actual!!.supportY,0.0)
                    assertEquals(expected.getString("material"),actual.material.wireValue)
                }
            }
        }
    }
}
