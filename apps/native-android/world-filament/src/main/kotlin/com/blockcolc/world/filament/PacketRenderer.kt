package com.blockcolc.world.filament

import android.content.res.AssetManager
import android.graphics.BitmapFactory
import com.blockcolc.world.*
import com.google.android.filament.*
import com.google.android.filament.android.TextureHelper
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.io.FileInputStream
import java.nio.channels.FileChannel
import org.json.JSONObject
import org.json.JSONArray
import kotlin.math.*

/** Render-thread only. Stage a complete owner before swapping attachments;
 * other owners keep their entities and pooled VBOs / textures. */
class PacketRenderer(private val engine: Engine, private val scene: Scene, private val assets: AssetManager,
                     private val cullingEnabled: Boolean = true, private val surfaceEffectsEnabled: Boolean = true,
                     private val surfaceOpticsEnabled: Boolean = true, private val nightReflectionsEnabled:Boolean = true,
                     private val fogEnabled:Boolean=true,initialCloudSeconds:Float=0f,initialWeatherElapsedMs:Float=0f) {
    private data class GeometryGpu(val vertex: VertexBuffer, val index: IndexBuffer)
    private var vertexUploadChunks=0L
    private var peakVertexUploadBytes=0
    private data class PacketGpu(val packet: DrawPacket, val entity: Int, val data: Texture?,
                                 val material: MaterialInstance, val geometryKey: String, val textureKey: String?,
                                 val groundKey:String?=null,val weather:SourcePrecipitation?=null,val weatherMinimumIndex:Int=0,var attached:Boolean=false,
                                 val atlasKeys:List<String> = emptyList(),var coverage:SurfaceCoverage,val fog:Boolean,
                                 val environment:NativeMaterialBinding?=null,val emission:LinearRgb=LinearRgb.BLACK,val emissionStrength:Float=0f,
                                 val roughness:Float=.9f,val metallic:Float=0f,val lit:Boolean=true,val cloudOriginSeconds:Float?=null,val weatherOriginMs:Float?=null,var skyVisible:Boolean=true,val toneMapped:Boolean=true,
                                 val paper:Boolean=false)
    private data class Source(val metadata: JSONObject, val world: WorldPackets, val geometryKeys: List<String>,
                              val surfaceCoverage: List<SurfaceCoverage>,val lighting:SourceLighting,val footprint:GpuFootprint,
                              val weather:SourceWeatherContext?,val groundImages:Map<Int,GroundHeights>,val animalInput:AnimalHabitatInput?,val animalInitial:AnimalInitialState?,val animalScale:Double,
                              val atlasTimelines:List<AtlasTimeline>,val nativePixels:Map<Int,NativePixelTexture> = emptyMap(),
                              val nativeBindings:List<NativeMaterialBinding?> = emptyList(),val nativeSurfaceState:NativeSurfaceState?=null,
                              val nativeCloudColor:LinearRgb?=null,val nativeLayer:NativePacketLayer?=null,val nativeGround:NativeGroundTexture?=null,val nativeSkyState:NativeSkyState?=null,val nativeDirect:Boolean=false,val nativeOwner:String?=null)
    private class AtlasGpu(val timeline:AtlasTimeline,val framesKey:String,val blendKey:String,val owner:String?=null){
        val frames=AtlasByteUploads(timeline.pixels.size);val blends=AtlasByteUploads(timeline.blendPixels.size)
        fun close(){frames.close();blends.close()}
    }
    private val programs = mutableMapOf<String, Material>()
    private val geometry = ResourcePool<String, GeometryGpu> { value ->
        try { engine.destroyVertexBuffer(value.vertex) } finally { engine.destroyIndexBuffer(value.index) }
    }
    private val textures = ResourcePool<String, Texture> { engine.destroyTexture(it) }
    private var owners: OwnerResources<PacketGpu>? = null
    private var projectionOnly = false
    private var closed = false
    data class GeneratedEnvironment(val uniforms:NativeSceneEnvironment,val camera:NativeSceneCamera)
    private var nativeEnvironment:GeneratedEnvironment?=null
    private var nativeInventory:NativeSceneInventory?=null
    lateinit var metadata: JSONObject; private set
    var payloadBytes = 0; private set
    private var coverage = emptyList<SurfaceCoverage>()
    private var skyPackets=emptyList<PacketGpu>()
    private var lodPackets=emptyMap<String,List<PacketGpu>>()
    private var lodSelector:ScenerySelector?=null
    private var runtimeData:Texture?=null
    private val runtimeUniforms=WorldRuntimeUniforms()
    private var cameraDistance=1.0
    private var cameraDepthOffset=0.0
    private var projectedFog:NativeFogRange?=null
    private var fogProjectionUploads=0
    private var clockUploads=0
    private var instanceRowUploads=0
    private var runtimeCloudSeconds=initialCloudSeconds.also{require(it.isFinite()&&it>=0f)}
    private var runtimeWeatherElapsedMs=initialWeatherElapsedMs.also{require(it.isFinite()&&it>=0f)}
    private var footprint:GpuFootprint?=null
    private var weatherContext:SourceWeatherContext?=null
    private var weatherState:WeatherFieldState?=null
    private var weatherPackets=emptyList<PacketGpu>()
    private var weatherFrame:WeatherRenderFrame?=null
    private var animalRuntime:NativeAnimalRuntime?=null
    private var nativeAnimalPrepared:NativeAnimalPrepared?=null
    private var nativeAnimalPicking:NativeAnimalPickTemplate?=null
    private var animalPackets=emptyList<PacketGpu>()
    private val animalSlots=mutableMapOf<Int,Pair<Int,IntArray>>()
    private val animalUploads=mutableMapOf<Int,AnimalRowUploads>()
    private var animalPending=false
    private var animalUploadFrames=0
    private var animalBackpressure=0
    private var atlasGpu=emptyList<AtlasGpu>()
    private var atlasUploads=0
    private var atlasBackpressure=0
    private var stormRuntime:NativeStormRuntime?=null
    private var stormWeather:NativeStormWeather?=null
    private var stormLight=0
    private var stormFlash=NativeStormFlash.NONE
    private var stormFlashPeak=0f
    private var cloudPackets=emptyList<PacketGpu>()
    private var stormPackets=emptyList<PacketGpu>()
    private var paperPackets=emptyList<PacketGpu>()
    private val stormUploads=mutableMapOf<Int,InstanceRowUploads>()
    private var stormElapsedMs=0.0
    private var stormPose= -1L
    private var stormScale=Double.NaN
    private var stormOpacity=Float.NaN
    private var stormVisible=false
    var hasAnimation=false;private set
    val hasNightAnimation get()=coverage.any{it.optics.night.stars>.01f}
    private val sourceEye=DoubleArray(3)
    private var sourceSkyRadius=1.0
    val hasSkyBackdrop get()=coverage.any{it.optics.sky}
    private val skyTransform=FloatArray(16).apply{this[0]=1f;this[5]=1f;this[10]=1f;this[15]=1f}
    val loadedPackets: Int get() = owners?.snapshot()?.values?.sumOf { it.size } ?: 0

    private fun sha(vararg buffers: ByteBuffer): String {
        val hash=MessageDigest.getInstance("SHA-256")
        for(buffer in buffers)hash.update(buffer.duplicate())
        return hash.digest().joinToString(""){"%02x".format(it.toInt() and 255)}
    }
    private fun read(name:String,packed:JSONObject?=null):Source {
        WorldFixtures.requireStem(name)
        val json=packed?.getJSONObject("metadata")?:assets.open("$name.world.json").bufferedReader().use{reader->
            val text=reader.readText();require(text.length<=16*1024*1024);JSONObject(text)
        }
        require(json.optInt("exportSchema") in 7..10){"Re-export complete source input with schema 7..10"}
        SourceCamera.read(json.getJSONObject("cameraVolume"))
        val source=packed?.getString("bytes")?.let{ByteBuffer.wrap(android.util.Base64.decode(it,android.util.Base64.DEFAULT))}?:assets.openFd("$name.bin").use{fd->
            require(fd.length in 16..WorldPackets.MAX_BYTES.toLong())
            FileInputStream(fd.fileDescriptor).use{file->file.channel.map(FileChannel.MapMode.READ_ONLY,fd.startOffset,fd.length)}
        }
        require(sha(source)==json.getString("binarySha256")){"World payload differs from frozen input"}
        val input=WorldPackets.read(json.toString(),source)
        // Check live environment and shader inputs before creating any GPU resources.
        val lighting=SourceLighting.read(json.getJSONObject("environment"))
        SourcePost.read(json.getJSONObject("environment").getJSONObject("pipeline"))
        require(!fogEnabled||lighting.fog==null||lighting.lights.any{it.type=="DirectionalLight"}){
            "Ambient-only source linear fog is not yet supported by this pinned-engine adapter"
        }
        val images=json.getJSONArray("textures");require(images.length()<=4096)
        val timelines=AtlasTimeline.readAll(json)
        for(t in timelines)for((id,role)in listOf(t.texture to "frames",t.blendTexture to "blend")){
            require(id in 0 until images.length());val image=images.getJSONObject(id)
            require(image.getString("animationIdentity")==t.identity&&image.getString("animationRole")==role)
        }
        for(i in 0 until images.length()){
            val item=images.getJSONObject(i);require(item.getInt("id")==i)
            require(item.getString("image").matches(Regex("[a-f0-9]{64}")))
            val width=item.getInt("width");val height=item.getInt("height")
            require(width in 1..8192&&height in 1..8192&&width.toLong()*height<=32*1024*1024)
            require(item.getString("colorSpace") in setOf("srgb","srgb-linear",""))
            require(item.optString("encoding","png") in setOf("png","r32f-le"))
            if(item.optString("encoding")=="r32f-le")require(width<=512&&height<=512&&item.getString("colorSpace")==""
                &&item.getInt("minFilter")==1003&&item.getInt("magFilter")==1003&&item.getInt("wrapS")==1001&&item.getInt("wrapT")==1001)
        }
        for(material in input.materials){
            val value=JSONObject(material)
            require(value.get("fog") is Boolean)
            require(value.getInt("billboard") in 0..2)
            if(value.getBoolean("transparent"))require(value.getInt("blending")==1||value.getInt("blending")==2&&value.getBoolean("unlit")){
                "Unreviewed transparent blend mode"
            }
            if(!value.isNull("texture"))require(value.getInt("texture") in 0 until images.length()
                &&images.getJSONObject(value.getInt("texture")).optString("encoding","png")=="png")
        }
        val keys=input.geometries.map{g->g.vertexCount.toString()+":"+g.indexCount+":"+sha(input.section(g.vertex),input.section(g.index))}
        val definitions=json.getJSONArray("programs")
        val audited=input.materials.map{raw->
            val value=JSONObject(raw);val recipe=value.optJSONObject("recipe")
            ReviewedSurfacePrograms.resolve(recipe?.let{definitions.getJSONObject(it.getInt("program"))},recipe?.getJSONObject("uniforms"))
        }
        val gaps=json.getJSONArray("unsupported")
        val structuralGap=(0 until gaps.length()).any{i->val g=gaps.getJSONObject(i)
            when(g.getString("kind")){
                "custom-program"->false // Exact identity AND every closure are checked below.
                "unported-material-model"->g.getString("name")!="MeshLambertMaterial"||input.materials.indices.any{k->
                    JSONObject(input.materials[k]).getString("sourceType")=="MeshLambertMaterial"&&audited[k].optics.cloud==null}
                else->true
            }}
        require(projectionOnly||!structuralGap&&audited.all{it.pending.isEmpty()}){
            "Unported production programs; select explicit geometry-projection mode for diagnosis only"
        }
        for(packet in input.packets)if(audited[packet.material].optics.fluidSurface)
            require(packet.auxChannels.containsAll(listOf("instanceFaceOcclusion","instanceMaterialResponse"))){"Fluid program has no packed surface input"}
        for(packet in input.packets){val atlas=audited[packet.material].optics.atlas
            require((input.geometries[packet.geometry].vertexPreparation=="atlas-static-v1")== (atlas!=null)){"Atlas vertex preparation / program mismatch"}
            if(atlas!=null){
                require(timelines.any{it.texture==atlas.lookup&&it.blendTexture==atlas.blend}){"Atlas lookup has no admitted timeline"}
                require(packet.auxChannels==listOf("instanceFaceOcclusion","instanceMaterialResponse"))
                for(id in listOf(atlas.lookup,atlas.blend)){require(id in 0 until images.length());val image=images.getJSONObject(id)
                    require(image.optString("encoding","png")=="png"&&image.getString("colorSpace")==""&&image.getInt("width")==atlas.lookupSize[0].toInt()
                        &&image.getInt("height")==atlas.lookupSize[1].toInt()&&image.getInt("minFilter")==1003&&image.getInt("magFilter")==1003)}
            }
        }
        for(packet in input.packets)if(audited[packet.material].optics.cloud!=null){
            require(packet.auxChannels==listOf("cloudCenter","cloudVelocity")){"Cloud program has no advection input"}
            SourceLambert.read(lighting,packet.bounds)
            val m=JSONObject(input.materials[packet.material]);require(!m.getBoolean("transparent")&&!packet.castShadow&&!packet.receiveShadow)
            require((0..2).all{m.getJSONArray("emissive").getDouble(it)==0.0}){"Unreviewed emissive cloud"}
        }
        val context=if(json.optInt("exportSchema")>=8)SourceWeatherContext.read(json.getJSONObject("precipitation"))else null
        val groundImages=mutableMapOf<Int,GroundHeights>()
        val populations=mutableMapOf<String,BooleanArray>()
        for(packet in input.packets)audited[packet.material].optics.precipitation?.let{weather->
            val ctx=requireNotNull(context){"Precipitation context missing"};val kind=if(weather.snow)"snow" else "rain"
            val population=ctx.populations.single{it.kind==kind};val seen=populations.getOrPut(kind){BooleanArray(population.capacity)}
            require(packet.layer=="precipitation"&&packet.owner=="world"&&packet.auxChannels==listOf("weatherPhase","weatherOffset")
                &&!packet.castShadow&&!packet.receiveShadow&&packet.lod==null)
            val m=JSONObject(input.materials[packet.material]);require(m.getBoolean("unlit")&&m.getBoolean("transparent")&&!m.getBoolean("fog")
                &&m.isNull("texture")&&!m.getBoolean("depthWrite")&&m.getInt("billboard")==0)
            val aux=input.section(packet.aux!!)
            repeat(packet.count){i->val index=aux.getFloat(i*16+12).toInt();require(index in seen.indices&&!seen[index]){"Incomplete or duplicate weather seeds"};seen[index]=true}
            val id=weather.groundTexture;require(id in 0 until images.length())
            val image=images.getJSONObject(id);require(image.optString("encoding")=="r32f-le"){"Precipitation ground must remain float"}
            if(id !in groundImages){
                val encoded=assets.open("images/${image.getString("image")}.f32").use{
                    require(it.available()==image.getInt("width")*image.getInt("height")*4){"Ground file size differs"};it.readBytes()}
                require(encoded.size==image.getInt("width")*image.getInt("height")*4&&sha(ByteBuffer.wrap(encoded))==image.getString("image"))
                groundImages[id]=GroundHeights(image.getInt("width"),image.getInt("height"),ByteBuffer.wrap(encoded))
            }
        }
        if(input.packets.any{it.owner=="world"})for(population in context?.populations.orEmpty())
            require(populations[population.kind]?.all{it}==true){"Source weather capacity was truncated"}
        var animalInput:AnimalHabitatInput?=null;var animalInitial:AnimalInitialState?=null;var animalScale=1.0
        if(json.optInt("exportSchema")>=9){
            val descriptor=json.getJSONObject("animalRuntime")
            require(descriptor.getInt("schema")==1&&descriptor.getString("file")=="$name.animals.bin")
            val hash=descriptor.getString("sha256");require(hash.matches(Regex("[a-f0-9]{64}")))
            val raw=packed?.getString("animals")?.let{ByteBuffer.wrap(android.util.Base64.decode(it,android.util.Base64.DEFAULT))}?:assets.openFd("$name.animals.bin").use{fd->require(fd.length in 32..(32L*1024*1024))
                FileInputStream(fd.fileDescriptor).use{f->f.channel.map(FileChannel.MapMode.READ_ONLY,fd.startOffset,fd.length)}}
            require(sha(raw)==hash){"Animal collision payload differs"}
            val ownerRows=descriptor.getJSONArray("owners");require(ownerRows.length()<=4096)
            animalInput=AnimalHabitatInput.read(raw,List(ownerRows.length()){ownerRows.getString(it)})
            require(animalInput.surfaces.size==descriptor.getInt("surfaceCount")&&animalInput.solids.size==descriptor.getInt("solidCount"))
            val scale=descriptor.get("activityScale");require(scale is Number&&scale.toDouble().isFinite()&&scale.toDouble() in .25..1.0);animalScale=scale.toDouble()
            if(name.endsWith("-update")){
                require(descriptor.getString("scope")=="owner-update"&&descriptor.getString("owner")=="building:complex-0"&&animalInput.surfaces.isEmpty()
                    &&animalInput.solids.all{it.owner==descriptor.getString("owner")})
            }else{
                animalInitial=AnimalInitialState.read(descriptor)
                val seen=AnimalRig.capacities.map{BooleanArray(it)}
                for(packet in input.packets.filter{it.layer=="animals"}){
                    require(packet.owner=="world"&&packet.auxChannels==listOf("animalSlot")&&!packet.castShadow&&packet.lod==null)
                    val aux=input.section(packet.aux!!);val kind=aux.getFloat(4).toInt()
                    repeat(packet.count){i->val slot=aux.getFloat(i*16).toInt();require(aux.getFloat(i*16+4).toInt()==kind&&slot in seen[kind].indices&&!seen[kind][slot]);seen[kind][slot]=true}
                }
                require(seen.all{kind->kind.all{it}}){"Incomplete native animal rig slots"}
            }
        }else require(input.packets.none{it.auxChannels==listOf("animalSlot")}){"Animal slots need collision / behavior input"}
        return Source(json,input,keys,audited,lighting,GpuFootprint.read(input,json),context,groundImages,animalInput,animalInitial,animalScale,timelines)
    }
    fun load(fixture:String,allowProjectionOnly:Boolean=false){
        check(!closed&&owners==null);projectionOnly=allowProjectionOnly
        val source=read(fixture)
        adopt(listOf(source),source.world.packets.map{it.owner}.toSet(),source.footprint)
    }
    /** Native CPU generation supplies validated buffers and immutable pixels.
     * No fixture name, file, captured world or JavaScript execution is involved. */
    fun loadGenerated(input:NativeGeneratedScene) {
        check(!closed&&owners==null);projectionOnly=false
        val prepared=input.sources.mapNotNull{source->source.world?.let{generatedSource(source,input.environment,input.camera,input.animals)}}
        adopt(prepared,input.sources.map{it.owner}.toSet(),input.footprint)
        nativeAnimalPrepared=input.animals?.prepared
        nativeAnimalPicking=input.animals?.picking
        nativeEnvironment=GeneratedEnvironment(input.environment,input.camera)
        updateAnimalActivity(input.environment)
        nativeInventory=input.inventory
        input.stormContext?.let{context->
            stormRuntime=NativeStormRuntime(context);stormWeather=checkNotNull(input.environment.storm)
            val light=EntityManager.get().create();val color=NativeStormFlash.COLOR
            try{LightManager.Builder(LightManager.Type.POINT).color(color.red,color.green,color.blue).intensityCandela(0f)
                .falloff(NativeStormFlash.RANGE).castShadows(false).build(engine,light);scene.addEntity(light);stormLight=light}
            catch(error:Throwable){engine.destroyEntity(light);EntityManager.get().destroy(light);throw error}
        }
        hasAnimation=hasAnimation||stormWeather?.thunderstorm==true
        val camera=input.camera;val p=camera.position;val t=camera.target
        projectFog(sqrt((p.x-t.x).pow(2)+(p.y-t.y).pow(2)+(p.z-t.z).pow(2)))
    }
    /** Uniform-only updates retain every entity, geometry, texture and instance
     * row. On failure restore the previous uniforms before exposing the input. */
    fun updateGeneratedEnvironment(uniforms:NativeSceneEnvironment,camera:NativeSceneCamera?=null):GeneratedEnvironment{
        check(!closed)
        val current=checkNotNull(nativeEnvironment)
        val draws=owners?.snapshot().orEmpty().values.flatten()
        require(!uniforms.directColor||draws.none{it.lit}||uniforms.lighting.lights.any{it.type=="DirectionalLight"}){"Native direct lit colour requires the generated directional-light contract"}
        require(uniforms.surfaceState!=null||draws.all{it.environment==null})
        require(uniforms.cloudColor!=null||draws.none{it.environment?.cloud==true})
        require(uniforms.sky!=null||draws.none{it.environment?.sky!=null})
        for(draw in draws)if(draw.environment?.sky==NativeSkyRole.DOME)require(draw.coverage.optics.floatingSky==uniforms.sky!!.floating)
        // Validate unsupported point-light influence before touching any GPU
        // uniform; its finite support must not intersect a wrapping cloud.
        for(draw in draws)if(draw.environment?.cloud==true)SourceLambert.read(uniforms.lighting,draw.packet.bounds)
        try{for(draw in draws)applyGeneratedUniforms(draw,uniforms);applyProjectedFog(uniforms.fogProjection)}catch(error:Throwable){
            for(draw in draws)try{applyGeneratedUniforms(draw,current.uniforms)}catch(rollback:Throwable){error.addSuppressed(rollback)}
            try{applyProjectedFog(current.uniforms.fogProjection)}catch(rollback:Throwable){error.addSuppressed(rollback)}
            throw error
        }
        nativeEnvironment=GeneratedEnvironment(uniforms,camera?:current.camera)
        updateAnimalActivity(uniforms)
        uniforms.storm?.let{stormWeather=it}
        coverage=draws.map{it.coverage}.distinct()
        hasAnimation=draws.any{it.coverage.optics.let{o->o.night.stars>0||o.cloud!=null||o.precipitation!=null||o.cascade!=null||o.atlas?.animated==true}||it.entity in animalSlots}||stormWeather?.thunderstorm==true
        return current
    }
    private fun updateAnimalActivity(environment:NativeSceneEnvironment){
        val state=environment.surfaceState?:return
        animalRuntime?.updateActivityScale(if(state.nightFactor>.55f).45 else if(state.clearSky==1f)1.0 else .7)
    }
    private fun applyGeneratedUniforms(draw:PacketGpu,uniforms:NativeSceneEnvironment){
        if (draw.paper) {
            paperUniforms(draw.material, uniforms.lighting, uniforms.surfaceState, uniforms.storm?.thunderstorm == true)
            return
        }
        val state=uniforms.surfaceState
        val projected=if(state!=null)draw.environment?.surface?.resolve(state)?:draw.coverage else draw.coverage
        val surface=projected.copy(optics=projected.optics.copy(atlas=draw.coverage.optics.atlas))
        val coverage=if(draw.environment?.sky==NativeSkyRole.DOME)surface.copy(optics=surface.optics.copy(night=checkNotNull(uniforms.sky).night.copy(gain=1f)))else surface
        applySurfaceUniforms(draw.material,coverage)
        draw.skyVisible=applySkyUniforms(draw.material,draw.environment?.sky,uniforms.sky,uniforms.lighting.exposure,uniforms.directColor,draw.toneMapped)
        if(draw.environment?.sky!=null)attach(draw,true)
        val fog=uniforms.lighting.fog;val color=fog?.color?:listOf(0f,0f,0f)
        draw.material.setParameter("fogEnabled",fogEnabled&&draw.fog&&fog!=null)
        draw.material.setParameter("fogColor",color[0],color[1],color[2]);draw.material.setParameter("fogRange",fog?.near?:0f,fog?.far?:1f)
        if(draw.environment?.cloud==true){val cloud=checkNotNull(uniforms.cloudColor)
            draw.material.setParameter("baseColor",cloud.red,cloud.green,cloud.blue,1f)
            applyLambert(draw.material,SourceLambert.read(uniforms.lighting,draw.packet.bounds))
        }
        if(draw.lit){val optics=if(surfaceOpticsEnabled)coverage.optics else SurfaceOptics.NONE
            draw.material.setParameter("roughness",optics.roughness(draw.roughness));draw.material.setParameter("metallic",optics.metallic(draw.metallic))
            val strength=if(state!=null)draw.environment?.emission(state,draw.emissionStrength)?:draw.emissionStrength else draw.emissionStrength
            draw.material.setParameter("emissive",draw.emission.red*strength,draw.emission.green*strength,draw.emission.blue*strength)
        }
        draw.coverage=coverage
    }
    private fun applySurfaceUniforms(material:MaterialInstance,coverage:SurfaceCoverage){
        fun vector(name:String,value:List<Float>){material.setParameter(name,value[0],value[1],value[2])}
        val effects=if(surfaceEffectsEnabled)coverage.effects else SurfaceEffects.NONE
        vector("effectDirection",effects.direction);vector("effectLightTint",effects.lightTint);vector("effectShadowTint",effects.shadowTint)
        material.setParameter("effectStrength",effects.strength);material.setParameter("effectEdgeStrength",effects.edgeStrength)
        val optics=if(surfaceOpticsEnabled)coverage.optics else SurfaceOptics.NONE;val night=optics.night
        material.setParameter("skyStars",night.stars);material.setParameter("skyGalaxy",night.galaxy);material.setParameter("skyAurora",night.aurora)
        material.setParameter("skyTime",night.time);material.setParameter("skyDensity",night.density);material.setParameter("skyMeteor",night.meteor)
        material.setParameter("skyGain",if(nightReflectionsEnabled)night.gain else 0f)
        vector("skyColdDirection",night.coldDirection);vector("skyGalaxyNormal",night.galaxyNormal)
    }
    private fun applySkyUniforms(material:MaterialInstance,role:NativeSkyRole?,sky:NativeSkyState?,exposure:Float,direct:Boolean,toneMapped:Boolean):Boolean {
        val data=NativeMaterialUniforms.pack(role,sky,exposure,direct,toneMapped)
        material.setParameter("nativeSkyData",MaterialInstance.FloatElement.MAT4,data,0,1)
        if(role!=null){val color=when(role){NativeSkyRole.DOME->LinearRgb.WHITE;NativeSkyRole.SUN->checkNotNull(sky).sunColor;NativeSkyRole.MOON->checkNotNull(sky).moonColor}
            material.setParameter("baseColor",color.red,color.green,color.blue,if(role==NativeSkyRole.DOME)1f else checkNotNull(sky).opacity)}
        return when(role){NativeSkyRole.SUN->checkNotNull(sky).sunVisible;NativeSkyRole.MOON->checkNotNull(sky).moonVisible;else->true}
    }
    private fun applyLambert(material:MaterialInstance,lighting:SourceLambert?){
        val hemi=FloatArray(16){index->if(index%4<3)lighting?.hemisphere?.get(index/4*3+index%4)?:0f else 0f}
        material.setParameter("lambertHemisphere",MaterialInstance.FloatElement.MAT4,hemi,0,1)
        val direction=lighting?.direction?:listOf(0f,1f,0f);val direct=lighting?.direct?:listOf(0f,0f,0f)
        material.setParameter("lambertDirection",direction[0],direction[1],direction[2]);material.setParameter("lambertDirect",direct[0],direct[1],direct[2])
    }
    private fun generatedSource(input:NativePacketSource,environment:NativeSceneEnvironment,camera:NativeSceneCamera,animals:NativeAnimalScene?=null):Source {
        val world=requireNotNull(input.world)
        input.validateRuntime(environment)
        for(material in world.materials){val m=JSONObject(material);if(!m.isNull("texture"))require(m.getInt("texture") in input.textures.indices)}
        for(packet in world.packets)if(input.surfaces[packet.material].optics.fluidSurface)require(packet.auxChannels==listOf("instanceFaceOcclusion","instanceMaterialResponse"))
        val metadata=camera.metadata().put("textures",input.textureMetadata())
        require(environment.surfaceState!=null||input.bindings.all{it==null})
        val ground=input.precipitation?.input?.ground?.texture
        val animal=animals?.takeIf{input.layer==NativePacketLayer.ANIMALS}
        return Source(metadata,world,input.geometryKeys,input.surfaces,environment.lighting,input.footprint,input.precipitation?.context,
            if(ground==null)emptyMap()else mapOf(0 to ground.heights),animal?.prepared?.habitat,animal?.initial,animal?.activityScale?:1.0,input.atlasSchedules.map{it.timeline()},input.textures.mapIndexed{i,t->i to t}.toMap(),
            input.bindings,environment.surfaceState,environment.cloudColor,input.layer,ground,environment.sky,environment.directColor,input.owner)
    }
    private fun adopt(sources:List<Source>,ownerNames:Set<String>,inputFootprint:GpuFootprint) {
        val source=sources.first();metadata=source.metadata;coverage=sources.flatMap{it.surfaceCoverage};footprint=inputFootprint
        val weather=sources.mapNotNull{it.weather};require(weather.size<=1)
        weatherContext=weather.singleOrNull();weatherState=weatherContext?.let{WeatherFieldState(it)}
        val animalSource=sources.filter{it.animalInitial!=null};require(animalSource.size<=1)
        animalSource.singleOrNull()?.let{a->animalRuntime=NativeAnimalRuntime(requireNotNull(a.animalInput),checkNotNull(a.animalInitial),a.animalScale,nativeEnvironment?.camera?.paper==true)}
        val eye=metadata.getJSONObject("camera").getJSONArray("position");for(i in 0..2)sourceEye[i]=eye.getDouble(i)
        sourceSkyRadius=SourceCamera.read(metadata.getJSONObject("cameraVolume")).sourceSkyRadius
        val staged=mutableListOf<PacketGpu>()
        val preparedAtlas=mutableListOf<AtlasGpu>()
        try{
            for(current in sources){preparedAtlas+=prepareAtlasRuntime(current);for(packet in current.world.packets)staged+=createPacket(current,packet)}
            for(draw in staged)attach(draw,true)
            val grouped=staged.groupBy{it.packet.owner};owners=OwnerResources(ownerNames.associateWith{grouped[it].orEmpty()},::destroyPacket)
            coverage=staged.map{it.coverage}.distinct()
            skyPackets=staged.filter{it.packet.layer=="sky"}
            stormPackets=staged.filter{it.coverage.optics.lightning}
            cloudPackets=staged.filter{it.coverage.optics.cloud!=null}
            paperPackets=staged.filter{it.paper}
            lodPackets=staged.filter{it.packet.lod!=null}.groupBy{it.packet.lod!!.id};lodSelector=ScenerySelector(sources.flatMap{it.world.packets})
            weatherPackets=staged.filter{it.weather!=null}
            animalPackets=staged.filter{it.entity in animalSlots}
            payloadBytes=sources.sumOf{it.world.byteSize}
            atlasGpu=preparedAtlas
        }catch(error:Throwable){
            for(a in preparedAtlas)a.close()
            for(draw in staged.asReversed())try{destroyPacket(draw)}catch(cleanup:Throwable){error.addSuppressed(cleanup)}
            throw error
        }
    }
    fun ownerToken(owner:String):OwnerToken?=owners?.token(owner)
    fun moonCenter():DoubleArray {
        val draw=skyPackets.firstOrNull{it.coverage.optics.moon!=null}?:error("No source moon for this probe")
        return DoubleArray(3){(draw.packet.bounds.min[it].toDouble()+draw.packet.bounds.max[it])*.5}
    }
    fun animalPickSnapshot():NativeAnimalPickSnapshot?=animalRuntime?.let{nativeAnimalPicking?.snapshot(it.rig)}
    fun animalPickPoints():List<Pair<Int,com.blockcolc.world.generation.BlockPoint>> {
        val rig=animalRuntime?.rig?:return emptyList();val result=LinkedHashMap<Int,com.blockcolc.world.generation.BlockPoint>()
        repeat(rig.counts[0]){slot->val id=rig.actorId(0,slot);if(id !in result)result[id]=com.blockcolc.world.generation.BlockPoint(rig.value(0,slot,12).toDouble(),rig.value(0,slot,13).toDouble(),rig.value(0,slot,14).toDouble())}
        return result.entries.map{it.key to it.value}
    }
    fun tapAnimal(id:Int):Boolean=animalRuntime?.community?.tap(id)==true
    fun animalCenter(kind:String):DoubleArray {
        val agents=animalRuntime?.community?.agents.orEmpty().filter{it.kind==kind}
        val a=(if(kind=="land")agents.lastOrNull()else agents.firstOrNull())?:error("No native animal kind $kind")
        return doubleArrayOf(a.position.x,a.position.y+.35,a.position.z)
    }
    private fun attach(draw:PacketGpu,visible:Boolean){
        val next=visible&&draw.skyVisible
        if(draw.attached==next)return
        if(next)scene.addEntity(draw.entity)else scene.removeEntity(draw.entity)
        draw.attached=next
    }
    fun selectLod(eye:DoubleArray,target:DoubleArray,fov:Double,cssHeight:Double){
        for((id,full) in lodSelector?.update(eye,target,fov,cssHeight).orEmpty())
            for(draw in lodPackets.getValue(id))attach(draw,(draw.packet.lod!!.detail=="full")==full)
    }
    fun moveSky(x:Double,y:Double,z:Double,radius:Double){
        if(closed||skyPackets.isEmpty())return
        for(p in skyPackets){val native=p.environment?.sky!=null;val scale=radius/(if(native)NativeSky.RADIUS else sourceSkyRadius);require(scale.isFinite()&&scale>0)
            skyTransform[0]=scale.toFloat();skyTransform[5]=scale.toFloat();skyTransform[10]=scale.toFloat()
            skyTransform[12]=(x-if(native)0.0 else scale*sourceEye[0]).toFloat();skyTransform[13]=(y-if(native)0.0 else scale*sourceEye[1]).toFloat();skyTransform[14]=(z-if(native)0.0 else scale*sourceEye[2]).toFloat()
            engine.transformManager.setTransform(engine.transformManager.getInstance(p.entity),skyTransform)
        }
    }
    private fun runtimeTexture():Texture {
        runtimeData?.let{return it}
        val texture=Texture.Builder().width(2).height(1).levels(1).sampler(Texture.Sampler.SAMPLER_2D).format(Texture.InternalFormat.RGBA32F).build(engine)
        runtimeData=texture;setRuntime(0f,false,cloudSeconds=runtimeCloudSeconds,weatherElapsedMs=runtimeWeatherElapsedMs);return texture
    }
    fun setRuntime(seconds:Float,enabled:Boolean=true,cloudSeconds:Float=seconds,weatherElapsedMs:Float=seconds*1000f,cascadeSeconds:Float=seconds,atlasElapsedMs:Float=weatherElapsedMs,atlasMotion:Boolean=true){
        require(seconds in 0f..Float.MAX_VALUE&&cloudSeconds in 0f..Float.MAX_VALUE&&
            weatherElapsedMs in 0f..Float.MAX_VALUE&&cascadeSeconds in 0f..Float.MAX_VALUE)
        runtimeCloudSeconds=cloudSeconds;runtimeWeatherElapsedMs=weatherElapsedMs
        val texture=runtimeData?:return
        runtimeUniforms.time(seconds,enabled,cloudSeconds,weatherElapsedMs,cascadeSeconds)
        texture.setImage(engine,0,Texture.PixelBufferDescriptor(runtimeUniforms.bytes(),Texture.Format.RGBA,Texture.Type.FLOAT));clockUploads++
        for(a in atlasGpu){
            a.timeline.sample(floor(atlasElapsedMs.toDouble()/50)*50,freeze=!atlasMotion)
            if(!a.timeline.dirty)continue
            val frames=textures[a.framesKey];val blend=textures[a.blendKey]
            if(frames==null||blend==null)continue
            if(!a.frames.available||!a.blends.available){atlasBackpressure++;continue}
            a.frames.upload(engine,frames,a.timeline.pixels);a.blends.upload(engine,blend,a.timeline.blendPixels)
            a.timeline.uploaded();atlasUploads++
        }
    }
    /** One shared upload, independent of packet count. A sample that was
     * calculated before a gesture is always projected at the latest distance. */
    fun projectFog(distance:Double,depthOffset:Double=0.0){
        require(distance.isFinite()&&distance>0&&depthOffset.isFinite()&&depthOffset>=0)
        cameraDistance=distance;cameraDepthOffset=depthOffset
        applyProjectedFog(nativeEnvironment?.uniforms?.fogProjection)
    }
    private fun applyProjectedFog(projection:NativeFogProjection?){
        val next=projection?.range(cameraDistance)?.let{NativeFogRange(it.near+cameraDepthOffset,it.far+cameraDepthOffset)}
        if(next==projectedFog)return
        val previous=projectedFog
        try{
            runtimeUniforms.fog(next)
            runtimeData?.setImage(engine,0,Texture.PixelBufferDescriptor(runtimeUniforms.bytes(),Texture.Format.RGBA,Texture.Type.FLOAT))
            for(draw in paperPackets)applyPaperFog(draw.material,next)
            projectedFog=next;fogProjectionUploads++
        }catch(error:Throwable){
            try{
                runtimeUniforms.fog(previous)
                runtimeData?.setImage(engine,0,Texture.PixelBufferDescriptor(runtimeUniforms.bytes(),Texture.Format.RGBA,Texture.Type.FLOAT))
                for(draw in paperPackets)applyPaperFog(draw.material,previous)
            }catch(rollback:Throwable){error.addSuppressed(rollback)}
            throw error
        }
    }
    private fun prepareAtlasRuntime(source:Source):List<AtlasGpu>{
        val prepared=mutableListOf<AtlasGpu>()
        try{for(t in source.atlasTimelines)prepared+=AtlasGpu(t,textureKey(source,t.texture),textureKey(source,t.blendTexture),source.nativeOwner);return prepared}
        catch(error:Throwable){for(a in prepared)a.close();throw error}
    }
    fun updateWeather(eye:DoubleArray,target:DoubleArray,fov:Double,aspect:Double,near:Double,far:Double,cssHeight:Double){
        val state=weatherState?:return;val context=weatherContext?:return
        val weather=weatherPackets.firstOrNull()?.weather?:return
        val population=context.populations.single{it.kind==if(weather.snow)"snow" else "rain"}
        val frame=state.update(weather,population,eye,target,fov,aspect,near,far,cssHeight)
        if(frame==weatherFrame)return
        weatherFrame=frame;val data=weather.motionData(frame)
        for(draw in weatherPackets){
            data[0]=weather.elapsedMs.toFloat()-(draw.weatherOriginMs?:0f)
            draw.material.setParameter("motionData",MaterialInstance.FloatElement.MAT4,data,0,1);attach(draw,draw.weatherMinimumIndex<frame.count)
        }
    }
    fun advanceAnimals(nowNs:Long,eye:DoubleArray,target:DoubleArray,fov:Double,aspect:Double,near:Double,far:Double,motion:Boolean,orthographic:Boolean=false){
        val runtime=animalRuntime?:return
        if(runtime.advance(nowNs,AnimalCamera(eye,target,fov,aspect,near,far,orthographic),motion))animalPending=true
        if(!animalPending)return
        val targets=animalPackets.filter{draw->val (kind,slots)=animalSlots.getValue(draw.entity);slots.any{it<runtime.rig.counts[kind]}}
        if(targets.any{!animalUploads.getValue(it.entity).available}){animalBackpressure++;return}
        for(draw in animalPackets){
            if(draw in targets){val(kind,slots)=animalSlots.getValue(draw.entity);animalUploads.getValue(draw.entity).upload(engine,checkNotNull(draw.data),runtime.rig,kind,slots);attach(draw,true)}
            else attach(draw,false)
        }
        animalUploadFrames++;animalPending=false
    }
    fun updateLightning(elapsedMs:Double,distance:Double,fov:Double,cssHeight:Double,motion:Boolean){
        val runtime=stormRuntime?:return;stormElapsedMs=elapsedMs
        // Configure on this renderer's actual double-precision visible clock.
        // A scene replacement can inherit a long-running clock; neither zero
        // nor a rounded GPU float is a valid first-strike time origin.
        runtime.configure(checkNotNull(stormWeather),elapsedMs)
        val frame=runtime.update(elapsedMs,motion);val burst=frame.burst
        applyStormFlash(NativeStormFlash.from(frame))
        if(burst==null){for(draw in stormPackets)attach(draw,false);stormVisible=false;return}
        val scale=PrecipitationMath.crossSection(.11,distance,fov,cssHeight,2.6,32.0).first
        if(stormPose!=burst.index||stormScale!=scale){
            if(stormPackets.any{!stormUploads.getValue(it.entity).available}){for(draw in stormPackets)attach(draw,false);stormVisible=false;return}
            for(draw in stormPackets)stormUploads.getValue(draw.entity).upload(engine,checkNotNull(draw.data)){NativeLightningRows.write(burst.vertices,scale,it)}
            stormPose=burst.index;stormScale=scale
        }
        val opacity=frame.opacity.toFloat()
        if(stormOpacity!=opacity){val color=LinearRgb.fromSrgb(0xf2f7ff)
            for(draw in stormPackets)draw.material.setParameter("baseColor",color.red,color.green,color.blue,opacity)
            stormOpacity=opacity
        }
        for(draw in stormPackets)attach(draw,true);stormVisible=stormPackets.isNotEmpty()
    }
    private fun applyStormFlash(value:NativeStormFlash){
        if(value==stormFlash)return
        val position=value.position
        if(stormLight!=0){val lights=engine.lightManager;val instance=lights.getInstance(stormLight)
            lights.setPosition(instance,position.x.toFloat(),position.y.toFloat(),position.z.toFloat())
            lights.setIntensityCandela(instance,value.intensity)
        }
        for(draw in cloudPackets)draw.material.setParameter("stormFlash",position.x.toFloat(),position.y.toFloat(),position.z.toFloat(),value.intensity)
        stormFlash=value;stormFlashPeak=max(stormFlashPeak,value.intensity)
    }
    fun pauseRuntime(){animalRuntime?.pause();stormRuntime?.update(stormElapsedMs,false);applyStormFlash(NativeStormFlash.NONE);for(draw in stormPackets)attach(draw,false);stormVisible=false}
    fun resize(width:Int,height:Int){
        require(width>0&&height>0)
        for(draw in owners?.snapshot().orEmpty().values.flatten())if(!draw.paper)draw.material.setParameter("viewportSize",width.toFloat(),height.toFloat())
    }
    /** Diagnostic injection exercises genuine partial-upload cleanup. */
    fun replaceOwner(fixture:String,owner:String,expected:OwnerToken,failAfterPackets:Int?=null):OwnerUpdateResult{
        check(!closed)
        check(nativeEnvironment==null){"A generated world cannot load a fixture replacement"}
        val store=owners?:error("World not loaded")
        if(store.token(owner)!=expected)return OwnerUpdateResult(false)
        val source=read("$fixture-update")
        return replaceSource(owner,expected,source,failAfterPackets)
    }
    fun replaceGenerated(input:NativePacketSource,expected:OwnerToken,failAfterPackets:Int?=null):OwnerUpdateResult =
        replaceGeneratedMany(listOf(input),mapOf(input.owner to expected),failAfterPackets)
    /** Weather owns multiple independent sources, but publishes one result.
     * Validate the final world's budget, then upload every new owner before
     * changing attachments. A failed cloud/rain upload keeps both old owners. */
    fun replaceGeneratedMany(inputs:List<NativePacketSource>,expected:Map<String,OwnerToken>,failAfterPackets:Int?=null,animals:NativeAnimalScene?=null):OwnerUpdateResult {
        check(!closed);val environment=requireNotNull(nativeEnvironment){"No generated world loaded"}
        val sources=inputs.toList();val tickets=expected.toMap();val store=owners?:error("World not loaded")
        require(sources.isNotEmpty()&&sources.map{it.owner}.distinct().size==sources.size&&sources.map{it.owner}.toSet()==tickets.keys)
        require(sources.all{it.owner!="world"})
        if(tickets.any{store.token(it.key)!=it.value})return OwnerUpdateResult(false)
        for(input in sources)input.validateRuntime(environment.uniforms)
        val inventory=requireNotNull(nativeInventory).replacing(sources)
        val previousAnimals=nativeAnimalPrepared
        val candidateAnimals=animals?.prepared
        val collision=if(previousAnimals!=null&&candidateAnimals!=null){
            require(previousAnimals.habitat.surfaces===candidateAnimals.habitat.surfaces&&previousAnimals.bounds==candidateAnimals.bounds&&previousAnimals.center==candidateAnimals.center
                &&previousAnimals.owners.keys==candidateAnimals.owners.keys){"Animal terrain or owner layout needs a full scene adoption"}
            val changed=candidateAnimals.owners.filter{(owner,values)->previousAnimals.owners[owner]!==values}
            require(changed.keys.all{owner->sources.any{it.owner==owner}}){"Animal collision changes need matching GPU owner uploads"}
            if(changed.isEmpty())null else checkNotNull(animalRuntime).prepareOwners(changed)
        }else{
            require(previousAnimals==null||sources.none{it.owner.startsWith("building:")||it.owner.startsWith("reward:")}){"Generated building updates need current animal collision input"};null
        }
        val prepared=sources.associate{it.owner to it.world?.let{_->generatedSource(it,environment.uniforms,environment.camera)}}
        val preparedAtlas=mutableListOf<AtlasGpu>()
        var uploads=0
        val result=try{
            for(source in prepared.values.filterNotNull())preparedAtlas+=prepareAtlasRuntime(source)
            store.replaceMany(tickets,{owner,staged->
            for(packet in prepared[owner]?.world?.packets.orEmpty()){
                staged+=createPacket(checkNotNull(prepared[owner]),packet);uploads++
                if(failAfterPackets!=null&&uploads>=failAfterPackets)error("Injected staged-upload failure")
            }
        },{previous,next->
            val old=previous.values.flatten();val visible=old.map{it.attached};val staged=next.values.flatten()
            try{for(draw in staged)attach(draw,true);for(draw in old)attach(draw,false)}
            catch(error:Throwable){
                for(draw in staged)try{attach(draw,false)}catch(rollback:Throwable){error.addSuppressed(rollback)}
                for((i,draw)in old.withIndex())try{attach(draw,visible[i])}catch(rollback:Throwable){error.addSuppressed(rollback)}
                throw error
            }
        })}catch(error:Throwable){for(a in preparedAtlas)a.close();refreshGeneratedRuntime();throw error}
        if(result.accepted){
            val replaced=atlasGpu.filter{it.owner in tickets.keys};atlasGpu=atlasGpu.filter{it.owner !in tickets.keys}+preparedAtlas
            for(a in replaced)a.close()
            collision?.commit();if(candidateAnimals!=null)nativeAnimalPrepared=candidateAnimals
            refreshGeneratedRuntime()
            if(sources.any{it.owner==PacketOwners.PRECIPITATION}){
                weatherContext=sources.single{it.owner==PacketOwners.PRECIPITATION}.precipitation?.context
                weatherState=weatherContext?.let{WeatherFieldState(it)};weatherFrame=null
            }
            nativeInventory=inventory;footprint=inventory.footprint;payloadBytes=inventory.payloadBytes.toInt()
        }else for(a in preparedAtlas)a.close()
        return result
    }
    private fun refreshGeneratedRuntime(){
        val draws=owners?.snapshot().orEmpty().values.flatten();coverage=draws.map{it.coverage}.distinct()
        weatherPackets=draws.filter{it.weather!=null};skyPackets=draws.filter{it.packet.layer=="sky"}
        stormPackets=draws.filter{it.coverage.optics.lightning}
        cloudPackets=draws.filter{it.coverage.optics.cloud!=null}
        paperPackets=draws.filter{it.paper}
        animalPackets=draws.filter{it.entity in animalSlots};animalPending=true
        hasAnimation=draws.any{it.coverage.optics.let{o->o.night.stars>0||o.cloud!=null||o.precipitation!=null||o.cascade!=null||o.atlas?.animated==true}||it.entity in animalSlots}||stormWeather?.thunderstorm==true
    }
    private var constructionIndex:JSONObject?=null
    /** Every admitted threshold is generated by the current production builder,
     * including newly exposed faces and collision. No 60%-only demonstration. */
    fun replaceConstruction(fixture:String,progress:Int,expected:OwnerToken):OwnerUpdateResult {
        require(progress in 0..10000)
        val index=constructionIndex?:assets.open("p2-construction.json").bufferedReader().use{JSONObject(it.readText())}.also{constructionIndex=it}
        require(index.getInt("schema")==1&&index.getBoolean("completed"))
        val item=index.getJSONObject("fixtures").getJSONObject(fixture)
        require(item.getString("baseBinary")==metadata.getString("binarySha256")){"Construction cache belongs to a different world"}
        val rows=item.getJSONArray("rows")
        val chosen=(0 until rows.length()).map{rows.getJSONObject(it)}.last{it.getInt("progress")<=progress}
        val file=chosen.getString("file");require(file.matches(Regex("construction/(ocean|coast|valley|floating)-[0-9]{1,5}\\.p2pack")))
        val encoded=assets.open(file).use{input->require(input.available() in 1..(4*1024*1024));input.readBytes()}
        require(sha(ByteBuffer.wrap(encoded))==chosen.getString("sha256")){"Construction cache checksum differs"}
        val decoded=java.util.zip.GZIPInputStream(encoded.inputStream()).use{input->
            val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(16384);var size=0
            while(true){val n=input.read(buffer);if(n<0)break;size+=n;require(size<=32*1024*1024){"Construction expansion budget"};out.write(buffer,0,n)};out.toString("UTF-8")
        }
        return replaceSource("building:complex-0",expected,read("$fixture-update",JSONObject(decoded)),null)
    }
    private fun replaceSource(owner:String,expected:OwnerToken,source:Source,failAfterPackets:Int?):OwnerUpdateResult {
        check(!closed)
        val store=owners?:error("World not loaded")
        if(store.token(owner)!=expected)return OwnerUpdateResult(false)
        require(source.world.packets.all{it.owner==owner}){"Replacement crosses owner boundary"}
        val colliders=source.animalInput?.solids
        if(animalRuntime!=null){require(colliders!=null);animalRuntime!!.habitat.world.validateOwner(owner,colliders)}
        val preparedAtlas=prepareAtlasRuntime(source);var adopted=false
        try{return store.replace(owner,expected,{staged->
            for(packet in source.world.packets){
                staged+=createPacket(source,packet)
                if(failAfterPackets!=null&&staged.size>=failAfterPackets)error("Injected staged-upload failure")
            }
        },{previous,staged->
            val visible=previous.map{it.attached}
            try{
                for(draw in staged)attach(draw,true)
                for(draw in previous)attach(draw,false)
                if(colliders!=null)animalRuntime?.replaceOwner(owner,colliders)
            }catch(error:Throwable){
                for(draw in staged)attach(draw,false)
                for((i,draw) in previous.withIndex())attach(draw,visible[i])
                throw error
            }
        }).also{result->if(result.accepted){val old=atlasGpu;atlasGpu=preparedAtlas;adopted=true;for(a in old)a.close()}}}
        finally{if(!adopted)for(a in preparedAtlas)a.close()}
    }
    fun diagnostics():JSONObject{
        val entities=JSONObject()
        for((owner,draws) in owners?.snapshot().orEmpty())entities.put(owner,JSONArray(draws.map{draw->
            JSONObject().put("entity",draw.entity).put("geometry",draw.geometryKey).put("texture",draw.textureKey).put("instances",draw.packet.count)
        }))
        fun resources(pool:Map<String,Pair<*,Int>>)=JSONObject().apply{
            for((key,entry) in pool)put(key,JSONObject().put("identity",System.identityHashCode(entry.first)).put("references",entry.second))
        }
        return JSONObject().put("owners",entities).put("geometries",resources(geometry.snapshot())).put("textures",resources(textures.snapshot()))
            .put("surfaceEffectsEnabled",surfaceEffectsEnabled)
            .put("surfaceOpticsEnabled",surfaceOpticsEnabled)
            .put("nightReflectionsEnabled",nightReflectionsEnabled)
            .put("fogEnabled",fogEnabled)
            .put("projectedFog",projectedFog?.let{JSONObject().put("near",it.near).put("far",it.far).put("distance",cameraDistance)})
            .put("fogProjectionUploads",fogProjectionUploads)
            .put("nativeUniforms",nativeEnvironment?.uniforms?.let{environment->JSONObject()
                .put("exposure",environment.lighting.exposure.toDouble()).put("clearColor",JSONArray(environment.lighting.clearColor))
                .put("nightFactor",environment.surfaceState?.nightFactor?.toDouble()).put("clearSky",environment.surfaceState?.clearSky?.toDouble())
                .put("nightStars",environment.surfaceState?.night?.stars?.toDouble()).put("nightGalaxy",environment.surfaceState?.night?.galaxy?.toDouble())
                .put("cloudColor",environment.cloudColor?.let{JSONArray(listOf(it.red,it.green,it.blue))})
                .put("sky",environment.sky?.let{sky->JSONObject().put("sunVisible",sky.sunVisible).put("moonVisible",sky.moonVisible).put("opacity",sky.opacity.toDouble())
                    .put("stars",sky.night.stars.toDouble()).put("galaxy",sky.night.galaxy.toDouble()).put("aurora",sky.night.aurora.toDouble()).put("floating",sky.floating)
                    .put("sunDirection",JSONArray(listOf(sky.sunDirection.x,sky.sunDirection.y,sky.sunDirection.z))).put("moonDirection",JSONArray(listOf(sky.moonDirection.x,sky.moonDirection.y,sky.moonDirection.z)))})
                .put("boundMaterials",owners?.snapshot().orEmpty().values.flatten().count{it.environment!=null})})
            .put("cloudInstances",owners?.snapshot().orEmpty().values.flatten().filter{it.packet.layer=="clouds"}.sumOf{it.packet.count})
            .put("cloudClockSeconds",runtimeCloudSeconds.toDouble())
            .put("nativeCloudOrigins",JSONArray(owners?.snapshot().orEmpty().values.flatten().mapNotNull{it.cloudOriginSeconds}.distinct()))
            .put("nativeWeatherOrigins",JSONArray(owners?.snapshot().orEmpty().values.flatten().mapNotNull{it.weatherOriginMs}.distinct()))
            .put("weatherClockElapsedMs",runtimeWeatherElapsedMs.toDouble())
            .put("runtimeClockUploads",clockUploads).put("hasAnimation",hasAnimation).put("skyPackets",skyPackets.size)
            .put("lightningStrikeCount",stormRuntime?.strikeCount?:0).put("lightningActive",stormVisible)
            .put("lightningInstanceUploads",stormUploads.values.sumOf{it.uploads}).put("lightningPackets",stormPackets.size)
            .put("stormFlash",JSONObject().put("entity",stormLight).put("intensityCandela",stormFlash.intensity.toDouble()).put("peakCandela",stormFlashPeak.toDouble())
                .put("cloudBindings",cloudPackets.size).put("actualIntensityCandela",if(stormLight==0)0.0 else engine.lightManager.getIntensity(engine.lightManager.getInstance(stormLight)).toDouble())
                .put("actualRange",if(stormLight==0)0.0 else engine.lightManager.getFalloff(engine.lightManager.getInstance(stormLight)).toDouble()))
            .put("nativeSkyVisible",JSONObject().apply{for(draw in skyPackets)draw.environment?.sky?.let{put(it.name,draw.attached)}})
            .put("instanceRowUploads",instanceRowUploads)
            .put("precipitationPackets",weatherPackets.size).put("precipitationActiveCount",weatherFrame?.count?:0)
            .put("precipitationField",weatherFrame?.field?.json()).put("precipitationSize",weatherFrame?.size?:0)
            .put("precipitationFieldSyncs",weatherState?.syncs?:0)
            .put("nativeAnimals",animalRuntime?.diagnostics()).put("animalUploadFrames",animalUploadFrames).put("animalBackpressure",animalBackpressure)
            .put("atlasUploadFrames",atlasUploads).put("atlasBackpressure",atlasBackpressure)
            .put("atlasSequences",atlasGpu.sumOf{a->a.timeline.sequences.count{it.index in a.timeline.active}})
            .put("atlasMaterials",coverage.count{it.optics.atlas!=null})
            .put("atlasTimelineChanges",atlasGpu.sumOf{it.timeline.changes})
            .put("atlasRuntime",JSONArray(atlasGpu.map{a->JSONObject().put("owner",a.owner?:JSONObject.NULL).put("identity",a.timeline.identity)
                .put("frames",AtlasTimeline.hash(a.timeline.pixels)).put("blends",AtlasTimeline.hash(a.timeline.blendPixels)).put("active",JSONArray(a.timeline.active.sorted()))}))
            .put("resourcePack",if(this::metadata.isInitialized)metadata.optJSONObject("resourcePack") else null)
            .put("lodTransitions",lodSelector?.transitions?:0).put("lodLevels",JSONObject(lodSelector?.levels.orEmpty()))
            .put("lodProjectedPixels",JSONObject(lodSelector?.projectedPixels.orEmpty()))
            .put("attachedPackets",owners?.snapshot().orEmpty().values.sumOf{list->list.count{it.attached}})
            .put("inputGpuEstimate",footprint?.json())
            .put("surfaceCoverage",JSONArray(coverage.map{JSONObject().put("applied",JSONArray(it.applied)).put("pending",JSONArray(it.pending))}))
            .put("geometryCreated",geometry.created).put("geometryDestroyed",geometry.destroyed)
            .put("vertexUploadChunks",vertexUploadChunks).put("peakVertexUploadBytes",peakVertexUploadBytes)
            .put("textureCreated",textures.created).put("textureDestroyed",textures.destroyed).put("packets",loadedPackets)
    }
    private fun createGeometry(source:Source,g:Geometry):GeometryGpu{
        val layout=VertexBuffer.Builder().vertexCount(g.vertexCount).bufferCount(1)
        val vb=if(g.paper)layout
            .attribute(VertexBuffer.VertexAttribute.POSITION,0,VertexBuffer.AttributeType.FLOAT3,0,g.vertexStride)
            .attribute(VertexBuffer.VertexAttribute.COLOR,0,VertexBuffer.AttributeType.UBYTE4,12,g.vertexStride)
            .normalized(VertexBuffer.VertexAttribute.COLOR).build(engine)
        else layout
            .attribute(VertexBuffer.VertexAttribute.POSITION,0,VertexBuffer.AttributeType.FLOAT3,0,64)
            .attribute(VertexBuffer.VertexAttribute.TANGENTS,0,VertexBuffer.AttributeType.FLOAT4,12,64)
            .attribute(VertexBuffer.VertexAttribute.UV0,0,VertexBuffer.AttributeType.FLOAT2,28,64)
            .attribute(VertexBuffer.VertexAttribute.COLOR,0,VertexBuffer.AttributeType.FLOAT4,36,64)
            .attribute(VertexBuffer.VertexAttribute.CUSTOM0,0,VertexBuffer.AttributeType.FLOAT3,52,64).build(engine)
        var ib:IndexBuffer?=null
        try{
            ib=IndexBuffer.Builder().indexCount(g.indexCount).bufferType(IndexBuffer.Builder.IndexType.UINT).build(engine)
            if (g.paper) {
                val vertices = source.world.section(g.vertex)
                peakVertexUploadBytes = maxOf(peakVertexUploadBytes, vertices.remaining())
                vertexUploadChunks++
                vb.setBufferAt(engine,0,vertices)
            } else NativeVertexUploads.each(source.world.section(g.vertex).asFloatBuffer(),g.vertexCount){offset,data->
                peakVertexUploadBytes=maxOf(peakVertexUploadBytes,data.remaining());vertexUploadChunks++
                vb.setBufferAt(engine,0,data,offset,data.remaining(),null,null)
                // The same bounded staging buffer is reused by the next chunk.
                // Do not overwrite memory still owned by Filament's driver.
                if(g.vertexCount>NativeVertexUploads.CHUNK_VERTICES)engine.flushAndWait()
            }
            ib.setBuffer(engine,source.world.section(g.index))
            return GeometryGpu(vb,ib)
        }catch(error:Throwable){engine.destroyVertexBuffer(vb);ib?.let{engine.destroyIndexBuffer(it)};throw error}
    }
    private fun textureKey(source:Source,id:Int?):String=if(id==null)"white" else source.nativePixels[id]?.identity?:source.nativeGround?.takeIf{id==0}?.identity?:
        source.metadata.getJSONArray("textures").getJSONObject(id).let{it.optString("encoding","png")+":"+it.getString("image")+":"+it.getString("colorSpace")+":"+it.optString("animationIdentity")+":"+it.optString("animationRole")}
    private fun createTexture(source:Source,id:Int?):Texture{
        if(id==null){
            val texture=Texture.Builder().width(1).height(1).levels(1).sampler(Texture.Sampler.SAMPLER_2D).format(Texture.InternalFormat.RGBA8).build(engine)
            try{texture.setImage(engine,0,Texture.PixelBufferDescriptor(ByteBuffer.allocateDirect(4).putInt(-1).flip(),Texture.Format.RGBA,Texture.Type.UBYTE));return texture}
            catch(error:Throwable){engine.destroyTexture(texture);throw error}
        }
        val item=source.metadata.getJSONArray("textures").getJSONObject(id);val hash=item.getString("image")
        source.nativePixels[id]?.let{image->
            val texture=Texture.Builder().width(image.width).height(image.height).levels(if(image.manualMipmaps.isNotEmpty())image.manualMipmaps.size+1 else if(image.mipmaps)0xff else 1).sampler(Texture.Sampler.SAMPLER_2D)
                .format(if(image.srgb)Texture.InternalFormat.SRGB8_A8 else Texture.InternalFormat.RGBA8).build(engine)
            try {
                val pixels=image.pixels();val data=ByteBuffer.allocateDirect(pixels.remaining()).put(pixels);data.flip()
                texture.setImage(engine,0,Texture.PixelBufferDescriptor(data,Texture.Format.RGBA,Texture.Type.UBYTE))
                for((level,pixelsAt)in image.manualMipmaps.withIndex()){
                    // Filament 1.56's Java byte-buffer JNI shifts the supplied mip height
                    // a second time. The Android bitmap entry passes its actual level size.
                    val bitmap=NativeBitmapUploads.rgba(pixelsAt.width,pixelsAt.height,pixelsAt.pixels())
                    var handedOff=false
                    try{
                        TextureHelper.setBitmap(engine,texture,level+1,bitmap,null,Runnable{bitmap.recycle()});handedOff=true
                    }finally{if(!handedOff)bitmap.recycle()}
                }
                if(image.mipmaps&&image.manualMipmaps.isEmpty())texture.generateMipmaps(engine)
                return texture
            }catch(error:Throwable){engine.destroyTexture(texture);throw error}
        }
        if(item.optString("encoding")=="r32f-le"){
            val ground=source.groundImages.getValue(id)
            val texture=Texture.Builder().width(ground.width).height(ground.height).levels(1).sampler(Texture.Sampler.SAMPLER_2D).format(Texture.InternalFormat.R32F).build(engine)
            try{
                val data=ByteBuffer.allocateDirect(ground.width*ground.height*4).order(ByteOrder.LITTLE_ENDIAN).put(ground.bytes());data.flip()
                texture.setImage(engine,0,Texture.PixelBufferDescriptor(data,Texture.Format.R,Texture.Type.FLOAT));return texture
            }catch(error:Throwable){engine.destroyTexture(texture);throw error}
        }
        val encoded=assets.open("images/$hash.png").use{stream->
            require(stream.available()<=32*1024*1024);stream.readBytes().also{require(it.size<=32*1024*1024)}
        }
        require(sha(ByteBuffer.wrap(encoded))==hash){"Texture content differs"}
        val timeline=source.atlasTimelines.firstOrNull{it.texture==id||it.blendTexture==id}
        if(timeline!=null){
            val pixels=if(timeline.texture==id)timeline.pixels else timeline.blendPixels
            val texture=Texture.Builder().width(timeline.width).height(timeline.height).levels(1).sampler(Texture.Sampler.SAMPLER_2D).format(Texture.InternalFormat.RGBA8).build(engine)
            try{val data=ByteBuffer.allocateDirect(pixels.size).put(pixels);data.flip()
                texture.setImage(engine,0,Texture.PixelBufferDescriptor(data,Texture.Format.RGBA,Texture.Type.UBYTE));return texture}
            catch(error:Throwable){engine.destroyTexture(texture);throw error}
        }
        val options=BitmapFactory.Options().apply{inJustDecodeBounds=true}
        BitmapFactory.decodeByteArray(encoded,0,encoded.size,options)
        require(options.outWidth==item.getInt("width")&&options.outHeight==item.getInt("height"))
        val bitmap=BitmapFactory.decodeByteArray(encoded,0,encoded.size)?:error("Invalid PNG")
        var texture:Texture?=null;var handedOff=false
        try{
            val gpu=Texture.Builder().width(bitmap.width).height(bitmap.height).levels(0xff).sampler(Texture.Sampler.SAMPLER_2D)
                .format(if(item.getString("colorSpace")=="srgb")Texture.InternalFormat.SRGB8_A8 else Texture.InternalFormat.RGBA8).build(engine)
            texture=gpu;TextureHelper.setBitmap(engine,gpu,0,bitmap,null,Runnable{bitmap.recycle()});handedOff=true
            gpu.generateMipmaps(engine);return gpu
        }catch(error:Throwable){texture?.let{engine.destroyTexture(it)};throw error}
        finally{if(!handedOff)bitmap.recycle()}
    }
    private fun program(key:String):Material=programs.getOrPut(key){
        val bytes=assets.open("$key.filamat").use{it.readBytes()}
        val data=ByteBuffer.allocateDirect(bytes.size).put(bytes);data.flip()
        Material.Builder().payload(data,data.remaining()).build(engine)
    }
    private fun wrap(value:Int)=when(value){
        1000->TextureSampler.WrapMode.REPEAT;1002->TextureSampler.WrapMode.MIRRORED_REPEAT
        1001->TextureSampler.WrapMode.CLAMP_TO_EDGE;else->error("Unsupported wrap mode")
    }
    private fun sampler(source:Source,texture:Int?):TextureSampler{
        if(texture==null)return TextureSampler(TextureSampler.MinFilter.NEAREST,TextureSampler.MagFilter.NEAREST,TextureSampler.WrapMode.CLAMP_TO_EDGE)
        val item=source.metadata.getJSONArray("textures").getJSONObject(texture)
        val min=when(item.getInt("minFilter")){
            1003->TextureSampler.MinFilter.NEAREST;1004->TextureSampler.MinFilter.NEAREST_MIPMAP_NEAREST
            1005->TextureSampler.MinFilter.NEAREST_MIPMAP_LINEAR;1006->TextureSampler.MinFilter.LINEAR
            1007->TextureSampler.MinFilter.LINEAR_MIPMAP_NEAREST;1008->TextureSampler.MinFilter.LINEAR_MIPMAP_LINEAR
            else->error("Unsupported sampler")
        }
        val mag=when(item.getInt("magFilter")){1003->TextureSampler.MagFilter.NEAREST;1006->TextureSampler.MagFilter.LINEAR;else->error("Unsupported mag filter")}
        return TextureSampler(min,mag,wrap(item.getInt("wrapS"))).apply{
            setWrapModeT(wrap(item.getInt("wrapT")));setAnisotropy(item.optDouble("anisotropy",1.0).toFloat().coerceIn(1f,4f))
        }
    }
    private fun createPacket(source:Source,packet:DrawPacket):PacketGpu{
        val key=source.geometryKeys[packet.geometry]
        val m=JSONObject(source.world.materials[packet.material])
        if (source.world.geometries[packet.geometry].paper) return createPaperPacket(source, packet, key, m)
        val textureId=if(m.isNull("texture"))null else m.getInt("texture");val textureKey=textureKey(source,textureId)
        val g=geometry.acquire(key){createGeometry(source,source.world.geometries[packet.geometry])}
        val weather=source.surfaceCoverage[packet.material].optics.precipitation
        val groundKey=weather?.let{textureKey(source,it.groundTexture)}
        val animalKind=if(packet.auxChannels==listOf("animalSlot"))source.world.section(packet.aux!!).getFloat(4).toInt()else null
        var acquiredTexture=false;var acquiredGround=false;var material:MaterialInstance?=null;var data:Texture?=null;var entity=0
        val atlasKeys=mutableListOf<String>()
        try{
            val baseMap=textures.acquire(textureKey){createTexture(source,textureId)};acquiredTexture=true
            val ground=if(weather!=null){textures.acquire(groundKey!!){createTexture(source,weather.groundTexture)}.also{acquiredGround=true}}else baseMap
            val blending=if(m.getBoolean("transparent")){if(m.getInt("blending")==2)"additive" else "transparent"}else if(m.getDouble("alphaTest")>0)"masked" else "opaque"
            val environmentBinding=source.nativeBindings.getOrNull(packet.material)
            val projectedSurface=environmentBinding?.surface?.resolve(checkNotNull(source.nativeSurfaceState))?:source.surfaceCoverage[packet.material]
            val sourceSurface=projectedSurface.copy(optics=projectedSurface.optics.copy(atlas=source.surfaceCoverage[packet.material].optics.atlas))
            val boundSurface=if(environmentBinding?.sky==NativeSkyRole.DOME)sourceSurface.copy(optics=sourceSurface.optics.copy(night=checkNotNull(source.nativeSkyState).night.copy(gain=1f)))else sourceSurface
            val originalOptics=boundSurface.optics
            val optics=if(surfaceOpticsEnabled)originalOptics else SurfaceOptics.NONE.copy(atlas=originalOptics.atlas,fluidSurface=originalOptics.atlas?.let{!it.shape}?:false)
            val atlas=optics.atlas
            val lookupTextures=if(atlas?.animated==true)listOf(atlas.lookup,atlas.blend).map{id->val k=textureKey(source,id)
                textures.acquire(k){createTexture(source,id)}.also{atlasKeys+=k}}else listOf(baseMap,baseMap)
            val shading=if(m.getBoolean("unlit")||optics.cloud!=null)"unlit" else "lit"
            val instance=program("$shading-$blending").createInstance();material=instance
            val rows=Texture.Builder().width(6).height(packet.count).levels(1).sampler(Texture.Sampler.SAMPLER_2D).format(Texture.InternalFormat.RGBA32F).build(engine);data=rows
            entity=EntityManager.get().create();engine.transformManager.create(entity)
            // One bounded staging buffer per packet, not an expanded world-sized array.
            val instanceRows=source.world.instanceRows(packet)
            rows.setImage(engine,0,Texture.PixelBufferDescriptor(instanceRows,Texture.Format.RGBA,Texture.Type.FLOAT))
            instanceRowUploads++
            instance.setParameter("instanceData",rows,TextureSampler(TextureSampler.MinFilter.NEAREST,TextureSampler.MagFilter.NEAREST,TextureSampler.WrapMode.CLAMP_TO_EDGE))
            instance.setParameter("runtimeData",runtimeTexture(),TextureSampler(TextureSampler.MinFilter.NEAREST,TextureSampler.MagFilter.NEAREST,TextureSampler.WrapMode.CLAMP_TO_EDGE))
            instance.setParameter("baseMap",baseMap,sampler(source,textureId))
            instance.setParameter("atlasLookup",lookupTextures[0],TextureSampler(TextureSampler.MinFilter.NEAREST,TextureSampler.MagFilter.NEAREST,TextureSampler.WrapMode.CLAMP_TO_EDGE))
            instance.setParameter("atlasBlend",lookupTextures[1],TextureSampler(TextureSampler.MinFilter.NEAREST,TextureSampler.MagFilter.NEAREST,TextureSampler.WrapMode.CLAMP_TO_EDGE))
            instance.setParameter("weatherGround",ground,TextureSampler(TextureSampler.MinFilter.NEAREST,TextureSampler.MagFilter.NEAREST,TextureSampler.WrapMode.CLAMP_TO_EDGE))
            val color=m.getJSONArray("color");val cloudColor=if(environmentBinding?.cloud==true)checkNotNull(source.nativeCloudColor)else null
            instance.setParameter("baseColor",cloudColor?.red?:color.getDouble(0).toFloat(),cloudColor?.green?:color.getDouble(1).toFloat(),cloudColor?.blue?:color.getDouble(2).toFloat(),m.getDouble("opacity").toFloat())
            val skyVisible=applySkyUniforms(instance,environmentBinding?.sky,source.nativeSkyState,source.lighting.exposure,source.nativeDirect,m.optBoolean("toneMapped",true))
            val uv=m.getJSONArray("uvTransform")
            instance.setParameter("uvRowU",if(atlas!=null)1f else uv.getDouble(0).toFloat(),if(atlas!=null)0f else uv.getDouble(3).toFloat(),if(atlas!=null)0f else uv.getDouble(6).toFloat())
            instance.setParameter("uvRowV",if(atlas!=null)0f else uv.getDouble(1).toFloat(),if(atlas!=null)1f else uv.getDouble(4).toFloat(),if(atlas!=null)0f else uv.getDouble(7).toFloat())
            instance.setParameter("flipV",m.getBoolean("flipY"));instance.setParameter("vertexColors",m.getBoolean("vertexColors"))
            instance.setParameter("alphaCutoff",m.getDouble("alphaTest").toFloat())
            instance.setParameter("billboardMode",m.getInt("billboard"));instance.setParameter("pointSize",m.getDouble("pointSize").toFloat())
            val billboardCenter=m.getJSONArray("billboardCenter");instance.setParameter("billboardCenter",billboardCenter.getDouble(0).toFloat(),billboardCenter.getDouble(1).toFloat())
            instance.setParameter("viewportSize",720f,960f)
            fun vector(name:String,values:List<Float>){instance.setParameter(name,values[0],values[1],values[2])}
            applySurfaceUniforms(instance,boundSurface)
            val night=optics.night
            val cloud=optics.cloud
            val cascade=optics.cascade
            instance.setParameter("motionKind",if(atlas!=null)6 else if(animalKind!=null)4 else if(weather!=null){if(weather.snow)3 else 2}else if(cloud!=null)1 else if(cascade!=null)5 else 0)
            val motion=atlas?.motion(optics.clearSky?:1f)?:weather?.motionData()?:FloatArray(16).apply{this[0]=cloud?.elapsed?:cascade?.elapsed?:0f;this[1]=cloud?.span?.get(0)?:1f;this[2]=cloud?.span?.get(1)?:1f}
            val cloudOrigin=if(source.nativeLayer==NativePacketLayer.CLOUDS)runtimeCloudSeconds else null
            if(cloudOrigin!=null)motion[0]-=cloudOrigin
            val weatherOrigin=if(source.nativeLayer==NativePacketLayer.PRECIPITATION)runtimeWeatherElapsedMs else null
            if(weatherOrigin!=null)motion[0]-=weatherOrigin
            instance.setParameter("motionData",MaterialInstance.FloatElement.MAT4,motion,0,1)
            val lambert=cloud?.let{SourceLambert.read(source.lighting,packet.bounds)}
            applyLambert(instance,lambert)
            instance.setParameter("stormFlash",stormFlash.position.x.toFloat(),stormFlash.position.y.toFloat(),stormFlash.position.z.toFloat(),stormFlash.intensity)
            if(cloud!=null||night.stars>0f||weather!=null||animalKind!=null||cascade!=null||atlas?.animated==true)hasAnimation=true
            instance.setParameter("skyBackdrop",optics.sky);instance.setParameter("floatingSky",optics.floatingSky)
            instance.setParameter("normalSign",if(m.getInt("side")==1)-1f else 1f)
            instance.setParameter("fluidSurface",optics.fluidSurface);instance.setParameter("distanceOpacity",optics.distanceOpacity)
            val fog=source.lighting.fog
            instance.setParameter("fogEnabled",fogEnabled&&m.getBoolean("fog")&&fog!=null)
            vector("fogColor",fog?.color?:listOf(0f,0f,0f))
            instance.setParameter("fogRange",fog?.near?:0f,fog?.far?:1f)
            if(shading=="lit"){
                instance.setParameter("roughness",optics.roughness(m.getDouble("roughness").toFloat()))
                instance.setParameter("metallic",optics.metallic(m.getDouble("metalness").toFloat()))
                val emission=m.getJSONArray("emissive");val fixed=m.getDouble("emissiveIntensity").toFloat()
                val strength=source.nativeSurfaceState?.let{environmentBinding?.emission(it,fixed)}?:fixed
                instance.setParameter("emissive",emission.getDouble(0).toFloat()*strength,emission.getDouble(1).toFloat()*strength,emission.getDouble(2).toFloat()*strength)
            }
            instance.setDoubleSided(m.getInt("side")==2)
            instance.setCullingMode(when(m.getInt("side")){2->Material.CullingMode.NONE;1->Material.CullingMode.FRONT;0->Material.CullingMode.BACK;else->error("Unsupported side")})
            instance.setDepthWrite(m.getBoolean("depthWrite"));instance.setColorWrite(m.getBoolean("colorWrite"));instance.setDepthCulling(m.getBoolean("depthTest"))
            instance.setDepthFunc(when(reversedDepthComparison(m.getInt("depthFunc"))){
                DepthComparison.NEVER->TextureSampler.CompareFunction.NEVER;DepthComparison.ALWAYS->TextureSampler.CompareFunction.ALWAYS
                DepthComparison.LESS->TextureSampler.CompareFunction.LESS;DepthComparison.LESS_EQUAL->TextureSampler.CompareFunction.LESS_EQUAL
                DepthComparison.EQUAL->TextureSampler.CompareFunction.EQUAL;DepthComparison.GREATER_EQUAL->TextureSampler.CompareFunction.GREATER_EQUAL
                DepthComparison.GREATER->TextureSampler.CompareFunction.GREATER;DepthComparison.NOT_EQUAL->TextureSampler.CompareFunction.NOT_EQUAL
            })
            val b=packet.bounds;val center=FloatArray(3){(b.min[it]+b.max[it])*.5f};val half=FloatArray(3){max(.001f,(b.max[it]-b.min[it])*.5f)}
            RenderableManager.Builder(1).geometry(0,RenderableManager.PrimitiveType.TRIANGLES,g.vertex,g.index).material(0,instance)
                .boundingBox(Box(center,half)).culling(cullingEnabled&&packet.layer !in setOf("sky","clouds","precipitation","animals")&&m.getInt("billboard")==0)
                .priority(packet.priority).instances(packet.count).castShadows(packet.castShadow).receiveShadows(packet.receiveShadow).build(engine,entity)
            val minimum=if(weather!=null)source.world.section(packet.aux!!).let{a->(0 until packet.count).minOf{a.getFloat(it*16+12).toInt()}}else 0
            if(animalKind!=null){val aux=source.world.section(packet.aux!!);animalSlots[entity]=animalKind to IntArray(packet.count){aux.getFloat(it*16).toInt()};animalUploads[entity]=AnimalRowUploads(packet.count)}
            if(boundSurface.optics.lightning)stormUploads[entity]=InstanceRowUploads(packet.count)
            val emission=m.getJSONArray("emissive")
            return PacketGpu(packet,entity,rows,instance,key,textureKey,groundKey,weather,minimum,atlasKeys=atlasKeys.toList(),coverage=boundSurface,fog=m.getBoolean("fog"),
                environment=environmentBinding,emission=LinearRgb(emission.getDouble(0).toFloat(),emission.getDouble(1).toFloat(),emission.getDouble(2).toFloat()),
                emissionStrength=m.getDouble("emissiveIntensity").toFloat(),roughness=m.getDouble("roughness").toFloat(),metallic=m.getDouble("metalness").toFloat(),lit=shading=="lit",cloudOriginSeconds=cloudOrigin,weatherOriginMs=weatherOrigin,skyVisible=skyVisible,toneMapped=m.optBoolean("toneMapped",true))
        }catch(error:Throwable){
            animalUploads.remove(entity)?.close();animalSlots.remove(entity);stormUploads.remove(entity)?.close()
            if(entity!=0){engine.destroyEntity(entity);EntityManager.get().destroy(entity)}
            material?.let{engine.destroyMaterialInstance(it)};data?.let{engine.destroyTexture(it)}
            for(k in atlasKeys.asReversed())textures.release(k)
            if(acquiredGround)textures.release(groundKey!!);if(acquiredTexture)textures.release(textureKey);geometry.release(key);throw error
        }
    }
    private fun createPaperPacket(source:Source,packet:DrawPacket,key:String,material:JSONObject):PacketGpu {
        require(packet.layer == "static" && packet.count == 1 && packet.aux == null &&
            !packet.castShadow && !packet.receiveShadow && material.getBoolean("unlit") &&
            material.getBoolean("vertexColors") && material.isNull("texture"))
        val matrix = source.world.section(packet.instances)
        require((0..15).all { matrix.getFloat(it*4) == if(it % 5 == 0) 1f else 0f })
        val g = geometry.acquire(key) { createGeometry(source,source.world.geometries[packet.geometry]) }
        var instance:MaterialInstance? = null
        var entity = 0
        try {
            val program = program(if(material.getBoolean("transparent"))"paper-fade" else "paper-opaque").createInstance()
            instance = program
            program.setParameter("opacity",material.getDouble("opacity").toFloat())
            paperUniforms(program,source.lighting,source.nativeSurfaceState,nativeEnvironment?.uniforms?.storm?.thunderstorm == true)
            entity = EntityManager.get().create()
            engine.transformManager.create(entity)
            val b = packet.bounds
            val center = FloatArray(3) { (b.min[it]+b.max[it])*.5f }
            val half = FloatArray(3) { max(.001f,(b.max[it]-b.min[it])*.5f) }
            RenderableManager.Builder(1).geometry(0,RenderableManager.PrimitiveType.TRIANGLES,g.vertex,g.index).material(0,program)
                .boundingBox(Box(center,half)).culling(cullingEnabled).priority(packet.priority)
                .castShadows(false).receiveShadows(false).build(engine,entity)
            return PacketGpu(packet,entity,null,program,key,null,coverage=source.surfaceCoverage[packet.material],
                fog=material.getBoolean("fog"),lit=false,paper=true)
        } catch(error:Throwable) {
            if(entity!=0){engine.destroyEntity(entity);EntityManager.get().destroy(entity)}
            instance?.let(engine::destroyMaterialInstance)
            geometry.release(key)
            throw error
        }
    }

    private fun paperUniforms(material:MaterialInstance,lighting:SourceLighting,state:NativeSurfaceState?,storm:Boolean) {
        val night = state?.nightFactor ?: 0f
        val directional = lighting.lights.firstOrNull { it.type == "DirectionalLight" }
        val sun = directional?.color ?: listOf(1f,1f,1f)
        val cover = if(storm) .70f else if(state?.clearSky == 1f) 1f else .90f
        val moon=(directional?.intensity?:0f).coerceIn(0f,.55f)
        val day=1f-night
        val floor=night*(1f+moon*.26f)
        material.setParameter("tint",cover*(day*(.98f+.09f*sun[0])+floor*.34f),
            cover*(day*(.93f+.08f*sun[1])+floor*.43f),cover*(day*(.88f+.10f*sun[2])+floor*.57f))
        // A small cool fill keeps the cutout edges visible over the darker sky.
        material.setParameter("nightFill",night*cover*.014f,night*cover*.019f,night*cover*.032f)
        val fog = lighting.fog
        val sky = fog?.color ?: lighting.clearColor
        material.setParameter("mist",sky[0],sky[1],sky[2])
        applyPaperFog(material,projectedFog ?: fog?.let{NativeFogRange(it.near.toDouble(),it.far.toDouble())})
    }

    private fun applyPaperFog(material:MaterialInstance,range:NativeFogRange?) {
        val visible=range?.takeIf{fogEnabled}
        material.setParameter("fogRange",visible?.near?.toFloat()?:1e6f,visible?.far?.toFloat()?:1e6f+1)
    }
    private fun destroyPacket(draw:PacketGpu){
        attach(draw,false);engine.destroyEntity(draw.entity);EntityManager.get().destroy(draw.entity)
        animalUploads.remove(draw.entity)?.close();animalSlots.remove(draw.entity);stormUploads.remove(draw.entity)?.close()
        engine.destroyMaterialInstance(draw.material);draw.data?.let(engine::destroyTexture)
        geometry.release(draw.geometryKey);draw.textureKey?.let(textures::release)
        draw.groundKey?.let{textures.release(it)}
        for(k in draw.atlasKeys)textures.release(k)
    }
    fun close(){
        if(closed)return;closed=true
        val errors=owners?.close()?:0;owners=null
        skyPackets=emptyList()
        lodPackets=emptyMap();lodSelector=null
        runtimeData?.let{engine.destroyTexture(it)};runtimeData=null
        hasAnimation=false
        for(a in atlasGpu)a.close();atlasGpu=emptyList()
        footprint=null
        nativeEnvironment=null
        nativeInventory=null
        weatherPackets=emptyList();weatherContext=null;weatherState=null;weatherFrame=null
        paperPackets=emptyList()
        animalRuntime?.close();animalRuntime=null;nativeAnimalPrepared=null;nativeAnimalPicking=null;animalPackets=emptyList();animalSlots.clear();for(upload in animalUploads.values)upload.close();animalUploads.clear()
        stormRuntime?.close();stormRuntime=null;stormWeather=null;stormPackets=emptyList();for(upload in stormUploads.values)upload.close();stormUploads.clear();stormVisible=false
        if(stormLight!=0){scene.removeEntity(stormLight);engine.destroyEntity(stormLight);EntityManager.get().destroy(stormLight);stormLight=0};stormFlash=NativeStormFlash.NONE;cloudPackets=emptyList()
        for(material in programs.values)engine.destroyMaterial(material)
        programs.clear()
        check(errors==0&&geometry.snapshot().isEmpty()&&textures.snapshot().isEmpty()){"Native world retirement incomplete: $errors"}
    }
}
