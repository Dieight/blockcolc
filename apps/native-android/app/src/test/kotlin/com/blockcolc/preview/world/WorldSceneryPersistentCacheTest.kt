package com.blockcolc.preview.world

import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CancellationException

class WorldSceneryPersistentCacheTest {
    private class BytesCache:SceneryCachePort {
        var bytes:ByteArray?=null;var reads=0;var writes=0
        override fun readScenery(key:String,cancelled:()->Boolean):WorldScenery? {reads++;return bytes?.let{SceneryCodec.decode(key,it.copyOf(),cancelled)}}
        override fun writeScenery(key:String,scene:WorldScenery){writes++;bytes=SceneryCodec.encode(key,scene)}
    }
    private fun prepare(builder:WorldPlanBuilder)=builder.prepare(WorldFacts.from(DomainEngine.initial("UTC")))
    @Test fun generatedFileNewOwnerAndMemoryReuseHaveTheSameImmutableVoxelAndSubsetValues() {
        val cache=BytesCache();val firstBuilder=WorldPlanBuilder(sceneryCache=cache)
        val first=firstBuilder.terrain(prepare(firstBuilder));assertEquals(SceneryReuse.GENERATED,first.sceneryReuse);assertEquals(1,cache.writes)
        assertTrue(first.scenery.objects.isNotEmpty());firstBuilder.clear()
        val nextBuilder=WorldPlanBuilder(sceneryCache=cache);val input=prepare(nextBuilder);val next=nextBuilder.terrain(input)
        assertEquals(SceneryReuse.PERSISTENT,next.sceneryReuse);assertNotSame(first.scenery,next.scenery);assertEquals(first.sceneryKey,next.sceneryKey)
        assertEquals(first.scenery.village,next.scenery.village)
        for((i,o)in first.scenery.objects.withIndex()) {
            val restored=next.scenery.objects[i];assertEquals(o.id,restored.id);assertEquals(o.rect,restored.rect)
            assertEquals(o.blocks.voxels,restored.blocks.voxels);assertEquals(o.blocks.distantVoxels,restored.blocks.distantVoxels)
        }
        val memory=nextBuilder.terrain(input);assertSame(next.scenery,memory.scenery);assertEquals(SceneryReuse.MEMORY,memory.sceneryReuse)
        assertEquals(2,cache.reads);assertEquals(1,cache.writes)
    }
    @Test fun addingARewardChangesProtectionButNotTerrainOrPreviouslyPublishedScenery() {
        val cache=BytesCache();val builder=WorldPlanBuilder(sceneryCache=cache);val now=DomainTime.millis("2026-10-25T08:00:00.000Z")
        var state=DomainEngine.execute(DomainEngine.initial("UTC"),DomainEngine.command("CreateProject","projectId" to "p","title" to "P","blueprintId" to "unknown",
            "subtasks" to JSONArray().put(JSONObject().put("id","t").put("title","T"))),now).state
        val first=builder.terrain(builder.prepare(WorldFacts.from(state)));val originalIds=first.scenery.objects.map{it.id}
        val configured=DomainEngine.execute(state,DomainEngine.command("ConfigureBirthday","enabled" to true,"month" to 10,"day" to 25),now)
        assertTrue(configured.error.toString(),configured.ok);state=configured.state
        val granted=DomainEngine.execute(state,DomainEngine.command("ObserveBirthday"),now);assertTrue(granted.error.toString(),granted.ok)
        val next=builder.terrain(builder.prepare(WorldFacts.from(granted.state)))
        assertSame(first.terrain,next.terrain);assertNotEquals(first.sceneryKey,next.sceneryKey);assertNotSame(first.scenery,next.scenery)
        assertEquals(SceneryReuse.GENERATED,next.sceneryReuse);assertEquals(2,cache.writes);assertEquals(1,next.rewards.size)
        assertEquals(originalIds,first.scenery.objects.map{it.id})
    }
    @Test fun corruptFilesAndOptionalIoFailuresRegenerateRatherThanFailOrAlterFacts() {
        val cache=BytesCache();val builder=WorldPlanBuilder(sceneryCache=cache);val first=builder.terrain(prepare(builder))
        cache.bytes!![cache.bytes!!.lastIndex]=(cache.bytes!!.last().toInt() xor 1).toByte()
        val next=WorldPlanBuilder(sceneryCache=cache);val restored=next.terrain(prepare(next))
        assertEquals(SceneryReuse.GENERATED,restored.sceneryReuse);assertEquals(first.sceneryKey,restored.sceneryKey);assertEquals(2,cache.writes)
        for(error in listOf(IOException("Unavailable derived files"),CancellationException("Cache stopped"))) {
            val failing=object:SceneryCachePort {
                override fun readScenery(key:String,cancelled:()->Boolean):WorldScenery?=throw error
                override fun writeScenery(key:String,scene:WorldScenery){throw error}
            }
            val b=WorldPlanBuilder(sceneryCache=failing);val input=prepare(b);val before=input.facts
            val world=b.terrain(input);assertEquals(SceneryReuse.GENERATED,world.sceneryReuse);assertSame(before,world.input.facts)
            assertEquals(SceneryReuse.MEMORY,b.terrain(input).sceneryReuse)
        }
    }
    @Test fun realGenerationCancellationDoesNotWriteOrAdoptPartialScenery() {
        val cache=BytesCache();val builder=WorldPlanBuilder(sceneryCache=cache);val input=prepare(builder);var checks=0
        assertThrows(CancellationException::class.java){builder.terrain(input,cancelled={++checks>8})}
        assertEquals(0,cache.writes)
        val world=builder.terrain(input);assertEquals(SceneryReuse.GENERATED,world.sceneryReuse)
        assertThrows(CancellationException::class.java){builder.terrain(input,cancelled={true})}
        assertSame(world.scenery,builder.terrain(input).scenery);assertEquals(1,cache.writes)
    }
}
