package com.blockcolc.world

import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import java.nio.FloatBuffer
import java.util.concurrent.CancellationException
import kotlin.math.*

class NativeResourceFluidPrepared internal constructor(val plan:NativeResourceFluidPlan,val origin:BlockPoint,val atlas:ResourceTextureAtlas,batches:List<Draw>){
    class Draw internal constructor(val batch:NativeResourceFluidBatch,val geometry:BlockGeometry,val entries:List<NativeResourceFluidEntry>,resources:Set<String>){val resources:Set<String> = java.util.Collections.unmodifiableSet(LinkedHashSet(resources))}
    val batches=java.util.Collections.unmodifiableList(batches.toList())
}
object NativeResourceFluidGeometry {
    fun compile(batch:NativeResourceFluidBatch,entry:NativeResourceFluidEntry,atlas:ResourceTextureAtlas,palette:ResourceBiomePalette):BlockGeometry{
        val source=OriginalFluids.geometry(batch.faceMask,batch.waterlogged);val count=source.vertexCount
        val p=source.positions().let{a->FloatArray(a.remaining()){a.get()}};val n=source.normals().let{a->FloatArray(a.remaining()){a.get()}}
        val local=source.textureCoordinates()!!;val uv=FloatArray(count*2);val color=FloatArray(count*3);val face=FloatArray(count)
        val page=atlas.pages.first{it.index==batch.page};val tiles=atlas.entries.filter{it.page==batch.page}.associateBy{it.pageTextureIndex}
        val angle=(entry.surface.packedMetadata-1_000_000)%32768*(PI*2)/4096
        val sin=.25*sin(angle);val cos=.25*cos(angle);val rgb=LinearRgb.fromSrgb(if(batch.kind==OriginalFluid.WATER)palette.water else 0xffffff)
        repeat(count){i->val slot=when{n[i*3+1]<-.5f->0;n[i*3+1]>.5f->1;n[i*3+2]<-.5f->2;n[i*3+2]>.5f->3;n[i*3]<-.5f->4;else->5};face[i]=slot.toFloat()
            var u=local.get(i*2).toDouble();var v=local.get(i*2+1).toDouble()
            if(entry.surface.flowing&&slot==1){val x=p[i*3];val z=p[i*3+2]
                u=if(z<0)if(x<0).5-cos-sin else .5+cos-sin else if(x<0).5-cos+sin else .5+cos+sin
                v=if(z<0)if(x<0).5-cos+sin else .5-cos-sin else if(x<0).5+cos+sin else .5+cos-sin
            }
            val tile=checkNotNull(tiles[entry.faceTiles[slot]])
            uv[i*2]=((tile.x+.5+u*(tile.width-1))/page.width).toFloat();uv[i*2+1]=((tile.y+.5+v*(tile.width-1))/page.height).toFloat()
            val shade=when(slot){0->.5f;1->1f;2,3->.8f;else->.6f};color[i*3]=rgb.red*shade;color[i*3+1]=rgb.green*shade;color[i*3+2]=rgb.blue*shade
        }
        val delegate=AttributeBlockGeometry(p,n,uv,color,IntArray(count){it})
        return object:BlockGeometry by delegate {
            override val byteSize=delegate.byteSize+face.size*4L
            override val vertexPreparation="atlas-static-v1"
            override fun colorAlpha()=FloatBuffer.wrap(face).asReadOnlyBuffer()
        }
    }
    fun prepare(voxels:List<RenderVoxel>,atlas:ResourceTextureAtlas,palette:ResourceBiomePalette,origin:BlockPoint,budget:Long=48L*1024*1024,cancelled:()->Boolean={false}):NativeResourceFluidPrepared{
        fun check(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Resource fluid geometry superseded")}
        val plan=NativeResourceFluidPlanner().plan(voxels,atlas,maximumWorkingBytes=budget,cancelled=cancelled);val draws=ArrayList<NativeResourceFluidPrepared.Draw>();var bytes=0L
        for(batch in plan.batches)for(entries in batch.entries.groupBy{it.faceTiles to if(it.surface.flowing)it.surface.packedMetadata%32768 else -1}.values){
            check();val geometry=compile(batch,entries.first(),atlas,palette);bytes+=geometry.byteSize+entries.size*96L;require(bytes<=budget){"Resource fluid geometry exceeds budget"}
            val used=(0..5).filter{batch.faceMask and(1 shl it)!=0}.map{entries.first().faceTiles[it]}.toSet()
            val resources=atlas.entries.filter{it.page==batch.page&&it.pageTextureIndex in used}.map{it.resourceId}.toSet()
            draws+=NativeResourceFluidPrepared.Draw(batch,geometry,java.util.Collections.unmodifiableList(entries.toList()),resources)
        }
        check();return NativeResourceFluidPrepared(plan,origin,atlas,draws)
    }
}
class NativeResourceFluidPackets(private val textures:NativeAtlasTextures){
    fun append(target:NativePacketBuilder,owner:String,prepared:NativeResourceFluidPrepared,voxels:List<RenderVoxel>,placement:NativeStructurePlacement,state:NativeSurfaceState,lod:SceneryLod?=null,cancelled:()->Boolean={false},sharedBindings:Map<Int,NativeAtlasPageBinding>?=null){
        require(textures.atlas===prepared.atlas);val bindings=sharedBindings?:textures.forOwner(owner,prepared.batches.flatMap{it.resources}.toSet());val parent=placement.parent(prepared.origin)
        for(draw in prepared.batches){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Resource fluid packets superseded")
            val water=draw.batch.kind==OriginalFluid.WATER;val binding=bindings.getValue(draw.batch.page);val surface=NativeSurfaceBinding(if(water).22f else 0f,fluid=true,weatherWater=water)
            val material=NativeRenderMaterial(texture=binding.color,roughness=.16f,opacity=if(water).76f else 1f,emission=if(water)LinearRgb.BLACK else LinearRgb.fromSrgb(0x70290c),emissionStrength=if(water)0f else .16f,transparent=draw.batch.alphaMode=="translucent",vertexColors=true,
                alphaCutoff=if(draw.batch.alphaMode=="cutout").5f else 0f,atlas=binding,surface=surface.resolve(state),environment=NativeMaterialBinding(surface))
            val matrices=FloatArray(draw.entries.size*16);val colors=FloatArray(draw.entries.size*4){1f};val aux=FloatArray(draw.entries.size*4)
            for((i,e)in draw.entries.withIndex()){val v=voxels[e.surface.sourceIndex];val m=parent*BlockTransform.translation(v.x-prepared.origin.x,v.y-prepared.origin.y,v.z-prepared.origin.z)
                repeat(16){matrices[i*16+it]=m[it].toFloat()};aux[i*4]=e.surface.packedMetadata.toFloat();aux[i*4+1]=e.surface.packedCorners.toFloat()}
            target.add(draw.geometry,material,FloatBuffer.wrap(matrices),FloatBuffer.wrap(colors),FloatBuffer.wrap(aux),castShadow=false,receiveShadow=water&&!draw.batch.waterlogged,priority=if(material.transparent)5 else 4,lod=lod)
        }
    }
}
