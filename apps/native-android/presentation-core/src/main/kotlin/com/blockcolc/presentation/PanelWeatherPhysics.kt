package com.blockcolc.presentation

import kotlin.math.*

/** Glass-local coordinates are density-independent. These are the formal
 * panel's physics and intensity rules, not a second provider-weather remap. */
data class GlassRaindrop(
    val x:Double,val y:Double,val vx:Double,val vy:Double,
    val radius:Double,val age:Double,val holdSeconds:Double?=null,
)
data class PanelRainProfile(
    val maxDrops:Int,val staticDrops:Int,val spawnIntervalMs:Int,val opacity:Double,
    val radiusMin:Double,val radiusMax:Double,val holdSecondsMin:Double,
    val holdSecondsMax:Double,val terminalSpeed:Double,val trailScale:Double,
)
data class PanelSnowProfile(val tier:String,val depth:Double)

object PanelWeatherPhysics {
    const val MAX_DROPS=24
    const val MAX_FLAKES=48
    const val AFTERIMAGE_MS=1650.0
    fun intensity(value:Double)=if(value.isFinite())value.coerceIn(0.0,1.0)else 0.0
    fun rainProfile(value:Double):PanelRainProfile {
        val i=intensity(value)
        fun mix(a:Double,b:Double)=a+(b-a)*i
        return PanelRainProfile(
            floor(5+19*i+.5).toInt().coerceIn(5,MAX_DROPS),
            floor(2+6*i+.5).toInt().coerceIn(3,8),floor(mix(1350.0,380.0)+.5).toInt(),
            mix(.7,.92),mix(1.4,1.9),mix(3.0,4.2),mix(1.5,.35),mix(4.0,1.5),
            mix(12.0,28.0),mix(.42,.9),
        )
    }
    fun snowProfile(value:Double):PanelSnowProfile=when(val i=intensity(value)){
        in 0.0..<.12->PanelSnowProfile("thin",3.0)
        in .12..<.34->PanelSnowProfile("low",7.0)
        in .34..<.68->PanelSnowProfile("medium",12.0)
        else->PanelSnowProfile("high",20.0)
    }
    fun advance(drops:List<GlassRaindrop>,deltaSeconds:Double,panelHeight:Double,terminalSpeed:Double=16.0):List<GlassRaindrop>{
        val dt=if(deltaSeconds.isFinite())deltaSeconds.coerceIn(0.0,.05)else 0.0
        val height=if(panelHeight.isFinite())max(0.0,panelHeight)else 0.0
        val terminal=if(terminalSpeed.isFinite())terminalSpeed.coerceIn(1.0,34.0)else 16.0
        return drops.take(MAX_DROPS).mapNotNull { drop->
            if(!listOf(drop.x,drop.y,drop.radius,drop.age).all{it.isFinite()})return@mapNotNull null
            val vxStart=if(drop.vx.isFinite())drop.vx else 0.0
            val vyStart=if(drop.vy.isFinite())drop.vy else 0.0
            val radius=drop.radius.coerceIn(.1,4.8);val age=drop.age+dt
            if(age>32||drop.y>height+radius*2)return@mapNotNull null
            val sliding=age>(drop.holdSeconds?:.8)
            val gravity=if(sliding)28+drop.radius*5 else 0.0
            val vy=if(sliding)min(terminal,(vyStart+gravity*dt)*exp(-1.18*dt))else vyStart*exp(-3.2*dt)
            val vx=vxStart*exp(-2.4*dt)
            drop.copy(x=drop.x+vx*dt,y=drop.y+vy*dt,vx=vx,vy=vy,age=age,
                radius=min(4.8,radius+dt*if(sliding).018 else .006))
        }
    }
    fun merge(drops:List<GlassRaindrop>):List<GlassRaindrop>{
        val result=drops.take(MAX_DROPS).toMutableList()
        for(index in result.indices){
            if(index>=result.size)break
            var first=result[index];var other=index+1
            while(other<result.size){
                val second=result[other]
                if(hypot(first.x-second.x,first.y-second.y)>(first.radius+second.radius)*.72){other++;continue}
                val area1=first.radius*first.radius;val area2=second.radius*second.radius;val total=area1+area2
                first=first.copy(x=(first.x*area1+second.x*area2)/total,y=(first.y*area1+second.y*area2)/total,
                    radius=min(4.8,sqrt(total)),vx=(first.vx*area1+second.vx*area2)/total,
                    vy=max(first.vy,second.vy),age=max(first.age,second.age),
                    holdSeconds=minOf(first.holdSeconds?:.8,second.holdSeconds?:.8,first.age+.12))
                result[index]=first;result.removeAt(other)
            }
        }
        return result
    }
    fun lightningOpacity(ageMs:Double):Double=when{
        !ageMs.isFinite()||ageMs<0||ageMs>AFTERIMAGE_MS->0.0
        ageMs<45->.8*ageMs/45
        ageMs<165->.8
        else->.5*(1-(ageMs-165)/(AFTERIMAGE_MS-165)).pow(.8)
    }
}

data class PanelSnowflake(val x:Double,val y:Double,val radius:Double,val speed:Double,val drift:Double,val phase:Double)
data class PanelLightning(val startedAt:Double,val x:Double,val endY:Double,val offsets:List<Double>)
data class PanelWeatherFrame(
    val drops:List<GlassRaindrop> = emptyList(),val flakes:List<PanelSnowflake> = emptyList(),
    val lightning:PanelLightning?=null,val lightningAgeMs:Double=0.0,
)

/** One bounded owner per visible panel. Pausing simply stops step calls;
 * resumed time never catches up missed precipitation or old lightning. */
class PanelWeatherSimulation(
    private val snow:Boolean,visualIntensity:Double,private val seed:Int,private val thunderstorm:Boolean,
){
    private val intensity=PanelWeatherPhysics.intensity(visualIntensity)
    val rainProfile=PanelWeatherPhysics.rainProfile(intensity)
    private class Random(seed:Int){
        private var state=if(seed!=0)seed else 0x26c0ffee
        fun next():Double {state=state xor(state shl 13);state=state xor(state ushr 17);state=state xor(state shl 5);return (state.toLong() and 0xffffffffL)/4294967296.0}
    }
    private val random=Random(seed xor floor(intensity*1_000_000+.5).toInt())
    private var elapsed=0.0;private var nextDrop=0.0
    private var nextLightning=if(thunderstorm)1600+random.next()*1600 else Double.POSITIVE_INFINITY
    private var drops=emptyList<GlassRaindrop>();private var flakes=emptyList<PanelSnowflake>();private var strike:PanelLightning?=null
    private var initialized=false
    private fun flake(initial:Boolean,width:Double,height:Double)=PanelSnowflake(
        width*(.04+random.next()*.92),if(initial)height*(.04+random.next()*.86)else -4.0,
        .8+random.next()*1.4,10+random.next()*20,(random.next()-.5)*7,random.next()*PI*2,
    )
    fun frame(width:Double,height:Double,deltaSeconds:Double=0.0,still:Boolean=false):PanelWeatherFrame {
        if(width<=0||height<=0||!width.isFinite()||!height.isFinite()||intensity<=0)return PanelWeatherFrame()
        if(still){
            if(snow)return PanelWeatherFrame(flakes=List(9){i->PanelSnowflake(width*((i*.113+.08)%1),height*((i*.19+.13)%.9),.8+(i%3)*.4,0.0,0.0,0.0)})
            val rng=Random(seed xor floor(intensity*1_000_000+.5).toInt());val p=rainProfile
            return PanelWeatherFrame(drops=List(p.staticDrops){i->GlassRaindrop(width*(.1+(i+.25+rng.next()*.5)/p.staticDrops*.8),height*(.16+rng.next()*.66),0.0,0.0,p.radiusMin+rng.next()*(p.radiusMax-p.radiusMin),0.0,Double.POSITIVE_INFINITY)})
        }
        if(!initialized){initialized=true;if(snow)flakes=List(floor(8+intensity*16+.5).toInt()){flake(true,width,height)}}
        val dt=if(deltaSeconds.isFinite())deltaSeconds.coerceIn(0.0,.05)else 0.0;elapsed+=dt*1000
        if(elapsed>=nextDrop){
            if(snow&&flakes.size<min(PanelWeatherPhysics.MAX_FLAKES,12+ceil(intensity*36).toInt())){
                flakes=flakes+flake(false,width,height);nextDrop=elapsed+110+(1-intensity)*230+random.next()*130
            }else if(!snow&&drops.size<rainProfile.maxDrops){
                val p=rainProfile;val radius=p.radiusMin+random.next()*(p.radiusMax-p.radiusMin)
                drops=drops+GlassRaindrop(width*(.06+random.next()*.88),height*(.08+random.next()*.66),(random.next()-.5)*.55,0.0,radius,0.0,p.holdSecondsMin+random.next()*(p.holdSecondsMax-p.holdSecondsMin))
                nextDrop=elapsed+p.spawnIntervalMs*(.72+random.next()*.56)
            }
        }
        if(thunderstorm&&elapsed>=nextLightning){
            strike=PanelLightning(elapsed,width*(.16+random.next()*.68),height*(.38+random.next()*.49),List(9){if(it==8)0.0 else random.next()*1.5-.75})
            nextLightning=elapsed+15000+random.next()*16000
        }
        if(snow)flakes=flakes.mapNotNull { f->
            val phase=f.phase+dt*1.4;val y=f.y+f.speed*(if(f.radius>1.5)1.0 else .62)*dt
            if(y>height-5)null else f.copy(x=f.x+(f.drift+sin(phase)*4)*dt,y=y,phase=phase)
        }else drops=PanelWeatherPhysics.merge(PanelWeatherPhysics.advance(drops,dt,height,rainProfile.terminalSpeed))
        val current=strike;val age=if(current!=null)elapsed-current.startedAt else 0.0
        if(age>PanelWeatherPhysics.AFTERIMAGE_MS)strike=null
        return PanelWeatherFrame(drops,flakes,strike,age)
    }
}
