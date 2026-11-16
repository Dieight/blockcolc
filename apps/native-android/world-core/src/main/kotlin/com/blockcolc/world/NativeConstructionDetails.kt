package com.blockcolc.world

import com.blockcolc.world.generation.*
import java.nio.FloatBuffer
import java.util.concurrent.CancellationException

enum class NativeOutlineVisibility(val wire:String) {
    OFF("off"),CURRENT("current"),ALL("all");
    fun shows(active:Boolean,completion:Int):Boolean {
        require(completion in 0..10000)
        return completion<10000&&(this==ALL||this==CURRENT&&active)
    }
    companion object {fun fromWire(value:String)=entries.firstOrNull{it.wire==value}?:throw IllegalArgumentException("Unsupported outline visibility")}
}

/** Formal construction overlays stay in the building's replaceable owner.
 * Rebase source coordinates before narrowing, just as the original structure
 * compiler does; neither feature belongs to terrain or to domain storage. */
class NativeConstructionDetails(private val materials:NativeOriginalMaterials=NativeOriginalMaterials()) {
    private val cube=CuboidGeometry.create()
    private val outlineCube=CuboidGeometry.create(.9,.9,.9)
    private val outlineMaterial=NativeRenderMaterial(color=LinearRgb.fromSrgb(0x8fa097),opacity=.2f,roughness=1f,transparent=true,depthWrite=false)
    private fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Construction detail preparation superseded")}
    private fun write(target:FloatArray,index:Int,parent:BlockTransform,local:BlockTransform){
        val matrix=parent*local;repeat(16){target[index*16+it]=matrix[it].toFloat().also{v->require(v.isFinite())}}
    }
    fun appendVines(target:NativePacketBuilder,vines:List<VinePosition>,origin:BlockPoint,placement:NativeStructurePlacement,state:NativeSurfaceState,
        cancelled:()->Boolean={false}):Int {
        checkpoint(cancelled);require(vines.size<=12)
        if(vines.isEmpty())return 0
        val parent=placement.parent(origin);val rows=FloatArray(vines.size*16)
        vines.forEachIndexed{index,vine->
            checkpoint(cancelled);require(vine.axis in setOf("x","z")&&listOf(vine.x,vine.y,vine.z).all{it.isFinite()})
            val local=BlockTransform.fromElements(doubleArrayOf(if(vine.axis=="x").12 else .58,0.0,0.0,0.0,
                0.0,.78,0.0,0.0,0.0,0.0,if(vine.axis=="z").12 else .58,0.0,vine.x-origin.x,vine.y-origin.y,vine.z-origin.z,1.0))
            write(rows,index,parent,local)
        }
        target.add(cube,materials.vine(state),FloatBuffer.wrap(rows),castShadow=true,receiveShadow=false)
        checkpoint(cancelled);return vines.size
    }
    fun appendOutline(target:NativePacketBuilder,blueprint:BlueprintSnapshot,completion:Int,visible:Boolean,origin:BlockPoint,placement:NativeStructurePlacement,
        cancelled:()->Boolean={false}):Int {
        checkpoint(cancelled);require(completion in 0..10000)
        if(!visible||completion>=10000)return 0
        val occupied=HashSet<BlockPoint>(blueprint.voxels.size)
        for((index,voxel)in blueprint.voxels.withIndex()){if(index%128==0)checkpoint(cancelled);occupied+=BlockPoint(voxel.x,voxel.y,voxel.z)}
        val planned=ArrayList<RenderVoxel>()
        for((index,v)in blueprint.voxels.withIndex()){
            if(index%128==0)checkpoint(cancelled)
            if(v.buildOrder>completion&&BlockFacing.entries.any{direction->BlockPoint(v.x+direction.dx,v.y+direction.dy,v.z+direction.dz) !in occupied})planned+=v
        }
        if(planned.isEmpty())return 0
        val parent=placement.parent(origin);val rows=FloatArray(planned.size*16)
        planned.forEachIndexed{index,v->if(index%128==0)checkpoint(cancelled)
            write(rows,index,parent,BlockTransform.translation(v.x-origin.x,v.y-origin.y,v.z-origin.z))}
        target.add(outlineCube,outlineMaterial,FloatBuffer.wrap(rows),castShadow=false,receiveShadow=false,priority=5)
        checkpoint(cancelled);return planned.size
    }
}
