package com.blockcolc.presentation

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/** A theme-specific tonal guard beneath full-opacity ink. Transparency still
 * controls the surface coating, not whether moving scenery can erase text.
 * Matrix biases use Android's 0..255 colour-matrix units. */
object GlassReadability {
    /** Required advantage before the other ink replaces the current one, so a
     * scene that drifts around the midpoint cannot make the text flicker. */
    const val SWITCH_MARGIN=1.25

    fun matrix(dark:Boolean):FloatArray{
        val gain=if(dark).42f else .5f;val bias=if(dark)0f else 127.5f
        return floatArrayOf(gain,0f,0f,0f,bias,0f,gain,0f,0f,bias,0f,0f,gain,0f,bias,0f,0f,0f,1f,0f)
    }

    /** WCAG relative luminance of an sRGB colour with channels in 0..1. */
    fun luminance(red:Double,green:Double,blue:Double):Double {
        fun linear(c:Double)=c.coerceIn(0.0,1.0).let{if(it<=.04045)it/12.92 else ((it+.055)/1.055).pow(2.4)}
        return .2126*linear(red)+.7152*linear(green)+.0722*linear(blue)
    }

    fun contrast(first:Double,second:Double)=(max(first,second)+.05)/(min(first,second)+.05)

    /** The world composites the blurred scene in its own frame; Compose then
     * draws the surface tint over it. Blend in sRGB, as the overlay does. */
    fun backgroundLuminance(scene:DoubleArray,surface:DoubleArray,tintAlpha:Double):Double {
        require(scene.size==3&&surface.size==3&&tintAlpha.isFinite())
        val alpha=tintAlpha.coerceIn(0.0,1.0)
        return luminance(scene[0]*(1-alpha)+surface[0]*alpha,scene[1]*(1-alpha)+surface[1]*alpha,scene[2]*(1-alpha)+surface[2]*alpha)
    }

    /** Light ink when it reads better. With a current ink, switch only when the
     * other one is clearly better; otherwise keep the text steady. */
    fun lightInk(background:Double,current:Boolean?,margin:Double=SWITCH_MARGIN):Boolean {
        require(background.isFinite()&&margin>=1)
        val light=contrast(1.0,background);val dark=contrast(0.0,background)
        return when(current){
            null->light>dark
            true->dark<=light*margin
            false->light>dark*margin
        }
    }
}
