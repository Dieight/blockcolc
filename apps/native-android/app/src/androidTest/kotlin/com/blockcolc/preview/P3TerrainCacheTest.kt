package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.rules.ActivityScenarioRule
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.preview.world.*
import com.blockcolc.world.generation.TerrainInputKey
import com.blockcolc.world.generation.TerrainMeshCodec
import com.blockcolc.world.generation.BuiltinBlueprintCatalog
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

/** All roots are unique temporary cache subdirectories. No Activity, business
 * database, application setting, source asset or user backup is opened. */
class P3TerrainCacheTest {
    @get:Rule val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun directory()=File(context.cacheDir,"p3-terrain-cache-${UUID.randomUUID()}").also{check(it.mkdirs())}
    private fun cleanup(root:File) {
        require(root.canonicalFile.parentFile==context.cacheDir.canonicalFile&&root.name.startsWith("p3-terrain-cache-"))
        removeBlueprintRenderTestFiles(root)
        for(file in root.listFiles().orEmpty()){
            require(file.isFile&&file.name in setOf("terrain-v1.bin","terrain-v1.bin.new","terrain-v1.bin.bak","scenery-v1.bin","scenery-v1.bin.new","scenery-v1.bin.bak","blocked"))
            check(file.delete())
        }
        check(root.delete())
    }
    @Test fun queuedFilesSurviveNewWorldOwnersAndCorruptionOnlyRegeneratesDerivedTerrain() {
        val root=directory();val ports=ArrayList<AndroidTerrainCache>();var session:NativeWorldSession?=null
        try {
            assertTrue(TerrainInputKey.generatorIdentity.matches(Regex("[a-f0-9]{64}")))
            val now=DomainTime.millis("2026-10-25T08:00:00.000Z");var state=DomainEngine.initial("UTC")
            val blueprints=BuiltinBlueprintCatalog.load().entries.filter{it.category=="native"}
            for(index in 0 until 25){
                val result=DomainEngine.execute(state,DomainEngine.command("CreateProject","projectId" to "cache-$index","title" to "Cache $index","blueprintId" to blueprints[index%blueprints.size].id,
                    "subtasks" to JSONArray().put(JSONObject().put("id","t-$index").put("title","Task"))),now)
                assertTrue(result.ok);state=result.state
            }
            val before=state.canonical
            fun port()=AndroidTerrainCache(context,root).also{ports+=it}
            val firstPort=port();val firstBuilder=WorldPlanBuilder(terrainCache=firstPort)
            val first=firstBuilder.terrain(firstBuilder.prepare(WorldFacts.from(state)))
            assertEquals(TerrainReuse.GENERATED,first.reuse);assertTrue(firstPort.awaitWritesForTest(30,TimeUnit.SECONDS));assertEquals(1L,firstPort.stats.commits)
            firstPort.close();assertTrue(firstPort.awaitTermination(20,TimeUnit.SECONDS));firstBuilder.clear()
            val nextPort=port();val nextBuilder=WorldPlanBuilder(terrainCache=nextPort)
            val restored=nextBuilder.terrain(nextBuilder.prepare(WorldFacts.from(state)))
            assertEquals(TerrainReuse.PERSISTENT,restored.reuse);assertEquals(1L,nextPort.stats.hits)
            assertEquals(first.terrain.positions(),restored.terrain.positions());assertEquals(first.terrain.triangleCount,restored.terrain.triangleCount)
            assertEquals(first.terrain.hydrology,restored.terrain.hydrology)
            assertNull(nextPort.read("00".repeat(32)){false})
            nextPort.close();assertTrue(nextPort.awaitTermination(20,TimeUnit.SECONDS))
            RandomAccessFile(File(root,"terrain-v1.bin"),"rw").use{file->val last=file.length()-1;file.seek(last);val original=file.read();file.seek(last);file.write(original xor 1)}
            val recoveryPort=port();val recovery=WorldPlanBuilder(terrainCache=recoveryPort)
            val rebuilt=recovery.terrain(recovery.prepare(WorldFacts.from(state)))
            assertEquals(TerrainReuse.GENERATED,rebuilt.reuse);assertEquals(first.cacheKey,rebuilt.cacheKey)
            assertEquals(first.terrain.positions(),rebuilt.terrain.positions());assertTrue(recoveryPort.awaitWritesForTest(30,TimeUnit.SECONDS));assertEquals(1L,recoveryPort.stats.commits)
            recoveryPort.close();assertTrue(recoveryPort.awaitTermination(20,TimeUnit.SECONDS))
            val deliveries=LinkedBlockingQueue<Runnable>();val received=ArrayList<PreparedWorldRequest>()
            session=NativeWorldSession(context,{deliveries.add(it)},root)
            session.request(WorldRequestIdentity("in-memory-cache-test",0,1),state,onReady=received::add,onFailure={throw AssertionError(it)})
            val delivery=NativeWorldTestAwait.delivery(deliveries,"Android world owner")
            delivery.run();assertEquals(TerrainReuse.PERSISTENT,received.single().terrainWorld.reuse)
            assertEquals(25,received.single().plan.buildings.size);assertEquals(before,state.canonical)
        }finally{
            session?.close();session?.let{assertTrue(it.awaitTermination(30,TimeUnit.SECONDS))}
            for(port in ports){port.close();assertTrue(port.awaitTermination(20,TimeUnit.SECONDS))}
            cleanup(root)
        }
    }
    @Test fun failedWritesOversizedFilesAndCancellationDoNotBecomeBusinessErrors() {
        val root=directory();val ports=ArrayList<AndroidTerrainCache>()
        try {
            val blocked=File(root,"blocked").also{it.writeBytes(byteArrayOf(1))}
            val cache=AndroidTerrainCache(context,blocked).also{ports+=it};val builder=WorldPlanBuilder(terrainCache=cache)
            val facts=WorldFacts.from(DomainEngine.initial("UTC"));val result=builder.terrain(builder.prepare(facts))
            assertEquals(TerrainReuse.GENERATED,result.reuse);assertTrue(result.terrain.cellCount>1000)
            assertTrue(cache.awaitWritesForTest(20,TimeUnit.SECONDS));assertEquals(1L,cache.stats.failures)
            assertThrows(IllegalArgumentException::class.java){AndroidTerrainCache(context,context.cacheDir.parentFile!!)}
            assertThrows(java.util.concurrent.CancellationException::class.java){cache.read(result.cacheKey){true}}
            val small=AndroidTerrainCache(context,root,4096).also{ports+=it}
            RandomAccessFile(File(root,"terrain-v1.bin"),"rw").use{it.setLength(TerrainMeshCodec.MAX_BYTES+1L)}
            assertNull(small.read(result.cacheKey){false})
            small.write(result.cacheKey,result.terrain);assertTrue(small.awaitWritesForTest(20,TimeUnit.SECONDS));assertEquals(1L,small.stats.oversized)
            small.close();assertTrue(small.awaitTermination(20,TimeUnit.SECONDS))
            val requests=small.stats.queuedWrites;small.write(result.cacheKey,result.terrain);assertEquals(requests,small.stats.queuedWrites)
        }finally{for(port in ports){port.close();assertTrue(port.awaitTermination(20,TimeUnit.SECONDS))};cleanup(root)}
    }
}
