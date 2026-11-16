package com.blockcolc.world

import com.blockcolc.world.generation.BlockPoint
import kotlin.math.*

/** The formal storm's finite, unshadowed point light. Positions remain in
 * user world space; a rendering backend must account for its own origin. */
data class NativeStormFlash(val position:BlockPoint,val intensity:Float) {
    init {require(listOf(position.x,position.y,position.z).all{it.isFinite()&&abs(it)<1e6});require(intensity.isFinite()&&intensity in 0f..3f)}
    fun diffuse(point:BlockPoint,normal:BlockPoint):DoubleArray {
        val dx=position.x-point.x;val dy=position.y-point.y;val dz=position.z-point.z
        val squared=dx*dx+dy*dy+dz*dz;val normalLength=sqrt(normal.x*normal.x+normal.y*normal.y+normal.z*normal.z)
        require(squared.isFinite()&&normalLength.isFinite()&&normalLength>0)
        val facing=if(squared==0.0)0.0 else max(0.0,(normal.x*dx+normal.y*dy+normal.z*dz)/(normalLength*sqrt(squared)))
        val window=max(0.0,1-(squared/(RANGE*RANGE)).pow(2))
        val attenuation=window*window/max(squared,.01)
        return DoubleArray(3){COLOR[it]*intensity*attenuation*facing/PI}
    }
    companion object {
        const val RANGE=28f
        val COLOR=LinearRgb.fromSrgb(0xd9e7ff)
        val NONE=NativeStormFlash(BlockPoint(0.0,0.0,0.0),0f)
        fun from(frame:NativeStormFrame)=frame.burst?.let{NativeStormFlash(it.flashPosition,frame.flashIntensity.toFloat())}?:NONE
    }
}
