package com.blockcolc.world

import com.blockcolc.world.resource.*

/** Immutable ready-to-use input for the normal world compiler. The import
 * owner lends a stack of private immutable archives for this input's lifetime. */
class NativeResourceWorldAssets private constructor(val stack:ResourcePackStack,val textures:NativeAtlasTextures,val palette:ResourceBiomePalette,val terrain:NativeResourceTerrain,val specials:NativeResourceSpecialCompiler){
    companion object{
        fun prepare(stack:ResourcePackStack,selectedIds:Set<String>?=null,limits:ResourceAtlasLimits=ResourceAtlasLimits(),cancelled:()->Boolean={false}):NativeResourceWorldAssets{
            val atlas=NativeResourceAtlas.build(stack,selectedIds,limits,cancelled)
            val pixels=NativeAtlasTextures.prepare(atlas,cancelled)
            val palette=ResourceBiomePalette.from(stack,cancelled=cancelled)
            val available=atlas.memoryEstimate.getValue("limitBytes")-pixels.estimatedPeakBytes
            val terrain=NativeResourceTerrain.prepare(stack,atlas,palette,available.coerceAtLeast(0),cancelled)
            val specials=NativeResourceSpecialCompiler(stack,(available-terrain.estimatedPeakBytes).coerceIn(0,16L*1024*1024))
            return NativeResourceWorldAssets(stack,pixels,palette,terrain,specials)
        }
    }
}
