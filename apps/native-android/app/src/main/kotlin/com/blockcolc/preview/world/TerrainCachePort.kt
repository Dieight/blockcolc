package com.blockcolc.preview.world

import com.blockcolc.world.generation.TerrainMesh

/** Derived-only persistence, separate from the serialized business writer.
 * read verifies the requested identity; write queues the immutable mesh and
 * never waits for encoding or disk. Failures are optional-cache misses. */
interface TerrainCachePort {
    fun read(key:String,cancelled:()->Boolean):TerrainMesh?
    fun write(key:String,mesh:TerrainMesh)
}

enum class TerrainReuse { MEMORY,PERSISTENT,GENERATED }
