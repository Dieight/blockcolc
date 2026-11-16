package com.blockcolc.presentation

/** A theme-specific tonal guard beneath full-opacity ink. Transparency still
 * controls the surface coating, not whether moving scenery can erase text.
 * Matrix biases use Android's 0..255 colour-matrix units. */
object GlassReadability {
    fun matrix(dark:Boolean):FloatArray{
        val gain=if(dark).42f else .5f;val bias=if(dark)0f else 127.5f
        return floatArrayOf(gain,0f,0f,0f,bias,0f,gain,0f,0f,bias,0f,0f,gain,0f,bias,0f,0f,0f,1f,0f)
    }
}
