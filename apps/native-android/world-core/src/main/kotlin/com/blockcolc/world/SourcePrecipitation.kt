package com.blockcolc.world

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*

private fun weatherNumber(value:Any,min:Double,max:Double):Double {
    require(value is Number);return value.toDouble().also{require(it.isFinite()&&it in min..max){"Invalid precipitation number"}}
}
private fun weatherVector(value:JSONArray,size:Int,min:Double,max:Double):List<Double> {
    require(value.length()==size);return List(size){weatherNumber(value.get(it),min,max)}
}

data class SourcePrecipitation(val snow:Boolean,val elapsedMs:Double,val base:Double,val span:Double,val speed:Double,
                               val size:Double,val center:List<Double>,val field:List<Double>,val groundTexture:Int,val groundBounds:List<Double>) {
    /** Column-major motion block, read alongside the single visible-time texel. */
    fun motionData(view:WeatherRenderFrame?=null):FloatArray = floatArrayOf(
        elapsedMs.toFloat(),base.toFloat(),span.toFloat(),speed.toFloat(),
        (view?.size?:size).toFloat(),(view?.field?.centerX?:center[0]).toFloat(),(view?.field?.centerZ?:center[1]).toFloat(),0f,
        (view?.field?.spanX?:field[0]).toFloat(),(view?.field?.spanZ?:field[1]).toFloat(),groundBounds[0].toFloat(),groundBounds[1].toFloat(),
        groundBounds[2].toFloat(),groundBounds[3].toFloat(),(view?.count?:0).toFloat(),0f)
    companion object {
        fun read(value:JSONObject,snow:Boolean):SourcePrecipitation {
            fun n(key:String,min:Double,max:Double)=weatherNumber(value.get(key),min,max)
            val ground=value.getJSONObject("weatherGround");val id=weatherNumber(ground.get("texture"),0.0,4095.0)
            require(id==floor(id)&&ground.length()==1)
            val bounds=weatherVector(value.getJSONArray("weatherGroundBounds"),4,-1e6,1e6)
            require(bounds[2]>=.01&&bounds[3]>=.01)
            val field=weatherVector(value.getJSONArray("weatherField"),2,.01,4096.0)
            return SourcePrecipitation(snow,n("weatherElapsed",0.0,1e9),n("weatherBase",-1e4,1e4),n("weatherSpan",.01,1000.0),
                n("weatherSpeed",.001,10.0),n("weatherSize",.001,10.0),weatherVector(value.getJSONArray("weatherCenter"),2,-1e6,1e6),field,id.toInt(),bounds)
        }
    }
}

data class WeatherPopulation(val kind:String,val capacity:Int,val referenceCount:Double,val baseCrossSection:Double)
data class SourceWeatherContext(val bounds:List<Double>,val framing:List<Double>,val groundY:List<Double>,
                                val qualityDensity:Double,val populations:List<WeatherPopulation>) {
    companion object {
        fun read(value:JSONObject):SourceWeatherContext {
            require(value.getInt("schema")==1)
            require(weatherNumber(value.get("rootRotationY"),-1e3,1e3)==0.0){"P1 precipitation requires the source root's frozen zero yaw"}
            val bounds=weatherVector(value.getJSONArray("bounds"),4,-1e6,1e6)
            require(bounds[1]>bounds[0]&&bounds[3]>bounds[2])
            val groundY=weatherVector(value.getJSONArray("groundY"),2,-1e6,1e6);require(groundY[1]>=groundY[0])
            val rows=value.getJSONArray("animations");require(rows.length()<=1){"Mixed rain and snow is outside the current source weather kinds"}
            val populations=List(rows.length()){i->val row=rows.getJSONObject(i);val kind=row.getString("kind");require(kind in setOf("rain","snow"))
                val cap=weatherNumber(row.get("capacity"),1.0,if(kind=="snow")49152.0 else 32768.0);require(cap==floor(cap))
                val active=weatherNumber(row.get("activeCount"),0.0,cap);require(active==floor(active))
                WeatherPopulation(kind,cap.toInt(),weatherNumber(row.get("referenceCount"),.001,1e6),weatherNumber(row.get("baseCrossSection"),.001,10.0))}
            require(populations.map{it.kind}.distinct().size==populations.size)
            return SourceWeatherContext(bounds,weatherVector(value.getJSONArray("framing"),2,.01,1e6),groundY,
                weatherNumber(value.get("qualityDensity"),.001,4.0),populations)
        }
    }
}

data class WeatherField(val centerX:Double,val centerZ:Double,val spanX:Double,val spanZ:Double,val usedFallback:Boolean) {
    fun json()=JSONObject().put("centerX",centerX).put("centerZ",centerZ).put("spanX",spanX).put("spanZ",spanZ).put("usedFallback",usedFallback)
}
data class WeatherFieldInput(val cameraPosition:List<Double>,val cameraDirection:List<Double>,val cameraUp:List<Double>,
    val fovDegrees:Double,val aspect:Double,val near:Double,val far:Double,val rootRotationY:Double,
    val precipitationMinY:Double,val precipitationMaxY:Double,val target:List<Double>,val bounds:List<Double>,
    val minSpanX:Double,val minSpanZ:Double,val maxSpanX:Double,val maxSpanZ:Double,val edgeMargin:Double) {
    init{require(listOf(cameraPosition,cameraDirection,cameraUp,target).all{it.size==3}&&bounds.size==4)}
    companion object {
        fun read(v:JSONObject):WeatherFieldInput {
            fun point(key:String)=v.getJSONObject(key).let{p->listOf(p.getDouble("x"),p.getDouble("y"),p.getDouble("z"))}
            val b=v.getJSONObject("bounds")
            return WeatherFieldInput(point("cameraPosition"),point("cameraDirection"),point("cameraUp"),v.getDouble("fovDegrees"),v.getDouble("aspect"),
                v.getDouble("near"),v.getDouble("far"),v.getDouble("rootRotationY"),v.getDouble("precipitationMinY"),v.getDouble("precipitationMaxY"),point("target"),
                listOf(b.getDouble("minX"),b.getDouble("maxX"),b.getDouble("minZ"),b.getDouble("maxZ")),v.getDouble("minSpanX"),v.getDouble("minSpanZ"),
                v.getDouble("maxSpanX"),v.getDouble("maxSpanZ"),v.getDouble("edgeMargin"))
        }
    }
}
data class WeatherMotion(val phase:Double,val x:Double,val z:Double)
data class WeatherRenderFrame(val field:WeatherField,val count:Int,val size:Double)

/** Literal port of the pure production frustum / volume / motion equations.
 * Its TS oracle is generated from current source, not handwritten expected positions. */
object PrecipitationMath {
    private fun positive(n:Double)=n.isFinite()&&n>0
    private fun clamp(v:Double,low:Double,high:Double)=max(low,min(high,if(v.isFinite())v else (low+high)/2))
    private fun normalized(v:List<Double>):List<Double>? {
        val length=sqrt(v.sumOf{it*it});return if(!length.isFinite()||length<=1e-7)null else v.map{it/length}
    }
    private fun cross(a:List<Double>,b:List<Double>)=listOf(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
    fun field(input:WeatherFieldInput):WeatherField {
        val b=input.bounds;val yaw=if(input.rootRotationY.isFinite())input.rootRotationY else 0.0
        fun local(v:List<Double>)=listOf(cos(yaw)*v[0]-sin(yaw)*v[2],v[1],sin(yaw)*v[0]+cos(yaw)*v[2])
        fun span(lo:Double,hi:Double)=(hi-lo).let{if(it.isFinite())max(0.0,it)else 4096.0}
        fun boundsValid()=b.all{it.isFinite()}&&b[1]>b[0]&&b[3]>b[2]&&span(b[0],b[1])>=.01&&span(b[2],b[3])>=.01
        fun fit(cx:Double,cz:Double,sx:Double,sz:Double,v:WeatherFieldInput,fallback:Boolean,target:List<Double>):WeatherField {
            val maxX=min(v.maxSpanX,max(.01,span(b[0],b[1])));val maxZ=min(v.maxSpanZ,max(.01,span(b[2],b[3])))
            val x=clamp(sx,min(v.minSpanX,maxX),maxX);val z=clamp(sz,min(v.minSpanZ,maxZ),maxZ)
            val tx=if(target[0].isFinite())target[0] else b[0]/2+b[1]/2
            val tz=if(target[2].isFinite())target[2] else b[2]/2+b[3]/2
            return WeatherField(clamp(if(!sx.isFinite()||sx>maxX)tx else if(cx.isFinite())cx else tx,b[0]+x/2,b[1]-x/2),
                clamp(if(!sz.isFinite()||sz>maxZ)tz else if(cz.isFinite())cz else tz,b[2]+z/2,b[3]-z/2),x,z,fallback)
        }
        fun fallback():WeatherField {
            if(!boundsValid())return WeatherField(0.0,0.0,0.0,0.0,true)
            fun maximum(n:Double,s:Double)=min(min(4096.0,max(.01,s)),max(.01,if(positive(n))n else 96.0))
            fun minimum(n:Double)=if(positive(n))min(4096.0,n)else 16.0
            val maxX=maximum(input.maxSpanX,span(b[0],b[1]));val maxZ=maximum(input.maxSpanZ,span(b[2],b[3]))
            val safe=input.copy(minSpanX=min(minimum(input.minSpanX),maxX),minSpanZ=min(minimum(input.minSpanZ),maxZ),maxSpanX=maxX,maxSpanZ=maxZ)
            val target=if(input.target.all{it.isFinite()})local(input.target)else listOf(b[0]/2+b[1]/2,0.0,b[2]/2+b[3]/2)
            return fit(target[0],target[2],safe.minSpanX,safe.minSpanZ,safe,true,target)
        }
        if(!boundsValid()||listOf(input.cameraPosition,input.cameraDirection,input.cameraUp,input.target).any{v->v.any{!it.isFinite()}}
            ||!input.fovDegrees.isFinite()||input.fovDegrees<=0||input.fovDegrees>=179||!positive(input.aspect)
            ||!input.near.isFinite()||input.near<0||!input.far.isFinite()||input.far<=input.near||!input.rootRotationY.isFinite()
            ||!input.precipitationMinY.isFinite()||!input.precipitationMaxY.isFinite()||input.precipitationMaxY<input.precipitationMinY
            ||!positive(input.minSpanX)||!positive(input.minSpanZ)||!positive(input.maxSpanX)||!positive(input.maxSpanZ)
            ||input.maxSpanX<input.minSpanX||input.maxSpanZ<input.minSpanZ||!input.edgeMargin.isFinite()||input.edgeMargin<0)return fallback()
        val eye=local(input.cameraPosition);val dir=normalized(local(input.cameraDirection))?:return fallback()
        val upHint=normalized(local(input.cameraUp))?:return fallback();val right=normalized(cross(dir,upHint))?:return fallback()
        val up=normalized(cross(right,dir))?:return fallback();val tan=tan(input.fovDegrees*PI/360)
        val points=mutableListOf<Pair<Double,Double>>()
        for(y in listOf(-1,1))for(x in listOf(-1,1)) {
            val ray=normalized(List(3){dir[it]+right[it]*x*tan*input.aspect+up[it]*y*tan})?:continue
            val interval=if(abs(ray[1])<=1e-7){if(eye[1]<input.precipitationMinY||eye[1]>input.precipitationMaxY)null else input.near to input.far}
                else {val a=(input.precipitationMinY-eye[1])/ray[1];val c=(input.precipitationMaxY-eye[1])/ray[1]
                    val lo=max(input.near,min(a,c));val hi=min(input.far,max(a,c));if(hi>=lo)lo to hi else null}?:continue
            for(d in listOf(interval.first,interval.second)){
                val px=eye[0]+ray[0]*d;val pz=eye[2]+ray[2]*d;if(px.isFinite()&&pz.isFinite())points+=px to pz
            }
        }
        if(points.size<2)return fallback()
        val minX=points.minOf{it.first}-input.edgeMargin;val maxX=points.maxOf{it.first}+input.edgeMargin
        val minZ=points.minOf{it.second}-input.edgeMargin;val maxZ=points.maxOf{it.second}+input.edgeMargin
        return fit((minX+maxX)/2,(minZ+maxZ)/2,maxX-minX,maxZ-minZ,input,false,local(input.target))
    }
    fun motion(phase:Double,elapsedMs:Double,snow:Boolean,speed:Double=1.0):WeatherMotion {
        require(listOf(phase,elapsedMs,speed).all{it.isFinite()})
        val p=phase-elapsedMs*(if(snow).00022 else .00078*speed);val drift=phase*PI*2+elapsedMs*.00055
        return WeatherMotion(p-floor(p),if(snow)sin(drift)*1.35 else 0.0,if(snow)cos(drift*.72)*.8 else 0.0)
    }
    fun count(reference:Double,density:Double,spanX:Double,spanZ:Double,spanY:Double,capacity:Int):Int {
        if(!listOf(reference,density,spanX,spanZ,spanY,capacity.toDouble()).all{positive(it)})return 0
        return min(capacity,floor(reference*density*spanX*spanZ*spanY/(80*80*40)+.5).toInt().coerceAtLeast(0))
    }
    fun crossSection(base:Double,distance:Double,fov:Double,cssHeight:Double,target:Double,maximum:Double):Pair<Double,Double> {
        val width=if(positive(base))base else .022;val d=if(positive(distance))distance else 1.0
        val height=if(positive(cssHeight))cssHeight else 1.0;val f=if(fov.isFinite()&&fov>0&&fov<179)fov else 34.0
        val px=height/(2*tan(f*PI/360)*d);val scale=clamp((if(positive(target))target else 1.0)/max(.01,width*px),1.0,if(positive(maximum))max(1.0,maximum)else 1.0)
        return scale to width*scale*px
    }
}

/** One terrain resource, nearest sampling, no per-frame height raycasts. */
class GroundHeights(val width:Int,val height:Int,bytes:ByteBuffer) {
    private val data=bytes.asReadOnlyBuffer().slice().order(ByteOrder.LITTLE_ENDIAN)
    init {
        require(width in 1..512&&height in 1..512&&data.remaining()==width*height*4)
        for(i in 0 until width*height)require(data.getFloat(i*4).isFinite()&&abs(data.getFloat(i*4))<=1e6){"Invalid ground height"}
    }
    fun at(u:Double,v:Double):Float {
        require(u.isFinite()&&v.isFinite())
        val x=floor(u*width).toInt().coerceIn(0,width-1);val z=floor(v*height).toInt().coerceIn(0,height-1)
        return data.getFloat((z*width+x)*4)
    }
    fun bytes()=data.asReadOnlyBuffer().order(ByteOrder.LITTLE_ENDIAN)
}

class WeatherFieldState(private val context:SourceWeatherContext) {
    var current:WeatherField?=null;private set
    var syncs=0;private set
    fun update(source:SourcePrecipitation,population:WeatherPopulation,eye:DoubleArray,target:DoubleArray,fov:Double,aspect:Double,
               near:Double,far:Double,cssHeight:Double):WeatherRenderFrame {
        require(eye.size==3&&target.size==3&&(eye.toList()+target.toList()).all{it.isFinite()})
        val maxX=min(4096.0,context.bounds[1]-context.bounds[0]);val maxZ=min(4096.0,context.bounds[3]-context.bounds[2])
        val proposed=PrecipitationMath.field(WeatherFieldInput(eye.toList(),List(3){target[it]-eye[it]},listOf(0.0,1.0,0.0),fov,aspect,near,far,0.0,
            context.groundY[0]+.2,context.groundY[1]+source.base+source.span,target.toList(),context.bounds,
            min(maxX,max(24.0,context.framing[0]*.65)),min(maxZ,max(24.0,context.framing[1]*.65)),maxX,maxZ,6.0))
        val old=current
        if(old==null||abs(old.centerX-proposed.centerX)>=.75||abs(old.centerZ-proposed.centerZ)>=.75
            ||abs(old.spanX-proposed.spanX)>=1||abs(old.spanZ-proposed.spanZ)>=1||old.usedFallback!=proposed.usedFallback){current=proposed;syncs++}
        val field=current!!;val distance=sqrt(eye.indices.sumOf{(eye[it]-target[it]).pow(2)})
        val size=PrecipitationMath.crossSection(population.baseCrossSection,if(source.snow)distance else max(near,distance),fov,cssHeight,
            if(source.snow)1.8 else 1.2,if(source.snow)2.8 else 3.0).first
        return WeatherRenderFrame(field,PrecipitationMath.count(population.referenceCount,context.qualityDensity,field.spanX,field.spanZ,source.span,population.capacity),size)
    }
}
