package com.blockcolc.world

import org.json.JSONObject
import kotlin.math.*

data class NightField(val stars:Float,val galaxy:Float,val aurora:Float,val time:Float,val density:Float,
                      val meteor:Float,val gain:Float,val coldDirection:List<Float>,val galaxyNormal:List<Float>) {
    companion object {
        val NONE=NightField(0f,0f,0f,0f,1f,-1f,0f,listOf(0f,0f,-1f),listOf(.82f,.22f,-.52f))
        fun read(value:JSONObject,reflection:Boolean=true):NightField {
            fun number(name:String,min:Double,max:Double):Float {
                val raw=value.get(name);require(raw is Number)
                val n=raw.toDouble();require(n.isFinite()&&n in min..max){"Invalid night uniform: $name"};return n.toFloat()
            }
            fun direction(name:String):List<Float> {
                val raw=value.getJSONArray(name);require(raw.length()==3)
                val v=(0..2).map{val n=raw.get(it);require(n is Number);n.toDouble().also{x->require(x.isFinite()&&x in -1.0..1.0)}.toFloat()}
                require(v.sumOf{it.toDouble()*it}>1e-8);return v
            }
            return NightField(number("bcSkyStars",0.0,1.0),number("bcSkyGalaxy",0.0,1.0),number("bcSkyAurora",0.0,1.0),
                number("bcSkyTime",0.0,1e9),number("bcSkyDensity",0.0,4.0),number("bcSkyMeteor",-1.0,1.0),
                if(reflection)number("bcSkyReflectionGain",0.0,8.0)else 1f,direction("bcSkyColdDirection"),direction("bcSkyGalaxyNormal"))
        }
    }
}
data class MoonPhase(val illumination:Float,val waxing:Float,val limbAngle:Float) {
    companion object {
        fun read(input:JSONObject):MoonPhase {
            fun n(key:String,min:Double,max:Double):Float{val v=input.get(key);require(v is Number);val n=v.toDouble();require(n.isFinite()&&n in min..max);return n.toFloat()}
            return MoonPhase(n("uMoonIllumination",0.0,1.0),n("uMoonWaxing",-1.0,1.0),n("uMoonBrightLimbAngle",-10.0,10.0))
        }
    }
}
data class SourceCascade(val elapsed:Float) {
    companion object {
        fun read(input:JSONObject):SourceCascade {
            val raw=input.get("uCascadeClock");require(raw is Number)
            val value=raw.toDouble();require(value.isFinite()&&value in 0.0..1e9)
            return SourceCascade(value.toFloat())
        }
    }
}

data class SurfaceOptics(val night:NightField=NightField.NONE,val fluidSurface:Boolean=false,
                         val clearSky:Float?=null,val distanceOpacity:Boolean=false,val sky:Boolean=false,
                         val floatingSky:Boolean=false,val moon:MoonPhase?=null,val cloud:SourceCloud?=null,
                         val precipitation:SourcePrecipitation?=null,val cascade:SourceCascade?=null,val atlas:SourceAtlas?=null,val lightning:Boolean=false) {
    fun roughness(source:Float)=clearSky?.let{1f+(source-1f)*it}?:source
    fun metallic(source:Float)=source*(clearSky?:1f)
    fun opacity(source:Float,distance:Float):Float {
        if(!distanceOpacity)return source
        val t=((distance-24f)/36f).coerceIn(0f,1f);return source+(1f-source)*t*t*(3f-2f*t)
    }
    companion object {val NONE=SurfaceOptics()}
}

/** Scalar counterpart of the source's packed fluid displacement/UV patch. */
object FluidSurface {
    fun positionY(x:Float,y:Float,z:Float,occlusion:Int,corners:Int):Float {
        if(occlusion-1000000<=.5||y<=0f)return y
        require(corners in 0..16777215)
        val shift=if(z<0f){if(x<0f)0 else 6}else{if(x<0f)18 else 12}
        return ((corners ushr shift) and 63)/63f-.5f
    }
    fun topUv(x:Float,z:Float,occlusion:Int):List<Float>? {
        val meta=occlusion-1000000
        if(meta<=.5||((meta ushr 15) and 1)==0)return null
        val angle=(meta and 32767)*2.0*PI/4096
        val s=.25*sin(angle);val c=.25*cos(angle)
        return if(z<0f){if(x<0f)listOf((.5-c-s).toFloat(),(.5-c+s).toFloat())else listOf((.5+c-s).toFloat(),(.5-c-s).toFloat())}
            else if(x<0f)listOf((.5-c+s).toFloat(),(.5+c+s).toFloat())else listOf((.5+c+s).toFloat(),(.5+c-s).toFloat())
    }
}
