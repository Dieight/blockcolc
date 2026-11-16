package com.blockcolc.weather

import java.util.Locale

/** Same provider-code and unit interpretation as the current qweather-visual
 * adapter. Perceptual rain/snow density stays in the world's projection. */
data class WeatherAppearance(val kind:String,val cloudIntensity:Double,val precipitationIntensity:Double,val thunderstorm:Boolean) {
    companion object {
        fun from(value:CurrentWeather):WeatherAppearance? {
            val code=value.conditionCode;val precipitation=value.precipitationType
            val rain=precipitation=="rain"||(precipitation !in setOf("snow","ice","mixed")&&code.matches(Regex("3\\d\\d")))
            val snow=precipitation in setOf("snow","ice","mixed")||code.matches(Regex("4\\d\\d"))
            val mist=code.matches(Regex("50[0129]|51[0-5]"))
            val kind=when{snow->"snow";rain->"rain";mist->"mist";code in setOf("100","103")->"clear"
                code.matches(Regex("10[124]|5\\d\\d"))->"cloudy";else->return null}
            fun unit(number:Double)=if(number.isFinite())number.coerceIn(0.0,1.0)else 0.0
            val fallback=when(kind){"clear"->.15;"cloudy"->.65;"mist"->.8;else->.85}
            val mm=value.precipitationIntensity?.takeIf{it.value.isFinite()&&it.value>=0}?.let{measure->when(measure.unit.trim().lowercase(Locale.ROOT)){
                "mm/h","mm/hr","mm/hour"->measure.value;"in/h","in/hr","inch/hour"->measure.value*25.4;else->null}}
            return WeatherAppearance(kind,unit(value.cloudCover?:fallback),if(kind in setOf("rain","snow"))unit((mm?:1.5)/5)else 0.0,
                kind=="rain"&&code in setOf("302","303","304"))
        }
    }
}
