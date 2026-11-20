package com.blockcolc.world

import com.blockcolc.world.generation.CuboidGeometry
import java.nio.FloatBuffer
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.CancellationException
import kotlin.math.*

data class NativeCloudContext(val view:NativeCloudView,val centerX:Double,val centerZ:Double,val baseY:Double) {
    init {require(listOf(view.contentWidth,view.contentDepth,view.visibleWidth,view.visibleDepth,view.normalWidth,view.normalDepth).all{it.isFinite()&&it>0&&it<=999_000})
        require(listOf(centerX,centerZ,baseY).all{it.isFinite()&&abs(it)<1e6})}
}
data class NativeCloudKey internal constructor(val identity:String)
class NativeCloudPrepared(val key:NativeCloudKey,val source:NativePacketSource,val budget:NativeCloudBudget,
    groups:List<NativeCloudGroup>,groupEnds:List<Int>,val visibleInstances:Int,val randomTail:Long) {
    val groups:List<NativeCloudGroup> = Collections.unmodifiableList(groups.toList())
    val groupEnds:List<Int> = Collections.unmodifiableList(groupEnds.toList())
    val instances get()=groupEnds.lastOrNull()?:0
}

/** One bounded latest cloud generation, owned by its CPU worker. The key is
 * small and deterministic so independently scheduled geometry/environment work
 * can recognize the same cloud input without retaining or hashing GPU payloads. */
class NativeCloudCompiler {
    companion object {
        fun key(context:NativeCloudContext,weather:NativeWeather,density:Double,paper:Boolean=false):NativeCloudKey {
            require(density.isFinite()&&density in 0.0..1.0)
            val text="native-cloud-v1:$context:$weather:$density:$paper"
            return NativeCloudKey(MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)})
        }
    }
    private var cached:NativeCloudPrepared?=null
    private val cube=CuboidGeometry.create()
    fun prepare(context:NativeCloudContext,weather:NativeWeather,density:Double=1.0,cancelled:()->Boolean={false},paper:Boolean=false):NativeCloudPrepared {
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Native cloud preparation superseded")}
        checkpoint();val key=key(context,weather,density,paper);cached?.takeIf{it.key==key}?.let{return it}
        val budget=NativeCloudLayout.budget(context.view,weather,if(paper)density else 1.0)
        val generator=NativeCloudLayout.Generator(weather.seed);val random=generator::next
        val groups=NativeCloudLayout.groups(budget,weather,random)
        val slices=if(paper)groups.map{checkpoint();paperSlices(it.kind,random)}else emptyList()
        val shapes=if(paper)emptyList()else groups.map{checkpoint();NativeCloudLayout.voxels(it.kind,floor(random()*0x7fffffff).toInt())}
        var total=0
        val ends=groups.indices.map{group->total+=if(paper)slices[group].size else shapes[group].size;total}
        require(total<=128*3588)
        val visible=if(paper)total else NativeCloudLayout.drawCount(ends,density)
        val matrices=FloatArray(visible*16);val auxiliary=FloatArray(visible*4);var at=0
        for((index,group)in groups.withIndex()){
            checkpoint()
            val altitude=if(context.view.preview)when(group.kind){NativeCloudKind.CIRRUS->1.5+random()*2;NativeCloudKind.STRATUS-> -.5+random()*.5;else->0.0}
                else when(group.kind){NativeCloudKind.CIRRUS->5+random()*6;NativeCloudKind.STRATUS,NativeCloudKind.BANK-> -2+random()*2;else->0.0}
            val x=context.centerX+group.x;val y=context.baseY+altitude+random()*1.5;val z=context.centerZ+group.z
            val speed=NativeCloudLayout.speed(weather)*(if(context.view.preview).25 else 1.0)*(if(group.region==NativeCloudRegion.FAR).62 else .8+random()*.5)
            val angle=PI/5+(random()-.5)*.44;val size=1.2*budget.blockScale*group.horizontalScale
            fun append(dx:Double,dy:Double,dz:Double,width:Double,height:Double,depth:Double) {
                if(at%128==0)checkpoint()
                val m=at*16;matrices[m]=(size*width).toFloat();matrices[m+5]=(size*height).toFloat();matrices[m+10]=(size*depth).toFloat();matrices[m+15]=1f
                matrices[m+12]=(x+dx*size).toFloat();matrices[m+13]=(y+dy*size).toFloat();matrices[m+14]=(z+dz*size).toFloat()
                val a=at*4;auxiliary[a]=x.toFloat();auxiliary[a+1]=z.toFloat();auxiliary[a+2]=(cos(angle)*speed).toFloat();auxiliary[a+3]=(sin(angle)*speed).toFloat();at++
            }
            if(paper){
                for(slice in slices[index])append(slice.x,slice.y,slice.z,slice.width,slice.height,slice.depth)
            }else{
                for(voxel in shapes[index]){
                    if(at>=visible)break
                    append(voxel.x.toDouble(),voxel.y.toDouble(),voxel.z.toDouble(),1.0,1.0,1.0)
                }
            }
        }
        check(at==visible)
        val builder=NativePacketBuilder(PacketOwners.CLOUDS,NativePacketLayer.CLOUDS,key)
        if(visible>0){
            val cloud=SourceCloud(0f,listOf(budget.spanX.toFloat(),budget.spanZ.toFloat()))
            val material=NativeRenderMaterial(unlit=true,environment=NativeMaterialBinding(cloud=true),fog=weather.kind==NativeWeatherKind.MIST,
                surface=SurfaceCoverage(SurfaceEffects.NONE,listOf("cloud-advection-v1","source-lambert-v1"),emptyList(),SurfaceOptics(cloud=cloud)))
            builder.add(cube,material,FloatBuffer.wrap(matrices),aux=FloatBuffer.wrap(auxiliary),castShadow=false,receiveShadow=false)
        }
        val result=NativeCloudPrepared(key,builder.build(cancelled),budget,groups,ends,visible,generator.state)
        checkpoint();cached=result;return result
    }
    private data class CloudSlice(val x:Double,val y:Double,val z:Double,val width:Double,val height:Double,val depth:Double)
    private fun paperSlices(kind:NativeCloudKind,random:()->Double):List<CloudSlice>{
        val width=when(kind){NativeCloudKind.BANK->28.0;NativeCloudKind.CIRRUS->17.0;else->12.0}*(.8+random()*.4)
        val depth=when(kind){NativeCloudKind.CIRRUS->3.0;NativeCloudKind.BANK->12.0;else->8.0}
        val layers=if(kind==NativeCloudKind.CIRRUS)2 else if(kind==NativeCloudKind.STORM)4 else 3
        return List(layers){layer->
            val taper=1-layer*.145
            CloudSlice((random()-.5)*(1+layer),.68*layer,(random()-.5)*(1+layer*.4),width*taper,.68,depth*taper)
        }
    }
    fun clear(){cached=null}
}
