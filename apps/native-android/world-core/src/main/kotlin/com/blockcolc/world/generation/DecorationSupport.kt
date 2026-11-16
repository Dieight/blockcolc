package com.blockcolc.world.generation

import java.util.Collections
import java.util.concurrent.CancellationException
import kotlin.math.*

class SupportedDecoration internal constructor(val placement:DecorationPlacement,foundation:List<RenderVoxel>) {
    val foundation:List<RenderVoxel> = Collections.unmodifiableList(foundation.toList())
}

object DecorationSupport {
    fun place(input:DecorationPlacement,blueprint:BlueprintSnapshot,surfaces:TerrainSurfaceTable,cancelled:()->Boolean={false}):SupportedDecoration {
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Reward support superseded")}
        checkpoint();var ground=Double.NEGATIVE_INFINITY;val width=input.footprint.width;val depth=input.footprint.depth
        var dx=-width/2
        while(dx<=width/2) {
            var dz=-depth/2
            while(dz<=depth/2) {
                surfaces.sample(input.worldPosition.x+dx,input.worldPosition.z+dz)?.let{ground=max(ground,it.supportY)};dz+=2
            };checkpoint();dx+=2
        }
        val y=(if(ground.isFinite())ground else input.worldPosition.y)-blueprint.bounds.minY
        val placement=input.copy(worldPosition=input.worldPosition.copy(y=y));val result=ArrayList<RenderVoxel>()
        val cosine=cos(input.rotationY);val sine=sin(input.rotationY);var visited=0
        for(voxel in blueprint.voxels) {
            if(visited++%128==0)checkpoint()
            if(voxel.y!=blueprint.bounds.minY.toDouble())continue
            val x=voxel.x+placement.blueprintOffset.x;val z=voxel.z+placement.blueprintOffset.z
            val surface=surfaces.sample(placement.worldPosition.x+x*cosine+z*sine,placement.worldPosition.z-x*sine+z*cosine)?:continue
            val bottom=ceil(surface.supportY-placement.worldPosition.y);var footing=voxel.y-1
            while(footing>=bottom) {
                if(visited++%128==0)checkpoint()
                result+=RenderVoxel(voxel.x,footing,voxel.z,"stone",0,"minecraft:stone_bricks");footing--
            }
        }
        checkpoint();return SupportedDecoration(placement,result)
    }
}
