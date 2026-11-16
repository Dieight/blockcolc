package com.blockcolc.world.generation

import java.util.Locale

data class EffectiveEmission(val kind:String,val level:Int)
data class SourceBlockEmission(val kind:String,val level:Int,val color:Int)

/** Render projections only. A legacy kind without a level and an explicit
 * zero remain different; derived lantern/candle light must not revive zero. */
object OriginalEmission {
    fun effective(voxel:RenderVoxel,projection:EffectiveEmission?=null):EffectiveEmission = projection?:run {
        val kind=voxel.emissiveKind?:"";EffectiveEmission(kind,voxel.emissiveLevel?:if(kind.isNotEmpty())15 else 0)
    }
    fun lantern(voxel:RenderVoxel):SourceBlockEmission? {
        if(voxel.emissiveLevel==0)return null
        if(voxel.emissiveKind!=null||(voxel.emissiveLevel?:0)>0) {
            val kind=voxel.emissiveKind?:"light";val value=kind.lowercase(Locale.ROOT)
            return SourceBlockEmission(kind,voxel.emissiveLevel?:15,if("soul" in value)0x65cfe3 else if("redstone" in value)0xe94b35 else 0xffb45f)
        }
        val id=voxel.sourceBlockId?.let(SourceNumbers::trim)?.lowercase(Locale.ROOT)
        if(id!="minecraft:lantern"&&id!="minecraft:soul_lantern")return null
        val s=voxel.sourceBlockState?:return null
        if(s.size!=2||s.keys.any{it!="hanging"&&it!="waterlogged"}||s["hanging"] !in setOf("true","false")||s["waterlogged"] !in setOf("true","false"))return null
        val soul=id=="minecraft:soul_lantern"
        return SourceBlockEmission(if(soul)"soul-lantern"else"lantern",if(soul)10 else 15,if(soul)0x65cfe3 else 0xffb45f)
    }
    private val candleId=Regex("^minecraft:(?:candle|(?:black|blue|brown|cyan|gray|green|light_blue|light_gray|lime|magenta|orange|pink|purple|red|white|yellow)_candle)$")
    fun candle(voxel:RenderVoxel):SourceBlockEmission? {
        if(voxel.emissiveKind!=null||voxel.emissiveLevel!=null)return null
        val id=voxel.sourceBlockId?.let(SourceNumbers::trim)?.lowercase(Locale.ROOT)?:return null
        if(!candleId.matches(id))return null
        val s=voxel.sourceBlockState?:return null
        if(s.size!=3||s.keys.any{it!="candles"&&it!="lit"&&it!="waterlogged"}||s["candles"]?.matches(Regex("[1-4]"))!=true||s["waterlogged"] !in setOf("true","false")||s["lit"]!="true")return null
        return SourceBlockEmission("candle",s.getValue("candles").toInt()*3,0xffb45f)
    }
    fun component(voxel:RenderVoxel,key:String):EffectiveEmission {
        if(key=="lantern-frame"||key=="candle-wax")return EffectiveEmission("",0)
        val core=key.startsWith("lantern-core-")||key=="candle-wick"
        if(core&&voxel.emissiveLevel==0)return EffectiveEmission("",0)
        val source=lantern(voxel)?:candle(voxel)
        return effective(voxel,if(core&&source!=null)EffectiveEmission(source.kind,source.level)else null)
    }
}
