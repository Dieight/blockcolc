package com.blockcolc.preview.world

import com.blockcolc.domain.DomainEngine
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.world.generation.TerrainMesh
import com.blockcolc.world.generation.TerrainMeshCodec
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CancellationException

class WorldPlanPersistentCacheTest {
    private class BytesCache:TerrainCachePort {
        var bytes:ByteArray?=null;var reads=0;var writes=0
        override fun read(key:String,cancelled:()->Boolean):TerrainMesh? {reads++;return bytes?.let{TerrainMeshCodec.decode(key,it.copyOf(),cancelled)}}
        override fun write(key:String,mesh:TerrainMesh){writes++;bytes=TerrainMeshCodec.encode(key,mesh)}
    }
    private fun prepare(builder:WorldPlanBuilder)=builder.prepare(WorldFacts.from(DomainEngine.initial("UTC")))
    @Test fun aNewBuilderRestoresExactCurrentTerrainAndThenKeepsTheInMemoryIdentity() {
        val cache=BytesCache();val firstBuilder=WorldPlanBuilder(terrainCache=cache)
        val first=firstBuilder.terrain(prepare(firstBuilder))
        assertEquals(TerrainReuse.GENERATED,first.reuse);assertEquals(1,cache.writes)
        firstBuilder.clear()
        val nextBuilder=WorldPlanBuilder(terrainCache=cache);val input=prepare(nextBuilder)
        val restored=nextBuilder.terrain(input)
        assertEquals(TerrainReuse.PERSISTENT,restored.reuse);assertNotSame(first.terrain,restored.terrain)
        assertEquals(first.cacheKey,restored.cacheKey);assertEquals(first.terrain.bounds,restored.terrain.bounds)
        assertEquals(first.terrain.vertexCount,restored.terrain.vertexCount);assertEquals(first.terrain.triangleCount,restored.terrain.triangleCount)
        assertEquals(first.terrain.positions(),restored.terrain.positions())
        assertEquals(first.surfaces.sample(0.0,0.0),restored.surfaces.sample(0.0,0.0))
        val same=nextBuilder.terrain(input);assertEquals(TerrainReuse.MEMORY,same.reuse);assertSame(restored.terrain,same.terrain)
        assertEquals(2,cache.reads);assertEquals(1,cache.writes)
    }
    @Test fun staleOrCorruptDerivedBytesRegenerateWithoutChangingBusinessFacts() {
        val state=DomainEngine.initial("UTC");val original=state.canonical;val cache=BytesCache()
        val builder=WorldPlanBuilder(terrainCache=cache);val initial=builder.terrain(prepare(builder))
        cache.bytes!![cache.bytes!!.lastIndex]=(cache.bytes!!.last()+1).toByte()
        val recovery=WorldPlanBuilder(terrainCache=cache);val rebuilt=recovery.terrain(prepare(recovery))
        assertEquals(TerrainReuse.GENERATED,rebuilt.reuse);assertEquals(initial.cacheKey,rebuilt.cacheKey)
        assertNotNull(TerrainMeshCodec.decode(rebuilt.cacheKey,cache.bytes!!))
        val changed=DomainEngine.execute(state,DomainEngine.command("ConfigureWorldEnvironment","environmentStyle" to "classic-island"),0).state
        val different=WorldPlanBuilder(terrainCache=cache)
        val world=different.terrain(different.prepare(WorldFacts.from(changed)))
        assertEquals(TerrainReuse.GENERATED,world.reuse);assertNotEquals(initial.cacheKey,world.cacheKey)
        assertEquals(original,state.canonical)
    }
    @Test fun cacheIoOrItsOwnCancellationCannotFailACompletedLiveWorld() {
        for(error in listOf(IOException("Unavailable cache"),CancellationException("Cache owner stopped"))) {
            val cache=object:TerrainCachePort {
                override fun read(key:String,cancelled:()->Boolean):TerrainMesh?=throw error
                override fun write(key:String,mesh:TerrainMesh){throw error}
            }
            val builder=WorldPlanBuilder(terrainCache=cache);val result=builder.terrain(prepare(builder))
            assertEquals(TerrainReuse.GENERATED,result.reuse);assertTrue(result.terrain.cellCount>1000)
            assertEquals(TerrainReuse.MEMORY,builder.terrain(result.input).reuse)
        }
    }
    @Test fun cancelledGenerationDoesNotQueueAWriteOrAdoptAPartialRead() {
        val cache=BytesCache();val builder=WorldPlanBuilder(terrainCache=cache);val input=prepare(builder);var checks=0
        assertThrows(CancellationException::class.java){builder.terrain(input,cancelled={++checks>8})}
        assertEquals(0,cache.writes);assertNull(cache.bytes)
        val result=builder.terrain(input);assertEquals(TerrainReuse.GENERATED,result.reuse);assertEquals(1,cache.writes)
        val other=WorldPlanBuilder(terrainCache=cache);checks=0
        assertThrows(CancellationException::class.java){other.terrain(prepare(other),cancelled={++checks>4})}
        assertEquals(1,cache.writes)
        assertEquals(TerrainReuse.PERSISTENT,other.terrain(prepare(other)).reuse)
    }
}
