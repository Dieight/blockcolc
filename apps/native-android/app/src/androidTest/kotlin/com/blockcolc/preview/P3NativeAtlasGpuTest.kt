package com.blockcolc.preview

import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.blockcolc.world.*
import com.blockcolc.world.filament.*
import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import com.google.android.filament.Engine
import com.google.android.filament.Filament
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.FloatBuffer
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Actual native texture/sampler/animation boundary, isolated from business state. */
class P3NativeAtlasGpuTest {
    @get:Rule val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val label get()=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
    private val oracle by lazy{JSONObject(javaClass.getResourceAsStream("/native-atlas-programs-oracle.json")!!.bufferedReader().use{it.readText()})}
    private val sample by lazy{NativeEnvironmentContext("UTC",NativeLightingQuality.LOW,8.0,32.0,16.0,weather=NativeWeatherOverride(NativeWeatherKind.CLEAR),timeMinutes=900).sample(1792929600000)}
    private fun matrix(x:Double,y:Double,z:Double)=BlockTransform.translation(x,y,z).let{m->FloatArray(16){m[it].toFloat()}}
    private fun program(name:String):NativeAtlasTextures {
        val rows=oracle.getJSONArray("cases");val row=(0 until rows.length()).map{rows.getJSONObject(it)}.first{it.getString("name")==name}
        return NativeResourceArchive.from(Base64.decode(row.getString("zip"),Base64.DEFAULT)).use{archive->
            NativeAtlasTextures.prepare(NativeResourceAtlas.build(ResourcePackStack.of(ResourcePackAssets.prepare(archive))))}
    }
    private fun source(owner:String,program:NativeAtlasTextures,x:Double,animated:Boolean=true):NativePacketSource {
        val binding=program.forOwner(owner,if(animated)null else emptySet()).values.single();val cube=CuboidGeometry.create(2.8,2.8,2.8)
        val entry=program.atlas.entries.single();val old=cube.textureCoordinates()!!;val mapped=FloatArray(cube.vertexCount*2)
        repeat(cube.vertexCount){i->val u=.5/16+old.get()*15.0/16;val v=.5/16+old.get()*15.0/16
            mapped[i*2]=(entry.uv.u0+(entry.uv.u1-entry.uv.u0)*u).toFloat();mapped[i*2+1]=(entry.uv.v0+(entry.uv.v1-entry.uv.v0)*v).toFloat()}
        val geometry=object:BlockGeometry by cube{
            override val vertexPreparation="atlas-static-v1"
            override fun textureCoordinates()=FloatBuffer.wrap(mapped).asReadOnlyBuffer()
            override fun colors()=FloatBuffer.wrap(FloatArray(vertexCount*3){1f}).asReadOnlyBuffer()
            override fun colorAlpha()=FloatBuffer.wrap(FloatArray(vertexCount)).asReadOnlyBuffer()
        }
        val surface=NativeSurfaceBinding(0f,0f);val material=NativeRenderMaterial(texture=binding.color,vertexColors=true,unlit=true,fog=false,
            surface=surface.resolve(sample.surface),environment=NativeMaterialBinding(surface),atlas=binding)
        return NativePacketBuilder(owner).also{it.add(geometry,material,FloatBuffer.wrap(matrix(x,1.4,0.0)),castShadow=false,receiveShadow=false)}.build()
    }
    private fun scene(a:NativePacketSource,b:NativePacketSource):NativeGeneratedScene{
        val floor=NativePacketBuilder("world");floor.add(CuboidGeometry.create(14.0,.1,10.0),NativeRenderMaterial(color=LinearRgb(.15f,.18f,.2f),unlit=true,fog=false),
            FloatBuffer.wrap(matrix(0.0,-.1,0.0)),castShadow=false,receiveShadow=false)
        val camera=NativeSceneCamera(BlockPoint(0.0,1.2,0.0),BlockPoint(7.0,8.0,17.0),19.0,42.0,
            SourceCamera(12.0,listOf(listOf(-12.0,-3.0,-12.0),listOf(12.0,12.0,12.0)),120.0,.82,.91,1.5,100.0))
        return NativeGeneratedScene(listOf(floor.build(),a,b),sample.lighting,SourcePost.native(NativeLightingQuality.LOW),camera,0,0,sample.surface)
    }
    private fun diagnostic(view:NativeWorldView):JSONObject{
        val done=CountDownLatch(1);val value=AtomicReference<JSONObject>();view.generatedDiagnostics{value.set(it);done.countDown()};assertTrue(done.await(10,TimeUnit.SECONDS));return value.get()
    }
    private fun await(view:NativeWorldView,condition:(JSONObject)->Boolean):JSONObject{
        val end=android.os.SystemClock.uptimeMillis()+10000;var current=diagnostic(view)
        while(!condition(current)&&android.os.SystemClock.uptimeMillis()<end){android.os.SystemClock.sleep(40);current=diagnostic(view)}
        assertTrue("Atlas runtime did not settle: $current",condition(current));return current
    }
    private fun screenshot(view:NativeWorldView,index:Int):JSONObject{
        val file=File(context.filesDir,"p3-world-$label-atlas-$index.png");assertTrue(UiDevice.getInstance(instrumentation).takeScreenshot(file))
        val bitmap=checkNotNull(android.graphics.BitmapFactory.decodeFile(file.path));val position=IntArray(2);instrumentation.runOnMainSync{view.getLocationOnScreen(position)}
        val digest=MessageDigest.getInstance("SHA-256")
        try{for(y in 0 until 48)for(x in 0 until 48){val px=(position[0]+view.width*(.1+.8*x/48)).toInt().coerceIn(0,bitmap.width-1);val py=(position[1]+view.height*(.1+.8*y/48)).toInt().coerceIn(0,bitmap.height-1)
            val c=bitmap.getPixel(px,py);digest.update((c shr 16).toByte());digest.update((c shr 8).toByte());digest.update(c.toByte())}}
        finally{bitmap.recycle()}
        return JSONObject().put("file",file.name).put("worldPixelsSha256",digest.digest().joinToString(""){"%02x".format(it.toInt()and 255)})
    }
    @Test fun androidBitmapMipUploadPreservesTheExactNonPremultipliedSourcePixels(){
        val rows=oracle.getJSONArray("cases");var levels=0
        repeat(rows.length()){i->val row=rows.getJSONObject(i)
            NativeResourceArchive.from(Base64.decode(row.getString("zip"),Base64.DEFAULT)).use{archive->
                val stack=ResourcePackStack.of(ResourcePackAssets.prepare(archive));val selected=row.optJSONArray("selectedIds")?.let{v->List(v.length()){v.getString(it)}.toSet()}
                val limits=row.getJSONObject("limits");val atlas=NativeResourceAtlas.build(stack,selected,ResourceAtlasLimits(maxPages=limits.optInt("maxPages",4),gutter=limits.optInt("gutter",2),maxPageSize=limits.optInt("maxPageSize",2048)))
                val textures=NativeAtlasTextures.prepare(atlas)
                for(binding in textures.forOwner("building:bitmap").values)for(level in binding.color.manualMipmaps){
                    val input=level.pixels();val start=input.position();val bitmap=NativeBitmapUploads.rgba(level.width,level.height,input)
                    try{val result=ByteBuffer.allocateDirect(level.width*level.height*4);bitmap.copyPixelsToBuffer(result);result.flip();assertEquals(start,input.position())
                        assertEquals(row.getString("name"),level.sha256,MessageDigest.getInstance("SHA-256").also{it.update(result)}.digest().joinToString(""){"%02x".format(it.toInt()and 255)});levels++}
                    finally{bitmap.recycle()}
                }
            }
        }
        assertTrue(levels>50)
        File(context.filesDir,"p3-world-atlas-gpu-bitmaps.json").writeText(JSONObject().put("schema",1).put("caseLabel",label).put("cases",rows.length()).put("mipLevels",levels).put("sourceHashes",oracle.getJSONObject("sourceHashes")).toString())
    }
    @Test fun actualFramesAnimateDuringDaytimeAndPauseWithoutRebuildingGeometryOrTextures(){
        val program=program("strip-animation");val scene=scene(source("building:atlas-a",program,-2.0),source("building:atlas-b",program,2.0,false))
        val ready=CountDownLatch(1);val error=AtomicReference<String>();val holder=AtomicReference<NativeWorldView>()
        foreground.scenario.onActivity{activity->activity.onGeneratedFrame={if(it==scene.presentationIdentity)ready.countDown()};activity.onGeneratedError={error.set(it);ready.countDown()};activity.presentGenerated(scene);holder.set(checkNotNull(activity.generatedWorld))}
        assertTrue(ready.await(60,TimeUnit.SECONDS));assertNull(error.get());val view=holder.get()
        val before=await(view){it.getJSONObject("resources").getInt("atlasTimelineChanges")>0}
        assertFalse(before.getBoolean("failed"));assertEquals(1,before.getJSONObject("resources").getInt("atlasSequences"))
        val screenshots=JSONArray();repeat(5){i->android.os.SystemClock.sleep(210);screenshots.put(screenshot(view,i))}
        val moving=diagnostic(view);assertTrue((0 until screenshots.length()).map{screenshots.getJSONObject(it).getString("worldPixelsSha256")}.distinct().size>1)
        assertEquals(before.getJSONObject("resources").getInt("geometryCreated"),moving.getJSONObject("resources").getInt("geometryCreated"))
        assertEquals(before.getJSONObject("resources").getInt("textureCreated"),moving.getJSONObject("resources").getInt("textureCreated"))
        instrumentation.runOnMainSync{view.pause()};val paused=diagnostic(view);android.os.SystemClock.sleep(350);val still=diagnostic(view)
        assertEquals(paused.getJSONObject("resources").getJSONArray("atlasRuntime").toString(),still.getJSONObject("resources").getJSONArray("atlasRuntime").toString())
        instrumentation.runOnMainSync{view.resume()};val resumed=await(view){it.getJSONObject("resources").getInt("atlasTimelineChanges")>still.getJSONObject("resources").getInt("atlasTimelineChanges")}
        File(context.filesDir,"p3-world-atlas-gpu-visible.json").writeText(JSONObject().put("schema",1).put("caseLabel",label).put("before",before).put("moving",moving).put("paused",paused).put("resumed",resumed)
            .put("screenshots",screenshots).put("sourceHashes",oracle.getJSONObject("sourceHashes")).toString())
        instrumentation.runOnMainSync{view.pause()}
    }
    @Test fun ownerSwapStagesTimelinesAndGpuFailureKeepsOldOwnersAndAnimationState(){
        val old=program("strip-animation");val next=program("grid-animation");val first=scene(source("building:atlas-a",old,-2.0),source("building:atlas-b",old,2.0))
        val replacement=source("building:atlas-a",next,-2.0);val static=source("building:atlas-a",next,-2.0,false)
        val thread=HandlerThread("blockcolc-atlas-gpu").apply{start()};val done=CountDownLatch(1);val failure=AtomicReference<Throwable>()
        Handler(thread.looper).post{var engine:Engine?=null;var renderer:PacketRenderer?=null;var world:com.google.android.filament.Scene?=null
            try{Filament.init();val e=Engine.create(Engine.Backend.OPENGL);engine=e;val s=e.createScene();world=s;val r=PacketRenderer(e,s,context.assets);renderer=r;r.loadGenerated(first)
                r.setRuntime(1f,enabled=false,atlasElapsedMs=175f,atlasMotion=true);e.flushAndWait();val before=r.diagnostics();val a=checkNotNull(r.ownerToken("building:atlas-a"));val b=r.ownerToken("building:atlas-b")
                assertEquals(2,before.getInt("atlasSequences"));assertThrows(IllegalStateException::class.java){r.replaceGenerated(replacement,a,failAfterPackets=1)};e.flushAndWait();val rejected=r.diagnostics()
                assertEquals(before.getJSONArray("atlasRuntime").toString(),rejected.getJSONArray("atlasRuntime").toString());assertEquals(a,r.ownerToken("building:atlas-a"));assertEquals(b,r.ownerToken("building:atlas-b"))
                assertTrue(r.replaceGenerated(replacement,a).accepted);r.setRuntime(1f,enabled=false,atlasElapsedMs=175f,atlasMotion=true);e.flushAndWait();val accepted=r.diagnostics()
                assertEquals(2,accepted.getInt("atlasSequences"));assertEquals(b,r.ownerToken("building:atlas-b"));assertFalse(r.replaceGenerated(replacement,a).accepted)
                val token=checkNotNull(r.ownerToken("building:atlas-a"));assertTrue(r.replaceGenerated(static,token).accepted);r.setRuntime(2f,atlasElapsedMs=350f);e.flushAndWait();val removed=r.diagnostics();assertEquals(1,removed.getInt("atlasSequences"))
                r.setRuntime(5f,atlasElapsedMs=9999f,atlasMotion=false);e.flushAndWait();val frozen=r.diagnostics()
                assertEquals(1,frozen.getJSONArray("atlasRuntime").length());assertEquals("building:atlas-b",frozen.getJSONArray("atlasRuntime").getJSONObject(0).getString("owner"))
                File(context.filesDir,"p3-world-atlas-gpu-rollback.json").writeText(JSONObject().put("schema",1).put("caseLabel",label).put("before",before).put("rejected",rejected).put("accepted",accepted).put("removed",removed).put("frozen",frozen).toString())
            }catch(t:Throwable){failure.set(t)}finally{try{renderer?.close();engine?.let{e->e.flushAndWait();world?.let{e.destroyScene(it)};e.destroy()}}catch(t:Throwable){failure.get()?.addSuppressed(t)?:failure.set(t)};done.countDown();thread.quitSafely()}}
        try{assertTrue(done.await(90,TimeUnit.SECONDS));failure.get()?.let{throw AssertionError("Native atlas GPU transaction failed",it)}}finally{thread.quitSafely()}
    }
}
