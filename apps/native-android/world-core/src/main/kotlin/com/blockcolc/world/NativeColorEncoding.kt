package com.blockcolc.world

import kotlin.math.pow

/** Same output transfer as the pinned Three working-colour conversion. */
object NativeColorEncoding {
    fun srgb(value:Float):Float {
        require(value.isFinite()&&value>=0f)
        val v=value.toDouble()
        return (if(v<=.0031308)v*12.92 else v.pow(.41666)*1.055-.055).toFloat()
    }
}
