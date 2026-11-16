package com.blockcolc.world

import kotlin.math.roundToInt

/** Session-only visual selection. No preference, domain command, reward
 * calendar or location/network policy depends on this value. Apply to normal
 * inputs each time, never to the previously projected debug inputs. */
data class NativeWorldDebug(val enabled:Boolean=false,val weather:NativeDebugWeather=NativeDebugWeather.NORMAL,val timeMinutes:Int?=null,val decayAmount:Double?=null) {
    init {require(timeMinutes==null||timeMinutes in 0..1439);require(decayAmount==null||decayAmount.isFinite()&&decayAmount in 0.0..1.0)}
    val buildingCondition:Int? get()=if(enabled)decayAmount?.let{((1-it)*10000).roundToInt()}else null
    fun project(normal:NativeAtmosphereInputs)=if(!enabled)normal else normal.copy(weather=weather.override?:normal.weather,timeMinutes=timeMinutes)
}

enum class NativeDebugWeather(val wire:String,val label:String,val override:NativeWeatherOverride?) {
    NORMAL("normal","正常天气",null),
    CLEAR("clear","晴",NativeWeatherOverride(NativeWeatherKind.CLEAR,cloudIntensity=.12,precipitationIntensity=0.0)),
    CLOUDY("cloudy","多云",NativeWeatherOverride(NativeWeatherKind.CLOUDY,cloudIntensity=.72,precipitationIntensity=0.0)),
    RAIN("rain","小雨",NativeWeatherOverride(NativeWeatherKind.RAIN,cloudIntensity=.5,precipitationIntensity=.12)),
    STORM("storm","雷雨",NativeWeatherOverride(NativeWeatherKind.RAIN,true,1.0,1.0)),
    SNOW("snow","雪",NativeWeatherOverride(NativeWeatherKind.SNOW,cloudIntensity=.5,precipitationIntensity=.12)),
    MIST("mist","雾",NativeWeatherOverride(NativeWeatherKind.MIST,cloudIntensity=.5,precipitationIntensity=0.0))
}
