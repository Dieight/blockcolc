package com.blockcolc.preview.world

import com.blockcolc.world.generation.WorldScenery

interface SceneryCachePort {
    fun readScenery(key:String,cancelled:()->Boolean):WorldScenery?
    /** Queues an immutable derived value; never encodes on the caller. */
    fun writeScenery(key:String,scene:WorldScenery)
}

enum class SceneryReuse { MEMORY,PERSISTENT,GENERATED }
