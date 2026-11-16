package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.security.MessageDigest
import java.util.Collections
import java.util.IdentityHashMap
import java.util.concurrent.CancellationException
import kotlin.math.*

data class LinearRgb(val red:Float,val green:Float,val blue:Float) {
    init {require(listOf(red,green,blue).all{it.isFinite()&&it in 0f..1f})}
    operator fun get(channel:Int)=when(channel){0->red;1->green;2->blue;else->throw IndexOutOfBoundsException()}
    companion object {
        val WHITE=LinearRgb(1f,1f,1f);val BLACK=LinearRgb(0f,0f,0f)
        fun fromSrgb(color:Int):LinearRgb {
            require(color in 0..0xffffff)
            fun channel(shift:Int):Float {val c=((color shr shift)and 255)/255.0;return(if(c<.04045)c*.0773993808 else (c*.9478672986+.0521327014).pow(2.4)).toFloat()}
            return LinearRgb(channel(16),channel(8),channel(0))
        }
    }
}

/** Immutable CPU pixels. Raw RGBA needs dimensions and mip policy in its
 * resource identity: equal bytes can describe differently shaped images. */
class NativePixelLevel(val width:Int,val height:Int,input:ByteBuffer){
    private val data:ByteBuffer
    val sha256:String
    init{require(width in 1..4096&&height in 1..4096&&input.remaining().toLong()==width.toLong()*height*4)
        data=NativePacketBuffers.frozen(input);sha256=MessageDigest.getInstance("SHA-256").apply{update(data.duplicate())}.digest().joinToString(""){"%02x".format(it.toInt()and 255)}}
    fun pixels():ByteBuffer=data.asReadOnlyBuffer()
    val byteSize get()=data.remaining().toLong()
}
class NativePixelTexture(val width:Int,val height:Int,input:ByteBuffer,val srgb:Boolean=true,val mipmaps:Boolean=true,
    val wrapS:Int=1000,val wrapT:Int=1000,val minFilter:Int=1008,val magFilter:Int=1003,val anisotropy:Float=4f,
    manualMipmaps:List<NativePixelLevel> = emptyList(),val dynamicIdentity:String?=null) {
    private val data:ByteBuffer
    val sha256:String
    val identity:String
    val samplingIdentity:String
    val manualMipmaps:List<NativePixelLevel> = Collections.unmodifiableList(manualMipmaps.toList())
    init {
        require(width in 1..8192&&height in 1..8192&&width.toLong()*height<=32L*1024*1024)
        require(input.remaining().toLong()==width.toLong()*height*4)
        require(wrapS in 1000..1002&&wrapT in 1000..1002&&minFilter in 1003..1008&&magFilter in setOf(1003,1006)&&anisotropy.isFinite()&&anisotropy in 1f..4f)
        require(mipmaps||minFilter in setOf(1003,1006))
        require(this.manualMipmaps.isEmpty()||mipmaps)
        var mw=width;var mh=height
        for(level in this.manualMipmaps){require(mw>1||mh>1);mw=maxOf(1,mw/2);mh=maxOf(1,mh/2);require(level.width==mw&&level.height==mh)}
        require(dynamicIdentity==null||dynamicIdentity.isNotEmpty()&&dynamicIdentity.length<=512&&dynamicIdentity.all{it.code in 33..126})
        data=NativePacketBuffers.frozen(input)
        sha256=MessageDigest.getInstance("SHA-256").apply{update(data.duplicate())}.digest().joinToString(""){"%02x".format(it.toInt() and 255)}
        identity="rgba8:$width:$height:$sha256:$srgb:$mipmaps"+
            (if(this.manualMipmaps.isEmpty())""else ":manual:"+this.manualMipmaps.joinToString("/"){it.sha256})+(dynamicIdentity?.let{":runtime:$it"}?:"")
        samplingIdentity="$identity:$wrapS:$wrapT:$minFilter:$magFilter:$anisotropy"
    }
    fun pixels():ByteBuffer=data.asReadOnlyBuffer()
    fun metadata(id:Int)=JSONObject().put("id",id).put("encoding","rgba8").put("image",sha256).put("width",width).put("height",height)
        .put("colorSpace",if(srgb)"srgb"else"").put("generateMipmaps",mipmaps&&manualMipmaps.isEmpty()).put("wrapS",wrapS).put("wrapT",wrapT).put("minFilter",minFilter).put("magFilter",magFilter).put("anisotropy",anisotropy.toDouble())
    val gpuBytes get()=if(manualMipmaps.isNotEmpty())width.toLong()*height*4+manualMipmaps.sumOf{it.byteSize}else if(mipmaps)GpuFootprint.mipBytes(width,height)else width.toLong()*height*4
}

enum class NativeFaceSide(val code:Int) { FRONT(0),BACK(1),DOUBLE(2) }
data class NativeRenderMaterial(val color:LinearRgb=LinearRgb.WHITE,val texture:NativePixelTexture?=null,val opacity:Float=1f,
    val roughness:Float=.9f,val metalness:Float=0f,val emission:LinearRgb=LinearRgb.BLACK,val emissionStrength:Float=0f,
    val transparent:Boolean=false,val vertexColors:Boolean=false,val unlit:Boolean=false,val depthWrite:Boolean=!transparent,
    val side:NativeFaceSide=NativeFaceSide.FRONT,val alphaCutoff:Float=0f,val flipY:Boolean=false,
    val surface:SurfaceCoverage=SurfaceCoverage(SurfaceEffects.NONE,emptyList(),emptyList()),val depthFunction:Int=3,
    val environment:NativeMaterialBinding?=null,val fog:Boolean=true,val depthTest:Boolean=true,val billboardMode:Int=0,
    val pointSize:Float=1f,val billboardCenterX:Float=.5f,val billboardCenterY:Float=.5f,val toneMapped:Boolean=true,val atlas:NativeAtlasPageBinding?=null) {
    init {
        require(listOf(opacity,roughness,metalness,alphaCutoff).all{it.isFinite()&&it in 0f..1f})
        require(emissionStrength.isFinite()&&emissionStrength in 0f..10000f)
        require(depthFunction in 0..7)
        require(billboardMode in 0..2&&pointSize.isFinite()&&pointSize in .001f..10000f&&listOf(billboardCenterX,billboardCenterY).all{it.isFinite()&&it in 0f..1f})
        require(atlas==null||texture===atlas.color&&vertexColors&&surface.optics.atlas==null&&billboardMode==0)
    }
    internal fun metadata(id:Int,textureId:Int?):JSONObject=JSONObject().put("id",id).put("sourceType",if(unlit)"NativeUnlit"else"NativePbr")
        .put("color",JSONArray(listOf(color.red,color.green,color.blue))).put("opacity",opacity.toDouble()).put("roughness",roughness.toDouble()).put("metalness",metalness.toDouble())
        .put("emissive",JSONArray(listOf(emission.red,emission.green,emission.blue))).put("emissiveIntensity",emissionStrength.toDouble())
        .put("transparent",transparent).put("vertexColors",vertexColors).put("unlit",unlit).put("depthWrite",depthWrite)
        .put("toneMapped",toneMapped)
        .put("colorWrite",true).put("depthTest",depthTest).put("flipY",flipY).put("side",side.code).put("alphaTest",alphaCutoff.toDouble())
        .put("depthFunc",depthFunction).put("blending",1).put("fog",fog).put("billboard",billboardMode).put("pointSize",pointSize.toDouble()).put("billboardCenter",JSONArray(listOf(billboardCenterX,billboardCenterY)))
        .put("uvTransform",JSONArray(listOf(1,0,0,0,1,0,0,0,1))).put("texture",textureId?:JSONObject.NULL).put("program","standard")
}

/** One independently replaceable owner's input, not a frozen export. Empty
 * owners remain explicit so a zero-progress building can later be updated. */
class NativePacketSource internal constructor(val owner:String,val world:WorldPackets?,textures:List<NativePixelTexture>,surfaces:List<SurfaceCoverage>,
    bindings:List<NativeMaterialBinding?> = List(surfaces.size){null},val layer:NativePacketLayer=NativePacketLayer.STATIC,val cloudKey:NativeCloudKey?=null,
    val precipitation:NativePrecipitationRuntime?=null,val precipitationKey:NativePrecipitationKey?=null,val skyKey:NativeSkyKey?=null,atlasSchedules:List<NativeAtlasSchedule> = emptyList()) {
    companion object {private val identities=java.util.concurrent.atomic.AtomicLong()}
    /** Process-local immutable input identity; no CPU payload need be retained
     * by the GPU host merely to recognize an unchanged owner. */
    val uploadIdentity:Long=identities.incrementAndGet().also{check(it>0)}
    val ownerIdentity:String=cloudKey?.let{"cloud:${it.identity}"}?:precipitationKey?.let{"precipitation:${it.identity}"}?:skyKey?.let{"sky:${it.identity}"}?:"native:$uploadIdentity"
    val textures:List<NativePixelTexture> = Collections.unmodifiableList(textures.toList())
    val surfaces:List<SurfaceCoverage> = Collections.unmodifiableList(surfaces.map{it.immutableNative()})
    val bindings:List<NativeMaterialBinding?> = Collections.unmodifiableList(bindings.toList())
    val atlasSchedules:List<NativeAtlasSchedule> = Collections.unmodifiableList(atlasSchedules.toList())
    init {require(bindings.size==surfaces.size);require(if(world==null)textures.isEmpty()&&surfaces.isEmpty()&&precipitation==null&&atlasSchedules.isEmpty() else surfaces.size==world.materials.size&&world.packets.all{it.owner==owner})
        precipitation?.let{runtime->
            val capacity=runtime.context.populations.single().capacity;val seen=BooleanArray(capacity)
            for(packet in requireNotNull(world).packets){require(packet.layer=="precipitation"&&packet.auxChannels==listOf("weatherPhase","weatherOffset"))
                val aux=world.section(checkNotNull(packet.aux));repeat(packet.count){i->val index=aux.getFloat(i*16+12).toInt();require(index in seen.indices&&!seen[index]);seen[index]=true}}
            require(seen.all{it}){"Native weather capacity was truncated"}
        }
        if(layer==NativePacketLayer.ANIMALS)NativeAnimalPackets.validate(this)
    }
    val geometryKeys:List<String> = Collections.unmodifiableList(world?.geometries?.map{g->
        val digest=MessageDigest.getInstance("SHA-256");digest.update(world.section(g.vertex));digest.update(world.section(g.index))
        "${g.vertexCount}:${g.indexCount}:"+digest.digest().joinToString(""){"%02x".format(it.toInt() and 255)}
    }?:emptyList())
    val footprint:GpuFootprint=GpuFootprint(world?.geometries?.sumOf{it.vertexCount*64L+it.indexCount*4L}?:0,
        world?.packets?.sumOf{it.count*96L}?:0,textures.distinctBy{it.identity}.sumOf{it.gpuBytes}+(precipitation?.input?.ground?.texture?.gpuBytes?:0)+if(world?.materials?.any{JSONObject(it).isNull("texture")}==true)4 else 0)
    fun textureMetadata()=JSONArray(textures.mapIndexed{index,texture->texture.metadata(index)}).apply{precipitation?.input?.ground?.texture?.let{put(it.metadata(textures.size))}}
    fun validateRuntime(environment:NativeSceneEnvironment){
        require(PacketOwners.valid(owner))
        require(!environment.directColor||world?.materials.orEmpty().all{JSONObject(it).getBoolean("unlit")}||environment.lighting.lights.any{it.type=="DirectionalLight"}){"Native direct lit colour requires the generated directional-light contract"}
        require(environment.surfaceState!=null||bindings.all{it==null})
        require(when(layer){NativePacketLayer.CLOUDS->owner==PacketOwners.CLOUDS&&cloudKey!=null&&precipitationKey==null&&precipitation==null&&skyKey==null
            NativePacketLayer.PRECIPITATION->owner==PacketOwners.PRECIPITATION&&precipitationKey!=null&&cloudKey==null&&textures.isEmpty()&&skyKey==null
            NativePacketLayer.SKY->owner==PacketOwners.SKY&&skyKey!=null&&cloudKey==null&&precipitationKey==null&&precipitation==null&&textures.isEmpty()&&environment.sky!=null
            NativePacketLayer.LIGHTNING->owner==PacketOwners.LIGHTNING&&cloudKey==null&&precipitationKey==null&&precipitation==null&&skyKey==null&&textures.isEmpty()&&environment.storm!=null
            NativePacketLayer.ANIMALS->owner==PacketOwners.ANIMALS&&cloudKey==null&&precipitationKey==null&&precipitation==null&&skyKey==null
            else->owner !in setOf(PacketOwners.CLOUDS,PacketOwners.PRECIPITATION,PacketOwners.SKY,PacketOwners.LIGHTNING,PacketOwners.ANIMALS)&&cloudKey==null&&precipitationKey==null&&precipitation==null&&skyKey==null})
        if(layer==NativePacketLayer.SKY)require(world!=null&&world.packets.size==3&&bindings.mapNotNull{it?.sky}.let{it.size==3&&it.toSet()==NativeSkyRole.entries.toSet()})
        val atlasIds=HashSet<Int>()
        for(schedule in atlasSchedules){require(schedule.texture in textures.indices&&schedule.blendTexture in textures.indices&&schedule.texture!=schedule.blendTexture)
            require(atlasIds.add(schedule.texture)&&atlasIds.add(schedule.blendTexture))
            for(id in listOf(schedule.texture,schedule.blendTexture)){val t=textures[id];require(!t.srgb&&!t.mipmaps&&t.manualMipmaps.isEmpty()&&t.width==schedule.width&&t.height==schedule.height&&t.minFilter==1003&&t.magFilter==1003&&t.dynamicIdentity!=null)}
            require(schedule.initialFramesSha256==textures[schedule.texture].sha256&&schedule.initialBlendSha256==textures[schedule.blendTexture].sha256)
        }
        for(surface in surfaces){val optics=surface.optics
            require(surface.pending.isEmpty()&&optics.cascade==null&&optics.moon==null)
            optics.atlas?.let{a->require(layer==NativePacketLayer.STATIC)
                if(a.animated)require(atlasSchedules.any{it.texture==a.lookup&&it.blendTexture==a.blend&&it.width==a.lookupSize[0].toInt()&&it.height==a.lookupSize[1].toInt()})}
            require(layer==NativePacketLayer.SKY||!optics.sky&&!optics.floatingSky)
            require((optics.cloud!=null)==(layer==NativePacketLayer.CLOUDS))
            require((optics.precipitation!=null)==(layer==NativePacketLayer.PRECIPITATION))
            require(optics.lightning==(layer==NativePacketLayer.LIGHTNING))
            if(layer==NativePacketLayer.CLOUDS)require(!optics.fluidSurface&&!optics.distanceOpacity&&optics.clearSky==null&&optics.night==NightField.NONE&&surface.effects==SurfaceEffects.NONE)
            if(layer==NativePacketLayer.PRECIPITATION)require(optics.precipitation==precipitation?.descriptor&&!optics.fluidSurface&&!optics.distanceOpacity&&optics.clearSky==null&&optics.night==NightField.NONE&&surface.effects==SurfaceEffects.NONE)
            if(layer==NativePacketLayer.LIGHTNING)require(!optics.fluidSurface&&!optics.distanceOpacity&&optics.clearSky==null&&optics.night==NightField.NONE&&surface.effects==SurfaceEffects.NONE)
        }
        for(packet in world?.packets.orEmpty()){
            require(packet.owner==owner&&packet.layer==layer.wire)
            require((world!!.geometries[packet.geometry].vertexPreparation=="atlas-static-v1")== (surfaces[packet.material].optics.atlas!=null))
            if(layer==NativePacketLayer.CLOUDS){
                require(packet.auxChannels==listOf("cloudCenter","cloudVelocity")&&packet.lod==null&&!packet.castShadow&&!packet.receiveShadow)
                require(bindings[packet.material]?.cloud==true&&environment.cloudColor!=null)
                val material=JSONObject(world!!.materials[packet.material]);require(material.getBoolean("unlit")&&!material.getBoolean("transparent")&&material.getDouble("opacity")==1.0)
                require(material.isNull("texture")&&!material.getBoolean("vertexColors"))
                require(material.getBoolean("depthWrite")&&material.getBoolean("depthTest")&&material.getBoolean("colorWrite")&&material.getInt("side")==0&&material.getDouble("alphaTest")==0.0&&material.getInt("billboard")==0)
            }else if(layer==NativePacketLayer.PRECIPITATION){
                require(precipitation!=null&&packet.auxChannels==listOf("weatherPhase","weatherOffset")&&packet.lod==null&&!packet.castShadow&&!packet.receiveShadow&&bindings[packet.material]==null)
                val material=JSONObject(world!!.materials[packet.material]);require(material.getBoolean("unlit")&&material.getBoolean("transparent")&&!material.getBoolean("fog")&&material.isNull("texture")&&!material.getBoolean("depthWrite"))
                require(!material.getBoolean("vertexColors")&&material.getBoolean("depthTest")&&material.getInt("billboard")==0)
            }else if(layer==NativePacketLayer.LIGHTNING){
                require(packet.auxChannels.isEmpty()&&packet.count==8&&packet.lod==null&&!packet.castShadow&&!packet.receiveShadow&&packet.priority==6)
                val material=JSONObject(world!!.materials[packet.material])
                require(bindings[packet.material]==null&&material.getBoolean("unlit")&&material.getBoolean("transparent")&&!material.getBoolean("fog")&&!material.getBoolean("depthWrite")&&!material.getBoolean("toneMapped"))
                require(material.isNull("texture")&&!material.getBoolean("vertexColors")&&material.getBoolean("depthTest"))
            }else if(layer==NativePacketLayer.SKY){
                val role=requireNotNull(bindings[packet.material]?.sky);val optics=surfaces[packet.material].optics
                require(packet.lod==null&&!packet.castShadow&&!packet.receiveShadow&&packet.auxChannels.isEmpty()&&packet.count==1)
                require((role==NativeSkyRole.DOME)==optics.sky&&(!optics.floatingSky||role==NativeSkyRole.DOME))
                if(role==NativeSkyRole.DOME)require(optics.floatingSky==environment.sky!!.floating)
                require(!optics.fluidSurface&&!optics.distanceOpacity&&optics.clearSky==null&&optics.night==NightField.NONE&&surfaces[packet.material].effects==SurfaceEffects.NONE)
                val material=JSONObject(world!!.materials[packet.material]);require(material.getBoolean("unlit")&&!material.getBoolean("fog")&&!material.getBoolean("depthWrite")&&!material.getBoolean("depthTest")&&material.isNull("texture"))
                require(material.getInt("billboard")==if(role==NativeSkyRole.DOME)0 else 1)
                require(material.getBoolean("toneMapped")==(role==NativeSkyRole.DOME))
                require(material.getBoolean("vertexColors")== (role==NativeSkyRole.DOME)&&material.getBoolean("transparent")== (role!=NativeSkyRole.DOME))
                require(material.getInt("side")==if(role==NativeSkyRole.DOME)1 else 2)
            }else{
                require(bindings[packet.material]?.cloud!=true&&bindings[packet.material]?.sky==null)
                require((packet.auxChannels==listOf("animalSlot"))==(layer==NativePacketLayer.ANIMALS))
                if(surfaces[packet.material].optics.fluidSurface)require(packet.auxChannels==listOf("instanceFaceOcclusion","instanceMaterialResponse"))
            }
        }
    }
}

/** Generation-thread packer for current native geometry. Produces the same
 * validated GPU packet contract used by the existing renderer, without JS,
 * files or a fixture manifest. Bounded owner payloads permit local updates.
 * Inputs must retain their immutable backing until build returns. */
class NativePacketBuilder(val owner:String,val layer:NativePacketLayer=NativePacketLayer.STATIC,private val cloudKey:NativeCloudKey?=null,
    private val precipitation:NativePrecipitationRuntime?=null,private val precipitationKey:NativePrecipitationKey?=null,private val skyKey:NativeSkyKey?=null) {
    private data class Draw(val geometry:Int,val material:Int,val matrices:FloatBuffer,val colors:FloatBuffer?,val aux:FloatBuffer?,val count:Int,
        val cast:Boolean,val receive:Boolean,val priority:Int,val lod:SceneryLod?,val boundsOverride:BlockBox?)
    private val geometries=ArrayList<BlockGeometry>();private val geometryIds=IdentityHashMap<BlockGeometry,Int>()
    private val materials=ArrayList<NativeRenderMaterial>();private val materialIds=LinkedHashMap<NativeRenderMaterial,Int>()
    private val textures=ArrayList<NativePixelTexture>();private val textureIds=LinkedHashMap<String,Int>()
    private val draws=ArrayList<Draw>();private var totalInstances=0L
    init {require(PacketOwners.valid(owner));require(when(layer){NativePacketLayer.CLOUDS->owner==PacketOwners.CLOUDS&&cloudKey!=null&&precipitationKey==null&&precipitation==null&&skyKey==null
        NativePacketLayer.PRECIPITATION->owner==PacketOwners.PRECIPITATION&&cloudKey==null&&precipitationKey!=null&&skyKey==null
        NativePacketLayer.SKY->owner==PacketOwners.SKY&&skyKey!=null&&cloudKey==null&&precipitationKey==null&&precipitation==null
        NativePacketLayer.LIGHTNING->owner==PacketOwners.LIGHTNING&&skyKey==null&&cloudKey==null&&precipitationKey==null&&precipitation==null
        NativePacketLayer.ANIMALS->owner==PacketOwners.ANIMALS&&skyKey==null&&cloudKey==null&&precipitationKey==null&&precipitation==null
        else->owner !in setOf(PacketOwners.CLOUDS,PacketOwners.PRECIPITATION,PacketOwners.SKY,PacketOwners.LIGHTNING,PacketOwners.ANIMALS)&&cloudKey==null&&precipitationKey==null&&precipitation==null&&skyKey==null})}
    fun add(geometry:BlockGeometry,material:NativeRenderMaterial,matrices:FloatBuffer,colors:FloatBuffer?=null,aux:FloatBuffer?=null,
        castShadow:Boolean=true,receiveShadow:Boolean=true,priority:Int=4,lod:SceneryLod?=null,boundsOverride:BlockBox?=null) {
        require(geometry.vertexCount in 1..4_000_000&&geometry.bounds!=null&&matrices.remaining()%16==0)
        require(matrices.remaining()>0&&priority in 0..7)
        require((geometry.vertexPreparation=="atlas-static-v1")== (material.atlas!=null))
        require(geometry.vertexPreparation==null||geometry.vertexPreparation=="atlas-static-v1")
        material.atlas?.let{require(it.owner==owner&&layer==NativePacketLayer.STATIC)}
        val count=matrices.remaining()/16;require(colors==null||colors.remaining()==count*4);require(aux==null||aux.remaining()==count*4)
        if(layer==NativePacketLayer.CLOUDS)require(aux!=null&&material.environment?.cloud==true&&material.surface.optics.cloud!=null&&!castShadow&&!receiveShadow&&lod==null)
        if(layer==NativePacketLayer.PRECIPITATION)require(precipitation!=null&&aux!=null&&material.surface.optics.precipitation==precipitation.descriptor&&material.texture==null&&!castShadow&&!receiveShadow&&lod==null)
        require(boundsOverride==null||layer in setOf(NativePacketLayer.LIGHTNING,NativePacketLayer.ANIMALS))
        if(layer==NativePacketLayer.ANIMALS)require(aux!=null&&!castShadow&&receiveShadow&&lod==null&&boundsOverride!=null)
        if(layer==NativePacketLayer.LIGHTNING)require(count==8&&material.surface.optics.lightning&&aux==null&&!castShadow&&!receiveShadow&&lod==null&&priority==6&&boundsOverride!=null)
        require(totalInstances+count<=WorldPackets.MAX_INSTANCE_BYTES/96);require(draws.size.toLong()+(count+1023L)/1024<=30_000)
        val g=geometryIds[geometry]?:geometries.size.also{require(it<10_000);geometryIds[geometry]=it;geometries+=geometry}
        val m=materialIds[material]?:materials.size.also{require(it<8192);materialIds[material]=it;materials+=material
            material.texture?.let{t->if(t.samplingIdentity !in textureIds){require(textures.size<4096);textureIds[t.samplingIdentity]=textures.size;textures+=t}}}
        fun section(input:FloatBuffer,start:Int,size:Int)=input.duplicate().apply{position(input.position()+start);limit(position()+size)}.slice().asReadOnlyBuffer()
        var first=0;while(first<count){val n=minOf(1024,count-first);draws+=Draw(g,m,section(matrices,first*16,n*16),colors?.let{section(it,first*4,n*4)},aux?.let{section(it,first*4,n*4)},n,castShadow,receiveShadow,priority,lod,boundsOverride);first+=n}
        totalInstances+=count
    }
    fun build(cancelled:()->Boolean={false}):NativePacketSource {
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Native packet source superseded")}
        checkpoint();if(draws.isEmpty())return NativePacketSource(owner,null,emptyList(),emptyList(),layer=layer,cloudKey=cloudKey,precipitationKey=precipitationKey,skyKey=skyKey)
        fun outward(value:Double,up:Boolean):Double {
            val f=value.toFloat();require(f.isFinite())
            if(f==0f)return(if(up)Float.MIN_VALUE else -Float.MIN_VALUE).toDouble()
            val bits=f.toRawBits();val next=Float.fromBits(if(up==(f>0))bits+1 else bits-1);require(next.isFinite())
            return next.toDouble()
        }
        val indexCounts=geometries.map{g->g.indices()?.remaining()?:g.vertexCount}
        var length=16L
        for((i,g)in geometries.withIndex()){require(indexCounts[i] in 3..12_000_000&&indexCounts[i]%3==0);length+=g.vertexCount*48L+indexCounts[i]*4L}
        length+=draws.sumOf{it.count*(80L+if(it.aux!=null)16L else 0L)}
        require(length in 16..WorldPackets.MAX_BYTES.toLong()){"Native owner packet budget"}
        val bytes=NativePacketBuffers.allocate(length.toInt()).order(ByteOrder.LITTLE_ENDIAN);bytes.position(16);var sections=0
        fun section(start:Int):JSONObject {sections++;return JSONObject().put("offset",start).put("bytes",bytes.position()-start)}
        fun bounds(value:BlockBox)=JSONArray().put(JSONArray(listOf(value.min.x,value.min.y,value.min.z))).put(JSONArray(listOf(value.max.x,value.max.y,value.max.z)))
        val geometryRows=JSONArray()
        val uploadedBounds=ArrayList<BlockBox>()
        for((id,g)in geometries.withIndex()) {
            checkpoint();val position=g.positions();val normal=g.normals();val uv=g.textureCoordinates();val color=g.colors();val alpha=g.colorAlpha()
            require(position.remaining()==g.vertexCount*3&&normal.remaining()==g.vertexCount*3&&(uv==null||uv.remaining()==g.vertexCount*2)&&(color==null||color.remaining()==g.vertexCount*3))
            require(alpha==null||alpha.remaining()==g.vertexCount);require(g.vertexPreparation==null||color!=null&&alpha!=null&&uv!=null)
            var start=bytes.position()
            val low=DoubleArray(3){Double.POSITIVE_INFINITY};val high=DoubleArray(3){Double.NEGATIVE_INFINITY}
            repeat(g.vertexCount){i->if(i%1024==0)checkpoint();repeat(3){axis->val p=position.get();require(p.isFinite());bytes.putFloat(p);low[axis]=min(low[axis],p.toDouble());high[axis]=max(high[axis],p.toDouble())};repeat(3){bytes.putFloat(normal.get())}
                repeat(2){bytes.putFloat(uv?.get()?:0f)};repeat(3){bytes.putFloat(color?.get()?:1f)};val a=alpha?.get()?:1f
                require(a.isFinite()&&(g.vertexPreparation==null||a in 0f..5f&&a%1f==0f));bytes.putFloat(a)}
            val vertex=section(start);start=bytes.position();val indices=g.indices()
            if(indices==null)repeat(g.vertexCount){bytes.putInt(it)}else while(indices.hasRemaining()){if(indices.position()%4096==0)checkpoint();bytes.putInt(indices.get())}
            val actual=BlockBox(BlockPoint(low[0],low[1],low[2]),BlockPoint(high[0],high[1],high[2]));uploadedBounds+=actual
            geometryRows.put(JSONObject().put("id",id).put("vertex",vertex).put("index",section(start)).put("vertexCount",g.vertexCount).put("indexCount",indexCounts[id]).put("bounds",bounds(actual)).apply{if(g.vertexPreparation!=null)put("vertexPreparation",g.vertexPreparation)})
        }
        val packetRows=JSONArray()
        for((id,draw)in draws.withIndex()) {
            checkpoint();val matrices=draw.matrices.duplicate();val color=draw.colors?.duplicate();var start=bytes.position()
            val low=DoubleArray(3){Double.POSITIVE_INFINITY};val high=DoubleArray(3){Double.NEGATIVE_INFINITY};val local=uploadedBounds[draw.geometry]
            repeat(draw.count){i->if(i%128==0)checkpoint();val m=DoubleArray(16){matrices.get().toDouble()};val transform=BlockTransform.fromElements(m)
                val box=transform.box(local);for(axis in 0..2){low[axis]=min(low[axis],box.min[axis]);high[axis]=max(high[axis],box.max[axis])}
                for(value in m)bytes.putFloat(value.toFloat());repeat(4){bytes.putFloat(color?.get()?:1f)}}
            val instances=section(start);val aux=draw.aux?.duplicate()?.let{input->start=bytes.position();while(input.hasRemaining())bytes.putFloat(input.get());section(start)}
            draw.boundsOverride?.let{box->for(axis in 0..2){low[axis]=min(low[axis],box.min[axis]);high[axis]=max(high[axis],box.max[axis])}}
            // Bounds enclose the actual uploaded coordinates, with room for
            // GPU multiply/add rounding rather than culling on an exact edge.
            val margin=DoubleArray(3){max(1e-4,max(abs(low[it]),abs(high[it]))*2e-6)}
            val box=BlockBox(BlockPoint(outward(low[0]-margin[0],false),outward(low[1]-margin[1],false),outward(low[2]-margin[2],false)),
                BlockPoint(outward(high[0]+margin[0],true),outward(high[1]+margin[1],true),outward(high[2]+margin[2],true)))
            packetRows.put(JSONObject().put("id",id).put("owner",owner).put("layer",layer.wire).put("geometry",draw.geometry).put("material",draw.material).put("count",draw.count)
                .put("instances",instances).put("bounds",bounds(box)).put("castShadow",draw.cast).put("receiveShadow",draw.receive).put("priority",draw.priority)
                .put("aux",aux?:JSONObject.NULL).put("auxChannels",JSONArray(if(aux==null)emptyList<String>()else when(layer){NativePacketLayer.CLOUDS->listOf("cloudCenter","cloudVelocity");NativePacketLayer.PRECIPITATION->listOf("weatherPhase","weatherOffset");NativePacketLayer.ANIMALS->listOf("animalSlot");else->listOf("instanceFaceOcclusion","instanceMaterialResponse")}))
                .apply{draw.lod?.let{put("lod",JSONObject().put("id",it.id).put("detail",it.detail).put("center",JSONArray(listOf(it.center.x,it.center.y,it.center.z))).put("width",it.width.toDouble()))}})
        }
        require(bytes.position()==length.toInt());bytes.putInt(0,0x31504342);bytes.putInt(4,5);bytes.putInt(8,length.toInt());bytes.putInt(12,sections);bytes.flip()
        val materialRows=JSONArray(materials.mapIndexed{id,m->m.metadata(id,m.texture?.let{textureIds.getValue(it.samplingIdentity)})})
        fun textureId(texture:NativePixelTexture):Int=textureIds[texture.samplingIdentity]?:textures.size.also{require(it<4096);textures+=texture;textureIds[texture.samplingIdentity]=it}
        val atlasBindings=materials.mapNotNull{it.atlas}.distinctBy{it.key}
        val schedules=atlasBindings.filter{it.animated}.map{it.schedule(textureId(checkNotNull(it.frames)),textureId(checkNotNull(it.blends)))}
        val surfaces=materials.map{m->m.atlas?.let{a->val colorId=textureId(a.color)
            m.surface.copy(optics=m.surface.optics.copy(atlas=a.source(colorId,a.frames?.let{textureId(it)},a.blends?.let{textureId(it)})))}?:m.surface}
        val manifest=JSONObject().put("version",5).put("geometries",geometryRows).put("materials",materialRows).put("packets",packetRows)
        checkpoint();val world=WorldPackets.read(manifest.toString(),bytes)
        checkpoint();return NativePacketSource(owner,world,textures,surfaces,materials.map{it.environment},layer,cloudKey,precipitation,precipitationKey,skyKey,schedules)
    }
}
