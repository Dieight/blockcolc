package com.blockcolc.world

import java.nio.FloatBuffer
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.CancellationException

private fun precipitationIdentity(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
class NativePrecipitationContext(bounds:List<Double>,framing:List<Double>,val ground:NativePrecipitationGround,val preview:Boolean=false) {
    val bounds:List<Double> = Collections.unmodifiableList(bounds.toList())
    val framing:List<Double> = Collections.unmodifiableList(framing.toList())
    val identity:String
    init {
        require(bounds.size==4&&bounds.all{it.isFinite()&&kotlin.math.abs(it)<=1e6}&&bounds[1]>bounds[0]&&bounds[3]>bounds[2])
        require(framing.size==2&&framing.all{it.isFinite()&&it>0&&it<=1e6})
        identity=precipitationIdentity("ground-v1:$bounds:$framing:$preview:${ground.texture.identity}:${ground.minX}:${ground.minZ}:${ground.spanX}:${ground.spanZ}:${ground.minY}:${ground.maxY}")
    }
}
data class NativePrecipitationKey internal constructor(val identity:String)

class NativePrecipitationRuntime internal constructor(val input:NativePrecipitationContext,snow:Boolean,referenceCount:Int,
    density:Double,capacity:Int,visual:Double,baseCrossSection:Double) {
    val descriptor:SourcePrecipitation
    val context:SourceWeatherContext
    init {
        require(referenceCount>0&&density.isFinite()&&density in 0.0..1.0&&capacity in 1..if(snow)49152 else 32768)
        require(visual.isFinite()&&visual in 0.0..1.0&&baseCrossSection.isFinite()&&baseCrossSection>0)
        val ground=input.ground;val bounds=Collections.unmodifiableList(listOf(ground.minX,ground.minZ,ground.spanX,ground.spanZ))
        val center=Collections.unmodifiableList(listOf((input.bounds[0]+input.bounds[1])/2,(input.bounds[2]+input.bounds[3])/2))
        val field=Collections.unmodifiableList(listOf(minOf(4096.0,input.bounds[1]-input.bounds[0]),minOf(4096.0,input.bounds[3]-input.bounds[2])))
        descriptor=SourcePrecipitation(snow,0.0,.2,if(input.preview)24.0 else 40.0,if(snow)1.0 else .72+visual*.58,1.0,center,field,0,bounds)
        context=SourceWeatherContext(input.bounds,input.framing,Collections.unmodifiableList(listOf(ground.minY,ground.maxY)),density,
            Collections.unmodifiableList(listOf(WeatherPopulation(if(snow)"snow"else"rain",capacity,referenceCount.toDouble(),baseCrossSection))))
    }
}
class NativePrecipitationPrepared(val key:NativePrecipitationKey,val source:NativePacketSource,val capacity:Int)

/** Worker-owned latest particle source. Camera motion uses the existing field
 * uniforms and visible-time texel; seed rows/ground pixels upload only on adopt. */
class NativePrecipitationCompiler {
    companion object {
        fun key(context:NativePrecipitationContext,weather:NativeWeather,density:Double,randomTail:Long,paper:Boolean=false):NativePrecipitationKey {
            require(density.isFinite()&&density in 0.0..1.0&&randomTail in 0..0xffffffffL)
            return NativePrecipitationKey(precipitationIdentity("precipitation-v1:${context.identity}:$weather:$density:$randomTail:$paper"))
        }
    }
    private var cached:NativePrecipitationPrepared?=null
    fun prepare(context:NativePrecipitationContext,weather:NativeWeather,density:Double,randomTail:Long,cancelled:()->Boolean={false},paper:Boolean=false):NativePrecipitationPrepared {
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Native precipitation preparation superseded")}
        checkpoint();val key=key(context,weather,density,randomTail,paper);cached?.takeIf{it.key==key}?.let{return it}
        val snow=weather.kind==NativeWeatherKind.SNOW
        val reference=if(snow)weather.snowFlakeCount else if(weather.kind==NativeWeatherKind.RAIN)weather.rainDropCount else 0
        val capacity=when {
            reference<=0->0
            context.preview->80
            paper->1024
            snow->49152
            else->32768
        }
        val visual=weather.visualPrecipitationIntensity.also{require(it.isFinite()&&it in 0.0..1.0)}
        val base=if(snow).36 else .022+visual*.013
        val runtime=if(capacity>0)NativePrecipitationRuntime(context,snow,reference,density,capacity,visual,base)else null
        val builder=NativePacketBuilder(PacketOwners.PRECIPITATION,NativePacketLayer.PRECIPITATION,precipitation=runtime,precipitationKey=key)
        if(runtime!=null){
            val generator=NativeCloudLayout.Generator(randomTail,zeroToOne=false)
            val matrices=FloatArray(capacity*16);val auxiliary=FloatArray(capacity*4)
            repeat(capacity){i->if(i%256==0)checkpoint();val x=generator.next()-.5;val z=generator.next()-.5;val phase=generator.next()
                val m=i*16;matrices[m]=1f;matrices[m+5]=1f;matrices[m+10]=1f;matrices[m+15]=1f;matrices[m+13]=(-2+phase*runtime.descriptor.span).toFloat()
                val a=i*4;auxiliary[a]=phase.toFloat();auxiliary[a+1]=x.toFloat();auxiliary[a+2]=z.toFloat();auxiliary[a+3]=i.toFloat()
            }
            val material=NativeRenderMaterial(color=LinearRgb.fromSrgb(if(snow)0xf3f7ff else if(weather.thunderstorm)0xd5e6f1 else 0xb8d6df),unlit=true,
                transparent=true,opacity=if(snow).96f else (.42+visual*.35).toFloat(),depthWrite=false,fog=false,
                side=if(paper)NativeFaceSide.DOUBLE else NativeFaceSide.FRONT,
                surface=SurfaceCoverage(SurfaceEffects.NONE,listOf("source-precipitation-v3"),emptyList(),SurfaceOptics(precipitation=runtime.descriptor)))
            val geometry=if(paper)NativePrecipitationGeometry.paper(snow,visual)else NativePrecipitationGeometry.create(snow,visual)
            builder.add(geometry,material,FloatBuffer.wrap(matrices),aux=FloatBuffer.wrap(auxiliary),castShadow=false,receiveShadow=false)
        }
        val result=NativePrecipitationPrepared(key,builder.build(cancelled),capacity);checkpoint();cached=result;return result
    }
    fun clear(){cached=null}
}
