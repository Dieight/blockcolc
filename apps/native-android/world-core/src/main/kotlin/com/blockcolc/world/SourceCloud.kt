package com.blockcolc.world

import org.json.JSONObject
import kotlin.math.*

/** One connected source cloud wraps as a unit, in seconds / world units. */
data class SourceCloud(val elapsed:Float,val span:List<Float>) {
    fun offset(center:List<Float>,velocity:List<Float>,seconds:Float):List<Float> {
        require(center.size==2&&velocity.size==2&&(center+velocity+seconds).all{it.isFinite()})
        return (0..1).map{i->val value=center[i]+velocity[i]*seconds+span[i]*.5f
            value-floor(value/span[i])*span[i]-span[i]*.5f-center[i]}
    }
    companion object {
        fun read(input:JSONObject):SourceCloud {
            fun number(raw:Any,min:Double,max:Double):Float {require(raw is Number);val n=raw.toDouble();require(n.isFinite()&&n in min..max);return n.toFloat()}
            val span=input.getJSONArray("cloudSpan");require(span.length()==2)
            return SourceCloud(number(input.get("cloudElapsed"),0.0,1e9),(0..1).map{number(span.get(it),1.0,1e6)})
        }
    }
}

/** Exact Lambert diffuse for the reviewed cloud recipe. Point-light omission
 * is allowed only after its finite support is proven outside this batch. */
data class SourceLambert(val hemisphere:FloatArray,val direction:List<Float>,val direct:List<Float>) {
    fun irradiance(normal:List<Float>):List<Float> {
        require(normal.size==3&&normal.all{it.isFinite()});val length=sqrt(normal.sumOf{it.toDouble()*it});require(length>1e-8)
        val n=normal.map{(it/length).toFloat()};val facing=max(0f,(0..2).sumOf{n[it].toDouble()*direction[it]}.toFloat())
        return (0..2).map{c->hemisphere[c]+hemisphere[3+c]*n[1]+hemisphere[6+c]*n[2]+hemisphere[9+c]*n[0]+direct[c]*facing}
    }
    companion object {
        fun read(lighting:SourceLighting,bounds:Bounds):SourceLambert {
            for(light in lighting.lights.filter{it.type=="PointLight"}) {
                // Clouds can wrap across the entire horizontal span. Only a
                // vertical separation proves the light never reaches them.
                val distance=max(0f,max(bounds.min.y-light.position[1],light.position[1]-bounds.max.y))
                require(light.distance>0f&&distance>=light.distance){"Cloud point-light contribution is not yet ported"}
            }
            val light=lighting.lights.firstOrNull{it.type=="DirectionalLight"}
            return SourceLambert(lighting.hemisphereCoefficients(),light?.direction?.map{-it}?:listOf(0f,1f,0f),
                light?.color?.map{(it*light.intensity/PI).toFloat()}?:List(3){0f})
        }
    }
}
