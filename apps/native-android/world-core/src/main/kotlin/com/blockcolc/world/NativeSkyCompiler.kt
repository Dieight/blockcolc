package com.blockcolc.world

import java.nio.FloatBuffer
import java.util.concurrent.CancellationException

data class NativeSkyKey internal constructor(val identity:String)

/** Time, weather, camera and UI state are uniforms, never a sky mesh key. */
class NativeSkyCompiler {
    private var cached:Pair<Boolean,NativePacketSource>?=null
    fun prepare(floating:Boolean,cancelled:()->Boolean={false}):NativePacketSource {
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Native sky preparation superseded")}
        checkpoint();cached?.takeIf{it.first==floating}?.let{return it.second}
        val target=NativePacketBuilder(PacketOwners.SKY,NativePacketLayer.SKY,skyKey=NativeSkyKey("native-sky-v1:$floating"))
        fun matrix(scale:Float=1f)=FloatBuffer.wrap(floatArrayOf(scale,0f,0f,0f,0f,scale,0f,0f,0f,0f,1f,0f,0f,0f,0f,1f))
        target.add(NativeSkyGeometry.dome(),NativeRenderMaterial(unlit=true,vertexColors=true,depthWrite=false,depthTest=false,side=NativeFaceSide.BACK,fog=false,
            environment=NativeMaterialBinding(sky=NativeSkyRole.DOME),surface=SurfaceCoverage(SurfaceEffects.NONE,listOf("native-sky-gradient-v1","night-sky-backdrop-v6"),emptyList(),SurfaceOptics(sky=true,floatingSky=floating))),
            matrix(),castShadow=false,receiveShadow=false,priority=0)
        val plane=NativeSkyGeometry.celestial()
        for((role,size)in listOf(NativeSkyRole.SUN to 8.5f,NativeSkyRole.MOON to 6.2f)){
            checkpoint();target.add(plane,NativeRenderMaterial(unlit=true,transparent=true,depthWrite=false,depthTest=false,side=NativeFaceSide.DOUBLE,fog=false,billboardMode=1,toneMapped=false,
                environment=NativeMaterialBinding(sky=role),surface=SurfaceCoverage(SurfaceEffects.NONE,listOf("native-celestial-sprite-v1"),emptyList())),
                matrix(size),castShadow=false,receiveShadow=false,priority=2)
        }
        val source=target.build(cancelled);checkpoint();cached=floating to source;return source
    }
    fun clear(){cached=null}
}
