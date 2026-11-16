package com.blockcolc.world

import org.json.JSONObject
import kotlin.math.*

data class SceneryLod(val id:String,val detail:String,val center:Point3,val width:Float) {
    companion object {
        fun read(value:JSONObject):SceneryLod {
            val id=value.getString("id");require(id.length in 1..256)
            val detail=value.getString("detail");require(detail in setOf("full","distant"))
            fun n(raw:Any):Float {require(raw is Number);val n=raw.toDouble();require(n.isFinite()&&abs(n)<=1e6);return n.toFloat()}
            val p=value.getJSONArray("center");require(p.length()==3)
            val width=n(value.get("width"));require(width>0)
            return SceneryLod(id,detail,Point3(n(p.get(0)),n(p.get(1)),n(p.get(2))),width)
        }
        fun full(projectedPixels:Double,wasFull:Boolean):Boolean {
            require(projectedPixels.isFinite()&&projectedPixels>=0)
            return if(wasFull)projectedPixels>=30 else projectedPixels>42
        }
    }
}

/** Source 30/42 CSS-pixel hysteresis. Selection only changes attachments;
 * both representations stay in the same resource owner and GPU pools. */
class ScenerySelector(packets:List<DrawPacket>) {
    private val groups=packets.mapNotNull{it.lod}.groupBy{it.id}.mapValues{(_,entries)->
        val first=entries.first();require(entries.all{it.center==first.center&&it.width==first.width});first}
    val levels=groups.keys.associateWith{true}.toMutableMap()
    val projectedPixels=groups.keys.associateWith{0.0}.toMutableMap()
    var transitions=0;private set
    fun update(eye:DoubleArray,target:DoubleArray,fov:Double,cssHeight:Double):Map<String,Boolean> {
        require(eye.size==3&&target.size==3&&(eye+target).all{it.isFinite()}&&fov.isFinite()&&fov in 1.0..179.0&&cssHeight.isFinite()&&cssHeight in 1.0..10000.0)
        val direction=DoubleArray(3){target[it]-eye[it]};val length=sqrt(direction.sumOf{it*it});require(length>1e-8)
        val focal=cssHeight/(2*tan(fov*PI/360));val changed=mutableMapOf<String,Boolean>()
        for((id,group) in groups){
            val depth=(0..2).sumOf{(group.center[it]-eye[it])*direction[it]/length}
            val pixels=group.width*focal/max(1.0,depth);projectedPixels[id]=pixels
            val full=SceneryLod.full(pixels,levels.getValue(id))
            if(full!=levels[id]){levels[id]=full;changed[id]=full;transitions++}
        }
        return changed
    }
}
