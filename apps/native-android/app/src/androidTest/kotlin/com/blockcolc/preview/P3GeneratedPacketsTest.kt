package com.blockcolc.preview

import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import android.os.Handler
import android.os.HandlerThread
import com.blockcolc.world.*
import com.blockcolc.world.generation.*
import com.blockcolc.world.filament.PacketRenderer
import com.google.android.filament.Engine
import com.google.android.filament.Filament
import com.google.android.filament.Scene
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.FloatBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Upload/lifetime checks on the real GLES driver, not a rendered frame or a
 * performance benchmark. No saved database, permissions or formal App access. */
class P3GeneratedPacketsTest {
    @get:Rule val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun matrices(count:Int)=FloatBuffer.wrap(FloatArray(count*16){when(it%16){0,5,10,15->1f;12->(it/16).toFloat();else->0f}})
    private fun camera()=NativeSceneCamera(BlockPoint(0.0,0.0,0.0),BlockPoint(10.0,20.0,25.0),35.0,40.0,
        SourceCamera(20.0,listOf(listOf(-20.0,-5.0,-20.0),listOf(20.0,20.0,20.0)),120.0,.82,.91,1.5,120.0))
    private fun lighting()=SourceLighting(1f,listOf(.1f,.2f,.3f),listOf(SourceLight("DirectionalLight",listOf(1f,1f,1f),3f,listOf(0f,-1f,0f),listOf(0f,20f,0f),true,listOf(0f,0f,0f),0f,.01f)),true,emptyList())
    private fun onRenderer(block:(PacketRenderer,Engine)->JSONObject):JSONObject {
        val thread=HandlerThread("blockcolc-p3-generated-gpu").apply{start()};val done=CountDownLatch(1)
        val result=AtomicReference<JSONObject>();val failure=AtomicReference<Throwable>()
        Handler(thread.looper).post {
            var engine:Engine?=null;var scene:Scene?=null;var packets:PacketRenderer?=null
            fun cleanup(action:()->Unit){try{action()}catch(error:Throwable){val previous=failure.get();if(previous==null)failure.set(error)else previous.addSuppressed(error)}}
            try {Filament.init();val e=Engine.create(Engine.Backend.OPENGL);engine=e;val s=e.createScene();scene=s
                val p=PacketRenderer(e,s,context.assets);packets=p;result.set(block(p,e))
            }catch(error:Throwable){failure.set(error)}
            finally {
                packets?.let{p->cleanup{p.close()}};engine?.let{e->cleanup{e.flushAndWait()};scene?.let{s->cleanup{e.destroyScene(s)}};cleanup{e.destroy()}}
                done.countDown();thread.quitSafely()
            }
        }
        try{assertTrue("Generated GPU check did not finish",done.await(90,TimeUnit.SECONDS))}
        finally{thread.quitSafely()}
        failure.get()?.let{throw AssertionError("Generated GLES resource check failed",it)}
        return checkNotNull(result.get()).put("gpuUploadOnly",true).put("frameRendered",false).also{println("P3_GENERATED_GPU "+it)}
    }
    @Test fun colorTargetsPrepareAndRollbackOnTheRealDriverAndColourOnlyChangesReuseStorage(){
        val report=onRenderer{_,e->
            val nativeView=e.createView();val cameraId=com.google.android.filament.EntityManager.get().create();val camera=e.createCamera(cameraId)
            var pipeline:com.blockcolc.world.filament.NativeColorPipeline?=null
            try{
                val p=com.blockcolc.world.filament.NativeColorPipeline(e,context.assets,nativeView,camera,1f,false,SourcePost.NONE);pipeline=p
                val before=p.diagnostics();val initial=before.getJSONObject("config").getInt("sourceTexture")
                val high=SourcePost.native(NativeLightingQuality.HIGH)
                val failure=assertThrows(IllegalStateException::class.java){p.prepareConfiguration(high,failAfterTargets=2)}
                assertEquals("Injected staged color-target failure",failure.message);e.flushAndWait()
                val failed=p.diagnostics();assertEquals(initial,failed.getJSONObject("config").getInt("sourceTexture"));assertEquals(1,failed.getInt("liveTargets"))
                assertEquals(2,failed.getInt("targetsCreated")-before.getInt("targetsCreated"));assertEquals(2,failed.getInt("targetsDestroyed")-before.getInt("targetsDestroyed"))
                val provisional=p.prepareConfiguration(high);assertEquals(initial,p.diagnostics().getJSONObject("config").getInt("sourceTexture"))
                provisional.commit();assertTrue(p.bloomEnabled);assertEquals(5,p.diagnostics().getInt("liveTargets"))
                provisional.rollback();val rolledBack=p.diagnostics();assertFalse(p.bloomEnabled);assertEquals(initial,rolledBack.getJSONObject("config").getInt("sourceTexture"));assertEquals(1,rolledBack.getInt("liveTargets"))
                p.prepareConfiguration(high).also{it.commit();assertEquals(0,it.finish())};val adopted=p.diagnostics()
                assertEquals(4,adopted.getInt("liveTargets"));assertEquals(2,adopted.getJSONObject("config").getInt("sampleCount"))
                p.worldColor(SourceWorldColor(50,110,120));val colour=p.diagnostics()
                assertEquals(adopted.getInt("targetsCreated"),colour.getInt("targetsCreated"));assertEquals(adopted.getJSONObject("config").getInt("sourceTexture"),colour.getJSONObject("config").getInt("sourceTexture"))
                assertEquals(50,colour.getJSONObject("config").getInt("saturation"));assertEquals(4,colour.getInt("liveTargets"))
                p.prepareConfiguration(SourcePost.NONE).also{it.commit();it.finish()};val low=p.diagnostics();assertEquals(1,low.getInt("liveTargets"));assertFalse(p.bloomEnabled)
                p.close();val closed=p.diagnostics();assertEquals(0,closed.getInt("liveTargets"));assertTrue(closed.getBoolean("closed"))
                JSONObject().put("before",before).put("failed",failed).put("rolledBack",rolledBack).put("adopted",adopted).put("colour",colour).put("low",low).put("closed",closed)
            }finally{pipeline?.close();e.destroyView(nativeView);e.destroyCameraComponent(cameraId);com.google.android.filament.EntityManager.get().destroy(cameraId)}
        }
        val label=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
        java.io.File(context.filesDir,"p3-world-color-targets.json").writeText(report.put("caseLabel",label).toString())
    }
    @Test fun generatedOwnersKeepSharedGpuResourcesAcrossFailedAndEmptyReplacements() {
        val report=onRenderer{p,e->
            val cube=CuboidGeometry.create();val pixels=ByteBuffer.wrap(ByteArray(8){(it*23+20).toByte()})
            val tall=NativePixelTexture(1,2,pixels,mipmaps=false,minFilter=1003);val wide=NativePixelTexture(2,1,pixels,mipmaps=false,minFilter=1003)
            fun source(owner:String,texture:NativePixelTexture?=null,count:Int=1):NativePacketSource {
                val builder=NativePacketBuilder(owner);if(count>0)builder.add(cube,NativeRenderMaterial(texture=texture),matrices(count));return builder.build()
            }
            p.loadGenerated(NativeGeneratedScene(listOf(source("world"),source("building:a",tall),source("building:b",wide),source("reward:empty",count=0)),lighting(),SourcePost.NONE,camera(),0,1));e.flushAndWait()
            val before=p.diagnostics();assertEquals("native-generated",p.metadata.getString("sourceKind"));assertEquals(1,before.getInt("geometryCreated"));assertEquals(3,before.getInt("textureCreated"))
            val token=checkNotNull(p.ownerToken("building:a"));assertNotNull(p.ownerToken("reward:empty"))
            assertThrows(IllegalStateException::class.java){p.replaceGenerated(source("building:a",tall,1025),token,1)};e.flushAndWait()
            val failed=p.diagnostics();for(key in listOf("owners","geometries","textures","inputGpuEstimate"))assertEquals(key,before.getJSONObject(key).toString(),failed.getJSONObject(key).toString())
            assertEquals(token,p.ownerToken("building:a"))
            assertTrue(p.replaceGenerated(source("building:a",tall,2),token).accepted);e.flushAndWait()
            val changed=p.diagnostics();assertEquals(before.getJSONObject("owners").getJSONArray("building:b").toString(),changed.getJSONObject("owners").getJSONArray("building:b").toString())
            assertEquals(1,changed.getInt("geometryCreated"));assertFalse(p.replaceGenerated(source("building:a",tall),token).accepted)
            val emptyToken=checkNotNull(p.ownerToken("reward:empty"));assertTrue(p.replaceGenerated(source("reward:empty",tall),emptyToken).accepted)
            val next=checkNotNull(p.ownerToken("building:a"));assertTrue(p.replaceGenerated(source("building:a",count=0),next).accepted);e.flushAndWait()
            assertEquals(0,p.diagnostics().getJSONObject("owners").getJSONArray("building:a").length())
            val live=p.diagnostics();p.close();e.flushAndWait();val retired=p.diagnostics()
            assertEquals(retired.getInt("geometryCreated"),retired.getInt("geometryDestroyed"));assertEquals(retired.getInt("textureCreated"),retired.getInt("textureDestroyed"))
            JSONObject().put("before",before).put("afterReplacement",live).put("retired",retired)
        }
        assertFalse(report.getBoolean("frameRendered"))
    }
    @Test fun originalRgbaPatternsAndPackedFluidSurfacesUploadWithoutPngOrFrozenWorldAssets() {
        val report=onRenderer{p,e->
            val library=OriginalMaterialLibrary.bundled;val builder=NativePacketBuilder("world");val cube=CuboidGeometry.create()
            for(pattern in OriginalPattern.entries){val image=library.texture(pattern);val d=image.descriptor
                val texture=NativePixelTexture(d.width,d.height,image.pixels(),wrapS=d.wrapS,wrapT=d.wrapT,minFilter=d.minFilter,magFilter=d.magFilter,anisotropy=d.anisotropy.toFloat())
                builder.add(cube,NativeRenderMaterial(texture=texture),matrices(1))
            }
            val water=OriginalFluids().free(listOf(RenderVoxel(0.0,0.0,0.0,"stone",0,"minecraft:water",mapOf("level" to "0")))).entries.single()
            val material=NativeRenderMaterial(color=LinearRgb.fromSrgb(0x4d7f86),transparent=true,opacity=.76f,
                surface=SurfaceCoverage(SurfaceEffects.NONE,listOf("native-fluid-surface"),emptyList(),SurfaceOptics(fluidSurface=true)))
            builder.add(OriginalFluids.geometry(water.faceMask,false),material,matrices(1),aux=FloatBuffer.wrap(floatArrayOf(water.packedMetadata.toFloat(),water.packedCorners.toFloat(),0f,0f)),castShadow=false)
            p.loadGenerated(NativeGeneratedScene(listOf(builder.build()),lighting(),SourcePost.NONE,camera(),0,2));e.flushAndWait()
            val live=p.diagnostics();assertEquals(25,live.getInt("packets"));assertEquals(25,live.getInt("textureCreated")) // 24 RGBA patterns plus white
            assertEquals(2,live.getInt("geometryCreated"))
            p.close();e.flushAndWait();val retired=p.diagnostics();assertEquals(retired.getInt("textureCreated"),retired.getInt("textureDestroyed"));assertEquals(retired.getInt("geometryCreated"),retired.getInt("geometryDestroyed"))
            JSONObject().put("patterns",OriginalPattern.entries.size).put("live",live).put("retired",retired)
        }
        assertEquals(24,report.getInt("patterns"))
    }
    @Test fun cloudAndGroundedPrecipitationOwnersRollbackTogetherAfterARealSecondOwnerGpuFailure(){
        onRenderer{p,e->
            val cloudContext=NativeCloudContext(NativeCloudView(20.0,20.0,80.0,80.0,40.0,40.0,true),0.0,0.0,24.0)
            val ground=NativePrecipitationGround.prepare(listOf(TerrainSurface(-40.0,40.0,-40.0,40.0,0.0,TerrainMaterial.GRASS)))
            val rainContext=NativePrecipitationContext(listOf(-40.0,40.0,-40.0,40.0),listOf(20.0,20.0),ground,true)
            fun sample(storm:Boolean)=NativeEnvironmentContext("UTC",NativeLightingQuality.HIGH,20.0,40.0,35.0,
                weather=NativeWeatherOverride(if(storm)NativeWeatherKind.RAIN else NativeWeatherKind.CLEAR,storm)).sample(1_792_886_400_000L)
            val clear=sample(false);val storm=sample(true);val clouds=NativeCloudCompiler();val precipitation=NativePrecipitationCompiler()
            val oldCloud=clouds.prepare(cloudContext,clear.weather);val oldRain=precipitation.prepare(rainContext,clear.weather,1.0,oldCloud.randomTail)
            val root=NativePacketBuilder("world").apply{add(CuboidGeometry.create(),NativeRenderMaterial(),matrices(1))}.build()
            p.loadGenerated(NativeGeneratedScene(listOf(root,oldCloud.source,oldRain.source),clear.lighting,SourcePost.NONE,camera(),0,1,clear.surface,clear.cloudColor));e.flushAndWait()
            val before=p.diagnostics();val nextCloud=clouds.prepare(cloudContext,storm.weather);val nextRain=precipitation.prepare(rainContext,storm.weather,1.0,nextCloud.randomTail)
            val inputs=listOf(nextCloud.source,nextRain.source);val tokens=inputs.associate{it.owner to checkNotNull(p.ownerToken(it.owner))}
            p.setRuntime(8f,cloudSeconds=8f,weatherElapsedMs=8000f);p.updateGeneratedEnvironment(storm.uniforms())
            assertThrows(IllegalStateException::class.java){p.replaceGeneratedMany(inputs,tokens,checkNotNull(nextCloud.source.world).packets.size+1)};e.flushAndWait()
            p.updateGeneratedEnvironment(clear.uniforms());val failed=p.diagnostics()
            for(key in listOf("owners","geometries","textures","inputGpuEstimate"))assertEquals(key,before.getJSONObject(key).toString(),failed.getJSONObject(key).toString())
            assertEquals(tokens,tokens.keys.associateWith{p.ownerToken(it)});assertEquals(0,failed.getInt("precipitationPackets"))
            p.updateGeneratedEnvironment(storm.uniforms());assertTrue(p.replaceGeneratedMany(inputs,tokens).accepted);e.flushAndWait()
            p.updateWeather(doubleArrayOf(10.0,20.0,25.0),doubleArrayOf(0.0,0.0,0.0),40.0,.75,.1,200.0,960.0)
            val adopted=p.diagnostics();assertEquals(before.getJSONObject("owners").getJSONArray("world").toString(),adopted.getJSONObject("owners").getJSONArray("world").toString())
            assertTrue(adopted.getInt("precipitationActiveCount")>0);assertEquals(8000.0,adopted.getJSONArray("nativeWeatherOrigins").getDouble(0),0.0)
            assertEquals(1,adopted.getJSONObject("textures").keys().asSequence().count{it.startsWith("r32f:")})
            val uploads=adopted.getInt("instanceRowUploads");p.setRuntime(9f,cloudSeconds=9f,weatherElapsedMs=9000f)
            p.updateWeather(doubleArrayOf(20.0,40.0,50.0),doubleArrayOf(0.0,0.0,0.0),40.0,.75,.1,200.0,960.0)
            assertEquals(uploads,p.diagnostics().getInt("instanceRowUploads"));assertFalse(p.replaceGeneratedMany(inputs,tokens).accepted)
            p.close();e.flushAndWait();val retired=p.diagnostics()
            assertEquals(retired.getInt("geometryCreated"),retired.getInt("geometryDestroyed"));assertEquals(retired.getInt("textureCreated"),retired.getInt("textureDestroyed"))
            JSONObject().put("before",before).put("failed",failed).put("adopted",adopted).put("retired",retired).put("atomicWeatherRollback",true)
        }
    }
}
