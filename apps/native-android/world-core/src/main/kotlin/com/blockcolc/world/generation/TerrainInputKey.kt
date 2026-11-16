package com.blockcolc.world.generation

import java.security.MessageDigest

/** The generator fingerprint is derived from source at build time, without a
 * timestamp or machine path. A cache never survives a generator change solely
 * because somebody forgot to update a manual version constant. */
object TerrainInputKey {
    val generatorIdentity:String by lazy {
        val value=TerrainInputKey::class.java.classLoader!!.getResourceAsStream("native-world-generator-id.txt")?.use{it.readBytes().toString(Charsets.US_ASCII).trim()}
            ?:error("Missing native world generator identity")
        require(Regex("[a-f0-9]{64}").matches(value));value
    }
    fun key(placements:List<VillagePlacement>,roads:List<RoadCell>,pads:List<TerrainPad>,minimumRadius:Position2?,options:TerrainOptions):String {
        require(options.generation==4)
        val text=buildString {
            append("native-terrain-key-1\n");append(generatorIdentity);append('\n')
            fun number(value:Double){require(value.isFinite());append(SourceNumbers.text(value));append(',')}
            append('[')
            for(p in placements){append('[');number(p.worldPosition.x);number(p.worldPosition.y);number(p.worldPosition.z);number(p.footprint.width);number(p.footprint.depth);append(']')}
            append("]\n[");for(road in roads){append('[');append(road.x);append(',');append(road.z);append(']')};append("]\n[")
            for(pad in pads){append('[');number(pad.x);number(pad.z);number(pad.width);number(pad.depth);number(pad.groundLevel);append(']')};append("]\n")
            if(minimumRadius==null)append("null")else{append('[');number(minimumRadius.x);number(minimumRadius.z);append(']')}
            append('\n');append(options.environment.wireValue);append('\n');append(SourceNumbers.quoted(options.worldSeed));append('\n')
            append(options.generation);append('\n');append(options.refinedFar?.toString()?:"null")
        }
        return MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
    }
}
