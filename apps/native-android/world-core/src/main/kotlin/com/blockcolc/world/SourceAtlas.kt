package com.blockcolc.world

import org.json.JSONObject

/** The static source UV / tint part is evaluated once per reusable geometry
 * appearance by the producer. Runtime remapping / interpolation stays on GPU. */
data class SourceAtlas(val shape:Boolean,val size:List<Float>,val columns:Float,val cell:Float,
                       val lookup:Int,val blend:Int,val lookupSize:List<Float>,val animated:Boolean=true) {
    fun motion(clearSky:Float)=FloatArray(16).apply{
        this[0]=this@SourceAtlas.size[0];this[1]=this@SourceAtlas.size[1];this[2]=columns;this[3]=cell
        this[4]=lookupSize[0];this[5]=lookupSize[1];this[6]=clearSky
        if(!animated)this[7]=-1f
    }
    companion object {
        fun read(input:JSONObject,shape:Boolean):SourceAtlas {
            fun n(name:String,max:Double):Float{val raw=input.get(name);require(raw is Number);val v=raw.toDouble()
                require(v.isFinite()&&v>=1&&v<=max&&v%1==0.0);return v.toFloat()}
            fun pair(name:String):List<Float>{val a=input.getJSONArray(name);require(a.length()==2);return (0..1).map{
                val v=a.getDouble(it);require(v.isFinite()&&v in 1.0..8192.0&&v%1==0.0);v.toFloat()}}
            fun texture(name:String):Int{val t=input.getJSONObject(name);require(t.length()==1);val id=t.getInt("texture");require(id in 0..4095);return id}
            val size=pair("blockcolcAtlasSize");val lookupSize=pair("blockcolcAnimationLookupSize")
            return SourceAtlas(shape,size,n("blockcolcAtlasColumns",8192.0),n("blockcolcAtlasCellSize",1024.0),
                texture("blockcolcAnimationLookup"),texture("blockcolcAnimationBlendLookup"),lookupSize)
        }
    }
}
