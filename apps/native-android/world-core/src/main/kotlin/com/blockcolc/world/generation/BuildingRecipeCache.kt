package com.blockcolc.world.generation

import java.util.concurrent.CancellationException

data class RecipeCacheStats(val hits:Long,val misses:Long,val entries:Int,val estimatedRetainedBytes:Long)

/** Worker-confined, derived CPU inputs only. Each live owner can retain at
 * most one version, not every progress/condition value in its history. The
 * estimate limits cache retention; it is not a measurement of process RSS. */
class BuildingRecipeCache(private val maximumEstimatedBytes:Long=24L*1024*1024,private val maximumEntries:Int=64) {
    private data class Entry(val recipe:BuildingInputRecipe,val bytes:Long)
    private val entries=LinkedHashMap<String,Entry>()
    private var bytes=0L;private var hits=0L;private var misses=0L
    init { require(maximumEstimatedBytes>=0&&maximumEntries>=0) }
    val stats get()=RecipeCacheStats(hits,misses,entries.size,bytes)

    fun prepare(owner:String,blueprint:BlueprintSnapshot,projectId:String,completion:Int,condition:Int,cancelled:()->Boolean={false}):BuildingInputRecipe {
        require(owner.isNotEmpty())
        fun checkCancelled(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Recipe request superseded")}
        checkCancelled()
        val key=BuildingPreparation.key(blueprint,projectId,completion,condition)
        entries[owner]?.takeIf{it.recipe.key==key}?.let{hits++;return it.recipe}
        misses++
        val recipe=BuildingPreparation.prepare(blueprint,projectId,completion,condition,cancelled)
        checkCancelled()
        // Full piston display retains source voxels, including not-yet-built
        // ones; count those too rather than just the visible prefix buffers.
        val estimated=512L+recipe.pistonDisplay.voxels.size*320L+recipe.intact.size*16L+recipe.missing.size*8L+recipe.vines.size*64L
        entries.remove(owner)?.let{bytes-=it.bytes}
        // Every generation scans the same live owners. When that working set
        // slightly exceeds the budget, LRU admission evicts the next owner's
        // recipe and turns the entire following scan into misses. Keep the
        // already admitted live set; overflow owners remain uncached. Removed
        // owners are pruned by retainOwners, and edits replace only that owner.
        if(entries.size<maximumEntries&&bytes+estimated<=maximumEstimatedBytes) {
            entries[owner]=Entry(recipe,estimated);bytes+=estimated
        }
        return recipe
    }

    fun retainOwners(owners:Set<String>) {
        val iterator=entries.entries.iterator()
        while(iterator.hasNext()) { val entry=iterator.next();if(entry.key !in owners){bytes-=entry.value.bytes;iterator.remove()} }
    }
    fun clear(){entries.clear();bytes=0}
}
