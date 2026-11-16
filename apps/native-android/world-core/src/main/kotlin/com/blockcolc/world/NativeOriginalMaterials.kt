package com.blockcolc.world

import com.blockcolc.world.generation.*

/** Environment values are supplied by the native lighting owner. They are not
 * derived from UI theme or read from an exported P1 environment manifest. */
data class NativeSurfaceState(val effects:SurfaceEffects=SurfaceEffects.NONE,val night:NightField=NightField.NONE,val nightFactor:Float=0f,
    val ambientOcclusion:Float=.44f,val nearDetail:Float=1f,val clearSky:Float=1f) {
    init {require(listOf(nightFactor,ambientOcclusion,nearDetail,clearSky).all{it.isFinite()&&it in 0f..1f})}
    fun coverage(edge:Float,gain:Float=.44f,fluid:Boolean=false,weatherWater:Boolean=false,distanceOpacity:Boolean=false)=SurfaceCoverage(
        effects.copy(edgeStrength=edge*(.35f+nearDetail*.65f)),listOf("night-sky-reflection-v6","face-and-edge-v1")+
            (if(fluid)listOf("fluid-surface-v1")else emptyList())+(if(weatherWater)listOf("weather-water-v1")else emptyList()),emptyList(),
        SurfaceOptics(night=night.copy(gain=gain),fluidSurface=fluid,clearSky=if(weatherWater)clearSky else null,distanceOpacity=distanceOpacity))
}

/** Shared original artwork and bounded state-specific textures. This factory
 * owns CPU pixels only; NativePacketSource transfers no engine handles. */
class NativeOriginalMaterials(private val library:OriginalMaterialLibrary=OriginalMaterialLibrary.bundled,private val textureBudget:Long=16L*1024*1024) {
    private val patterns=HashMap<Pair<OriginalPattern,Boolean>,NativePixelTexture>()
    private val details=LinkedHashMap<String,NativePixelTexture>(16,.75f,true);private var detailBytes=0L
    private val styles=OriginalMaterialStyles(library)
    private val glass by lazy{NativePixelTexture(128,128,ConnectedOriginalGlass.pixels(),wrapS=1001,wrapT=1001,anisotropy=1f)}
    init {require(textureBudget>=0)}
    fun pattern(pattern:OriginalPattern,linear:Boolean=false):NativePixelTexture=patterns.getOrPut(pattern to linear){
        val texture=library.texture(pattern);val d=texture.descriptor
        NativePixelTexture(d.width,d.height,texture.pixels(),magFilter=if(linear)1006 else d.magFilter,anisotropy=d.anisotropy.toFloat())
    }
    private fun detail(texture:OriginalDetailTexture):NativePixelTexture {
        details[texture.contentSha]?.let{return it}
        val result=NativePixelTexture(texture.width,texture.height,texture.rgba(),wrapS=1001,wrapT=1001,anisotropy=1f)
        val size=texture.byteSize
        if(size<=textureBudget){while(details.isNotEmpty()&&detailBytes+size>textureBudget){val first=details.entries.iterator();val old=first.next().value;detailBytes-=old.width.toLong()*old.height*4;first.remove()}
            details[texture.contentSha]=result;detailBytes+=size}
        return result
    }
    private fun tinted(color:Int,weathering:Double):LinearRgb {
        val c=LinearRgb.fromSrgb(color);val factor=(1-weathering*.28).toFloat();return LinearRgb(c.red*factor,c.green*factor,c.blue*factor)
    }
    private fun NativeRenderMaterial.withSurface(state:NativeSurfaceState,binding:NativeSurfaceBinding)=
        copy(surface=binding.resolve(state),environment=NativeMaterialBinding(binding))
    fun batch(batch:OriginalDrawBatch,weathering:Double,state:NativeSurfaceState):NativeRenderMaterial {
        require(weathering.isFinite()&&weathering in 0.0..1.0)
        val result=when(val m=batch.material) {
            is OriginalDrawMaterial.Pattern->{val response=library.response(m.style.response)
                NativeRenderMaterial(color=tinted(m.style.color,weathering),texture=pattern(m.style.pattern),opacity=m.style.opacity.toFloat(),
                    roughness=minOf(1.0,response.roughness+weathering*.1).toFloat(),metalness=response.metalness.toFloat(),transparent=m.style.transparent)
                    .withSurface(state,NativeSurfaceBinding(if(m.style.transparent){if(batch.route==OriginalDrawRoute.COMPONENT)0f else .22f}else if(batch.route==OriginalDrawRoute.COMPONENT).12f else .025f))}
            is OriginalDrawMaterial.Detail->NativeRenderMaterial(color=tinted(0xffffff,weathering),texture=detail(m.texture),roughness=m.roughness.toFloat(),metalness=m.metalness.toFloat()).withSurface(state,NativeSurfaceBinding(.025f))
            OriginalDrawMaterial.Plant->NativeRenderMaterial(roughness=.88f,vertexColors=true,side=NativeFaceSide.DOUBLE,
                surface=SurfaceCoverage(SurfaceEffects.NONE,emptyList(),emptyList()))
            is OriginalDrawMaterial.Glass->NativeRenderMaterial(color=tinted(m.color,weathering),texture=glass,opacity=m.opacity.toFloat(),roughness=m.roughness.toFloat(),metalness=m.metalness.toFloat(),
                transparent=true).withSurface(state,NativeSurfaceBinding(0f,.7f))
            is OriginalDrawMaterial.Fluid->{val water=m.kind==OriginalFluid.WATER
                NativeRenderMaterial(color=LinearRgb.fromSrgb(if(water)0x4d7f86 else 0xe96b23),texture=pattern(if(water)OriginalPattern.WATER else OriginalPattern.LAVA,water),
                    roughness=if(water).34f else .9f,metalness=if(water).05f else 0f,opacity=m.opacity.toFloat(),transparent=water,
                    emission=if(water)LinearRgb.BLACK else LinearRgb.fromSrgb(0x8f1f08),emissionStrength=if(water)0f else .68f)
                    .withSurface(state,NativeSurfaceBinding(if(water).22f else 0f,fluid=true))}
        }
        return if(batch.emission.level>0)result.copy(emission=LinearRgb.fromSrgb(when{batch.emission.kind.contains("soul",true)->0x65cfe3;batch.emission.kind.contains("redstone",true)->0xe94b35;else->0xffb45f}),
            emissionStrength=state.nightFactor*(batch.emission.level/15f)*1.55f,
            environment=NativeMaterialBinding(result.environment?.surface,(batch.emission.level/15f)*1.55f))else result
    }
    fun terrain(material:TerrainMaterial,state:NativeSurfaceState,coast:Boolean=false,livingWater:Boolean=true,side:Boolean=false):NativeRenderMaterial {
        val result=when(material) {
            TerrainMaterial.SAND,TerrainMaterial.SNOW,TerrainMaterial.ICE,TerrainMaterial.TERRACOTTA->{val ice=material==TerrainMaterial.ICE
                NativeRenderMaterial(color=LinearRgb.fromSrgb(when(material){TerrainMaterial.SAND->0xe4d7a6;TerrainMaterial.SNOW->0xf1f7fc;TerrainMaterial.ICE->0x9bd5e6;else->0xb16b4a}),
                    roughness=if(ice).18f else 1f,metalness=if(ice).12f else 0f).let{if(ice)it.withSurface(state,NativeSurfaceBinding(0f))else it}}
            TerrainMaterial.WATER->NativeRenderMaterial(color=LinearRgb.fromSrgb(0x4d7f86),texture=pattern(OriginalPattern.WATER,true),roughness=.34f,metalness=.05f,
                transparent=coast||livingWater,opacity=if(coast).58f else if(livingWater).7f else 1f,depthWrite=!coast,depthFunction=if(livingWater&&!coast)2 else 3)
                .withSurface(state,NativeSurfaceBinding(0f,2.2f,weatherWater=true))
            else->{val id=when(material){TerrainMaterial.GRASS->"grass";TerrainMaterial.DIRT->"dirt";else->"terrainStone"};val response=library.response(styles.responseForMaterial(id))
                NativeRenderMaterial(color=LinearRgb.fromSrgb(when(material){TerrainMaterial.GRASS->0x718365;TerrainMaterial.DIRT->0x746650;else->0x69736e}),texture=pattern(styles.patternForMaterial(id)),roughness=response.roughness.toFloat(),metalness=response.metalness.toFloat()).withSurface(state,NativeSurfaceBinding(0f))}
        }
        return if(side)result.copy(color=result.color.let{LinearRgb(it.red*.65f,it.green*.65f,it.blue*.65f)})else result
    }
    fun path(state:NativeSurfaceState):NativeRenderMaterial=NativeRenderMaterial(color=LinearRgb.fromSrgb(0x9a8b72),texture=pattern(OriginalPattern.PATH)).withSurface(state,NativeSurfaceBinding(0f))
    fun vine(state:NativeSurfaceState):NativeRenderMaterial {
        val response=library.response(OriginalResponse.DEFAULT)
        return NativeRenderMaterial(color=LinearRgb.fromSrgb(0x3f7044),texture=pattern(OriginalPattern.FOLIAGE),roughness=response.roughness.toFloat(),metalness=response.metalness.toFloat())
            .withSurface(state,NativeSurfaceBinding(0f))
    }
    fun clear(){patterns.clear();details.clear();detailBytes=0}
}
