package com.blockcolc.world

import com.blockcolc.world.generation.BlockPoint
import java.util.Collections
import kotlin.math.abs
import kotlin.math.max

data class NativeStormWeather(val thunderstorm:Boolean,val seed:Long) {
    init {require(seed in 0..0xffffffffL)}
}

data class NativeStormContext(val center:BlockPoint,val contentWidth:Double,val contentDepth:Double,val cloudBaseY:Double,val preview:Boolean=false) {
    init {
        require(listOf(center.x,center.y,center.z,cloudBaseY).all{it.isFinite()&&abs(it)<999_000})
        require(listOf(contentWidth,contentDepth).all{it.isFinite()&&it in 0.0..1_999_000.0})
        require(topY>bottomY)
    }
    val width get()=contentWidth.coerceIn(8.0,20.0)
    val depth get()=contentDepth.coerceIn(8.0,20.0)
    val topY get()=max(24.0,cloudBaseY+3)
    val bottomY get()=max(0.0,center.y-1)
}

class NativeLightningBurst internal constructor(val index:Long,val startedAtMs:Double,val seedState:Long,
    val flashPosition:BlockPoint,vertices:List<BlockPoint>) {
    val vertices:List<BlockPoint> = Collections.unmodifiableList(vertices.toList())
}

data class NativeStormFrame(val burst:NativeLightningBurst?,val opacity:Double,val flashIntensity:Double) {
    companion object {val NONE=NativeStormFrame(null,0.0,0.0)}
}

/** Render-owner state. Only an explicitly confirmed thunderstorm can strike.
 * Pausing clears a visible bolt, doesn't consume random values, and never
 * replays missed strikes in a burst. No world geometry or business state here. */
class NativeStormRuntime(val context:NativeStormContext):AutoCloseable {
    private var weather:NativeStormWeather?=null
    private var random:NativeRandom32?=null
    private var burst:NativeLightningBurst?=null
    private var closed=false;private var lastAt=0.0
    var strikeCount=0L;private set
    var nextStrikeAtMs=Double.POSITIVE_INFINITY;private set
    val enabled get()=!closed&&weather?.thunderstorm==true&&!context.preview
    private fun time(value:Double){require(value.isFinite()&&value>=lastAt&&value<=1e12);lastAt=value}
    fun configure(value:NativeStormWeather,elapsedMs:Double){
        check(!closed);time(elapsedMs);if(value==weather)return
        weather=value;burst=null
        random=NativeRandom32(value.seed xor 0x51e7b017L)
        nextStrikeAtMs=if(value.thunderstorm&&!context.preview)elapsedMs+1600+random!!.next()*1600 else Double.POSITIVE_INFINITY
    }
    fun update(elapsedMs:Double,motionAllowed:Boolean):NativeStormFrame {
        if(closed)return NativeStormFrame.NONE
        time(elapsedMs)
        if(weather?.thunderstorm!=true||context.preview||!motionAllowed){burst=null;return NativeStormFrame.NONE}
        if(elapsedMs>=nextStrikeAtMs){
            val generator=checkNotNull(random);val seed=generator.state
            val x=context.center.x+(generator.next()-.5)*context.width
            val z=context.center.z+(generator.next()-.5)*context.depth
            val vertices=List(9){index->
                val fraction=index/8.0;val wander=(1-fraction)*2.8
                BlockPoint(x+(generator.next()-.5)*wander,context.topY+(context.bottomY-context.topY)*fraction,z+(generator.next()-.5)*wander)
            }
            strikeCount++;burst=NativeLightningBurst(strikeCount,elapsedMs,seed,BlockPoint(x,context.bottomY+6,z),vertices)
            nextStrikeAtMs=elapsedMs+7000+generator.next()*8000
        }
        val active=burst?:return NativeStormFrame.NONE
        val age=elapsedMs-active.startedAtMs
        if(age>1450){burst=null;return NativeStormFrame.NONE}
        val core=if(age<180)1.0 else 0.0;val afterglow=max(0.0,1-age/1450)
        return NativeStormFrame(active,.12+core*.84+(1-core)*afterglow*.28,core*2.3+afterglow*.28)
    }
    override fun close(){closed=true;burst=null;weather=null;random=null;nextStrikeAtMs=Double.POSITIVE_INFINITY}
}
