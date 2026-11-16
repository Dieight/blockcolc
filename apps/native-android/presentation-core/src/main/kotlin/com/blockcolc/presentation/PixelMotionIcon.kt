package com.blockcolc.presentation

import org.json.JSONObject
import kotlin.math.*

data class PixelMotionLayer(val part:String,val path:String,val background:Boolean)
data class PixelTransform(val x:Float=0f,val y:Float=0f,val scaleX:Float=1f,val scaleY:Float=1f,val rotation:Float=0f,
    val rotationX:Float=0f,val skewX:Float=0f,val perspective:Float=32f,val opacity:Float=1f)
data class PixelMotionFrame(val offset:Float,val value:PixelTransform)
class PixelMotionSpec(val frames:List<PixelMotionFrame>,val originX:Float,val originY:Float,val delay:Int,val duration:Int,val easeOut:Boolean){
    fun at(milliseconds:Float):PixelTransform{
        val raw=((milliseconds-delay)/duration).coerceIn(0f,1f)
        val t=if(easeOut)curve(raw,.0f,.0f,.58f,1f)else curve(raw,.2f,.7f,.3f,1f)
        val end=frames.indexOfFirst{it.offset>=t}.let{if(it<1)1 else it};val a=frames[end-1];val b=frames[end]
        val u=if(b.offset==a.offset)1f else ((t-a.offset)/(b.offset-a.offset)).coerceIn(0f,1f)
        fun lerp(x:Float,y:Float)=x+(y-x)*u
        val x=a.value;val y=b.value
        return PixelTransform(lerp(x.x,y.x),lerp(x.y,y.y),lerp(x.scaleX,y.scaleX),lerp(x.scaleY,y.scaleY),lerp(x.rotation,y.rotation),
            lerp(x.rotationX,y.rotationX),lerp(x.skewX,y.skewX),lerp(x.perspective,y.perspective),lerp(x.opacity,y.opacity))
    }
    companion object{
        private fun curve(t:Float,x1:Float,y1:Float,x2:Float,y2:Float):Float{
            fun bez(u:Float,a:Float,b:Float)=3*(1-u)*(1-u)*u*a+3*(1-u)*u*u*b+u*u*u
            var low=0f;var high=1f;repeat(16){val middle=(low+high)/2;if(bez(middle,x1,x2)<t)low=middle else high=middle}
            return if(t==0f||t==1f)t else bez((low+high)/2,y1,y2)
        }
    }
}

/** Finite layers/frames come from the production SVG and motion function.
 * Parsing rejects unsupported transform syntax instead of silently dropping it. */
class PixelMotionIcon private constructor(val minX:Float,val minY:Float,val width:Float,val height:Float,val layers:List<PixelMotionLayer>,val motions:Map<String,PixelMotionSpec>){
    companion object{
        private val function=Regex("([A-Za-z]+)\\(([^)]*)\\)")
        private fun number(raw:String)=raw.trim().removeSuffix("px").removeSuffix("deg").toFloat().also{require(it.isFinite()&&abs(it)<=10000f)}
        internal fun transform(raw:String,opacity:Float):PixelTransform{
            if(raw=="none"||raw.isBlank())return PixelTransform(opacity=opacity)
            var value=PixelTransform(opacity=opacity)
            val parsed=function.findAll(raw).toList();require(parsed.isNotEmpty()&&function.replace(raw,"").isBlank())
            for(match in parsed){val args=match.groupValues[2].split(',').map(::number)
                value=when(match.groupValues[1]){
                    "translate"->value.copy(x=args[0],y=args.getOrElse(1){0f})
                    "translateX"->value.copy(x=args.single());"translateY"->value.copy(y=args.single())
                    "scale"->value.copy(scaleX=args[0],scaleY=args.getOrElse(1){args[0]})
                    "scaleX"->value.copy(scaleX=args.single());"scaleY"->value.copy(scaleY=args.single())
                    "rotate"->value.copy(rotation=args.single());"rotateX"->value.copy(rotationX=args.single())
                    "skewX"->value.copy(skewX=args.single());"perspective"->value.copy(perspective=args.single().also{require(it>0)})
                    else->error("Unsupported pixel icon motion ${match.groupValues[1]}")
                }
            }
            return value
        }
        fun read(row:JSONObject):PixelMotionIcon{
            val view=row.getJSONArray("viewBox");require(view.length()==4)
            val minX=view.getDouble(0).toFloat();val minY=view.getDouble(1).toFloat();require(minX.isFinite()&&minY.isFinite()&&abs(minX)<=64&&abs(minY)<=64)
            val w=view.getDouble(2).toFloat();val h=view.getDouble(3).toFloat();require(w in 1f..64f&&h in 1f..64f)
            val raw=row.getJSONArray("layers");require(raw.length() in 1..64)
            val layers=List(raw.length()){i->val x=raw.getJSONObject(i);PixelMotionLayer(x.getString("part"),x.getString("path").also{require(it.length<=32768)},x.getBoolean("background"))}
            val specs=row.getJSONObject("motions");require(specs.length()<=64)
            val motions=specs.keys().asSequence().associateWith{key->val x=specs.getJSONObject(key);val a=x.getJSONArray("keyframes");require(a.length() in 2..16)
                val frames=List(a.length()){i->val f=a.getJSONObject(i);val offset=f.optDouble("offset",i.toDouble()/(a.length()-1)).toFloat();require(offset in 0f..1f)
                    PixelMotionFrame(offset,transform(f.optString("transform","none"),f.optDouble("opacity",1.0).toFloat().also{require(it in 0f..1f)}))}
                require(frames.first().offset==0f&&frames.last().offset==1f&&frames.zipWithNext().all{it.first.offset<=it.second.offset})
                val origin=x.getString("origin").split(' ').filter{it.isNotBlank()};require(origin.size==2)
                fun axis(raw:String,minimum:Float,size:Float)=if(raw.endsWith('%'))minimum+number(raw.removeSuffix("%"))*size/100 else number(raw)
                val delay=x.getInt("delay");val duration=x.getInt("duration");require(delay in 0..900&&duration in 1..900)
                PixelMotionSpec(frames,axis(origin[0],minX,w),axis(origin[1],minY,h),delay,duration,x.optString("easing")=="ease-out")
            }
            return PixelMotionIcon(minX,minY,w,h,java.util.Collections.unmodifiableList(layers),java.util.Collections.unmodifiableMap(motions))
        }
    }
}
