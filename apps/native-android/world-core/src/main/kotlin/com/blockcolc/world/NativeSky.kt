package com.blockcolc.world

import com.blockcolc.world.generation.BlockPoint
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import kotlin.math.*

data class NativeSkyOptions(val floating:Boolean=false,val coldRegion:Boolean=false)
data class NativeSkyGradient(val zenith:LinearRgb,val horizon:LinearRgb,val lower:LinearRgb)
enum class NativeSkyRole { DOME,SUN,MOON }
data class NativeSkyState(val gradient:NativeSkyGradient,val sunDirection:BlockPoint,val moonDirection:BlockPoint,
    val sunColor:LinearRgb,val moonColor:LinearRgb,val opacity:Float,val sunVisible:Boolean,val moonVisible:Boolean,
    val night:NightField,val floating:Boolean,val moonPhase:MoonPhase) {
    init {
        for(v in listOf(sunDirection,moonDirection))require((0..2).all{v[it].isFinite()}&&abs((0..2).sumOf{v[it]*v[it]}-1)<1e-8)
        require(opacity.isFinite()&&opacity in 0f..1f)
        require(moonPhase.illumination.isFinite()&&moonPhase.illumination in 0f..1f&&moonPhase.waxing in setOf(-1f,1f)&&moonPhase.limbAngle.isFinite()&&abs(moonPhase.limbAngle)<=10f)
    }
}
data class NativeWeatherVisual(val tint:Int?,val cloudBlend:Double,val sunScale:Double,val ambientScale:Double,val starScale:Double)

/** Same source palette/visibility calculation for the dome, lighting and every
 * reflective surface. No location request, mesh or UI theme enters this math. */
object NativeSky {
    const val RADIUS=120.0
    const val CELESTIAL_RATIO=.82
    fun weatherVisual(weather:NativeWeather):NativeWeatherVisual {
        if(weather.thunderstorm)return NativeWeatherVisual(0x465365,.78,.26,.58,0.0)
        return when(weather.kind){
            NativeWeatherKind.CLEAR->NativeWeatherVisual(null,0.0,1.0,1.0,1.0)
            NativeWeatherKind.CLOUDY->NativeWeatherVisual(0x9eada8,.28,.82,.87,.28)
            NativeWeatherKind.RAIN->NativeWeatherVisual(0x9eada8,.42,.64,.77,.05)
            NativeWeatherKind.MIST->NativeWeatherVisual(0xaeb8b1,.28,.76,.81,.12)
            NativeWeatherKind.SNOW->NativeWeatherVisual(0xb2c0c8,.36,.72,.87,.08)
        }
    }
    private fun smooth(a:Double,b:Double,x:Double):Double{val t=((x-a)/(b-a)).coerceIn(0.0,1.0);return t*t*(3-2*t)}
    private fun linear(c:Double)=if(c<.04045)c*.0773993808 else (c*.9478672986+.0521327014).pow(2.4)
    private fun srgb(c:Double)=if(c<.0031308)c*12.92 else 1.055*c.pow(.41666)-.055
    /** Three.Color.lerp/getHex: interpolate linear light, then quantize sRGB. */
    private fun blend(a:Int,b:Int,t:Double):Int {
        fun channel(shift:Int):Int {val x=linear(((a shr shift)and 255)/255.0);val y=linear(((b shr shift)and 255)/255.0)
            return floor(srgb(x+(y-x)*t).coerceIn(0.0,1.0)*255+.5).toInt()}
        return(channel(16)shl 16)or(channel(8)shl 8)or channel(0)
    }
    fun altitude(state:NativeSunState):Double=state.sun?.altitudeDeg?:asin((state.sunPosition.y/
        max(.001,sqrt((0..2).sumOf{state.sunPosition[it]*state.sunPosition[it]}))).coerceIn(-1.0,1.0))*180/PI
    fun twilight(state:NativeSunState,time:Long,zone:TimeZone):NativeSunState {
        val year=Calendar.getInstance(zone,Locale.ROOT).apply{timeInMillis=time}.get(Calendar.YEAR)
        val variant=NativeCloudLayout.Generator(year*400L+floor(time/86_400_000.0).toLong()).next()
        val altitude=altitude(state);val warm=smooth(-7.0,-1.0,altitude)*(1-smooth(3.0,14.0,altitude))
        val blue=smooth(-12.0,-6.0,altitude)*(1-smooth(-2.0,1.0,altitude));val pink=variant>.5
        return state.copy(
            skyHorizonColor=blend(blend(state.skyHorizonColor,if(pink)0xf5a4bd else 0xf68b64,warm*.74),0x638ac4,blue*.5),
            skyZenithColor=blend(blend(state.skyZenithColor,0x68538f,warm*.3),0x213f86,blue*.72),
            skyColor=blend(blend(state.skyColor,if(pink)0xca8bb4 else 0xe09573,warm*.45),0x3a5d9a,blue*.55),
            cloudColor=blend(state.cloudColor,if(pink)0xefb1c1 else 0xf1b18c,warm*.52),
            fogColor=blend(blend(state.fogColor,if(pink)0xc18da3 else 0xc78d79,warm*.28),0x49658c,blue*.3))
    }
    fun state(state:NativeSunState,weather:NativeWeather,quality:NativeLightingQuality,options:NativeSkyOptions):NativeSkyState {
        val response=weatherVisual(weather);val blend=response.cloudBlend*weather.cloudIntensity.pow(.68)*.78
        val tint=response.tint?.let(LinearRgb::fromSrgb)
        fun color(hex:Int):LinearRgb {val rgb=LinearRgb.fromSrgb(hex);return if(tint==null)rgb else LinearRgb(
            (rgb.red+(tint.red-rgb.red)*blend).toFloat(),(rgb.green+(tint.green-rgb.green)*blend).toFloat(),(rgb.blue+(tint.blue-rgb.blue)*blend).toFloat())}
        fun direction(p:BlockPoint):BlockPoint {val length=max(1e-6,sqrt((0..2).sumOf{p[it]*p[it]}));return BlockPoint(p.x/length,p.y/length,p.z/length)}
        val dark=1-smooth(-17.0,-7.0,altitude(state));val moon=state.moonVisibility*state.lunar.fraction.coerceIn(0.0,1.0)
        val night=NightField((dark*response.starScale*(1-moon*.35)).toFloat(),(dark*response.starScale*(1-moon*.62)).toFloat(),
            (if(options.coldRegion)dark*response.starScale*(1-moon*.3)else 0.0).toFloat(),0f,if(quality==NativeLightingQuality.HIGH)1f else .65f,-1f,.44f,
            listOf(-1f,0f,0f),if(options.floating)listOf(-.27f,.925f,-.27f)else listOf(.82f,.22f,-.52f))
        val a=LinearRgb.fromSrgb(state.skyHorizonColor);val b=LinearRgb.fromSrgb(0xd7e3ef);val m=state.moonVisibility
        val moonColor=LinearRgb((a.red+(b.red-a.red)*m).toFloat(),(a.green+(b.green-a.green)*m).toFloat(),(a.blue+(b.blue-a.blue)*m).toFloat())
        val opacity=if(weather.kind==NativeWeatherKind.CLEAR)1f else 0f
        return NativeSkyState(NativeSkyGradient(color(state.skyZenithColor),color(state.skyHorizonColor),color(state.skyLowerColor)),direction(state.sunPosition),direction(state.moonPosition),
            LinearRgb.fromSrgb(state.color),moonColor,opacity,state.sunVisibility>.08&&opacity>.08f,state.moonVisibility>.08&&opacity>.08f,night,options.floating,
            MoonPhase(state.lunar.fraction.toFloat(),if(state.lunar.waxing)1f else -1f,(state.lunar.angleDeg*PI/180).toFloat()))
    }
}
