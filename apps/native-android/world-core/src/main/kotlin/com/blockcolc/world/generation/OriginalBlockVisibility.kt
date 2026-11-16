package com.blockcolc.world.generation

/** Visibility is a world rule, applied before either resource-pack or original
 * routing. A pack must not turn omitted structural placeholders into cubes. */
object OriginalBlockVisibility{
    fun invisible(v:RenderVoxel):Boolean{
        val id=v.sourceBlockId?:return false
        when(id){"minecraft:air","minecraft:cave_air","minecraft:void_air","minecraft:barrier","minecraft:light","minecraft:moving_piston","minecraft:structure_void"->return true}
        val s=v.sourceBlockState
        if(id=="minecraft:pitcher_crop")return s?.get("half")=="upper"&&when(s["age"]){"0","1","2"->true;else->false}
        return id.startsWith("minecraft:")&&id.endsWith("_wall")&&s?.get("up")=="false"&&listOf("north","south","west","east").all{s[it]=="none"}
    }
}
