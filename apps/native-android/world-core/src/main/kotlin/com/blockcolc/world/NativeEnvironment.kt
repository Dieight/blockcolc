package com.blockcolc.world

import com.blockcolc.world.generation.BlockPoint
import com.blockcolc.world.generation.SourceNumbers
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import kotlin.math.*

enum class NativeWeatherKind(val wire:String){CLEAR("clear"),CLOUDY("cloudy"),RAIN("rain"),MIST("mist"),SNOW("snow")}
data class NativeWeather(val localDate:String,val kind:NativeWeatherKind,val thunderstorm:Boolean,val seed:Long,val cloudCount:Int,
    val cloudIntensity:Double,val rainDropCount:Int,val snowFlakeCount:Int,val precipitationIntensity:Double,val visualPrecipitationIntensity:Double)
data class NativeWeatherOverride(val kind:NativeWeatherKind,val thunderstorm:Boolean=false,val cloudIntensity:Double?=null,
    val precipitationIntensity:Double?=null,val visualPrecipitationIntensity:Double?=null)
data class NativeSunState(val phase:String,val position:BlockPoint,val sunPosition:BlockPoint,val moonPosition:BlockPoint,
    val sunVisibility:Double,val moonVisibility:Double,val starVisibility:Double,val intensity:Double,val color:Int,
    val skyColor:Int,val skyZenithColor:Int,val skyHorizonColor:Int,val skyLowerColor:Int,val cloudColor:Int,val fogColor:Int,
    val hemisphereSkyColor:Int,val hemisphereGroundColor:Int,val hemisphereIntensity:Double,val exposure:Double,val nightFactor:Double,
    val lunar:NativeLunarIllumination,val sun:NativeCelestialPosition?=null,val moon:NativeCelestialPosition?=null,val directSunIntensity:Double?=null)
enum class NativeLightingQuality(val faceContrast:Float,val ambientOcclusion:Float,val coolColor:Int,val cloudDensity:Double){LOW(.18f,.3f,0x7890ac,.45),BALANCED(.22f,.38f,0x7088aa,.72),HIGH(.25f,.44f,0x6981a5,1.0)}
data class NativeEnvironmentSample(val sun:NativeSunState,val weather:NativeWeather,val lighting:SourceLighting,val surface:NativeSurfaceState,val post:SourcePost,
    val cloudColor:LinearRgb=LinearRgb.WHITE,val sky:NativeSkyState?=null,val fogProjection:NativeFogProjection?=null) {
    fun uniforms()=NativeSceneEnvironment(lighting,surface,cloudColor,sky,fogProjection,post.direct,NativeStormWeather(weather.thunderstorm,weather.seed))
}

/** Native counterparts of lighting.ts, astronomy-visual.ts and environment.ts.
 * The provider/debug selection is an input; sampling never requests location,
 * changes the timer, or reads a feature page's theme. */
object NativeEnvironment {
    private fun smooth(a:Double,b:Double,value:Double):Double {val t=((value-a)/(b-a)).coerceIn(0.0,1.0);return t*t*(3-2*t)}
    private fun mix(a:Double,b:Double,t:Double)=a+(b-a)*t
    private fun color(a:Int,b:Int,amount:Double):Int {val t=amount.coerceIn(0.0,1.0);fun channel(shift:Int)=floor(mix(((a shr shift)and 255).toDouble(),((b shr shift)and 255).toDouble(),t)+.5).toInt()
        return(channel(16) shl 16)or(channel(8) shl 8)or channel(0)}
    private fun unit(value:Double?,fallback:Double)=if(value==null||!value.isFinite())fallback else value.coerceIn(0.0,1.0)
    private fun readability(state:NativeSunState,lunarInfluence:Double=0.0):NativeSunState {
        val amount=smooth(.05,.95,state.nightFactor);val moon=unit(lunarInfluence,0.0)
        return state.copy(hemisphereSkyColor=color(state.hemisphereSkyColor,0x9fb4cc,amount),hemisphereGroundColor=color(state.hemisphereGroundColor,0x65768b,amount),
            hemisphereIntensity=mix(state.hemisphereIntensity,1.58,amount)+moon*amount*.04,exposure=mix(state.exposure,1.43,amount)+moon*amount*.02)
    }
    fun localSun(time:Long,zone:TimeZone=TimeZone.getDefault()):NativeSunState {
        val date=Calendar.getInstance(zone,Locale.ROOT).apply{timeInMillis=time};val hour=date.get(Calendar.HOUR_OF_DAY)+date.get(Calendar.MINUTE)/60.0+date.get(Calendar.SECOND)/3600.0
        val elevation=sin((hour-6)/12*PI);val day=smooth(-.08,.2,elevation);val warmth=max(0.0,1-abs(elevation)/.42)*day;val night=1-day
        val azimuth=hour/24*PI*2-PI/2;val daylight=elevation>=0;val sign=if(daylight)1 else -1
        val sun=BlockPoint(cos(azimuth)*18,elevation*18,sin(azimuth)*18);val moon=BlockPoint(-sun.x,-sun.y,-sun.z)
        val position=BlockPoint(cos(azimuth)*18*sign,if(daylight)4+elevation*15 else 5-elevation*7,sin(azimuth)*18*sign)
        val sky=color(color(0x17243a,0xb9cddd,day),0xd98969,warmth*.62)
        return readability(NativeSunState(if(day<.15)"night"else if(hour<9)"dawn"else if(hour>16.5)"dusk"else"day",position,sun,moon,
            smooth(-.06,.08,elevation),smooth(-.08,.12,-elevation),smooth(.12,.5,-elevation),mix(.92,1.48+max(0.0,elevation)*.9,day),
            color(color(0x9db7d9,0xfff1ce,day),0xffae68,warmth*.72),sky,color(color(0x0d1930,0x669cc3,day),0x765f83,warmth*.2),
            color(sky,0xe49a75,warmth*.42),color(color(0x182536,0xc8d5d2,day),0xc77b68,warmth*.3),color(color(0x344256,0xe7ece8,day),0xf0b28e,warmth*.3),
            color(color(0x263444,0xadc1b8,day),0xc98269,warmth*.42),color(0x7895b5,0xf4f0dc,day),color(0x24382d,0x4d6659,day),mix(1.24,1.12,day),mix(1.28,1.22,day),night,NativeEphemeris.illumination(time)))
    }
    fun celestialDirection(azimuth:Double,altitude:Double):BlockPoint {
        require(azimuth.isFinite()&&altitude.isFinite());val a=azimuth*PI/180;val h=altitude*PI/180
        return BlockPoint(sin(a)*cos(h),sin(h),-cos(a)*cos(h))
    }
    fun astronomySun(time:Long,coordinates:NativeCoordinates):NativeSunState {
        val sun=NativeEphemeris.sunPosition(time,coordinates);val moon=NativeEphemeris.moonPosition(time,coordinates);val lunar=NativeEphemeris.illumination(time)
        val h=sun.altitudeDeg;val day=smooth(-12.0,6.0,h);val night=1-smooth(-8.0,-2.0,h);val direct=smooth(-.267,4.0,h)
        val warmth=smooth(-8.0,-1.0,h)*(1-smooth(5.0,18.0,h));val moonVisibility=smooth(-.25,3.0,moon.altitudeDeg)
        val rising=h<=NativeEphemeris.sunPosition(time+600000,coordinates).altitudeDeg
        val phase=if(h>=0)"day"else if(h> -2)if(rising)"dawn"else"dusk"else if(h> -6)"civil-twilight"else if(h> -12)"nautical-twilight"else if(h> -18)"astronomical-twilight"else"night"
        fun scaled(p:BlockPoint)=BlockPoint(p.x*18,p.y*18,p.z*18)
        val sky=color(color(0x17243a,0xb9cddd,day),0xd98969,warmth*.72)
        return readability(NativeSunState(phase,scaled(celestialDirection(sun.azimuthDeg,max(3.0,h))),scaled(celestialDirection(sun.azimuthDeg,h)),scaled(celestialDirection(moon.azimuthDeg,moon.altitudeDeg)),
            direct,moonVisibility,1-smooth(-18.0,-8.0,h),.92+day*(.56+direct*.5),color(color(0x9db7d9,0xfff1ce,day),0xffae68,warmth*.78),
            sky,color(color(0x0d1930,0x669cc3,day),0x765f83,warmth*.24),color(sky,0xe49a75,warmth*.45),color(color(0x182536,0xc8d5d2,day),0xc77b68,warmth*.3),
            color(color(0x344256,0xe7ece8,day),0xf0b28e,warmth*.3),color(color(0x263444,0xadc1b8,day),0xc98269,warmth*.42),
            color(0x7895b5,0xf4f0dc,day),color(0x24382d,0x4d6659,day),1.24+day*-.12,1.28+day*-.06,night,lunar,sun,moon,direct),moonVisibility*lunar.fraction)
    }
    fun localDate(time:Long,zone:TimeZone=TimeZone.getDefault()):String=Calendar.getInstance(zone,Locale.ROOT).run{timeInMillis=time;String.format(Locale.ROOT,"%04d-%02d-%02d",get(Calendar.YEAR),get(Calendar.MONTH)+1,get(Calendar.DAY_OF_MONTH))}
    private fun checkedDate(date:String) {require(date.matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}")));val d=try{java.time.LocalDate.parse(date)}catch(e:java.time.DateTimeException){throw IllegalArgumentException("Invalid local date",e)};require(d.year in 0..9999)}
    fun localWeather(date:String,ocean:Boolean=false):NativeWeather {
        checkedDate(date);val seed=SourceNumbers.fnv32("weather:$date");val roll=seed%100
        val kind=if(ocean)when{roll<34->NativeWeatherKind.CLEAR;roll<60->NativeWeatherKind.CLOUDY;roll<72->NativeWeatherKind.RAIN;else->NativeWeatherKind.MIST}
            else when{roll<50->NativeWeatherKind.CLEAR;roll<75->NativeWeatherKind.CLOUDY;roll<90->NativeWeatherKind.RAIN;else->NativeWeatherKind.MIST}
        val storm=kind==NativeWeatherKind.RAIN&&SourceNumbers.fnv32("thunder:$date")%5==0L
        val clouds=if(storm)14 else when(kind){NativeWeatherKind.CLEAR->2;NativeWeatherKind.CLOUDY->9;NativeWeatherKind.RAIN->12;else->6};val rain=kind==NativeWeatherKind.RAIN
        return NativeWeather(date,kind,storm,seed,clouds,min(1.0,clouds/12.0),if(rain)72 else 0,0,if(rain)1.0 else 0.0,if(rain)1.0 else 0.0)
    }
    fun externalWeather(date:String,value:NativeWeatherOverride):NativeWeather {
        checkedDate(date);val kind=value.kind
        val cloud=unit(value.cloudIntensity,when(kind){NativeWeatherKind.CLEAR->2/12.0;NativeWeatherKind.CLOUDY,NativeWeatherKind.SNOW->9/12.0;NativeWeatherKind.MIST->.5;else->1.0})
        val factual=unit(value.precipitationIntensity,when(kind){NativeWeatherKind.RAIN->1.0;NativeWeatherKind.SNOW->.55;else->0.0})
        val visual=value.visualPrecipitationIntensity?.let{unit(it,0.0)}?:if(kind !in setOf(NativeWeatherKind.RAIN,NativeWeatherKind.SNOW))0.0 else
            (.1+.9*sqrt(factual)).coerceIn(if(kind==NativeWeatherKind.RAIN).16 else .14,1.0)
        val seed=SourceNumbers.fnv32("weather:external:$date:${kind.wire}:${SourceNumbers.text(cloud)}:${SourceNumbers.text(factual)}")
        return NativeWeather(date,kind,kind==NativeWeatherKind.RAIN&&value.thunderstorm,seed,floor(cloud*12+.5).toInt(),cloud,
            if(kind==NativeWeatherKind.RAIN)max(8,floor(72*visual+.5).toInt())else 0,if(kind==NativeWeatherKind.SNOW)max(10,floor(96*visual+.5).toInt())else 0,factual,visual)
    }
    fun facts(time:Long,inputs:NativeAtmosphereInputs):NativeAtmosphereFacts {
        val zone=TimeZone.getTimeZone(inputs.zone)
        val visualTime=inputs.visualTime(time)
        val raw=if(inputs.coordinates==null)localSun(visualTime,zone)else astronomySun(visualTime,inputs.coordinates)
        val date=localDate(visualTime,zone)
        val weather=if(inputs.weather==null)localWeather(date,inputs.ocean)else externalWeather(date,inputs.weather)
        return NativeAtmosphereFacts(time,inputs,NativeSky.twilight(raw,visualTime,zone),weather,visualTime)
    }
    fun sample(time:Long,zone:TimeZone,quality:NativeLightingQuality,coreRadius:Double,terrainHalfExtent:Double,distance:Double,ocean:Boolean=false,
        coordinates:NativeCoordinates?=null,override:NativeWeatherOverride?=null,skyOptions:NativeSkyOptions=NativeSkyOptions(),timeMinutes:Int?=null):NativeEnvironmentSample =
        project(facts(time,NativeAtmosphereInputs(zone.id,ocean,coordinates,override,timeMinutes)),quality,coreRadius,terrainHalfExtent,distance,skyOptions)

    fun project(facts:NativeAtmosphereFacts,quality:NativeLightingQuality,coreRadius:Double,terrainHalfExtent:Double,distance:Double,
        skyOptions:NativeSkyOptions=NativeSkyOptions()):NativeEnvironmentSample {
        require(listOf(coreRadius,terrainHalfExtent,distance).all{it.isFinite()&&it>0})
        val state=facts.sun;val weather=facts.weather
        val kind=weather.kind;val cover=weather.cloudIntensity.pow(.68);val response=NativeSky.weatherVisual(weather)
        val tint=response.tint;val cloudBlend=response.cloudBlend
        val sunScale=1-(1-response.sunScale)*cover
        val ambient=1-(1-response.ambientScale)*cover*(1-.45*state.nightFactor)
        fun rgb(color:Int)=LinearRgb.fromSrgb(color).let{listOf(it.red,it.green,it.blue)}
        val solar=state.intensity*state.sunVisibility;val lunar=if(state.moonPosition.y>0).55*state.moonVisibility*sqrt(state.lunar.fraction)*(1-state.sunVisibility)else 0.0
        val moon=lunar>solar;val p=if(moon)state.moonPosition else state.position;val length=sqrt(p.x*p.x+p.y*p.y+p.z*p.z);val direction=listOf((-p.x/length).toFloat(),(-p.y/length).toFloat(),(-p.z/length).toFloat())
        val lightColor=if(moon)0xb3c7e3 else state.color;val worldBias=(.00035*(max(48.0,coreRadius*2.4)+coreRadius*3-.1)).toFloat()
        val lights=listOf(SourceLight("DirectionalLight",rgb(lightColor),((if(moon)lunar else solar)*sunScale).toFloat(),direction,listOf(0f,0f,0f),true,List(3){0f},0f,worldBias),
            SourceLight("HemisphereLight",rgb(state.hemisphereSkyColor),(state.hemisphereIntensity*ambient).toFloat(),listOf(0f,1f,0f),listOf(0f,1f,0f),false,rgb(state.hemisphereGroundColor),0f,0f))
        val fogProjection=NativeFogProjection(kind,coreRadius,terrainHalfExtent);val range=fogProjection.range(distance)
        val sky=rgb(state.skyColor);val fog=rgb(state.fogColor);val weatherTint=tint?.let(::rgb)
        val clear=List(3){i->if(weatherTint==null)sky[i]else mix(sky[i].toDouble(),weatherTint[i].toDouble(),cloudBlend*cover*.82).toFloat()}
        val fogColor=List(3){i->if(weatherTint==null)fog[i]else mix(fog[i].toDouble(),weatherTint[i].toDouble(),cloudBlend*cover*.74).toFloat()}
        val effects=SurfaceEffects(direction.map{-it},rgb(lightColor),rgb(quality.coolColor),quality.faceContrast,0f)
        val skyState=NativeSky.state(state,weather,quality,skyOptions);val night=skyState.night
        val cloud=rgb(state.cloudColor);val cloudColor=List(3){i->if(weatherTint==null)cloud[i]else mix(cloud[i].toDouble(),weatherTint[i].toDouble(),cloudBlend).toFloat()}
        return NativeEnvironmentSample(state,weather,SourceLighting(state.exposure.toFloat(),clear,lights,true,emptyList(),SourceFog(fogColor,range.near.toFloat(),range.far.toFloat())),
            NativeSurfaceState(effects,night,state.nightFactor.toFloat(),quality.ambientOcclusion,clearSky=if(kind==NativeWeatherKind.CLEAR)1f else 0f),SourcePost.native(quality),LinearRgb(cloudColor[0],cloudColor[1],cloudColor[2]),skyState,fogProjection)
    }
}
