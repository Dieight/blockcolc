package com.blockcolc.presentation

import kotlin.math.*

data class SliderFlight(val origin:Double,val startY:Double,val vx:Double,val vy:Double,val gravity:Double,val duration:Double,val landing:Double)
data class SliderPoint(val x:Double,val y:Double)

/** Formal physical-slider equations in density-independent coordinates. */
object SliderPhysics {
    const val GRAVITY=1800.0
    private fun round(x:Double)=floor(x+.5)
    fun valueAt(x:Double,width:Double,min:Int,max:Int,step:Int):Int {
        require(min<max&&step>0)
        val value=min+(x/maxOf(1.0,width)).coerceIn(0.0,1.0)*(max-min)
        return (min+round((value-min)/step)*step).coerceIn(min.toDouble(),max.toDouble()).toInt()
    }
    fun landingValueAt(x:Double,width:Double,min:Int,max:Int,step:Int,direction:Double):Int {
        require(min<max&&step>0)
        val steps=(x/maxOf(1.0,width)).coerceIn(0.0,1.0)*(max-min)/step
        val index=when{direction>0->ceil(steps-1e-8);direction<0->floor(steps+1e-8);else->round(steps)}
        return (min+index*step).coerceIn(min.toDouble(),max.toDouble()).toInt()
    }
    fun flight(origin:Double,pullX:Double,pullY:Double,width:Double):SliderFlight {
        require(listOf(origin,pullX,pullY,width).all{it.isFinite()}&&width>0)
        val polarity=if(pullY<0)1 else -1;val side=if(pullY<0)-1 else 1
        val speed=(sqrt(2*GRAVITY*abs(pullY))+abs(pullY)*4.8).coerceIn(110.0,1000.0)
        val duration=(speed+sqrt(speed*speed-2*GRAVITY*abs(pullY)))/GRAVITY
        val start=(origin+pullX).coerceIn(0.0,width)
        val landing=(start+polarity*(pullX*6).coerceIn(-1200.0,1200.0)*duration).coerceIn(0.0,width)
        return SliderFlight(start,pullY,(landing-start)/duration,-side*speed,side*GRAVITY,duration,landing)
    }
    fun position(flight:SliderFlight,seconds:Double):SliderPoint {
        val t=seconds.coerceIn(0.0,flight.duration)
        return SliderPoint(flight.origin+flight.vx*t,flight.startY+flight.vy*t+.5*flight.gravity*t*t)
    }
    fun reboundSpeed(impact:Double)=minOf(380.0,abs(impact)*.48)
    fun firstBounceDuration(impact:Double)=2*reboundSpeed(impact)/GRAVITY
    fun bounce(seconds:Double,impact:Double):Double {
        var speed=reboundSpeed(impact);var time=maxOf(0.0,seconds)
        repeat(3){val duration=2*speed/GRAVITY;if(time<duration)return -speed*time+.5*GRAVITY*time*time;time-=duration;speed*=.34}
        return 0.0
    }
}
