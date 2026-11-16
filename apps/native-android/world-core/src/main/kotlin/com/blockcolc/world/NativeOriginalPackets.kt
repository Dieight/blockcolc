package com.blockcolc.world

import com.blockcolc.world.generation.*
import java.util.concurrent.CancellationException

/** Parent transform restores the rebased blueprint origin in Double before
 * narrowing. Adding two huge Float translations would lose a small building
 * entirely when a legitimate imported blueprint has a distant source origin. */
data class NativeStructurePlacement(val position:BlockPoint,val rotationY:Double=0.0,val offset:Position2=Position2(0.0,0.0)) {
    init {require(rotationY.isFinite()&&offset.x.isFinite()&&offset.z.isFinite())}
    fun parent(origin:BlockPoint):BlockTransform=BlockTransform.translation(position.x,position.y,position.z)*BlockTransform.rotationY(rotationY)*
        BlockTransform.translation(offset.x+origin.x,origin.y,offset.z+origin.z)
}

/** Append all routes to an owner's packet builder. It may also append support,
 * scenery or vines without creating another renderer or GPU resource owner. */
class NativeOriginalPackets(private val materials:NativeOriginalMaterials=NativeOriginalMaterials()) {
    fun append(target:NativePacketBuilder,structure:OriginalStructure,placement:NativeStructurePlacement,state:NativeSurfaceState,weathering:Double=0.0,
        lod:SceneryLod?=null,skippedMembers:Set<Int> = emptySet(),cancelled:()->Boolean={false},fog:Boolean=true) {
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Original packet preparation superseded")}
        checkpoint();val parent=placement.parent(structure.origin)
        // One scratch matrix per append. Scenery can contain hundreds of
        // thousands of instances; immutable transforms for every row created
        // three short-lived DoubleArrays per instance on the Android path.
        val local=DoubleArray(16)
        for(batch in structure.batches) {
            checkpoint();val members=if(skippedMembers.isEmpty())null else batch.instanceMembers()
            val selected=members?.let{rows->(0 until batch.instanceCount).filter{rows.get(it) !in skippedMembers}}
            val count=selected?.size?:batch.instanceCount;if(count==0)continue
            // A scenery owner can append many batches before its final packet
            // is serialized. Keep those instance rows in the same scoped
            // storage as packet payloads, rather than retaining every batch's
            // second set of large FloatArrays on ART until the owner completes.
            val matrix=batch.matrices();val transformed=NativePacketBuffers.floats(count*16);val colors=NativePacketBuffers.floats(count*4)
            val ao=batch.occlusion();val face=batch.faceOcclusion();val response=batch.materialResponse();val aux=NativePacketBuffers.floats(count*4)
            repeat(count){instance->if(instance%128==0)checkpoint();val original=selected?.get(instance)?:instance
                repeat(16){local[it]=matrix.get(original*16+it).toDouble().also{v->require(v.isFinite())}}
                require(local[3]==0.0&&local[7]==0.0&&local[11]==0.0&&local[15]==1.0)
                // Preserve BlockTransform.times' Double operation order before
                // the one Float narrowing, including rebased distant origins.
                for(column in 0..3)for(row in 0..3){val at=column*4
                    val value=parent[row]*local[at]+parent[4+row]*local[at+1]+parent[8+row]*local[at+2]+parent[12+row]*local[at+3]
                    transformed.put(instance*16+at+row,value.toFloat().also{v->require(v.isFinite())})
                }
                val brightness=1-ao.get(original)*state.ambientOcclusion*.7f
                repeat(3){colors.put(instance*4+it,brightness)};colors.put(instance*4+3,1f)
                aux.put(instance*4,face.get(original).toFloat());aux.put(instance*4+1,response.get(original).toFloat())
                aux.put(instance*4+2,0f);aux.put(instance*4+3,0f)
            }
            val material=materials.batch(batch,weathering,state).let{if(fog)it else it.copy(fog=false)}
            val flower=batch.route==OriginalDrawRoute.FLOWER;val contained=(batch.material as? OriginalDrawMaterial.Fluid)?.waterlogged==true
            target.add(batch.geometry,material,transformed,colors,aux,
                castShadow=!flower&&batch.route!=OriginalDrawRoute.FLUID&&!material.transparent,receiveShadow=!contained,priority=if(material.transparent)5 else 4,lod=lod)
        }
        checkpoint()
    }
    fun build(owner:String,structure:OriginalStructure,placement:NativeStructurePlacement,state:NativeSurfaceState,weathering:Double=0.0,
        cancelled:()->Boolean={false}):NativePacketSource=NativePacketBuilder(owner).also{append(it,structure,placement,state,weathering,cancelled=cancelled)}.build(cancelled)
}
