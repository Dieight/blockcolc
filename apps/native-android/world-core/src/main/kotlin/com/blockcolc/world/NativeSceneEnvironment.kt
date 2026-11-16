package com.blockcolc.world

import java.util.Collections
import kotlin.math.abs
import java.util.TimeZone

/** Reusable sampling inputs contain no business snapshot, mesh or GPU handle. */
data class NativeEnvironmentContext(val zone:String,val quality:NativeLightingQuality,val coreRadius:Double,
    val terrainHalfExtent:Double,val distance:Double,val ocean:Boolean=false,val coordinates:NativeCoordinates?=null,
    val weather:NativeWeatherOverride?=null,val skyOptions:NativeSkyOptions=NativeSkyOptions(),val timeMinutes:Int?=null) {
    init {require(zone in TimeZone.getAvailableIDs());require(listOf(coreRadius,terrainHalfExtent,distance).all{it.isFinite()&&it>0});require(timeMinutes==null||timeMinutes in 0..1439)}
    val atmosphere get()=NativeAtmosphereInputs(zone,ocean,coordinates,weather,timeMinutes)
    /** Explicit provider/clock adoption keeps this scene's camera, geometry,
     * sky options and quality. A different local probability family needs its
     * matching world preparation instead. */
    fun adopting(facts:NativeAtmosphereFacts):NativeEnvironmentContext {
        require(facts.inputs.ocean==ocean){"Atmosphere belongs to a different world environment"}
        if(facts.inputs==atmosphere)return this
        return copy(zone=facts.inputs.zone,coordinates=facts.inputs.coordinates,weather=facts.inputs.weather,timeMinutes=facts.inputs.timeMinutes)
    }
    fun sample(time:Long)=NativeEnvironment.sample(time,TimeZone.getTimeZone(zone),quality,coreRadius,terrainHalfExtent,distance,ocean,coordinates,weather,skyOptions,timeMinutes)
    fun project(facts:NativeAtmosphereFacts):NativeEnvironmentSample {
        require(facts.inputs==atmosphere){"Atmosphere belongs to a different environment"}
        return NativeEnvironment.project(facts,quality,coreRadius,terrainHalfExtent,distance,skyOptions)
    }
}

/** Small immutable uniforms, independent of geometry, packet and image identity. */
class NativeSceneEnvironment(lighting:SourceLighting,surfaceState:NativeSurfaceState?=null,val cloudColor:LinearRgb?=null,sky:NativeSkyState?=null,val fogProjection:NativeFogProjection?=null,val directColor:Boolean=false,val storm:NativeStormWeather?=null) {
    val lighting:SourceLighting
    val surfaceState:NativeSurfaceState?
    val sky:NativeSkyState?
    init {
        fun vector(value:List<Float>,minimum:Float=0f,maximum:Float=1f):List<Float>{
            require(value.size==3&&value.all{it.isFinite()&&it in minimum..maximum})
            return Collections.unmodifiableList(value.toList())
        }
        require(lighting.exposure.isFinite()&&lighting.exposure in .01f..100f)
        val lights=lighting.lights.map{light->
            require(light.type in setOf("DirectionalLight","HemisphereLight","PointLight")&&light.intensity.isFinite()&&light.intensity in 0f..10000f)
            require(light.distance.isFinite()&&light.distance in 0f..1e6f&&light.shadowBiasWorld.isFinite()&&light.shadowBiasWorld>=0)
            val direction=vector(light.direction,-1f,1f)
            if(light.type!="PointLight")require(abs(direction.sumOf{it.toDouble()*it}-1)<.001)
            light.copy(color=vector(light.color),direction=direction,position=vector(light.position,-1e6f,1e6f),groundColor=vector(light.groundColor))
        }
        require(lights.size in 1..32&&lights.count{it.type=="DirectionalLight"}<=1)
        val fog=lighting.fog?.let{f->require(f.near.isFinite()&&f.far.isFinite()&&f.near>=0&&f.far>f.near);f.copy(color=vector(f.color))}
        require(fog==null||lights.any{it.type=="DirectionalLight"})
        require(fogProjection==null||fog!=null){"Camera fog requires an explicit fog colour and enable state"}
        this.lighting=lighting.copy(clearColor=vector(lighting.clearColor),lights=Collections.unmodifiableList(lights),pending=Collections.unmodifiableList(lighting.pending.toList()),fog=fog)
        this.surfaceState=surfaceState?.let{state->
            val frozen=SurfaceCoverage(state.effects,emptyList(),emptyList(),SurfaceOptics(night=state.night,clearSky=state.clearSky)).immutableNative()
            state.copy(effects=frozen.effects,night=frozen.optics.night)
        }
        this.sky=sky?.let{state->state.copy(night=SurfaceCoverage(SurfaceEffects.NONE,emptyList(),emptyList(),SurfaceOptics(night=state.night)).immutableNative().optics.night)}
    }
}

/** Explicit source semantics, never inferred from a texture or material name. */
data class NativeSurfaceBinding(val edge:Float,val gain:Float=.44f,val fluid:Boolean=false,
    val weatherWater:Boolean=false,val distanceOpacity:Boolean=false) {
    init {require(edge.isFinite()&&edge in 0f..0.35f&&gain.isFinite()&&gain in 0f..8f)}
    fun resolve(state:NativeSurfaceState)=state.coverage(edge,gain,fluid,weatherWater,distanceOpacity)
}

data class NativeMaterialBinding(val surface:NativeSurfaceBinding?=null,val nightEmissionMaximum:Float?=null,val cloud:Boolean=false,val sky:NativeSkyRole?=null) {
    init {require(surface!=null||nightEmissionMaximum!=null||cloud||sky!=null);require(!cloud||surface==null&&nightEmissionMaximum==null&&sky==null)
        require(sky==null||surface==null&&nightEmissionMaximum==null&&!cloud);require(nightEmissionMaximum==null||nightEmissionMaximum.isFinite()&&nightEmissionMaximum in 0f..10000f)}
    fun emission(state:NativeSurfaceState,fixed:Float)=nightEmissionMaximum?.let{it*state.nightFactor}?:fixed
}

internal fun SurfaceCoverage.immutableNative():SurfaceCoverage {
    fun vector(v:List<Float>,unit:Boolean=false):List<Float>{require(v.size==3&&v.all{it.isFinite()&&it in -1f..1f});if(unit)require(abs(v.sumOf{it.toDouble()*it}-1)<.001);return Collections.unmodifiableList(v.toList())}
    val e=effects;require(e.strength.isFinite()&&e.strength in 0f..1f&&e.edgeStrength.isFinite()&&e.edgeStrength in 0f..0.35f)
    require(e.lightTint.all{it>=0}&&e.shadowTint.all{it>=0})
    val n=optics.night
    require(listOf(n.stars,n.galaxy,n.aurora).all{it.isFinite()&&it in 0f..1f}&&n.time.isFinite()&&n.time in 0f..1e9f&&n.density.isFinite()&&n.density in 0f..4f&&n.meteor.isFinite()&&n.meteor in -1f..1f&&n.gain.isFinite()&&n.gain in 0f..8f)
    require(optics.clearSky==null||optics.clearSky.isFinite()&&optics.clearSky in 0f..1f)
    require(n.coldDirection.sumOf{it.toDouble()*it}>1e-8&&n.galaxyNormal.sumOf{it.toDouble()*it}>1e-8)
    val cloud=optics.cloud?.let{c->require(c.elapsed.isFinite()&&c.elapsed in 0f..1e9f&&c.span.size==2&&c.span.all{it.isFinite()&&it in 1f..1e6f})
        c.copy(span=Collections.unmodifiableList(c.span.toList()))}
    val precipitation=optics.precipitation?.let{p->
        fun frozen(v:List<Double>,size:Int,min:Double,max:Double):List<Double>{require(v.size==size&&v.all{it.isFinite()&&it in min..max});return Collections.unmodifiableList(v.toList())}
        require(p.elapsedMs.isFinite()&&p.elapsedMs in 0.0..1e9&&p.base.isFinite()&&p.base in -1e4..1e4&&p.span.isFinite()&&p.span in .01..1000.0)
        require(p.speed.isFinite()&&p.speed in .001..10.0&&p.size.isFinite()&&p.size in .001..10.0&&p.groundTexture in 0..4095)
        val bounds=frozen(p.groundBounds,4,-1e6,1e6);require(bounds[2]>=.01&&bounds[3]>=.01)
        p.copy(center=frozen(p.center,2,-1e6,1e6),field=frozen(p.field,2,.01,4096.0),groundBounds=bounds)
    }
    val atlas=optics.atlas?.let{a->
        fun pair(v:List<Float>):List<Float>{require(v.size==2&&v.all{it.isFinite()&&it in 1f..8192f&&it%1f==0f});return Collections.unmodifiableList(v.toList())}
        require(a.columns.isFinite()&&a.columns in 1f..8192f&&a.columns%1f==0f&&a.cell.isFinite()&&a.cell in 1f..1024f&&a.cell%1f==0f)
        require(a.lookup in 0..4095&&a.blend in 0..4095&&(!a.animated||a.lookup!=a.blend));a.copy(size=pair(a.size),lookupSize=pair(a.lookupSize))
    }
    return copy(effects=e.copy(direction=vector(e.direction,true),lightTint=vector(e.lightTint),shadowTint=vector(e.shadowTint)),
        applied=Collections.unmodifiableList(applied.toList()),pending=Collections.unmodifiableList(pending.toList()),
        optics=optics.copy(night=n.copy(coldDirection=vector(n.coldDirection),galaxyNormal=vector(n.galaxyNormal)),cloud=cloud,precipitation=precipitation,atlas=atlas))
}
