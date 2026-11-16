package com.blockcolc.world

import com.blockcolc.world.generation.TerrainSurface
import com.blockcolc.world.generation.TerrainSurfaceTable
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import kotlin.math.*

/** Immutable linear R32F data. Height pixels never pass through RGBA/sRGB or
 * mip generation; dimensions participate in the shared GPU resource identity. */
class NativeGroundTexture(val width:Int,val height:Int,input:ByteBuffer) {
    private val data:ByteArray
    val sha256:String
    val identity:String
    val heights:GroundHeights
    init {
        require(width in 1..512&&height in 1..512&&input.remaining()==width*height*4)
        data=ByteArray(input.remaining());input.duplicate().get(data)
        heights=GroundHeights(width,height,ByteBuffer.wrap(data))
        sha256=MessageDigest.getInstance("SHA-256").digest(data).joinToString(""){"%02x".format(it.toInt() and 255)}
        identity="r32f:$width:$height:$sha256"
    }
    val gpuBytes get()=width.toLong()*height*4
    fun bytes()=ByteBuffer.wrap(data).asReadOnlyBuffer().order(ByteOrder.LITTLE_ENDIAN)
    fun metadata(id:Int)=JSONObject().put("id",id).put("encoding","r32f-le").put("image",sha256).put("width",width).put("height",height)
        .put("colorSpace","").put("generateMipmaps",false).put("minFilter",1003).put("magFilter",1003).put("wrapS",1001).put("wrapT",1001).put("anisotropy",1)
}

class NativePrecipitationGround(val texture:NativeGroundTexture,val minX:Double,val minZ:Double,val spanX:Double,val spanZ:Double,val minY:Double,val maxY:Double) {
    init {require(listOf(minX,minZ,spanX,spanZ,minY,maxY).all{it.isFinite()&&abs(it)<=1e6}&&spanX>0&&spanZ>0&&maxY>=minY)}
    fun at(x:Double,z:Double)=texture.heights.at((x-minX)/spanX,(z-minZ)/spanZ)
    companion object {
        fun prepare(surfaces:TerrainSurfaceTable,cancelled:()->Boolean={false})=build(surfaces.length,surfaces::at,cancelled)
        fun prepare(surfaces:List<TerrainSurface>,cancelled:()->Boolean={false}):NativePrecipitationGround {
            val owned=surfaces.toList();return build(owned.size,{owned[it]},cancelled)
        }
        private fun build(count:Int,row:(Int)->TerrainSurface?,cancelled:()->Boolean):NativePrecipitationGround {
            fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Native precipitation ground superseded")}
            fun usable(s:TerrainSurface)=s.minX.isFinite()&&s.maxX.isFinite()&&s.minZ.isFinite()&&s.maxZ.isFinite()&&s.supportY.isFinite()&&s.maxX>s.minX&&s.maxZ>s.minZ
            checkpoint();var minX=Double.POSITIVE_INFINITY;var minZ=minX;var minY=minX;var maxX=Double.NEGATIVE_INFINITY;var maxZ=maxX;var maxY=maxX
            repeat(count){i->if(i%256==0)checkpoint();val s=row(i);if(s!=null&&usable(s)){
                minX=min(minX,s.minX);maxX=max(maxX,s.maxX);minZ=min(minZ,s.minZ);maxZ=max(maxZ,s.maxZ);minY=min(minY,s.supportY);maxY=max(maxY,s.supportY)
            }}
            if(!minX.isFinite())return NativePrecipitationGround(NativeGroundTexture(1,1,ByteBuffer.allocate(4)), -1.0,-1.0,2.0,2.0,0.0,0.0)
            val sx=maxX-minX;val sz=maxZ-minZ;val width=ceil(sx/2).toInt().coerceIn(1,512);val height=ceil(sz/2).toInt().coerceIn(1,512)
            val data=FloatArray(width*height){minY.toFloat()}
            repeat(count){i->if(i%128==0)checkpoint();val s=row(i);if(s!=null&&usable(s)){
                val x0=max(0,floor((s.minX-minX)/sx*width).toInt());val x1=min(width-1,ceil((s.maxX-minX)/sx*width).toInt()-1)
                val z0=max(0,floor((s.minZ-minZ)/sz*height).toInt());val z1=min(height-1,ceil((s.maxZ-minZ)/sz*height).toInt()-1)
                for(z in z0..z1){if(z%64==0)checkpoint();for(x in x0..x1){val at=z*width+x;data[at]=max(data[at].toDouble(),s.supportY).toFloat()}}
            }}
            val encoded=ByteBuffer.allocate(data.size*4).order(ByteOrder.LITTLE_ENDIAN);for(value in data)encoded.putFloat(value);encoded.flip()
            checkpoint();return NativePrecipitationGround(NativeGroundTexture(width,height,encoded),minX,minZ,sx,sz,minY,maxY)
        }
    }
}
