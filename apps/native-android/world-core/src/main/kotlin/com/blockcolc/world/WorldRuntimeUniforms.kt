package com.blockcolc.world

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Two RGBA32F texels shared by all draws. Updating camera fog preserves the
 * five independent animation channels, and clock ticks preserve camera fog.
 * A zero final component selects the frozen per-material range used by P1. */
class WorldRuntimeUniforms {
    companion object {const val BYTES=32}
    private val values=FloatArray(8)
    fun time(seconds:Float,enabled:Boolean,cloudSeconds:Float,weatherElapsedMs:Float,cascadeSeconds:Float){
        require(listOf(seconds,cloudSeconds,weatherElapsedMs,cascadeSeconds).all{it.isFinite()&&it>=0f})
        val slot=seconds%48f
        values[0]=seconds;values[1]=if(!enabled)-2f else if(slot>=12f&&slot<13.6f)(slot-12f)/1.6f else -1f
        values[2]=cloudSeconds;values[3]=weatherElapsedMs;values[4]=cascadeSeconds
    }
    fun fog(range:NativeFogRange?){
        val near=range?.near?.toFloat()?:0f;val far=range?.far?.toFloat()?:0f
        require(near.isFinite()&&far.isFinite()&&(range==null||far>near))
        values[5]=near;values[6]=far;values[7]=if(range==null)0f else 1f
    }
    fun bytes():ByteBuffer=ByteBuffer.allocateDirect(BYTES).order(ByteOrder.nativeOrder()).apply{asFloatBuffer().put(values)}
}
