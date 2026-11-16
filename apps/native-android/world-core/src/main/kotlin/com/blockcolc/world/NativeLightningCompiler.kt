package com.blockcolc.world

import com.blockcolc.world.generation.*
import java.nio.ByteBuffer
import java.nio.FloatBuffer
import java.util.concurrent.CancellationException
import kotlin.math.*

/** Eight fixed five-sided cylinder instances. A strike uploads only their
 * poses; no geometry, material or static world owner is rebuilt. */
class NativeLightningCompiler {
    private var cached:Pair<NativeStormContext,NativePacketSource>?=null
    private val shape=geometry()
    fun prepare(context:NativeStormContext,cancelled:()->Boolean={false}):NativePacketSource {
        if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Lightning preparation superseded")
        cached?.takeIf{it.first==context}?.let{return it.second}
        val points=List(9){i->BlockPoint(context.center.x,context.topY+(context.bottomY-context.topY)*i/8,context.center.z)}
        val matrices=NativeLightningRows.matrices(points,1.0)
        val margin=1.4+.11*32
        val bounds=BlockBox(BlockPoint(context.center.x-context.width/2-margin,context.bottomY-margin,context.center.z-context.depth/2-margin),
            BlockPoint(context.center.x+context.width/2+margin,context.topY+margin,context.center.z+context.depth/2+margin))
        val material=NativeRenderMaterial(color=LinearRgb.fromSrgb(0xf2f7ff),opacity=.96f,transparent=true,unlit=true,depthWrite=false,
            fog=false,toneMapped=false,surface=SurfaceCoverage(SurfaceEffects.NONE,emptyList(),emptyList(),SurfaceOptics(lightning=true)))
        val source=NativePacketBuilder(PacketOwners.LIGHTNING,NativePacketLayer.LIGHTNING).also{
            it.add(shape,material,FloatBuffer.wrap(matrices),castShadow=false,receiveShadow=false,priority=6,boundsOverride=bounds)
        }.build(cancelled)
        if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Lightning preparation superseded")
        cached=context to source;return source
    }
    fun clear(){cached=null}
    private fun geometry():BlockGeometry {
        val positions=ArrayList<Float>();val normals=ArrayList<Float>()
        fun vertex(p:BlockPoint,n:BlockPoint){for(i in 0..2){positions+=p[i].toFloat();normals+=n[i].toFloat()}}
        fun point(i:Int,top:Boolean):BlockPoint{val angle=i*2*PI/5;val radius=if(top).055 else .11;return BlockPoint(radius*sin(angle),if(top).5 else -.5,radius*cos(angle))}
        for(i in 0 until 5){
            val a=point(i,true);val b=point(i,false);val c=point(i+1,false);val d=point(i+1,true)
            val angle=(i+.5)*2*PI/5;val n=BlockPoint(sin(angle),0.0,cos(angle))
            for(p in listOf(a,b,d,b,c,d))vertex(p,n)
            for(p in listOf(a,d,BlockPoint(0.0,.5,0.0)))vertex(p,BlockPoint(0.0,1.0,0.0))
            for(p in listOf(c,b,BlockPoint(0.0,-.5,0.0)))vertex(p,BlockPoint(0.0,-1.0,0.0))
        }
        return AttributeBlockGeometry(positions.toFloatArray(),normals.toFloatArray())
    }
}

object NativeLightningRows {
    fun matrices(vertices:List<BlockPoint>,scale:Double):FloatArray {
        require(vertices.size==9&&scale.isFinite()&&scale in 1.0..32.0)
        val output=FloatArray(8*16)
        for(i in 0 until 8){
            val a=vertices[i];val b=vertices[i+1];val dx=b.x-a.x;val dy=b.y-a.y;val dz=b.z-a.z
            val length=sqrt(dx*dx+dy*dy+dz*dz);require(length.isFinite()&&length>1e-8)
            val yx=dx/length;val yy=dy/length;val yz=dz/length
            var qx:Double;var qy=0.0;var qz:Double;var qw=1+yy
            if(qw<2.220446049250313e-16){qx=0.0;qz=1.0;qw=0.0}else{qx=yz;qz= -yx}
            val norm=sqrt(qx*qx+qy*qy+qz*qz+qw*qw);qx/=norm;qy/=norm;qz/=norm;qw/=norm
            val xx=2*qx*qx;val xy=2*qx*qy;val xz=2*qx*qz;val yyq=2*qy*qy;val yzq=2*qy*qz;val zz=2*qz*qz
            val wx=2*qw*qx;val wy=2*qw*qy;val wz=2*qw*qz;val at=i*16
            val values=doubleArrayOf((1-yyq-zz)*scale,(xy+wz)*scale,(xz-wy)*scale,0.0,
                (xy-wz)*length,(1-xx-zz)*length,(yzq+wx)*length,0.0,
                (xz+wy)*scale,(yzq-wx)*scale,(1-xx-yyq)*scale,0.0,(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2,1.0)
            for(j in values.indices){output[at+j]=values[j].toFloat();require(output[at+j].isFinite())}
        }
        return output
    }
    fun write(vertices:List<BlockPoint>,scale:Double,target:ByteBuffer){
        val matrices=matrices(vertices,scale);require(target.remaining()>=8*96)
        repeat(8){i->repeat(16){target.putFloat(matrices[i*16+it])};repeat(4){target.putFloat(1f)};repeat(4){target.putFloat(0f)}}
    }
}
