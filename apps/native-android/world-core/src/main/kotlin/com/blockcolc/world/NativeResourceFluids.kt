package com.blockcolc.world

import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import java.util.Collections
import java.util.concurrent.CancellationException

class NativeResourceFluidEntry internal constructor(val surface:OriginalFluidEntry,tiles:List<Int>){
    val faceTiles:List<Int> = Collections.unmodifiableList(tiles.toList())
}
class NativeResourceFluidBatch internal constructor(val kind:OriginalFluid,val height:Double,val page:Int,val faceMask:Int,val alphaMode:String,
    val waterlogged:Boolean,entries:List<NativeResourceFluidEntry>){
    val entries:List<NativeResourceFluidEntry> = Collections.unmodifiableList(entries.toList())
}
/** Solid and fluid admission are independent: accepting a waterlogged solid
 * never authorizes deleting its fluid layer or changing its neighbor context. */
class NativeResourceFluidPlan internal constructor(batches:List<NativeResourceFluidBatch>,fallback:List<OriginalFluidBatch>,free:Set<Int>,waterlogged:Set<Int>){
    val batches:List<NativeResourceFluidBatch> = Collections.unmodifiableList(batches.toList())
    val fallbackBatches:List<OriginalFluidBatch> = Collections.unmodifiableList(fallback.toList())
    val acceptedFree:Set<Int> = Collections.unmodifiableSet(LinkedHashSet(free))
    val acceptedWaterlogged:Set<Int> = Collections.unmodifiableSet(LinkedHashSet(waterlogged))
}
/** Atlas routing over the already source-verified OriginalFluids surface
 * algorithm. This planner does not decode textures, allocate GPU resources,
 * mutate recipes, or decide which solid members a model compiler accepts. */
class NativeResourceFluidPlanner(private val planner:OriginalFluids=OriginalFluids()) {
    private data class Key(val kind:OriginalFluid,val height:Double,val page:Int,val mask:Int,val alpha:String,val contained:Boolean)
    fun plan(voxels:List<RenderVoxel>,atlas:ResourceTextureAtlas?,neighboringVoxels:List<RenderVoxel> = voxels,
        maximumBatchEntries:Int=4096,maximumWorkingBytes:Long=48L*1024*1024,cancelled:()->Boolean={false}):NativeResourceFluidPlan{
        require(maximumBatchEntries in 1..4096&&maximumWorkingBytes>=0)
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Resource fluids superseded")}
        checkpoint();val groups=LinkedHashMap<Key,MutableList<NativeResourceFluidEntry>>()
        val fallback=ArrayList<OriginalFluidBatch>();val free=LinkedHashSet<Int>();val contained=LinkedHashSet<Int>();var bytes=0L
        for(plan in listOf(planner.free(voxels,neighboringVoxels,cancelled),planner.waterlogged(voxels,maximumBatchEntries.toDouble(),cancelled)))for(batch in plan.batches){
            checkpoint();val prefix=if(batch.kind==OriginalFluid.WATER)"water" else "lava"
            val still=atlas?.entry("minecraft:block/${prefix}_still");val flow=atlas?.entry("minecraft:block/${prefix}_flow")
            val missing=ArrayList<OriginalFluidEntry>()
            for(surface in batch.entries){
                checkpoint();val top=if(surface.flowing)flow?:still else still?:flow;val side=flow?:still
                if(top==null||side==null||atlas==null||atlas.pages.none{it.index==top.page}||atlas.pages.none{it.index==side.page}){missing+=surface;continue}
                data class Page(var mask:Int,val tiles:MutableList<Int>,var alpha:String)
                val pages=LinkedHashMap<Int,Page>()
                for(face in 0..5)if(surface.faceMask and(1 shl face)!=0){
                    val tile=if(face<2)top else side
                    val row=pages.getOrPut(tile.page){Page(0,MutableList(6){tile.pageTextureIndex},if(batch.kind==OriginalFluid.WATER)"translucent"else tile.alphaMode)}
                    row.mask=row.mask or(1 shl face);row.tiles[face]=tile.pageTextureIndex
                    if(batch.kind==OriginalFluid.LAVA&&tile.alphaMode=="translucent")row.alpha="translucent"
                }
                for((page,row)in pages){bytes+=128;require(bytes<=maximumWorkingBytes){"Resource fluid planning exceeds budget"}
                    groups.getOrPut(Key(batch.kind,surface.height,page,row.mask,row.alpha,batch.waterlogged)){ArrayList()}.add(NativeResourceFluidEntry(surface,row.tiles))}
                (if(batch.waterlogged)contained else free)+=surface.sourceIndex
            }
            if(missing.isNotEmpty())for(rows in missing.chunked(maximumBatchEntries))fallback+=OriginalFluidBatch(batch.kind,batch.height,batch.faceMask,batch.waterlogged,rows)
        }
        val output=ArrayList<NativeResourceFluidBatch>()
        for((key,rows)in groups.entries.sortedWith(compareBy<Map.Entry<Key,MutableList<NativeResourceFluidEntry>>>{it.key.kind.name.lowercase()}.thenBy{it.key.height}.thenBy{it.key.page}.thenBy{it.key.mask}.thenBy{it.key.alpha})){
            for(part in rows.sortedBy{it.surface.sourceIndex}.chunked(maximumBatchEntries)){checkpoint();output+=NativeResourceFluidBatch(key.kind,key.height,key.page,key.mask,key.alpha,key.contained,part)}
        }
        checkpoint();return NativeResourceFluidPlan(output,fallback,free,contained)
    }
}
