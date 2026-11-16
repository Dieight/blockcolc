package com.blockcolc.world

import org.json.JSONObject
import kotlin.math.*

data class CameraFrame(val near:Double,val far:Double,val skyRadius:Double)
data class SourceCamera(val framingRadius:Double,val visibility:List<List<Double>>,val skyBaseRadius:Double,
                        val skyFarRatio:Double,val starRadiusRatio:Double,val starNearMargin:Double,val sourceSkyRadius:Double) {
    fun frame(eye:DoubleArray,distance:Double):CameraFrame {
        require(eye.size==3&&eye.all{it.isFinite()}&&distance.isFinite()&&distance>0)
        val nearest=sqrt((0..2).sumOf{i->max(0.0,max(visibility[0][i]-eye[i],eye[i]-visibility[1][i])).pow(2)})
        val farthest=sqrt((0..2).sumOf{i->max(abs(eye[i]-visibility[0][i]),abs(eye[i]-visibility[1][i])).pow(2)})
        val near=min(max(.1,distance-framingRadius*1.65),max(.5,nearest*.72))
        val far=max(max(distance+framingRadius*3+60,farthest+24),near*starNearMargin/(starRadiusRatio*skyFarRatio))
        return CameraFrame(near,far,min(far*skyFarRatio,max(skyBaseRadius,near*starNearMargin/starRadiusRatio)))
    }
    companion object {
        fun read(value:JSONObject):SourceCamera {
            require(value.getInt("schema")==1)
            fun n(raw:Any,min:Double,max:Double):Double{require(raw is Number);return raw.toDouble().also{require(it.isFinite()&&it in min..max)}}
            val raw=value.getJSONArray("visibility");require(raw.length()==2)
            val bounds=(0..1).map{i->val p=raw.getJSONArray(i);require(p.length()==3);(0..2).map{n(p.get(it),-1e6,1e6)}}
            require((0..2).all{bounds[1][it]>=bounds[0][it]})
            return SourceCamera(n(value.get("framingRadius"),6.0,1e6),bounds,n(value.get("skyBaseRadius"),1.0,1e6),
                n(value.get("skyFarRatio"),.001,1.0),n(value.get("starRadiusRatio"),.001,1.0),n(value.get("starNearMargin"),1.0,100.0),
                n(value.get("sourceSkyRadius"),.001,1e6))
        }
    }
}
