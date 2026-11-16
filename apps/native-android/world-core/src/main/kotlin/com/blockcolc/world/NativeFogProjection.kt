package com.blockcolc.world

import kotlin.math.max
import kotlin.math.min

data class NativeFogRange(val near:Double,val far:Double) {
    init {require(near.isFinite()&&far.isFinite()&&near>=0&&far>near)}
}

/** Camera-depth projection only. Time, ephemeris and source geometry are not
 * inputs; a later weather sample must use the current camera distance. */
data class NativeFogProjection(val kind:NativeWeatherKind,val coreRadius:Double,val terrainHalfExtent:Double) {
    init {require(coreRadius.isFinite()&&terrainHalfExtent.isFinite()&&coreRadius>0&&terrainHalfExtent>0)}
    fun range(cameraDistance:Double):NativeFogRange {
        val distance=max(1.0,if(cameraDistance.isFinite())cameraDistance else 1.0)
        val radius=max(6.0,max(coreRadius,terrainHalfExtent/6))
        return when(kind){
            NativeWeatherKind.MIST->NativeFogRange(0.0,max(32.0,max(distance*2.65,min(radius*6.4,distance*3.15))))
            NativeWeatherKind.RAIN->NativeFogRange(max(22.0,distance+radius*.05),distance+radius*4.1)
            NativeWeatherKind.SNOW->NativeFogRange(max(22.0,distance+radius*.1),distance+radius*4.8)
            else->NativeFogRange(max(32.0,distance+radius*.45),distance+radius*6)
        }
    }
}
