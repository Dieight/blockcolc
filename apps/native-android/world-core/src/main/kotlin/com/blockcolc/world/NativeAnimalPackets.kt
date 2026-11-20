package com.blockcolc.world

import com.blockcolc.world.generation.*
import java.nio.ByteBuffer
import java.nio.FloatBuffer
import java.util.concurrent.CancellationException
import kotlin.math.*

/** Original model primitives, pixel maps and the complete four-kind row
 * capacity. Live motion updates existing instance rows, never these assets. */
object NativeAnimalPackets {
    private val geometry by lazy {listOf(CuboidGeometry.create(),plane(false),plane(true),ring())}
    private fun plane(horizontal:Boolean):BlockGeometry {
        val position=floatArrayOf(-.5f,.5f,0f,.5f,.5f,0f,-.5f,-.5f,0f,.5f,-.5f,0f)
        val normal=FloatArray(12){if(it%3==2)1f else 0f}
        if(horizontal)rotateHorizontal(position,normal)
        return AttributeBlockGeometry(position,normal,floatArrayOf(0f,1f,1f,1f,0f,0f,1f,0f),index=intArrayOf(0,2,1,2,3,1))
    }
    private fun rotateHorizontal(position:FloatArray,normal:FloatArray){
        val c=cos(-PI/2);val s=sin(-PI/2)
        for(i in position.indices step 3){val y=position[i+1].toDouble();val z=position[i+2].toDouble();position[i+1]=(y*c-z*s).toFloat();position[i+2]=(y*s+z*c).toFloat()
            val ny=normal[i+1].toDouble();val nz=normal[i+2].toDouble();normal[i+1]=(ny*c-nz*s).toFloat();normal[i+2]=(ny*s+nz*c).toFloat()}
    }
    private fun ring():BlockGeometry {
        val p=FloatArray(26*3);val n=FloatArray(26*3);val uv=FloatArray(26*2);val index=IntArray(12*6)
        for(row in 0..1)for(i in 0..12){val r=if(row==0).6 else .76;val theta=i.toDouble()/12*PI*2;val x=r*cos(theta);val y=r*sin(theta);val at=row*13+i
            p[at*3]=x.toFloat();p[at*3+1]=y.toFloat();n[at*3+2]=1f;uv[at*2]=((x/.76+1)/2).toFloat();uv[at*2+1]=((y/.76+1)/2).toFloat()}
        for(i in 0 until 12){val at=i*6;index[at]=i;index[at+1]=i+13;index[at+2]=i+1;index[at+3]=i+13;index[at+4]=i+14;index[at+5]=i+1}
        rotateHorizontal(p,n);return AttributeBlockGeometry(p,n,uv,index=index)
    }
    private fun texture(face:Boolean):NativePixelTexture {
        val bytes=ByteArray(16*16*4)
        for(y in 0 until 16)for(x in 0 until 16){val at=(y*16+x)*4;val value=if(face){if(y in 8..11&&(x in 2..4||x in 11..13))35 else 255}else 225+(x*17+y*7+x*y)%31
            repeat(3){bytes[at+it]=value.toByte()};bytes[at+3]=255.toByte()}
        return NativePixelTexture(16,16,ByteBuffer.wrap(bytes),wrapS=1001,wrapT=1001,anisotropy=1f)
    }
    private val materials by lazy {listOf(
        NativeRenderMaterial(texture=texture(false),roughness=1f,emissionStrength=1f),
        NativeRenderMaterial(texture=texture(true),roughness=1f,emissionStrength=1f),
        NativeRenderMaterial(color=LinearRgb.fromSrgb(0x2b3527),opacity=.16f,transparent=true,unlit=true,depthWrite=false),
        NativeRenderMaterial(color=LinearRgb.fromSrgb(0xd9f6ec),opacity=.35f,transparent=true,unlit=true,depthWrite=false,side=NativeFaceSide.DOUBLE))}
    private val paperMaterials by lazy {
        listOf(
            NativeRenderMaterial(unlit=true),NativeRenderMaterial(unlit=true),
            materials[2].copy(opacity=.10f),materials[3].copy(opacity=.46f)
        )
    }
    /** All slots are present even when the initial pose has fewer parts. Slots
     * start inactive and are filled by the admitted runtime before drawing. */
    fun prepare(bounds:BlockBox,cancelled:()->Boolean={false}):NativePacketSource=prepare(bounds,false,cancelled)
    fun prepare(bounds:BlockBox,paper:Boolean,cancelled:()->Boolean={false}):NativePacketSource {
        val builder=NativePacketBuilder(PacketOwners.ANIMALS,NativePacketLayer.ANIMALS)
        for(kind in 0..3){
            if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Animal packets superseded")
            val capacity=AnimalRig.capacities[kind];val matrices=FloatArray(capacity*16){if(it%16%5==0)1f else 0f}
            val aux=FloatArray(capacity*4){when(it%4){0->(it/4).toFloat();1->kind.toFloat();else->0f}}
            builder.add(geometry[kind],(if(paper)paperMaterials else materials)[kind],FloatBuffer.wrap(matrices),aux=FloatBuffer.wrap(aux),castShadow=false,receiveShadow=true,
                priority=4,boundsOverride=bounds)
        }
        return builder.build(cancelled)
    }
    fun validate(source:NativePacketSource){
        require(source.owner==PacketOwners.ANIMALS&&source.layer==NativePacketLayer.ANIMALS)
        val world=requireNotNull(source.world);val seen=AnimalRig.capacities.map{BooleanArray(it)}
        for(packet in world.packets){
            require(packet.auxChannels==listOf("animalSlot")&&packet.lod==null&&!packet.castShadow&&packet.receiveShadow)
            val aux=world.section(requireNotNull(packet.aux));val kind=aux.getFloat(4).toInt();require(kind in 0..3)
            repeat(packet.count){i->val slot=aux.getFloat(i*16);require(slot==floor(slot)&&slot.toInt() in seen[kind].indices&&!seen[kind][slot.toInt()])
                require(aux.getFloat(i*16+4)==kind.toFloat()&&aux.getFloat(i*16+8)==0f&&aux.getFloat(i*16+12)==0f);seen[kind][slot.toInt()]=true}
        }
        require(seen.all{rows->rows.all{it}}){"Native animal rig capacity was truncated"}
    }
}
