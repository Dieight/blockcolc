package com.blockcolc.world

import org.json.JSONObject

data class SourceWorldColor(val saturation:Int=100,val brightness:Int=100,val contrast:Int=100) {
    init {require(saturation in 50..150&&brightness in 80..120&&contrast in 80..120)}
    val neutral get()=saturation==100&&brightness==100&&contrast==100
}

data class SourcePost(val bloom:Boolean,val threshold:Float,val knee:Float,val strength:Float,val samples:Int,val worldColor:SourceWorldColor=SourceWorldColor(),val direct:Boolean=false) {
    init {require(listOf(threshold,knee,strength).all{it.isFinite()&&it in 0f..1f}&&samples in setOf(0,2,4));require(!direct||!bloom)}
    val sceneSamples get()=if(bloom||direct)samples.coerceAtLeast(1)else 1
    companion object {
        val NONE=SourcePost(false,.72f,.22f,0f,0)
        // The source default framebuffer requests antialias:true (4 samples on
        // the GLES3 reference), whereas its explicit bloom target is bounded to 2.
        fun native(quality:NativeLightingQuality)=if(quality==NativeLightingQuality.HIGH)SourcePost(true,.72f,.22f,.32f,2)else NONE.copy(direct=true,samples=4)
        fun read(pipeline:JSONObject):SourcePost {
            val b=pipeline.getJSONObject("bloom");val enabled=b.get("enabled");require(enabled is Boolean)
            fun n(key:String):Float{val raw=b.get(key);require(raw is Number);val v=raw.toDouble();require(v.isFinite()&&v in 0.0..1.0);return v.toFloat()}
            val count=b.get("sampleCount");require(count is Number&&count.toDouble() in listOf(0.0,2.0))
            require(n("scale")==.5f)
            val c=pipeline.getJSONObject("worldColor")
            fun color(key:String):Int {val value=c.get(key);require(value is Number);val v=value.toDouble();require(v.isFinite()&&v==v.toInt().toDouble());return v.toInt()}
            return SourcePost(enabled,n("threshold"),n("softKnee"),n("strength"),count.toInt(),SourceWorldColor(color("saturation"),color("brightness"),color("contrast")))
        }
    }
}
