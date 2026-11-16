package com.blockcolc.world.resource

/** The same fixed temperate climate as the existing world, not the UI theme
 * or a location-dependent biome guess. Decoded maps are not retained. */
data class ResourceBiomePalette(val grass:Int=0x91bd59,val foliage:Int=0x77ab2f,val dryFoliage:Int=0xa37546,
    val water:Int=0x3f76e4,val spruceLeaves:Int=0x619961,val birchLeaves:Int=0x80a755,val lilyPad:Int=0x208030){
    init{require(listOf(grass,foliage,dryFoliage,water,spruceLeaves,birchLeaves,lilyPad).all{it in 0..0xffffff})}
    fun color(kind:Int,stateTint:Int?):Int=when(kind){0->0xffffff;1->foliage;2->grass;3->water;4->dryFoliage;5->spruceLeaves;6->birchLeaves;7->lilyPad;8,9,10->checkNotNull(stateTint);else->error("Unknown tint")}
    companion object{
        fun from(stack:ResourcePackStack,temperature:Double=.8,downfall:Double=.4,cancelled:()->Boolean={false}):ResourceBiomePalette{
            if(cancelled()||Thread.currentThread().isInterrupted)throw java.util.concurrent.CancellationException("Colormap superseded")
            fun sample(kind:String,fallback:Int):Int{
                val source=stack.colormaps["minecraft:colormap/$kind"]?:return fallback
                return sample(source.decode(cancelled),temperature,downfall)
            }
            return ResourceBiomePalette(sample("grass",0x91bd59),sample("foliage",0x77ab2f),sample("dry_foliage",0xa37546))
        }
        fun sample(image:ResourcePngImage,temperature:Double=.8,downfall:Double=.4):Int{
            require(image.width==256&&image.height==256)
            fun clamp(v:Double)=if(v.isFinite())v.coerceIn(0.0,1.0)else 0.0
            val t=clamp(temperature);val rain=clamp(downfall)
            val x=kotlin.math.floor((1-t)*255).toInt().coerceIn(0,255);val y=kotlin.math.floor((1-rain*t)*255).toInt().coerceIn(0,255)
            val at=(y*256+x)*4;val pixels=image.rgba()
            return ((pixels.get(at).toInt()and 255)shl 16)or((pixels.get(at+1).toInt()and 255)shl 8)or(pixels.get(at+2).toInt()and 255)
        }
        fun tintKind(blockId:String,tintIndex:Int?):Int?{
            if(tintIndex==null)return 0
            if(!blockId.startsWith("minecraft:"))return null
            val id=blockId.removePrefix("minecraft:")
            if(tintIndex==1&&id in setOf("pink_petals","wildflowers"))return 2
            if(tintIndex!=0)return 0
            return when(id){
                "oak_leaves","jungle_leaves","acacia_leaves","dark_oak_leaves","mangrove_leaves","vine"->1
                "grass_block","short_grass","tall_grass","fern","large_fern","potted_fern","bush","sugar_cane"->2
                "water","bubble_column","water_cauldron"->3
                "leaf_litter"->4;"spruce_leaves"->5;"birch_leaves"->6;"lily_pad"->7
                "attached_melon_stem","attached_pumpkin_stem"->8;"redstone_wire"->9;"melon_stem","pumpkin_stem"->10
                else->0
            }
        }
        /** Null includes none/invalid; callers require a value only for tint 8..10. */
        fun stateTint(blockId:String,state:Map<String,String>):Int?{
            fun integer(key:String,max:Int):Int?{val value=state[key]?:"0";if(!Regex("(?:0|[1-9][0-9]*)").matches(value))return null;return value.toIntOrNull()?.takeIf{it in 0..max}}
            return when(blockId){
                "minecraft:attached_melon_stem","minecraft:attached_pumpkin_stem"->0xe0c71c
                "minecraft:redstone_wire"->{val power=integer("power",15)?:return null;val p=power/15f;val square=p*p
                    val red=p*.6f+if(power>0).4f else .3f;val green=(square*.7f-.5f).coerceIn(0f,1f);val blue=(square*.6f-.7f).coerceIn(0f,1f)
                    ((red*255f).toInt()shl 16)or((green*255f).toInt()shl 8)or((blue*255f).toInt())}
                "minecraft:melon_stem","minecraft:pumpkin_stem"->{val age=integer("age",7)?:return null;((age*32)shl 16)or((255-age*8)shl 8)or(age*4)}
                else->null
            }
        }
    }
}
