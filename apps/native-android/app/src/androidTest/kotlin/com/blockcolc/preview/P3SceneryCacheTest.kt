package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.rules.ActivityScenarioRule
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.preview.world.*
import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.Rule
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Only unique cache roots and in-memory commands; never opens the saved
 * business DB, changes permissions or launches the formal app. */
class P3SceneryCacheTest {
    @get:Rule val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun directory()=File(context.cacheDir,"p3-scenery-cache-${UUID.randomUUID()}").also{check(it.mkdirs())}
    private fun cleanup(root:File) {
        removeBlueprintRenderTestFiles(root)
        require(root.canonicalFile.parentFile==context.cacheDir.canonicalFile&&root.name.startsWith("p3-scenery-cache-"))
        for(file in root.listFiles().orEmpty()){
            require(file.isFile&&file.name in setOf("terrain-v1.bin","terrain-v1.bin.new","terrain-v1.bin.bak","scenery-v1.bin","scenery-v1.bin.new","scenery-v1.bin.bak","blocked"));check(file.delete())
        };check(root.delete())
    }
    private fun rows(a:JSONArray)=List(a.length()){a.getJSONObject(it)}
    private fun placement(value:JSONObject):VillagePlacement {
        val p=value.getJSONObject("worldPosition");val f=value.getJSONObject("footprint");val o=value.getJSONObject("blueprintOffset");val e=value.getJSONObject("entrance")
        return VillagePlacement(value.getLong("settlementIndex"),Position3(p.getDouble("x"),p.getDouble("y"),p.getDouble("z")),value.getDouble("rotationY"),
            Footprint(f.getDouble("width"),f.getDouble("depth")),Position2(o.getDouble("x"),o.getDouble("z")),RoadCell(e.getInt("x"),e.getInt("z")))
    }
    @Test fun fourActualAndroidEnvironmentsKeepAllSourceSceneryVoxelsAndDistantSubsetIdentity() {
        val fixture=JSONObject(javaClass.getResource("/scenery-device-oracle.json")!!.readText());assertTrue(fixture.getString("producerSha").matches(Regex("[a-f0-9]{64}")))
        val cases=rows(fixture.getJSONArray("cases"));assertEquals(4,cases.size)
        for(c in cases) {
            val environment=WorldEnvironment.fromWire(c.getString("environment"));val roads=rows(c.getJSONArray("roads")).map{RoadCell(it.getInt("x"),it.getInt("z"))}
            val placements=rows(c.getJSONArray("placements")).map(::placement)
            val pads=rows(c.getJSONArray("pads")).map{TerrainPad(it.getDouble("x"),it.getDouble("z"),it.getDouble("width"),it.getDouble("depth"),it.getDouble("groundLevel"))}
            val terrain=SteppedTerrain.generate(placements,roads,pads,options=TerrainOptions(environment,c.getString("seed")))
            val protected=rows(c.getJSONArray("protectedRects")).map{SceneryRect(it.getDouble("x"),it.getDouble("z"),it.getDouble("width"),it.getDouble("depth"))}
            val input=WorldSceneryInput(environment,c.getString("seed"),TerrainSurfaceTable.from(terrain),protected,roads,terrain.naturalTrees,terrain.nearDetailBounds,
                maxOf(kotlin.math.abs(terrain.framingBounds.minX),kotlin.math.abs(terrain.framingBounds.maxX)))
            val scene=WorldSceneryPlanner.plan(input);SceneryTestChecks.source(c,scene)
            val key=SceneryInputKey.key("12".repeat(32),input)
            SceneryTestChecks.source(c,SceneryCodec.decode(key,SceneryCodec.encode(key,scene)!!)!!)
        }
    }
    @Test fun realCoastFileRestoresIntoANewHostAndOnlyCorruptSceneryRegenerates() {
        val root=directory();val terrainPorts=ArrayList<AndroidTerrainCache>();val sceneryPorts=ArrayList<AndroidSceneryCache>();var session:NativeWorldSession?=null
        try {
            val now=DomainTime.millis("2026-10-25T08:00:00.000Z");var state=DomainEngine.initial("UTC")
            val blueprints=BuiltinBlueprintCatalog.load().entries.filter{it.category=="native"}
            for(index in 0 until 25) {
                val created=DomainEngine.execute(state,DomainEngine.command("CreateProject","projectId" to "scenery-$index","title" to "Scenery $index","blueprintId" to blueprints[index%blueprints.size].id,
                    "subtasks" to JSONArray().put(JSONObject().put("id","t-$index").put("title","T"))),now)
                assertTrue(created.ok);state=created.state
            }
            val configured=DomainEngine.execute(state,DomainEngine.command("ConfigureWorldEnvironment","environmentStyle" to "mosaic-coast"),now);assertTrue(configured.ok);state=configured.state
            val before=state.canonical
            fun terrain()=AndroidTerrainCache(context,root).also{terrainPorts+=it}
            fun scenery()=AndroidSceneryCache(context,root).also{sceneryPorts+=it}
            val terrainFile=terrain();val sceneryFile=scenery();val builder=WorldPlanBuilder(terrainCache=terrainFile,sceneryCache=sceneryFile)
            val first=builder.terrain(builder.prepare(WorldFacts.from(state)))
            assertEquals(SceneryReuse.GENERATED,first.sceneryReuse);assertTrue(first.scenery.objects.any{":reef:" in it.id})
            assertTrue(terrainFile.awaitWritesForTest(30,TimeUnit.SECONDS));assertTrue(sceneryFile.awaitWritesForTest(30,TimeUnit.SECONDS));assertEquals(1L,sceneryFile.stats.commits)
            terrainFile.close();sceneryFile.close();assertTrue(terrainFile.awaitTermination(20,TimeUnit.SECONDS));assertTrue(sceneryFile.awaitTermination(20,TimeUnit.SECONDS));builder.clear()
            val deliveries=LinkedBlockingQueue<Runnable>();val received=ArrayList<PreparedWorldRequest>()
            session=NativeWorldSession(context,{deliveries.add(it)},root)
            session.request(WorldRequestIdentity("scenery-file-test",0,1),state,onReady=received::add,onFailure={throw AssertionError(it)})
            NativeWorldTestAwait.delivery(deliveries,"New scenery world owner").run()
            val next=received.single().terrainWorld
            assertEquals(TerrainReuse.PERSISTENT,next.reuse);assertEquals(SceneryReuse.PERSISTENT,next.sceneryReuse);assertEquals(first.sceneryKey,next.sceneryKey)
            assertEquals(first.scenery.objects.size,next.scenery.objects.size)
            for((i,o)in first.scenery.objects.withIndex()){
                val n=next.scenery.objects[i];assertEquals(o.id,n.id);assertEquals(o.rect,n.rect)
                assertEquals(SceneryTestChecks.voxels(o.blocks.voxels),SceneryTestChecks.voxels(n.blocks.voxels));assertEquals(SceneryTestChecks.distant(o.blocks),SceneryTestChecks.distant(n.blocks))
            }
            session.close();assertTrue(session.awaitTermination(30,TimeUnit.SECONDS));session=null
            RandomAccessFile(File(root,"scenery-v1.bin"),"rw").use{f->val last=f.length()-1;f.seek(last);val n=f.read();f.seek(last);f.write(n xor 1)}
            val recovery=WorldPlanBuilder(terrainCache=terrain(),sceneryCache=scenery());val rebuilt=recovery.terrain(recovery.prepare(WorldFacts.from(state)))
            assertEquals(TerrainReuse.PERSISTENT,rebuilt.reuse);assertEquals(SceneryReuse.GENERATED,rebuilt.sceneryReuse);assertEquals(first.sceneryKey,rebuilt.sceneryKey)
            assertEquals(before,state.canonical);assertTrue(sceneryPorts.last().awaitWritesForTest(30,TimeUnit.SECONDS))
        }finally {
            session?.close();session?.let{assertTrue(it.awaitTermination(30,TimeUnit.SECONDS))}
            for(port in terrainPorts){port.close();assertTrue(port.awaitTermination(20,TimeUnit.SECONDS))}
            for(port in sceneryPorts){port.close();assertTrue(port.awaitTermination(20,TimeUnit.SECONDS))};cleanup(root)
        }
    }
    @Test fun cacheFailureOversizeCancellationAndClosureDoNotBreakALiveWorld() {
        val root=directory();val ports=ArrayList<AndroidSceneryCache>()
        try {
            val blocked=File(root,"blocked").also{it.writeBytes(byteArrayOf(1))}
            val broken=AndroidSceneryCache(context,blocked).also{ports+=it};val builder=WorldPlanBuilder(sceneryCache=broken)
            val facts=WorldFacts.from(DomainEngine.initial("UTC"));val world=builder.terrain(builder.prepare(facts))
            assertEquals(SceneryReuse.GENERATED,world.sceneryReuse);assertTrue(world.scenery.objects.isNotEmpty())
            assertTrue(broken.awaitWritesForTest(20,TimeUnit.SECONDS));assertEquals(1L,broken.stats.failures)
            assertThrows(IllegalArgumentException::class.java){AndroidSceneryCache(context,context.cacheDir.parentFile!!)}
            assertThrows(java.util.concurrent.CancellationException::class.java){broken.readScenery(world.sceneryKey){true}}
            val small=AndroidSceneryCache(context,root,4096).also{ports+=it}
            RandomAccessFile(File(root,"scenery-v1.bin"),"rw").use{it.setLength(SceneryCodec.MAX_BYTES+1L)}
            assertNull(small.readScenery(world.sceneryKey){false})
            small.writeScenery(world.sceneryKey,world.scenery);assertTrue(small.awaitWritesForTest(20,TimeUnit.SECONDS));assertEquals(1L,small.stats.oversized)
            small.close();assertTrue(small.awaitTermination(20,TimeUnit.SECONDS))
            val queued=small.stats.queuedWrites;small.writeScenery(world.sceneryKey,world.scenery);assertEquals(queued,small.stats.queuedWrites)
        }finally{for(port in ports){port.close();assertTrue(port.awaitTermination(20,TimeUnit.SECONDS))};cleanup(root)}
    }
}
