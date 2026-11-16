package com.blockcolc.world.generation

import java.nio.FloatBuffer
import java.nio.IntBuffer
import java.util.Collections
import java.util.concurrent.CancellationException
import kotlin.math.*

/** Worker-confined LRU of canonical component surfaces, shared between owners
 * and facings. This never retains a building's voxel graph or progress history. */
class OriginalSurfaceCache(private val budgetBytes:Long=32L*1024*1024) {
    private data class Key(val boxes:List<BlockBox>)
    private data class Value(val mesh:BoxSurfaceMesh,val bytes:Long)
    private val entries=LinkedHashMap<Key,Value>(16,.75f,true)
    var retainedBytes=0L;private set
    val size get()=entries.size
    init {require(budgetBytes>=0)}
    fun surface(boxes:List<BlockBox>,cancelled:()->Boolean={false}):BoxSurfaceMesh {
        if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Original surface cancelled")
        val key=Key(boxes.toList());entries[key]?.let{return it.mesh}
        val result=BoxSurfaceMesher.create(boxes,cancelled=cancelled);val bytes=result.byteSize+96+boxes.size*128L
        if(bytes<=budgetBytes) {
            while(entries.isNotEmpty()&&retainedBytes+bytes>budgetBytes){val first=entries.entries.iterator();retainedBytes-=first.next().value.bytes;first.remove()}
            entries[key]=Value(result,bytes);retainedBytes+=bytes
        }
        return result
    }
    fun clear(){entries.clear();retainedBytes=0}
}

class OriginalGeometryBatch internal constructor(val topologyKey:String,val componentKey:String,val material:OriginalVisualStyle,val emission:EffectiveEmission,
    val geometry:BoxSurfaceMesh,private val indices:IntArray,private val transforms:FloatArray) {
    val count get()=indices.size
    fun voxelIndices():IntBuffer=IntBuffer.wrap(indices).asReadOnlyBuffer()
    fun matrices():FloatBuffer=FloatBuffer.wrap(transforms).asReadOnlyBuffer()
}
class OriginalGeometryResult internal constructor(batches:List<OriginalGeometryBatch>,private val handled:IntArray,private val fallback:IntArray,
    val topologies:Int,val topologyOverflow:Int,val materialOverflow:Int) {
    val batches:List<OriginalGeometryBatch> = Collections.unmodifiableList(batches.toList())
    val fallbackCount get()=fallback.size
    fun handledIndices():IntBuffer=IntBuffer.wrap(handled).asReadOnlyBuffer()
    fun fallbackIndices():IntBuffer=IntBuffer.wrap(fallback).asReadOnlyBuffer()
}

/** Compiles the existing bounded original-shape route. Callers still own pack,
 * flower/detail/fluid routing and place these owner-local results in the world.
 * One rejected material component sends the entire voxel to fallback, never a
 * half bed/lantern. Metadata is typed; JSON strings serve only stable ordering. */
class OriginalGeometryCompiler(private val shapes:OriginalBlockShapes=OriginalBlockShapes(),private val styles:OriginalMaterialStyles=OriginalMaterialStyles(),
    private val surfaces:OriginalSurfaceCache=OriginalSurfaceCache()) {
    private data class ShapeKey(val id:String?,val state:List<Pair<String,String>>?)
    private data class Entry(val index:Int,val voxel:RenderVoxel,val shape:OriginalBlockShape,val components:List<OriginalShapeComponent>)
    private data class Topology(val component:OriginalShapeComponent,val entries:MutableList<Entry>)
    private data class Group(val component:OriginalShapeComponent,val material:OriginalVisualStyle,val emission:EffectiveEmission,val entries:MutableList<Entry>)
    private fun key(vararg strings:String)=strings.joinToString(",","[","]",transform=SourceNumbers::quoted)
    private fun groupKey(component:OriginalShapeComponent,material:OriginalVisualStyle,emission:EffectiveEmission)=
        "[${SourceNumbers.quoted(component.topologyKey)},${SourceNumbers.quoted(component.key)},${SourceNumbers.quoted(material.key)},${SourceNumbers.quoted(emission.kind)},${emission.level}]"
    private fun limit(value:Double)=if(value.isNaN())0 else floor(value).coerceIn(0.0,64.0).toInt()
    fun compile(voxels:List<RenderVoxel>,maximumTopologies:Double=64.0,maximumMaterials:Double=64.0,cancelled:()->Boolean={false}):OriginalGeometryResult {
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Original geometry superseded")}
        checkpoint();val shapeCache=HashMap<ShapeKey,OriginalBlockShape>();val entries=ArrayList<Entry>(voxels.size)
        for((index,v)in voxels.withIndex()) {
            if(index%128==0)checkpoint()
            val k=ShapeKey(v.sourceBlockId,v.sourceBlockState?.entries?.map{it.key to it.value}?.sortedBy{it.first})
            val shape=shapeCache[k]?:shapes.plan(v).also{if(shapeCache.size<4096)shapeCache[k]=it}
            entries+=Entry(index,v,shape,shape.renderComponents())
        }
        val topologyKeys=entries.flatMap{it.components.map{c->key(c.key,c.topologyKey)}}.distinct().sorted()
        val topologyLimit=limit(maximumTopologies);val admittedTopologies=topologyKeys.take(topologyLimit).toSet()
        val topologies=LinkedHashMap<String,Topology>();val fallback=ArrayList<Int>()
        for(entry in entries) {
            if(entry.index%128==0)checkpoint()
            if(entry.shape.family==null||entry.components.any{key(it.key,it.topologyKey) !in admittedTopologies}){fallback+=entry.index;continue}
            for(component in entry.components)topologies.getOrPut(key(component.key,component.topologyKey)){Topology(component,arrayListOf())}.entries+=entry
        }
        val groups=HashMap<String,Group>()
        for((_,topology)in topologies.toSortedMap())for(entry in topology.entries) {
            if(entry.index%128==0)checkpoint()
            val component=topology.component;val material=styles.component(entry.voxel,component.key);val emission=OriginalEmission.component(entry.voxel,component.key)
            groups.getOrPut(groupKey(component,material,emission)){Group(component,material,emission,arrayListOf())}.entries+=entry
        }
        val ordered=groups.toSortedMap();val materialLimit=limit(maximumMaterials);val admitted=ordered.keys.take(materialLimit).toSet()
        val entryGroups=LinkedHashMap<Int,MutableSet<String>>()
        for((k,g)in ordered)for(entry in g.entries)entryGroups.getOrPut(entry.index){linkedSetOf()}.add(k)
        val accepted=entryGroups.filterValues{it.all{g->g in admitted}}.keys
        for(index in entryGroups.keys)if(index !in accepted)fallback+=index
        val batches=ArrayList<OriginalGeometryBatch>();val handled=linkedSetOf<Int>()
        for((_,g)in ordered) {
            checkpoint();val selected=g.entries.filter{it.index in accepted};if(selected.isEmpty())continue
            val matrix=FloatArray(selected.size*16);val indices=IntArray(selected.size)
            for((i,entry)in selected.withIndex()) {
                if(i%128==0)checkpoint()
                val component=entry.components.firstOrNull{it.key==g.component.key&&it.topologyKey==g.component.topologyKey}?:g.component
                val transform=BlockTransform.translation(entry.voxel.x,entry.voxel.y,entry.voxel.z)*component.transform
                for(j in 0..15)matrix[i*16+j]=transform[j].toFloat().also{require(it.isFinite())}
                indices[i]=entry.index;handled+=entry.index
            }
            batches+=OriginalGeometryBatch(g.component.topologyKey,g.component.key,g.material,g.emission,surfaces.surface(g.component.boxes,cancelled),indices,matrix)
        }
        checkpoint()
        return OriginalGeometryResult(batches,handled.toIntArray(),fallback.toIntArray(),min(topologyKeys.size,topologyLimit),max(0,topologyKeys.size-topologyLimit),max(0,groups.size-materialLimit))
    }
    fun clear()=surfaces.clear()
}
