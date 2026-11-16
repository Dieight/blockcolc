package com.blockcolc.world

import kotlin.math.pow

/** The /10 clarity curve. Extra luminance bounds alter its perceived opacity. */
data class NativeGlassMaterial(val blur:Float,val saturation:Float,val brightness:Float,val tintAlpha:Float,val highlightAlpha:Float,val ceiling:Float,val floor:Float=0f) {
    companion object {
        fun usesLightInk(clarity:Int,dark:Boolean,night:Boolean)=dark||night&&clarity>=75
        fun forClarity(clarity:Int,dark:Boolean,night:Boolean=false):NativeGlassMaterial {
            val x=clarity.coerceIn(0,100)/100.0;val e=x*x*(3-2*x)
            return NativeGlassMaterial((32-30*e).toFloat(),(1.08+.18*e).toFloat(),if(dark).92f else 1.03f,
                (if(dark).9-.77*e.pow(.85) else .9-.825*e.pow(.7)).toFloat(),(.13-.065*e).toFloat(),
                if(night&&clarity>=75)(.2+.1*((clarity-75)/25.0).coerceIn(0.0,1.0)).toFloat()else 1f)
        }
    }
}

/** Bottom-origin normalized viewport rectangle; blur radii are normalized too,
 * so changing render resolution never changes the apparent glass material. */
data class NativeGlassRegion(val left:Float,val bottom:Float,val right:Float,val top:Float,
    val blurX:Float,val blurY:Float,val saturation:Float,val brightness:Float,val ceiling:Float,val floor:Float=0f) {
    init {
        require(listOf(left,bottom,right,top,blurX,blurY,saturation,brightness,ceiling,floor).all{it.isFinite()})
        require(left in 0f..1f&&bottom in 0f..1f&&right in left..1f&&top in bottom..1f&&blurX>=0&&blurY>=0)
        require(floor in 0f..1f&&ceiling in floor..1f)
    }
}
