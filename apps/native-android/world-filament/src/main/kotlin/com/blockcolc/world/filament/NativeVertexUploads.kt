package com.blockcolc.world.filament

import java.nio.Buffer
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.sqrt

/** The consumer must finish reading each chunk before returning. Filament's
 * asynchronous upload therefore needs a driver drain before this buffer is
 * reused. Keeps large geometry uploads out of ART's single-allocation peak. */
internal object NativeVertexUploads {
    const val STRIDE=64
    const val CHUNK_VERTICES=16384
    private const val CONVERSION_ROWS=512
    fun each(input:FloatBuffer,count:Int,consume:(destinationBytes:Int,data:ByteBuffer)->Unit){
        require(count in 1..4_000_000&&input.remaining().toLong()==count*12L)
        val floats=input.duplicate()
        val data=ByteBuffer.allocateDirect(minOf(count,CHUNK_VERTICES)*STRIDE).order(ByteOrder.nativeOrder())
        val staging=data.asFloatBuffer()
        val rows=minOf(CONVERSION_ROWS,count)
        val source=FloatArray(rows*12)
        val converted=FloatArray(rows*16)
        var first=0
        while(first<count){
            (staging as Buffer).clear()
            val size=minOf(CHUNK_VERTICES,count-first)
            var remaining=size
            while(remaining>0){
                val batch=minOf(rows,remaining)
                floats.get(source,0,batch*12)
                for(row in 0 until batch){
                    val from=row*12
                    val to=row*16
                    var nx=source[from+3]
                    var ny=source[from+4]
                    var nz=source[from+5]
                    val length=sqrt(nx*nx+ny*ny+nz*nz)
                    if(length>1e-8f){nx/=length;ny/=length;nz/=length}else{nx=0f;ny=1f;nz=0f}
                    var qx=-ny
                    var qy=nx
                    var qw=1f+nz
                    if(qw<1e-6f){qx=1f;qy=0f;qw=1e-6f}
                    val scale=1f/sqrt(qx*qx+qy*qy+qw*qw)
                    converted[to]=source[from]
                    converted[to+1]=source[from+1]
                    converted[to+2]=source[from+2]
                    converted[to+3]=qx*scale
                    converted[to+4]=qy*scale
                    converted[to+5]=0f
                    converted[to+6]=qw*scale
                    for(attribute in 0 until 6)converted[to+7+attribute]=source[from+6+attribute]
                    converted[to+13]=nx
                    converted[to+14]=ny
                    converted[to+15]=nz
                }
                staging.put(converted,0,batch*16)
                remaining-=batch
            }
            (data as Buffer).position(0).limit(size*STRIDE)
            consume(first*STRIDE,data)
            first+=size
        }
    }
}
