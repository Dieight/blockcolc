package com.blockcolc.world.generation

import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

data class OriginalVisualStyle(val color:Int,val response:OriginalResponse,val pattern:OriginalPattern,val transparent:Boolean=false,val opacity:Double=if(transparent).44 else 1.0) {
    /** Compatibility identity only. Native consumers use the typed fields. */
    val key get()="fallback:${color.toString(16).padStart(6,'0')}:${response.wireValue}:${pattern.wireValue}:${if(transparent)"t"else"o"}"
}
enum class OriginalFluid { WATER,LAVA }

class OriginalMaterialStyles(private val library:OriginalMaterialLibrary=OriginalMaterialLibrary.bundled) {
    // Only the finite internal rule expressions enter this map, never a user
    // block ID or a material key. Safe to reuse between CPU preparation jobs.
    private val compiledPatterns=ConcurrentHashMap<String,Regex>()
    private val base=library.colors("BASE_COLORS").associate{it.name to it.color}
    private val dye=library.colors("DYE_COLORS");private val wood=library.colors("WOOD_COLORS")
    private val terracotta=library.colors("TERRACOTTA_COLORS").associate{it.name to it.color}
    private val coralColors=library.colors("CORAL_COLORS").associate{it.name to it.color}
    private fun regex(pattern:String)=compiledPatterns.getOrPut(pattern){Regex(pattern)}
    private val coral=regex("^(dead_)?(tube|brain|bubble|fire|horn)_coral(?:_block|_fan|_wall_fan)?$")
    private val small=mapOf("stone_button" to 0x7d8581,"stone_pressure_plate" to 0x7d8581,"polished_blackstone_button" to 0x4d5655,
        "polished_blackstone_pressure_plate" to 0x4d5655,"light_weighted_pressure_plate" to 0xd6ad3f,"heavy_weighted_pressure_plate" to 0xb7b9b2)
    private val metalDoors=regex("^(?:iron_(?:door|trapdoor)|(?:waxed_)?(?:(?:exposed|weathered|oxidized)_)?copper_(?:door|trapdoor))$")
    private val metalResponse=regex("(?:^|:)(?:.*_)?(?:iron|gold|copper|netherite)(?:_|$)|(?:^|:)(?:anvil|chain|hopper|cauldron|bell|lantern|rail|lightning_rod)(?:$|_)")
    private val glassResponse=regex("(?:^|:)(?:.*_)?(?:glass|ice)(?:$|_)")
    private val woodResponse=regex("(?:^|:)(?:.*_)?(?:log|wood|planks|stem|hyphae|bamboo|bookshelf|barrel|chest)(?:$|_)")
    private val stoneResponse=regex("(?:^|:)(?:.*_)?(?:stone|cobblestone|deepslate|tuff|brick|concrete|terracotta|quartz|sandstone|basalt|blackstone|netherrack|ore)(?:$|_)")
    private fun source(id:String?)=id?.lowercase(Locale.ROOT)?:""
    private fun path(id:String?)=source(id).substringAfterLast(':')
    private fun namespace(id:String?)=source(id).let{if(':' in it)it.substringBefore(':')else"minecraft"}
    fun patternForMaterial(material:String)=when(material) {
        "stone","terrainStone"->OriginalPattern.STONE;"wood"->OriginalPattern.BARK;"plank"->OriginalPattern.PLANKS;"roof"->OriginalPattern.SHINGLES
        "glass"->OriginalPattern.GLASS;"grass"->OriginalPattern.GRASS;"dirt"->OriginalPattern.SOIL;"terrainWater"->OriginalPattern.WATER;"terrainLava"->OriginalPattern.LAVA
        "leaves","vine"->OriginalPattern.FOLIAGE;"path"->OriginalPattern.PATH;"lamp"->OriginalPattern.EMISSIVE;else->OriginalPattern.SMOOTH
    }
    fun responseForMaterial(material:String)=when(material){"glass"->OriginalResponse.GLASS;"stone"->OriginalResponse.STONE;"wood","plank","roof"->OriginalResponse.WOOD;else->OriginalResponse.DEFAULT}
    fun builtinBlock(material:String):String?=when(material){"stone"->"minecraft:stone";"wood"->"minecraft:oak_log";"plank"->"minecraft:oak_planks";"roof"->"minecraft:bricks";"glass"->"minecraft:glass";"accent"->"minecraft:birch_planks";else->null}
    fun response(id:String?,material:String):OriginalResponse {
        val value=source(id);val p=path(id);val ns=namespace(id)
        val component=when(p){"stone_button","stone_pressure_plate","polished_blackstone_button","polished_blackstone_pressure_plate"->OriginalResponse.STONE
            "light_weighted_pressure_plate","heavy_weighted_pressure_plate","lantern","soul_lantern"->OriginalResponse.METAL;else->null}
        if(component!=null)return if(ns=="minecraft")component else responseForMaterial(material)
        return when {glassResponse.containsMatchIn(value)->OriginalResponse.GLASS;metalResponse.containsMatchIn(value)->OriginalResponse.METAL
            woodResponse.containsMatchIn(value)->OriginalResponse.WOOD;stoneResponse.containsMatchIn(value)->OriginalResponse.STONE;else->responseForMaterial(material)}
    }
    fun pattern(id:String?,material:String):OriginalPattern {
        val p=path(id);val ns=namespace(id)
        fun has(pattern:String)=regex(pattern).containsMatchIn(p)
        if(coral.matches(p))return if(ns!="minecraft")patternForMaterial(material)else if(p.endsWith("_block"))OriginalPattern.STONE else OriginalPattern.FOLIAGE
        if(ns!="minecraft"&&(p in small||metalDoors.matches(p)))return patternForMaterial(material)
        return when {
            p.contains("shelf_mushroom")||has("(?:^|_)(?:brown|red)_mushroom(?:_block)?$")->OriginalPattern.MUSHROOM
            p.contains("straw_bed")||p=="hay_block"->OriginalPattern.STRAW
            ns=="minecraft"&&p=="moss_carpet"->OriginalPattern.FOLIAGE
            p.contains("cushion")->OriginalPattern.FABRIC
            metalDoors.matches(p)->OriginalPattern.METAL
            p=="water"||p=="bubble_column"->OriginalPattern.WATER
            p=="lava"->OriginalPattern.LAVA
            ns=="minecraft"&&p in setOf("stone_button","stone_pressure_plate","polished_blackstone_button","polished_blackstone_pressure_plate")->OriginalPattern.STONE
            ns=="minecraft"&&p in setOf("light_weighted_pressure_plate","heavy_weighted_pressure_plate")->OriginalPattern.METAL
            ns=="minecraft"&&has("^(?:(?:white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_stained_)?glass_pane$")->OriginalPattern.CLEAR_GLASS
            has("(?:glass|ice)(?:$|_)")->OriginalPattern.GLASS
            ns=="minecraft"&&has("^(?:acacia|bamboo|bamboo_mosaic|birch|cherry|crimson|dark_oak|jungle|mangrove|oak|pale_oak|poplar|spruce|warped)_(?:stairs|slab)$")->OriginalPattern.PLANKS
            has("(?:^|_)(?:log|wood|stem|hyphae)(?:$|_)|bamboo_block")->OriginalPattern.BARK
            has("(?:planks|shelf|bookshelf|door|trapdoor|fence|gate|sign|button|pressure_plate)")->OriginalPattern.PLANKS
            has("(?:wool|carpet|bed|banner)")->OriginalPattern.FABRIC
            p.contains("concrete_powder")||has("(?:^|_)(?:sand|gravel)(?:$|_)")->OriginalPattern.SAND
            p.contains("concrete")->OriginalPattern.SMOOTH
            has("(?:terracotta|clay)")->if(p.contains("glazed"))OriginalPattern.BRICK else OriginalPattern.CERAMIC
            has("(?:^|_)(?:ore|raw_iron|raw_gold|raw_copper)(?:$|_)")||has("(?:sulfur|cinnabar)")->OriginalPattern.ORE
            has("(?:cobblestone|cobbled|rubble)")->OriginalPattern.COBBLE
            has("(?:brick|tiles?)")->OriginalPattern.BRICK
            has("(?:copper|iron|gold|netherite|anvil|chain|hopper|cauldron|bell|rail|lightning_rod)")->OriginalPattern.METAL
            p.contains("sculk")->OriginalPattern.SCULK
            has("(?:torch|lantern|glowstone|shroomlight|froglight|sea_lantern|redstone_lamp|magma|fire|candle)")->OriginalPattern.EMISSIVE
            has("(?:leaves|vine|moss|azalea|grass|fern|sapling|roots|lichen|shrub)")->OriginalPattern.FOLIAGE
            has("(?:dirt|mud|podzol|mycelium|soul_soil)")->OriginalPattern.SOIL
            has("(?:stone|andesite|diorite|granite|calcite|deepslate|tuff|blackstone|basalt|netherrack|quartz|sandstone|prismarine|purpur|obsidian)")->OriginalPattern.STONE
            else->patternForMaterial(material)
        }
    }
    private fun oreColor(p:String):Int {
        for((word,color)in listOf("coal" to 0x5f625f,"iron" to 0xa8927d,"gold" to 0xc5a344,"redstone" to 0x9f4d46,"diamond" to 0x5ca6a1,"emerald" to 0x57966b,"lapis" to 0x526f9f,"copper" to 0xa86e55,"quartz" to 0xbda99a))if(p.contains(word))return color
        return 0x7f827c
    }
    fun voxel(voxel:RenderVoxel)=voxel(voxel.sourceBlockId,voxel.materialId)
    fun voxel(id:String?,material:String):OriginalVisualStyle {
        val p=path(id);val ns=namespace(id);var response=response(id,material);val pattern=pattern(id,material)
        val dyed=dye.firstOrNull{p==it.name||p.startsWith(it.name+"_")};val wooden=wood.firstOrNull{p==it.name||p.startsWith(it.name+"_")};val reef=coral.matchEntire(p)
        var color=base[material]?:0xc3b18d;var transparent=material=="glass";var opacity=if(transparent).44 else 1.0
        fun has(pattern:String)=regex(pattern).containsMatchIn(p)
        when {
            (p in small||reef!=null||p=="sea_pickle")&&ns!="minecraft"->Unit
            reef!=null->color=if(reef.groupValues[1].isNotEmpty())0x8a8b81 else coralColors.getValue(reef.groupValues[2])
            p=="sea_pickle"->color=0x809f48
            p in small->color=small.getValue(p)
            dyed!=null&&has("(?:wool|carpet|concrete|terracotta|glazed_terracotta|glass|glass_pane|bed|banner|candle|cushion|shulker_box)")->color=if(p.endsWith("_terracotta")&&!p.endsWith("_glazed_terracotta"))terracotta.getValue(dyed.name)else dyed.color
            wooden!=null&&has("(?:planks|log|wood|stem|hyphae|bamboo|shelf|bookshelf|door|trapdoor|fence|gate|sign|button|pressure_plate|stairs|slab)")->{color=wooden.color;response=OriginalResponse.WOOD}
            has("(?:^|_)ore(?:_|$)")->color=oreColor(p)
            p.contains("copper")->{color=when {p.contains("oxidized")->0x51a68c;p.contains("weathered")->0x7c9b89;p.contains("exposed")->0xc27a4e;else->0xb8673e};response=OriginalResponse.METAL}
            p.contains("resin")->color=0xd97845
            p.contains("pale_moss")->color=0x72845d
            has("^(?:red|orange|yellow)_poplar_leaves$")->color=if(p.startsWith("red_"))0xb64d49 else if(p.startsWith("orange_"))0xd27b3c else 0xd4b84c
            p=="red_shrub"->color=0xb74d3e
            p.contains("shelf_mushroom")->color=0x9c634a
            p=="red_mushroom"||p=="red_mushroom_block"->color=0xb94f3f
            p=="brown_mushroom"||p=="brown_mushroom_block"->color=0x886348
            p=="straw_bed"||p=="hay_block"->color=0xc4a64c
            p.contains("sculk")->color=0x165c63
            p.contains("sulfur")->color=0xd6c653
            p.contains("cinnabar")->color=0xa24b3d
            p.contains("deepslate")||p.contains("blackstone")||p.contains("basalt")->color=0x4d5655
            p.contains("tuff")->color=0x65756c
            p.contains("granite")->color=0x9b6a5b
            p.contains("diorite")||p.contains("calcite")||p.contains("quartz")->color=0xc9cbc3
            p.contains("red_sandstone")->color=0xba7042
            p.contains("sandstone")||p=="sand"||p.contains("end_stone")->color=0xcbb887
            p.contains("andesite")||p.contains("stone")||p.contains("cobble")->color=0x7d8581
            p.contains("nether_brick")||p.contains("netherrack")->color=0x74413f
            p.contains("mud_brick")||p.contains("mud")->color=0x776453
            p=="bricks"||p.contains("brick_block")->color=0x9d5c4c
            p.contains("prismarine")->color=0x59988d
            p.contains("purpur")->color=0x9d6d9d
            p.contains("obsidian")->color=0x3d334c
            p.contains("iron")->color=0xb7b9b2
            p.contains("gold")->color=0xd6ad3f
            p.contains("netherite")->color=0x4e474b
            p=="cherry_leaves"||p=="flowering_azalea_leaves"->color=0xe8a8c4
            p.contains("spruce_leaves")->color=0x4d6e4e
            p.contains("birch_leaves")->color=0x7d9449
            p.contains("mangrove_leaves")||p.contains("jungle_leaves")||p.contains("dark_oak_leaves")->color=0x3f6b3f
            has("(?:grass|moss|leaves|vine|azalea|fern)")->color=0x638453
            has("(?:dirt|podzol|mycelium|soul_soil|farmland)")->color=0x79634e
            has("(?:sand|gravel)")->color=if(p.contains("red_"))0xb66c42 else 0xc7b88b
            p.contains("snow")->color=0xe5ece8
        }
        if(ns=="minecraft"&&(p=="packed_ice"||p=="blue_ice")){color=if(p=="blue_ice")0x82aeca else 0xb6cee1;transparent=false;opacity=1.0}
        else if(has("(?:^|_)glass(?:_|$)|(?:^|_)ice(?:_|$)")){transparent=true;opacity=.44;response=OriginalResponse.GLASS}
        return OriginalVisualStyle(color,response,pattern,transparent,opacity)
    }
    fun component(voxel:RenderVoxel,key:String):OriginalVisualStyle {
        val p=path(voxel.sourceBlockId);val ns=namespace(voxel.sourceBlockId)
        fun style(color:Int,response:OriginalResponse,pattern:OriginalPattern)=OriginalVisualStyle(color,response,pattern)
        if(ns=="minecraft"&&key=="carpet")return style(if(p=="moss_carpet")0x74895f else dye.firstOrNull{p==it.name+"_carpet"}?.color?:0x74895f,OriginalResponse.DEFAULT,if(p=="moss_carpet")OriginalPattern.FOLIAGE else OriginalPattern.FABRIC)
        if(ns=="minecraft"&&p=="pale_moss_carpet") {
            if(key=="pale-moss-base")return style(0x72845d,OriginalResponse.DEFAULT,OriginalPattern.FOLIAGE)
            if(key.startsWith("pale-moss-"))return style(0x667954,OriginalResponse.DEFAULT,OriginalPattern.FOLIAGE)
        }
        if(ns=="minecraft"&&p=="lever") {
            if(key=="lever-base")return style(0x7d8581,OriginalResponse.STONE,OriginalPattern.STONE)
            if(key=="lever-handle")return style(0x8b6745,OriginalResponse.WOOD,OriginalPattern.BARK)
        }
        if(ns=="minecraft"&&(p=="lantern"||p=="soul_lantern"))when(key) {
            "lantern-frame"->return style(0x525a57,OriginalResponse.METAL,OriginalPattern.METAL)
            "lantern-core-warm"->return style(0xffc66a,OriginalResponse.DEFAULT,OriginalPattern.EMISSIVE)
            "lantern-core-soul"->return style(0x65cfe3,OriginalResponse.DEFAULT,OriginalPattern.EMISSIVE)
        }
        if(ns=="minecraft"&&(p=="candle"||dye.any{p==it.name+"_candle"})) {
            if(key=="candle-wax")return style(voxel(voxel).color,OriginalResponse.DEFAULT,OriginalPattern.SMOOTH)
            if(key=="candle-wick"){val lit=voxel.sourceBlockState?.get("lit")=="true";return style(if(lit)0xffbb63 else 0x3d352e,OriginalResponse.DEFAULT,if(lit)OriginalPattern.EMISSIVE else OriginalPattern.SMOOTH)}
        }
        if(ns=="minecraft"&&(p=="straw_bed"||dye.any{p==it.name+"_bed"}))when(key) {
            "bed-cover"->return style(voxel(voxel).color,OriginalResponse.DEFAULT,OriginalPattern.FABRIC)
            "bed-legs"->return style(0x87643f,OriginalResponse.WOOD,OriginalPattern.BARK)
            "bed-pillow"->return style(0xeae6d8,OriginalResponse.DEFAULT,OriginalPattern.FABRIC)
            "bed-straw-base"->return style(0xc4a64c,OriginalResponse.DEFAULT,OriginalPattern.STRAW)
            "bed-straw-pillow"->return style(0xe0cf91,OriginalResponse.DEFAULT,OriginalPattern.STRAW)
        }
        return voxel(voxel)
    }
    fun parseLegacyKey(key:String):OriginalVisualStyle? {
        val m=regex("^fallback:([0-9a-f]{6}):(default|stone|wood|metal|glass):([^:]+):(t|o)$").matchEntire(key)?:return null
        val p=OriginalPattern.entries.firstOrNull{it.wireValue==m.groupValues[3]}?:return null
        return OriginalVisualStyle(m.groupValues[1].toInt(16),OriginalResponse.entries.first{it.wireValue==m.groupValues[2]},p,m.groupValues[4]=="t")
    }
    fun fluid(id:String?):OriginalFluid?=when(source(id)){"minecraft:water","minecraft:bubble_column"->OriginalFluid.WATER;"minecraft:lava"->OriginalFluid.LAVA;else->null}
    fun fluidHeight(state:Map<String,String>?):Double {
        val raw=state?.get("level")?:"0";val text=SourceNumbers.trim(raw)
        val value=when {
            text.isEmpty()->0.0
            text.startsWith("0x",true)->text.substring(2).toLongOrNull(16)?.toDouble()
            text.startsWith("0b",true)->text.substring(2).toLongOrNull(2)?.toDouble()
            text.startsWith("0o",true)->text.substring(2).toLongOrNull(8)?.toDouble()
            text.matches(regex("[+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?"))->text.toDoubleOrNull()
            else->null
        }
        val level=if(value!=null&&value in 0.0..15.0&&value==kotlin.math.floor(value))value.toInt()else 0
        return (if(level>=8)8 else 8-level)/9.0
    }
}
