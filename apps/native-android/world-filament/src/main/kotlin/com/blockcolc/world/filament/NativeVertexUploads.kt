package com.blockcolc.world.filament

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.sqrt

/** The consumer must finish reading each chunk before returning. Filament's
 * asynchronous upload therefore needs a driver drain before this buffer is
 * reused. Keeps large geometry uploads out of ART's single-allocation peak. */
internal object NativeVertexUploads {
    const val STRIDE=64
    const val CHUNK_VERTICES=4096
    fun each(input:FloatBuffer,count:Int,consume:(destinationBytes:Int,data:ByteBuffer)->Unit){
        require(count in 1..4_000_000&&input.remaining().toLong()==count*12L)
        val floats=input.duplicate()
        val data=ByteBuffer.allocateDirect(minOf(count,CHUNK_VERTICES)*STRIDE).order(ByteOrder.nativeOrder())
        var first=0
        while(first<count){
            data.clear()
            val size=minOf(CHUNK_VERTICES,count-first)
            repeat(size){
                val x=floats.get();val y=floats.get();val z=floats.get()
                var nx=floats.get();var ny=floats.get();var nz=floats.get()
                val length=sqrt(nx*nx+ny*ny+nz*nz)
                if(length>1e-8f){nx/=length;ny/=length;nz/=length}else{nx=0f;ny=1f;nz=0f}
                var qx=-ny;var qy=nx;var qw=1f+nz
                if(qw<1e-6f){qx=1f;qy=0f;qw=1e-6f}
                val scale=1f/sqrt(qx*qx+qy*qy+qw*qw)
                data.putFloat(x).putFloat(y).putFloat(z).putFloat(qx*scale).putFloat(qy*scale).putFloat(0f).putFloat(qw*scale)
                repeat(6){data.putFloat(floats.get())}
                data.putFloat(nx).putFloat(ny).putFloat(nz)
            }
            data.flip();consume(first*STRIDE,data)
            first+=size
        }
    }
}
