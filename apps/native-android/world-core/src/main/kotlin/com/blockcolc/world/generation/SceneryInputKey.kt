package com.blockcolc.world.generation

import java.security.MessageDigest

/** Derived identity uses the verified terrain, not a revision/title/progress.
 * All additional ordered planning inputs are retained, including reward
 * protection rectangles and the optional near/biome composition bounds. */
object SceneryInputKey {
    fun key(terrainKey:String,input:WorldSceneryInput):String {
        require(terrainKey.matches(Regex("[a-f0-9]{64}")))
        val digest=MessageDigest.getInstance("SHA-256")
        fun word(value:String){digest.update(value.toByteArray(Charsets.UTF_8));digest.update(0)}
        fun number(value:Double)=word(SourceNumbers.text(value))
        word("blockcolc-scenery-1");word(TerrainInputKey.generatorIdentity);word(terrainKey);word(input.environment.wireValue);word(SourceNumbers.quoted(input.seed))
        word(input.protectedRects.size.toString())
        for(r in input.protectedRects){number(r.x);number(r.z);number(r.width);number(r.depth)}
        word(input.roads.size.toString());for(r in input.roads){word(r.x.toString());word(r.z.toString())}
        word(input.trees.size.toString());for(t in input.trees){number(t.x);number(t.y);number(t.z);number(t.scale)}
        val b=input.normalBounds
        word(if(b==null)"no-normal-bounds"else"normal-bounds")
        if(b!=null){number(b.minX);number(b.maxX);number(b.minZ);number(b.maxZ)}
        word(if(input.mosaicCoreRadius==null)"no-mosaic-radius"else SourceNumbers.text(input.mosaicCoreRadius))
        return digest.digest().joinToString(""){"%02x".format(it.toInt() and 255)}
    }
}
