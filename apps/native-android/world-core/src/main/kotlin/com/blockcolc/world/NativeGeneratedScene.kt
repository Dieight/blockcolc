package com.blockcolc.world

import com.blockcolc.world.generation.BlockPoint
import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections

class NativeSceneCamera(val target:BlockPoint,val position:BlockPoint,val fittedDistance:Double,val fov:Double,volume:SourceCamera,val aspect:Double=.75,val preview:Boolean=false) {
    private val canonicalVolume=JSONObject().put("schema",1).put("visibility",JSONArray(volume.visibility.map{JSONArray(it)}))
        .put("framingRadius",volume.framingRadius).put("skyBaseRadius",volume.skyBaseRadius).put("skyFarRatio",volume.skyFarRatio)
        .put("starRadiusRatio",volume.starRadiusRatio).put("starNearMargin",volume.starNearMargin).put("sourceSkyRadius",volume.sourceSkyRadius).toString()
    val volume:SourceCamera=SourceCamera.read(JSONObject(canonicalVolume)).let{v->v.copy(visibility=Collections.unmodifiableList(v.visibility.map{Collections.unmodifiableList(it.toList())}))}
    init {require(fittedDistance.isFinite()&&fittedDistance>0&&fov.isFinite()&&fov in 1.0..179.0&&aspect.isFinite()&&aspect>0);require((0..2).any{kotlin.math.abs(target[it]-position[it])>1e-8})}
    fun metadata():JSONObject=JSONObject().put("camera",JSONObject().put("target",JSONArray(listOf(target.x,target.y,target.z)))
        .put("position",JSONArray(listOf(position.x,position.y,position.z))).put("fittedDistance",fittedDistance).put("fov",fov))
        .put("cameraVolume",JSONObject(canonicalVolume)).put("sourceKind","native-generated")
}

/** Immutable native scene envelope. CPU generation supplies real packet owners,
 * lighting and camera; the renderer must not reopen a P1 world export. Current
 * static packets can already use the admitted native surface/fluid optics.
 * Clouds, precipitation, animals and animated atlas ownership are added through
 * their dedicated runtime contracts, not guessed from a material name. */
class NativeGeneratedScene(sources:List<NativePacketSource>,lighting:SourceLighting,val post:SourcePost,val camera:NativeSceneCamera,
    val generation:Long,val revision:Long,surfaceState:NativeSurfaceState?=null,cloudColor:LinearRgb?=null,sky:NativeSkyState?=null,fogProjection:NativeFogProjection?=null,
    storm:NativeStormWeather?=null,val stormContext:NativeStormContext?=null,
    orbitTargets:List<NativeOrbitTarget> = emptyList(),val picking:NativeWorldPickIndex=NativeWorldPickIndex.EMPTY,val animals:NativeAnimalScene?=null) {
    companion object {private val identities=java.util.concurrent.atomic.AtomicLong()}
    val presentationIdentity:Long=identities.incrementAndGet().also{check(it>0)}
    val sources:List<NativePacketSource> = Collections.unmodifiableList(sources.toList())
    val orbitTargets:List<NativeOrbitTarget> = Collections.unmodifiableList(orbitTargets.toList())
    val environment=NativeSceneEnvironment(lighting,surfaceState,cloudColor,sky,fogProjection,post.direct,storm)
    val lighting:SourceLighting get()=environment.lighting
    val footprint:GpuFootprint
    val inventory:NativeSceneInventory
    init {
        require(generation>=0&&revision>=0&&sources.isNotEmpty()&&sources.first().owner=="world"&&sources.first().world!=null)
        require(sources.size<=4096&&sources.map{it.owner}.distinct().size==sources.size)
        require(this.orbitTargets.size<=4095&&this.orbitTargets.map{it.id}.distinct().size==this.orbitTargets.size)
        require(picking.ids.toSet()==this.orbitTargets.map{it.id}.toSet()){"Picking and orbit identities must refer to the same scene"}
        require(environment.surfaceState!=null||sources.all{source->source.bindings.all{it==null}}){"Environment-bound materials require native uniforms"}
        require(listOf(post.threshold,post.knee,post.strength).all{it.isFinite()&&it in 0f..1f}&&post.samples in setOf(0,2,4))
        for(source in sources)source.validateRuntime(environment)
        require(sources.any{it.layer==NativePacketLayer.LIGHTNING}==(stormContext!=null))
        require(sources.any{it.layer==NativePacketLayer.ANIMALS}==(animals!=null)){"Animal draw slots require native habitat and initial poses"}
        inventory=NativeSceneInventory.of(sources);footprint=inventory.footprint
    }
    /** Camera / uniform probes retain all runtime and picking contracts. */
    fun withPresentation(sources:List<NativePacketSource> = this.sources,lighting:SourceLighting=this.lighting,post:SourcePost=this.post,
        camera:NativeSceneCamera=this.camera)=NativeGeneratedScene(sources,lighting,post,camera,generation,revision,environment.surfaceState,
        environment.cloudColor,environment.sky,environment.fogProjection,environment.storm,stormContext,orbitTargets,picking,animals)
}

/** Small resource charges only, not source buffers/pixels. The renderer can
 * validate a replacement against the complete live world's budgets without
 * retaining an obsolete generated scene or trusting a per-owner limit alone. */
class NativeSceneInventory private constructor(private val entries:Map<String,Charge>) {
    private class Charge(val geometry:Map<String,Long>,val images:Map<String,Long>,val instances:Long,val payload:Long,val packets:Int)
    val footprint:GpuFootprint
    val payloadBytes:Long
    init {
        val geometry=linkedMapOf<String,Long>();val images=linkedMapOf<String,Long>();var instances=32L;var payload=0L;var packets=0
        for(charge in entries.values){geometry.putAll(charge.geometry);images.putAll(charge.images);instances+=charge.instances;payload+=charge.payload;packets+=charge.packets}
        require(payload<=WorldPackets.MAX_BYTES&&packets<=30_000)
        payloadBytes=payload;footprint=GpuFootprint(geometry.values.sum(),instances,images.values.sum())
    }
    fun replacing(source:NativePacketSource):NativeSceneInventory = replacing(listOf(source))
    fun replacing(sources:List<NativePacketSource>):NativeSceneInventory {
        require(sources.size<=4096&&sources.map{it.owner}.distinct().size==sources.size&&sources.all{it.owner!="world"&&it.owner in entries})
        return NativeSceneInventory(LinkedHashMap(entries).apply{for(source in sources)put(source.owner,charge(source))})
    }
    companion object {
        private fun charge(source:NativePacketSource):Charge {
            val geometry=linkedMapOf<String,Long>();val images=linkedMapOf<String,Long>();val world=source.world
            if(world!=null){for((i,g)in world.geometries.withIndex())geometry[source.geometryKeys[i]]=g.vertexCount*64L+g.indexCount*4L
                if(world.materials.any{JSONObject(it).isNull("texture")})images["white"]=4}
            for(texture in source.textures)images[texture.identity]=texture.gpuBytes
            source.precipitation?.input?.ground?.texture?.let{images[it.identity]=it.gpuBytes}
            return Charge(geometry,images,world?.packets?.sumOf{it.count*96L}?:0,world?.byteSize?.toLong()?:0,world?.packets?.size?:0)
        }
        fun of(sources:List<NativePacketSource>):NativeSceneInventory {
            require(sources.size<=4096&&sources.map{it.owner}.distinct().size==sources.size)
            return NativeSceneInventory(sources.associate{it.owner to charge(it)})
        }
    }
}
