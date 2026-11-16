package com.blockcolc.preview.world

import com.blockcolc.presentation.WorldAssetKind
import com.blockcolc.presentation.WorldBlueprintReference
import com.blockcolc.world.generation.BlueprintSnapshot
import com.blockcolc.world.generation.BuiltinBlueprintCatalog
import org.json.JSONObject

fun interface BlueprintSources {
    fun resolve(reference:WorldBlueprintReference,decoration:Boolean,cancelled:()->Boolean):BlueprintSnapshot
    fun resolve(reference:WorldBlueprintReference,decoration:Boolean):BlueprintSnapshot=resolve(reference,decoration){false}
    fun clear() {}
}

/** Optional, derived render inputs keyed by the validated source and its role. */
interface BlueprintRenderCache {
    fun read(sourceSha:String,decoration:Boolean,cancelled:()->Boolean):BlueprintSnapshot?
    fun offer(sourceSha:String,decoration:Boolean,blueprint:BlueprintSnapshot)
}

data class BlueprintSourceStats(val hits:Long,val misses:Long,val entries:Int,val estimatedRetainedBytes:Long)

/** One generation worker owns this cache. Catalog labels do not replace saved
 * per-building sources, and a bad known asset is an error, not an unknown-ID
 * fallback. Estimates bound this cache, not the complete rendered world. */
class NativeBlueprintSources(
    private val catalog:BuiltinBlueprintCatalog=BuiltinBlueprintCatalog.load(),
    private val maximumEstimatedBytes:Long=32L*1024*1024,
    private val maximumEntries:Int=64,
    private val renderCache:BlueprintRenderCache?=null
):BlueprintSources {
    private data class Entry(val blueprint:BlueprintSnapshot,val bytes:Long)
    private val retained=LinkedHashMap<String,Entry>(16,.75f,true)
    private var bytes=0L;private var hits=0L;private var misses=0L
    init { require(maximumEstimatedBytes>=0&&maximumEntries>=0) }
    val stats get()=BlueprintSourceStats(hits,misses,retained.size,bytes)

    override fun resolve(reference:WorldBlueprintReference,decoration:Boolean,cancelled:()->Boolean):BlueprintSnapshot {
        val entry=when(reference.kind) {
            WorldAssetKind.EMBEDDED->null
            WorldAssetKind.BUILTIN->{
                require(!decoration){"A reward requires its qualified source"}
                catalog.find(reference.id)?.takeIf{it.category in setOf("native","supplemental")}
                    ?:catalog.find("builtin-unknown-placeholder")!!
            }
            WorldAssetKind.HOLIDAY->{
                require(decoration)
                catalog.find(reference.id)?.also{require(it.category=="holiday"&&it.holidayId==reference.holidayId)}
                    ?:throw IllegalArgumentException("Missing qualified holiday source")
            }
            WorldAssetKind.BIRTHDAY->{
                require(decoration)
                catalog.find(reference.id)?.also{require(it.category=="birthday")}
                    ?:throw IllegalArgumentException("Missing qualified birthday source")
            }
        }
        val sourceSha=entry?.sha256?:reference.sourceSha!!
        val expectedId=entry?.id?:reference.id
        val key="${if(decoration)'d' else 'b'}:$sourceSha"
        retained[key]?.let{
            require(it.blueprint.id==expectedId){"Saved owner source identity mismatch"}
            hits++;return it.blueprint
        }
        misses++
        val cached=renderCache?.read(sourceSha,decoration,cancelled)?.takeIf{
            it.id==expectedId&&(entry==null||it.bounds==entry.bounds&&it.voxels.size==entry.voxelCount)
        }
        val blueprint=if(cached!=null){
            if(entry!=null)catalog.verifyContent(entry.id)
            cached
        }else{
            val raw=entry?.let{catalog.content(it.id).json()}?:JSONObject(reference.embeddedCanonical!!)
            BlueprintSnapshot.read(raw,decoration).also{
                require(it.id==expectedId){"Saved owner source identity mismatch"}
                renderCache?.offer(sourceSha,decoration,it)
            }
        }
        val estimated=512L+blueprint.canonicalLength*4L+blueprint.voxels.size*320L
        if(maximumEntries>0&&estimated<=maximumEstimatedBytes) {
            retained[key]=Entry(blueprint,estimated);bytes+=estimated
            while(retained.size>maximumEntries||bytes>maximumEstimatedBytes) {
                val iterator=retained.entries.iterator();val oldest=iterator.next();bytes-=oldest.value.bytes;iterator.remove()
            }
        }
        return blueprint
    }

    override fun clear(){retained.clear();bytes=0}
}
