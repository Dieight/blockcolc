package com.blockcolc.world

import java.util.Collections
import kotlin.math.*

enum class NativeCloudKind(val wire:String){CIRRUS("cirrus"),CUMULUS("cumulus"),ALTOCUMULUS("altocumulus"),STRATUS("stratus"),STORM("storm"),BANK("bank")}
enum class NativeCloudRegion(val wire:String){NEAR("near"),FAR("far")}
data class NativeCloudView(val contentWidth:Double,val contentDepth:Double,val visibleWidth:Double,val visibleDepth:Double,
    val normalWidth:Double=Double.NaN,val normalDepth:Double=Double.NaN,val preview:Boolean=false)
data class NativeCloudBudget(val cloudCount:Int,val maxInstances:Int,val blockScale:Double,val spanX:Double,val spanZ:Double,
    val nearSpanX:Double,val nearSpanZ:Double,val nearCloudCount:Int,val farCloudCount:Int,val farBlockScale:Double,val previewMode:Boolean)
data class NativeCloudGroup(val region:NativeCloudRegion,val kind:NativeCloudKind,val x:Double,val z:Double,val blocks:Int,val horizontalScale:Double)
data class NativeCloudVoxel(val x:Int,val y:Int,val z:Int)

/** The current formal layout/shape recipe in native world coordinates. View
 * extent is physical terrain extent, never the camera's current zoom. */
object NativeCloudLayout {
    private fun positive(value:Double,fallback:Double)=if(value.isFinite()&&value>0)value else fallback
    fun budget(view:NativeCloudView,weather:NativeWeather,density:Double=1.0):NativeCloudBudget {
        val cw=positive(view.contentWidth,18.0);val cd=positive(view.contentDepth,18.0)
        val vw=positive(view.visibleWidth,cw);val vd=positive(view.visibleDepth,cd)
        val d=max(0.0,if(density.isFinite())density else 1.0);val count=max(0,weather.cloudCount)
        if(view.preview){val span=max(cw,cd);val n=if(count==0)0 else min(4,max(1,ceil(span/18).toInt()))
            val x=max(12.0,cw*1.15);val z=max(10.0,cd*1.15)
            return NativeCloudBudget(n,min(80,max(12,n*8)),(span/60).coerceIn(.2,.65),x,z,x,z,n,0,1.0,true)
        }
        val compact=vw<cw*2.2&&vd<cd*2.2;val spread=min(24.0,max(1.0,vw*vd/max(1.0,cw*cd)))
        val kindDensity=when(weather.kind){NativeWeatherKind.CLEAR->.6;NativeWeatherKind.CLOUDY->1.6;NativeWeatherKind.RAIN->1.4;NativeWeatherKind.MIST->.45;NativeWeatherKind.SNOW->1.15}
        val x=if(compact)max(32.0,vw*1.05)else max(32.0,vw+24);val z=if(compact)max(28.0,vd*1.05)else max(28.0,vd+24)
        val nx=min(x,positive(view.normalWidth,max(100.0,cw*1.6+100)));val nz=min(z,positive(view.normalDepth,max(100.0,cd*1.6+100)))
        val nearArea=nx*nz;val farArea=max(0.0,x*z-nearArea)
        val base=if(count==0||d==0.0)0 else min(if(compact)64 else 128,max(1,floor(count*d*sqrt(spread)*kindDensity+.5).toInt()))
        val far=farArea>nearArea*.15;val nearCount=if(base==0)0 else max(1,floor(base*if(far).48 else .8).toInt())
        val farCount=if(far)max(nearCount,base-nearCount)else 0
        return NativeCloudBudget(nearCount+farCount,1600,1.0,x,z,nx,nz,nearCount,farCount,
            if(farCount==0)1.0 else sqrt(farArea/nearArea*nearCount/farCount).coerceIn(1.0,6.0),false)
    }
    class Generator(seed:Long,zeroToOne:Boolean=true) {
        private val random=NativeRandom32(seed,zeroToOne)
        val state:Long get()=random.state
        fun next()=random.next()
    }
    fun random(seed:Long):()->Double=Generator(seed)::next
    private fun fract(value:Double)=value-floor(value)
    private fun inverse(value:Int,base:Int):Double {var digit=value;var divisor=base.toDouble();var result=0.0
        while(digit>0){result+=(digit%base)/divisor;digit/=base;divisor*=base};return result}
    private fun kind(weather:NativeWeather,roll:Double):NativeCloudKind=when{
        weather.thunderstorm->if(roll<.94)NativeCloudKind.STORM else NativeCloudKind.STRATUS
        weather.kind==NativeWeatherKind.RAIN->if(roll<.68)NativeCloudKind.STORM else if(roll<.88)NativeCloudKind.CUMULUS else NativeCloudKind.STRATUS
        weather.kind==NativeWeatherKind.MIST->if(roll<.88)NativeCloudKind.STRATUS else NativeCloudKind.CIRRUS
        weather.kind==NativeWeatherKind.SNOW->if(roll<.7)NativeCloudKind.STRATUS else NativeCloudKind.CUMULUS
        weather.kind==NativeWeatherKind.CLOUDY->if(roll<.4)NativeCloudKind.STRATUS else if(roll<.65)NativeCloudKind.ALTOCUMULUS else if(roll<.88)NativeCloudKind.CUMULUS else NativeCloudKind.CIRRUS
        else->if(roll<.38)NativeCloudKind.CIRRUS else if(roll<.7)NativeCloudKind.CUMULUS else NativeCloudKind.ALTOCUMULUS
    }
    private fun farPoint(b:NativeCloudBudget,pick:Double,u:Double,v:Double):Pair<Double,Double>{
        val hx=b.spanX/2;val hz=b.spanZ/2;val nx=b.nearSpanX/2;val nz=b.nearSpanZ/2
        val strips=listOf(doubleArrayOf(-hx,-nx,-hz,hz),doubleArrayOf(nx,hx,-hz,hz),doubleArrayOf(-nx,nx,-hz,-nz),doubleArrayOf(-nx,nx,nz,hz))
        val areas=strips.map{(it[1]-it[0])*(it[3]-it[2])};var remaining=pick*areas.sum()
        for(i in strips.indices){if(areas[i]<=0)continue
            if(remaining<areas[i]||i==strips.lastIndex){val s=strips[i];return s[0]+(s[1]-s[0])*u to s[2]+(s[3]-s[2])*v};remaining-=areas[i]}
        return 0.0 to 0.0
    }
    fun groups(b:NativeCloudBudget,weather:NativeWeather,random:()->Double):List<NativeCloudGroup>{
        require(b.cloudCount in 0..128&&b.nearCloudCount+b.farCloudCount==b.cloudCount)
        val result=ArrayList<NativeCloudGroup>();var ni=0;var fi=0;var used=0
        val sx=random();val sz=random();val strip=random()
        for(index in 0 until b.cloudCount){
            val region=if(ceil((index+1).toDouble()*b.nearCloudCount/b.cloudCount)>ni)NativeCloudRegion.NEAR else NativeCloudRegion.FAR
            val group=if(region==NativeCloudRegion.NEAR)ni++ else fi++
            var kind=kind(weather,random());val overcast=weather.kind in setOf(NativeWeatherKind.CLOUDY,NativeWeatherKind.RAIN,NativeWeatherKind.SNOW)
            if(!b.previewMode&&region==NativeCloudRegion.FAR&&overcast&&group%3==0)kind=NativeCloudKind.BANK
            if(region==NativeCloudRegion.NEAR&&weather.kind!=NativeWeatherKind.CLOUDY&&!b.previewMode)
                kind=if(weather.thunderstorm||weather.kind==NativeWeatherKind.RAIN)NativeCloudKind.STORM else if(weather.kind==NativeWeatherKind.SNOW)NativeCloudKind.CUMULUS else NativeCloudKind.CIRRUS
            val blocks=if(b.previewMode)if(kind==NativeCloudKind.CIRRUS)3+floor(random()*3).toInt()else 4+floor(random()*4).toInt()
                else if(region==NativeCloudRegion.NEAR&&weather.kind!=NativeWeatherKind.CLOUDY)5+floor(random()*3).toInt()
                else when(kind){NativeCloudKind.BANK->22+floor(random()*8).toInt();NativeCloudKind.CIRRUS->5+floor(random()*3).toInt();NativeCloudKind.STRATUS,NativeCloudKind.STORM->10+floor(random()*5).toInt();else->8+floor(random()*4).toInt()}
            if(used+blocks>b.maxInstances)break
            val point=if(b.previewMode){val angle=random()*PI*2;val radius=.03+.38*random().pow(2.4);cos(angle)*b.spanX*.5*radius to sin(angle)*b.spanZ*.5*radius}
                else if(region==NativeCloudRegion.NEAR){val f=if(group<3).22 else 1.0;(fract(inverse(group+1,2)+sx)-.5)*b.nearSpanX*f to (fract(inverse(group+1,3)+sz)-.5)*b.nearSpanZ*f}
                else farPoint(b,fract(inverse(group+1,5)+strip),fract(inverse(group+1,2)+sx),fract(inverse(group+1,3)+sz))
            result+=NativeCloudGroup(region,kind,point.first,point.second,blocks,if(region==NativeCloudRegion.FAR&&weather.kind!=NativeWeatherKind.CLEAR)b.farBlockScale else 1.0);used+=blocks
        }
        return Collections.unmodifiableList(result)
    }
    fun voxels(kind:NativeCloudKind,variant:Int):List<NativeCloudVoxel>{
        var seed=variant;fun random():Double{seed=seed*1664525+1013904223;return(seed.toLong() and 0xffffffffL)/4294967296.0}
        val lobes=ArrayList<DoubleArray>()
        fun lobe(x:Double,y:Double,z:Double,rx:Double,ry:Double,rz:Double){lobes+=doubleArrayOf(x,y,z,rx,ry,rz)}
        when(kind){
            NativeCloudKind.CIRRUS->for(i in 0..4)lobe(-5+i*2.5,1+i*.2,sin(i*.9)*.8,2.5,1.05,1.25)
            NativeCloudKind.STRATUS,NativeCloudKind.BANK->{val columns=if(kind==NativeCloudKind.BANK)5 else 3
                for(x in 0 until columns)for(z in 0..2)lobe((x-(columns-1)/2.0)*3,1+random()*.4,(z-1)*2.2,3.2,1.2+random()*.6,2.7)}
            NativeCloudKind.ALTOCUMULUS->for(x in 0..3)for(z in 0..1)lobe((x-1.5)*3.1,1+random(),(z-.5)*3,2.4,1.7+random(),2.1)
            else->{lobe(0.0,1.2,0.0,5.1,1.8,3.6)
                for(i in 0..4)lobe((i-2)*1.8,2+random()*1.3,(random()-.5)*3,2.6+random(),2.3+random()*1.4,2.5)
                if(kind==NativeCloudKind.STORM){lobe(.5,4.0,0.0,3.4,4.1,3.1);lobe(1.5,7.2,.4,5.6,1.4,3.8)}}
        }
        val occupied=BooleanArray(23*13*12)
        fun index(x:Int,y:Int,z:Int)=((y+1)*13+(z+6))*23+x+11
        fun has(x:Int,y:Int,z:Int)=x in -11..11&&y in -1..10&&z in -6..6&&occupied[index(x,y,z)]
        for(y in -1..10)for(z in -6..6)for(x in -11..11)if(lobes.any{l->val dx=(x-l[0])/l[3];val dy=(y-l[1])/l[4];val dz=(z-l[2])/l[5];dx*dx+dy*dy+dz*dz<=1})occupied[index(x,y,z)]=true
        val result=ArrayList<NativeCloudVoxel>()
        for(y in -1..10)for(z in -6..6)for(x in -11..11)if(has(x,y,z)&&(!has(x+1,y,z)||!has(x-1,y,z)||!has(x,y+1,z)||!has(x,y-1,z)||!has(x,y,z+1)||!has(x,y,z-1)))result+=NativeCloudVoxel(x,y,z)
        return Collections.unmodifiableList(result)
    }
    fun drawCount(groupEnds:List<Int>,density:Double):Int{
        if(groupEnds.isEmpty()||!density.isFinite()||density<=0)return 0
        require(groupEnds.first()>0&&groupEnds.zipWithNext().all{it.first<it.second})
        val target=groupEnds.last()*min(1.0,density);var count=groupEnds.first()
        for(end in groupEnds){if(end>target)break;count=end};return count
    }
    fun speed(weather:NativeWeather):Double {
        val base=when(weather.kind){NativeWeatherKind.CLEAR->.08;NativeWeatherKind.CLOUDY->.22;NativeWeatherKind.RAIN->if(weather.thunderstorm).72 else .38;NativeWeatherKind.MIST->.04;NativeWeatherKind.SNOW->.15}
        return base*(.72+.28*sqrt(if(weather.cloudIntensity.isFinite())weather.cloudIntensity.coerceIn(0.0,1.0)else 0.0))
    }
}
