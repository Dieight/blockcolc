package com.blockcolc.world

import org.json.JSONObject
import org.json.JSONArray
import java.security.MessageDigest
import kotlin.math.*

data class AtlasFrame(val index:Int,val ticks:Long)
data class AtlasSequence(val index:Int,val total:Long,val interpolate:Boolean,val frames:List<AtlasFrame>)
class AtlasTimeline(val identity:String,val texture:Int,val blendTexture:Int,val width:Int,val height:Int,val tileCount:Int,
                    val sequences:List<AtlasSequence>,val active:Set<Int>) {
    val pixels=ByteArray(width*height*4)
    val blendPixels=ByteArray(width*height*4)
    var dirty=true;private set
    var changes=0;private set
    init {
        for(i in 0 until tileCount){write(i,i,i,0)}
        sample(0.0,true);changes=0
    }
    private fun write(index:Int,current:Int,next:Int,mix:Int):Boolean {
        val at=index*4;val p=intArrayOf(current and 255,current ushr 8,next and 255,next ushr 8)
        var changed=false
        for(k in 0..3)if(pixels[at+k]!=(p[k].toByte())){pixels[at+k]=p[k].toByte();changed=true}
        if(blendPixels[at]!=mix.toByte()){blendPixels[at]=mix.toByte();changed=true}
        blendPixels[at+3]=255.toByte();return changed
    }
    fun sample(elapsedMs:Double,freeze:Boolean=false):Boolean {
        require(elapsedMs.isFinite()&&abs(elapsedMs)<=1e15)
        val ticks=max(0.0,elapsedMs)/50;var changed=false
        for(s in sequences)if(s.index in active){
            var current=s.frames.first().index;var next=current;var mix=0
            if(!freeze){val phase=ticks%s.total.toDouble();var start=0L
                for((index,f)in s.frames.withIndex()){val end=start+f.ticks
                    if(phase<end){current=f.index;next=if(s.interpolate)s.frames[(index+1)%s.frames.size].index else current
                        mix=if(s.interpolate)floor(((phase-start)/f.ticks).coerceIn(0.0,1.0)*255+.5).toInt()else 0;break};start=end}
            }
            changed=write(s.index,current,next,mix)||changed
        }
        if(changed){dirty=true;changes++};return changed
    }
    fun uploaded(){dirty=false}
    companion object {
        fun hash(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
        fun read(d:JSONObject):AtlasTimeline {
            require(d.getInt("schema")==1)
            fun integer(o:JSONObject,key:String,min:Long,max:Long):Long {val raw=o.get(key);require(raw is Number)
                val n=raw.toDouble();require(n.isFinite()&&n>=min&&n<=max&&n%1==0.0);return n.toLong()}
            val width=integer(d,"width",1,8192).toInt();val height=integer(d,"height",1,8192).toInt()
            val count=integer(d,"tileCount",1,65536).toInt();require(height==(count+width-1)/width&&width*height<=73727)
            val rows=d.getJSONArray("sequences");require(rows.length() in 1..256)
            val sequences=List(rows.length()){i->val s=rows.getJSONObject(i)
                val fs=s.getJSONArray("frames");require(fs.length() in 2..4096)
                val frames=List(fs.length()){j->val f=fs.getJSONObject(j);AtlasFrame(integer(f,"textureIndex",0,(count-1).toLong()).toInt(),integer(f,"time",1,1000000))}
                require(s.get("interpolate") is Boolean)
                val total=integer(s,"totalTicks",1,4096000000);require(total==frames.sumOf{it.ticks})
                AtlasSequence(integer(s,"textureIndex",0,(count-1).toLong()).toInt(),total,s.getBoolean("interpolate"),frames)}
            require(sequences.map{it.index}.distinct().size==sequences.size)
            val activeRaw=d.getJSONArray("activeTextureIndices");require(activeRaw.length()<=65536)
            val active=List(activeRaw.length()){i->val n=activeRaw.get(i);require(n is Number&&n.toDouble()%1==0.0&&n.toDouble() in 0.0..(count-1).toDouble());n.toInt()}.toSet()
            val page=if(d.has("page"))integer(d,"page",0,15).toInt()else 0
            val code="$page/$width/$height/$count;"+sequences.joinToString(";"){s->"${s.index}:${s.total}:${if(s.interpolate)1 else 0}:"+s.frames.joinToString("/"){"${it.index},${it.ticks}"}}
            val identity=d.getString("identity");require(hash(code.toByteArray(Charsets.UTF_8))==identity){"Atlas schedule identity changed"}
            val result=AtlasTimeline(identity,integer(d,"texture",0,4095).toInt(),integer(d,"blendTexture",0,4095).toInt(),width,height,count,sequences,active)
            require(result.texture!=result.blendTexture)
            require(hash(result.pixels)==d.getString("lookupPixelsSha256")&&hash(result.blendPixels)==d.getString("blendPixelsSha256")){"Atlas frozen lookup differs from actual source"}
            return result
        }
        fun readAll(metadata:JSONObject):List<AtlasTimeline>{val rows=metadata.optJSONArray("atlasAnimations")?:return emptyList()
            require(rows.length()<=16);return List(rows.length()){read(rows.getJSONObject(it))}.also{list->
                require(list.map{it.texture}.distinct().size==list.size&&list.map{it.blendTexture}.distinct().size==list.size)
            }}
    }
}
