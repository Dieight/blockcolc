package com.blockcolc.preview

import android.content.Intent
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleCallback
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.test.uiautomator.UiDevice
import com.blockcolc.domain.*
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.preview.world.*
import com.blockcolc.world.*
import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Real generated scenes rendered through the actual SurfaceView, not just an
 * upload. Screenshots are evidence for review, not automatic visual approval. */
class P3GeneratedWorldTest {
    @get:Rule val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val now=DomainTime.millis("2026-10-25T04:00:00.000Z")
    private val options=WorldRenderOptions(now,"Asia/Shanghai",weather=NativeWeatherOverride(NativeWeatherKind.CLEAR))
    private val caseLabel get()=(InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone").also{require(it.matches(Regex("[a-z0-9-]{1,60}")))}
    private fun record(name:String,value:JSONObject){File(context.filesDir,"p3-world-$name.json").writeText(value.put("caseLabel",caseLabel).toString())}
    private fun apply(s:DomainDocument,type:String,vararg fields:Pair<String,Any?>,at:Long=now):DomainDocument {
        val r=DomainEngine.execute(s,DomainEngine.command(type,*fields),at);check(r.ok){"$type ${r.error}"};return r.state
    }
    private fun facts():DomainDocument {
        var state=DomainEngine.initial("UTC")
        for(id in listOf("a","b"))state=apply(state,"CreateProject","projectId" to id,"title" to "P3 synthetic $id","blueprintId" to "builtin-small-workshop",
            "subtasks" to JSONArray().put(JSONObject().put("id","task-$id").put("title","P3 task $id")))
        return state
    }
    private fun present(scene:NativeGeneratedScene,fixedCamera:Boolean=false):JSONObject {
        val done=CountDownLatch(1);val error=AtomicReference<String>()
        foreground.scenario.onActivity{activity->activity.onGeneratedFrame={id->if(id==scene.presentationIdentity)done.countDown()}
            activity.onGeneratedError={error.set(it);done.countDown()};activity.presentGenerated(scene,fixedCamera)}
        assertTrue("Native generated world did not submit a frame",done.await(80,TimeUnit.SECONDS));assertNull(error.get())
        val result=AtomicReference<JSONObject>();val diagnostic=CountDownLatch(1)
        foreground.scenario.onActivity{it.generatedWorld!!.generatedDiagnostics{value->result.set(value);diagnostic.countDown()}}
        assertTrue(diagnostic.await(10,TimeUnit.SECONDS));return result.get().also{assertFalse(it.getBoolean("failed"));assertTrue(it.getLong("frames")>0);assertEquals(scene.revision,it.getLong("revision"))}
    }
    private data class SkyPixel(val x:Int,val y:Int,val rgb:IntArray)
    private fun screen(suffix:String,skyPixel:SkyPixel?=null):Int {
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
        val file=File(context.filesDir,"p3-world-$group-$suffix.png")
        val device=UiDevice.getInstance(instrumentation)
        // Capture settling is deliberately outside all performance samples.
        device.waitForIdle(1000);android.os.SystemClock.sleep(120)
        assertTrue(device.takeScreenshot(file));assertTrue(file.length()>4096)
        val bitmap=checkNotNull(android.graphics.BitmapFactory.decodeFile(file.path));val colors=HashSet<Int>()
        var picked=0
        try{for(y in bitmap.height/4 until bitmap.height*3/4 step 17)for(x in bitmap.width/8 until bitmap.width*7/8 step 17)colors+=bitmap.getPixel(x,y) and 0xffffff
            if(skyPixel==null)assertTrue("The displayed world is blank rather than the submitted scene",colors.size>32)
            else {
                picked=bitmap.getPixel(skyPixel.x,skyPixel.y)
                repeat(3){channel->val actual=(picked shr(16-channel*8))and 255
                    assertTrue("Sky channel $channel: expected ${skyPixel.rgb[channel]}, got $actual",kotlin.math.abs(actual-skyPixel.rgb[channel])<=6)}
            }
        }finally{bitmap.recycle()}
        return picked
    }
    /** Independent CPU evaluation of the current Three terminal operator.
     * A sky-only storm can be nearly uniform; verify its predicted colour
     * rather than treating low colour variety as a missing world. */
    private fun terminalPixel(color:DoubleArray,exposure:Double):IntArray {
        fun matrix(m:DoubleArray,c:DoubleArray)=DoubleArray(3){row->(0..2).sumOf{column->m[row*3+column]*c[column]}}
        val input=matrix(doubleArrayOf(.59719,.35458,.04823,.076,.90834,.01566,.0284,.13383,.83777),DoubleArray(3){color[it]*exposure/.6})
        val fitted=DoubleArray(3){i->val v=input[i];(v*(v+.0245786)-.000090537)/(v*(.983729*v+.4329510)+.238081)}
        val output=matrix(doubleArrayOf(1.60475,-.53108,-.07367,-.10208,1.10813,-.00605,-.00327,-.07276,1.07602),fitted)
        return IntArray(3){i->val c=output[i].coerceIn(0.0,1.0);val encoded=if(c<=.0031308)c*12.92 else 1.055*Math.pow(c,.41666)-.055;kotlin.math.floor(encoded*255+.5).toInt()}
    }
    private fun diagnostic(world:com.blockcolc.world.filament.NativeWorldView):JSONObject {
        val result=AtomicReference<JSONObject>();val ready=CountDownLatch(1)
        world.generatedDiagnostics{result.set(it);ready.countDown()}
        assertTrue(ready.await(10,TimeUnit.SECONDS));return checkNotNull(result.get())
    }
    private fun awaitDiagnostic(world:com.blockcolc.world.filament.NativeWorldView,condition:(JSONObject)->Boolean):JSONObject {
        val deadline=android.os.SystemClock.uptimeMillis()+10000
        var last=diagnostic(world)
        while(!condition(last)&&android.os.SystemClock.uptimeMillis()<deadline){android.os.SystemClock.sleep(16);last=diagnostic(world)}
        if(!condition(last)){
            val state=JSONObject(last.toString()).apply{remove("resources")}
            fail("Surface lifecycle did not settle: $state")
        }
        return last
    }
    @Test fun projectionAndSceneReceiptsSurviveConcurrentReplacementAndPausedRequests(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
        val errors=java.util.concurrent.CopyOnWriteArrayList<String>()
        try{
            val input=builder.terrain(builder.prepare(WorldFacts.from(facts())))
            val scene=compiler.prepare(WorldRequestIdentity("synthetic-projection.db",0,1),input,options).scene
            val before=present(scene);val replacement=scene.withPresentation()
            val reference=AtomicReference<com.blockcolc.world.filament.NativeWorldView>()
            val sceneReady=CountDownLatch(1);val projectionReady=CountDownLatch(1)
            val projectionCount=java.util.concurrent.atomic.AtomicInteger()
            foreground.scenario.onActivity{activity->
                val world=checkNotNull(activity.generatedWorld);reference.set(world)
                activity.onGeneratedError=errors::add
                activity.onGeneratedFrame={if(it==replacement.presentationIdentity)sceneReady.countDown()}
                // Both receipts must be acknowledged even when the pending
                // camera frame and the replacement use the same render turn.
                world.projectionWindow(world.height*3/4,0){projectionCount.incrementAndGet();projectionReady.countDown()}
                activity.presentGenerated(replacement)
            }
            assertTrue("Replacement scene was not acknowledged: $errors",sceneReady.await(30,TimeUnit.SECONDS))
            assertTrue("Scene replacement cancelled the projection receipt: $errors",projectionReady.await(10,TimeUnit.SECONDS))
            val world=reference.get();val resumed=CountDownLatch(1)
            val stale=java.util.concurrent.atomic.AtomicInteger();val resumedCount=java.util.concurrent.atomic.AtomicInteger()
            foreground.scenario.onActivity{
                world.pause()
                world.projectionWindow(world.height*2/3,0){stale.incrementAndGet()}
                world.projectionWindow(world.height,0){resumedCount.incrementAndGet();resumed.countDown()}
                world.resume()
            }
            assertTrue("The latest paused projection request was lost: $errors",resumed.await(10,TimeUnit.SECONDS))
            val after=diagnostic(world)
            assertEquals(1,projectionCount.get());assertEquals(0,stale.get());assertEquals(1,resumedCount.get())
            assertEquals(replacement.presentationIdentity,after.getLong("presentationIdentity"))
            assertTrue(errors.toString(),errors.isEmpty());assertFalse(after.getBoolean("failed"))
            for(key in listOf("owners","geometries","textures"))assertEquals(key,before.getJSONObject("resources").getJSONObject(key).toString(),after.getJSONObject("resources").getJSONObject(key).toString())
            record("independent-receipts",JSONObject().put("schema",1).put("before",before).put("after",after)
                .put("projectionCallbacks",projectionCount.get()).put("cancelledCallbacks",stale.get()).put("resumedCallbacks",resumedCount.get()))
        }finally{builder.clear();compiler.clear()}
    }
    @Test fun stoppingAndResumingKeepsResourcesAndRetiresTheOldSurfaceBeforeItsCallbackReturns(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler();val errors=java.util.concurrent.CopyOnWriteArrayList<String>()
        val lifecycle=java.util.concurrent.CopyOnWriteArrayList<String>()
        val activity=AtomicReference<P3DerivedCacheCheckActivity>()
        val stoppedActivity=CountDownLatch(1);val resumedActivity=CountDownLatch(1)
        val monitor=ActivityLifecycleMonitorRegistry.getInstance()
        val callback=ActivityLifecycleCallback{target,stage->if(target===activity.get()){
            lifecycle.add(stage.name)
            if(stage==Stage.STOPPED)stoppedActivity.countDown()
            if(stage==Stage.RESUMED)resumedActivity.countDown()
        }}
        instrumentation.runOnMainSync{monitor.addLifecycleCallback(callback)}
        try{
            val worldInput=builder.terrain(builder.prepare(WorldFacts.from(facts())))
            val scene=compiler.prepare(WorldRequestIdentity("synthetic-surface.db",0,1),worldInput,options).scene
            val before=present(scene)
            val reference=AtomicReference<com.blockcolc.world.filament.NativeWorldView>()
            foreground.scenario.onActivity{activity.set(it);reference.set(it.generatedWorld);it.onGeneratedError=errors::add}
            val world=checkNotNull(reference.get())
            // Exercise an actual background window. ActivityScenario 1.6.1's
            // stop invoker puts an empty test Activity on top, which remained
            // PAUSED on this device and never destroyed the tested Surface.
            assertTrue(UiDevice.getInstance(instrumentation).pressHome())
            assertTrue("Home did not stop the test Activity: $lifecycle",stoppedActivity.await(15,TimeUnit.SECONDS))
            instrumentation.runOnMainSync{assertEquals(Stage.STOPPED,monitor.getLifecycleStageOf(activity.get()))}
            val stopped=awaitDiagnostic(world){!it.getBoolean("active")&&!it.getBoolean("swapReady")&&it.getInt("windowDetaches")>before.getInt("windowDetaches")&&it.getInt("windowDetaches")==it.getInt("windowRetirements")}
            assertEquals(stopped.getInt("windowDetaches"),stopped.getInt("windowRetirements"))
            assertEquals(0,stopped.getInt("windowRetirementFailures"));assertTrue(stopped.isNull("surfaceTicket"))
            // A health guard for a stable scene, not a performance comparison.
            assertTrue(stopped.getDouble("longestWindowRetirementMs")<1000)
            android.os.SystemClock.sleep(120)
            assertEquals(stopped.getLong("frames"),diagnostic(world).getLong("frames"))
            val projectionResumed=CountDownLatch(1);val projectionCount=java.util.concurrent.atomic.AtomicInteger()
            instrumentation.runOnMainSync{world.projectionWindow(world.height,0){projectionCount.incrementAndGet();projectionResumed.countDown()}}
            context.startActivity(Intent(context,P3DerivedCacheCheckActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            assertTrue("Returning did not resume the test Activity: $lifecycle",resumedActivity.await(15,TimeUnit.SECONDS))
            foreground.scenario.onActivity{assertSame("The stopped world must survive in the same Activity",activity.get(),it);assertSame(world,it.generatedWorld)}
            val resumed=awaitDiagnostic(world){it.getLong("gpuReadyFrames")>before.getLong("gpuReadyFrames")&&it.getLong("notifiedFrames")>before.getLong("notifiedFrames")}
            assertTrue("Surface acquisition cancelled a queued projection receipt",projectionResumed.await(10,TimeUnit.SECONDS));assertEquals(1,projectionCount.get())
            assertFalse(resumed.getBoolean("failed"));assertTrue(resumed.getBoolean("swapReady"));assertFalse(resumed.isNull("surfaceTicket"))
            for(key in listOf("owners","geometries","textures"))assertEquals(key,before.getJSONObject("resources").getJSONObject(key).toString(),resumed.getJSONObject("resources").getJSONObject(key).toString())
            assertEquals(before.getJSONObject("camera").toString(),resumed.getJSONObject("camera").toString());assertTrue(errors.toString(),errors.isEmpty())
            screen("surface-resumed")
            record("surface-lifecycle",JSONObject().put("schema",1).put("before",before).put("stopped",stopped).put("resumed",resumed).put("lifecycle",JSONArray(lifecycle))
                .put("scope","One stable generated scene stop/resume; not OEM background timing or a driver-loss experiment"))
        }catch(error:Throwable){
            val stacks=Thread.getAllStackTraces().filterKeys{it.name=="main"||it.name=="blockcolc-native-world"}
            record("surface-failure",JSONObject().put("schema",1).put("exception",error.javaClass.name).put("lifecycle",JSONArray(lifecycle)).put("threads",JSONArray(stacks.map{(thread,frames)->
                JSONObject().put("name",thread.name).put("id",thread.id).put("state",thread.state.name).put("stack",JSONArray(frames.map{it.toString()}))
            })))
            throw error
        }finally{instrumentation.runOnMainSync{monitor.removeLifecycleCallback(callback)};builder.clear();compiler.clear()}
    }
    @Test fun actualFourEnvironmentScenesSubmitAndHaveScreenshotsWithoutFrozenWorldFiles(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler();val reports=JSONArray()
        try{val initial=facts();for((i,environment)in WorldEnvironment.entries.withIndex()){
            val state=apply(initial,"ConfigureWorldEnvironment","environmentStyle" to environment.wireValue)
            val world=builder.terrain(builder.prepare(WorldFacts.from(state)));val frame=compiler.prepare(WorldRequestIdentity("synthetic-device.db",0,i.toLong()),world,options)
            val report=present(frame.scene);assertEquals("native-generated",report.getString("sourceKind"));assertEquals(frame.scene.sources.size,report.getInt("owners"))
            screen(environment.name.lowercase());reports.put(report.put("environment",environment.wireValue))
        }}finally{builder.clear();compiler.clear()}
        record("scenes",JSONObject().put("schema",1).put("frames",reports).put("visualApproval",false))
    }
    @Test fun independentEnvironmentUpdatesKeepGpuOwnersAndRejectStaleSamples(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
        try{
            val worldInput=builder.terrain(builder.prepare(WorldFacts.from(facts())))
            val day=DomainTime.millis("2026-10-25T12:00:00.000Z");val midnight=DomainTime.millis("2026-10-26T00:00:00.000Z")
            val frame=compiler.prepare(WorldRequestIdentity("synthetic-environment.db",0,1),worldInput,options.copy(time=day,zone="UTC"))
            val before=present(frame.scene);screen("environment-day")
            val reference=AtomicReference<com.blockcolc.world.filament.NativeWorldView>()
            foreground.scenario.onActivity{reference.set(it.generatedWorld)}
            val view=checkNotNull(reference.get())
            val night=frame.environmentContext.sample(midnight)
            view.updateEnvironment(frame.scene.presentationIdentity,2,night.uniforms())
            val afterNight=awaitDiagnostic(view){it.getLong("environmentVersion")==2L&&it.getLong("frames")>before.getLong("frames")}
            assertTrue(afterNight.getJSONObject("resources").getJSONObject("nativeUniforms").getDouble("nightFactor")>.9)
            screen("environment-night")
            val noon=frame.environmentContext.sample(day)
            view.updateEnvironment(frame.scene.presentationIdentity,1,noon.uniforms())
            view.updateEnvironment(frame.scene.presentationIdentity+1000,3,noon.uniforms())
            val stale=diagnostic(view)
            assertEquals(2L,stale.getLong("environmentVersion"));assertEquals(afterNight.getLong("environmentUpdates"),stale.getLong("environmentUpdates"))
            val storm=frame.environmentContext.copy(weather=NativeWeatherOverride(NativeWeatherKind.RAIN,true)).sample(day)
            view.updateEnvironment(frame.scene.presentationIdentity,3,storm.uniforms())
            val afterStorm=awaitDiagnostic(view){it.getLong("environmentVersion")==3L&&it.getLong("frames")>afterNight.getLong("frames")}
            val uniforms=afterStorm.getJSONObject("resources").getJSONObject("nativeUniforms")
            assertEquals(0.0,uniforms.getDouble("clearSky"),0.0);assertTrue(uniforms.getInt("boundMaterials")>0)
            for(next in listOf(afterNight,afterStorm)){
                assertEquals(0L,next.getLong("environmentFailures"));assertFalse(next.getBoolean("failed"))
                for(key in listOf("owners","geometries","textures"))assertEquals(key,before.getJSONObject("resources").getJSONObject(key).toString(),next.getJSONObject("resources").getJSONObject(key).toString())
                for(key in listOf("geometryCreated","geometryDestroyed","textureCreated","textureDestroyed"))assertEquals(key,before.getJSONObject("resources").getInt(key),next.getJSONObject("resources").getInt(key))
                assertEquals(before.getJSONObject("camera").toString(),next.getJSONObject("camera").toString())
            }
            screen("environment-storm")
            record("environment",JSONObject().put("schema",1).put("before",before).put("night",afterNight).put("stale",stale).put("storm",afterStorm)
                .put("scope","Real GPU uniforms on a held cloud layout; not weather layout replacement, precipitation or a performance sample"))
        }finally{builder.clear();compiler.clear()}
    }
    @Test fun nativeCloudMotionAndWeatherReplacementPreserveStaticOwnersAndRecognizeAnotherWorkersIdenticalSource(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
        try{
            val world=builder.terrain(builder.prepare(WorldFacts.from(facts())))
            val clear=compiler.prepare(WorldRequestIdentity("synthetic-clouds.db",0,1),world,options)
            val before=present(clear.scene);assertTrue(before.getJSONObject("resources").getInt("cloudInstances")>0)
            val reference=AtomicReference<com.blockcolc.world.filament.NativeWorldView>();foreground.scenario.onActivity{reference.set(it.generatedWorld)}
            val view=checkNotNull(reference.get());screen("clouds-clear")
            val moving=awaitDiagnostic(view){it.getJSONObject("resources").getDouble("cloudClockSeconds")>before.getJSONObject("resources").getDouble("cloudClockSeconds")+1.0}
            for(key in listOf("owners","geometries","textures"))assertEquals(before.getJSONObject("resources").getJSONObject(key).toString(),moving.getJSONObject("resources").getJSONObject(key).toString())
            assertEquals(before.getJSONObject("resources").getInt("instanceRowUploads"),moving.getJSONObject("resources").getInt("instanceRowUploads"))
            assertTrue(moving.getJSONObject("resources").getInt("runtimeClockUploads")>before.getJSONObject("resources").getInt("runtimeClockUploads"))
            val storm=compiler.prepare(WorldRequestIdentity("synthetic-clouds.db",0,1),world,options.copy(weather=NativeWeatherOverride(NativeWeatherKind.RAIN,true)))
            val accepted=AtomicReference<Boolean>();val adopted=CountDownLatch(1)
            view.updateEnvironment(clear.scene.presentationIdentity,10,storm.environment.uniforms(),storm.clouds.source,storm.precipitation.source){accepted.set(it);adopted.countDown()}
            assertTrue(adopted.await(10,TimeUnit.SECONDS));assertEquals(true,accepted.get())
            val after=awaitDiagnostic(view){it.getLong("environmentVersion")==10L&&it.getLong("frames")>moving.getLong("frames")}
            assertEquals(storm.clouds.source.ownerIdentity,after.getString("cloudOwnerIdentity"));assertEquals(0L,after.getLong("environmentFailures"))
            val old=moving.getJSONObject("resources");val next=after.getJSONObject("resources")
            for(owner in listOf("world","building:a","building:b")){
                assertEquals(owner,old.getJSONObject("owners").getJSONArray(owner).toString(),next.getJSONObject("owners").getJSONArray(owner).toString())
                val bindings=old.getJSONObject("owners").getJSONArray(owner)
                repeat(bindings.length()){i->val binding=bindings.getJSONObject(i);for((field,pool)in listOf("geometry" to "geometries","texture" to "textures")){
                    val key=binding.getString(field);assertEquals(old.getJSONObject(pool).getJSONObject(key).getInt("identity"),next.getJSONObject(pool).getJSONObject(key).getInt("identity"))
                }}
            }
            assertNotEquals(old.getJSONObject("owners").getJSONArray(PacketOwners.CLOUDS).toString(),next.getJSONObject("owners").getJSONArray(PacketOwners.CLOUDS).toString())
            assertEquals(next.getJSONObject("owners").getJSONArray(PacketOwners.CLOUDS).length()+next.getJSONObject("owners").getJSONArray(PacketOwners.PRECIPITATION).length(),next.getInt("instanceRowUploads")-old.getInt("instanceRowUploads"))
            assertTrue(next.getJSONArray("nativeCloudOrigins").getDouble(0)>0)
            screen("clouds-storm")
            val another=NativeCloudCompiler().prepare(storm.cloudContext,storm.environment.weather,options.quality.cloudDensity)
            assertNotEquals(storm.clouds.source.uploadIdentity,another.source.uploadIdentity);assertEquals(storm.clouds.source.ownerIdentity,another.source.ownerIdentity)
            val same=storm.scene.withPresentation(sources=storm.scene.sources.map{if(it.owner==PacketOwners.CLOUDS)another.source else it})
            val recognized=present(same)
            assertEquals(next.getJSONObject("owners").toString(),recognized.getJSONObject("resources").getJSONObject("owners").toString())
            assertEquals(next.getInt("instanceRowUploads"),recognized.getJSONObject("resources").getInt("instanceRowUploads"))
            assertEquals(next.getJSONArray("nativeCloudOrigins").toString(),recognized.getJSONObject("resources").getJSONArray("nativeCloudOrigins").toString())
            val staleDone=CountDownLatch(1);val staleAccepted=AtomicReference<Boolean>()
            view.updateEnvironment(clear.scene.presentationIdentity,99,clear.environment.uniforms(),clear.clouds.source){staleAccepted.set(it);staleDone.countDown()}
            assertTrue(staleDone.await(10,TimeUnit.SECONDS));assertEquals(false,staleAccepted.get())
            val stale=diagnostic(view);assertEquals(recognized.getString("cloudOwnerIdentity"),stale.getString("cloudOwnerIdentity"))
            assertEquals(recognized.getJSONObject("resources").getInt("instanceRowUploads"),stale.getJSONObject("resources").getInt("instanceRowUploads"))
            record("clouds",JSONObject().put("schema",1).put("before",before).put("moving",moving).put("storm",after).put("recognized",recognized).put("stale",stale)
                .put("scope","Generated cloud Surface frames, uniform clock, isolated weather replacement and stable cross-worker identity; not final visual/performance approval"))
        }finally{builder.clear();compiler.clear()}
    }
    @Test fun advancingOneActualBuildingKeepsOtherOwnersAndTheirGpuResources(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
        var state=apply(facts(),"SwitchActiveProject","projectId" to "a")
        var revision=0L
        fun render():NativeWorldFrame=compiler.prepare(WorldRequestIdentity("synthetic-local.db",0,revision++),builder.terrain(builder.prepare(WorldFacts.from(state))),options)
        try{val first=render();val before=present(first.scene)
            state=apply(state,"StartFocus","sessionId" to "s","subtaskId" to "task-a","plannedDurationMs" to 1000)
            state=apply(state,"CompleteFocus",at=now+1000);state=apply(state,"ReportSubtaskProgress","reportId" to "report","subtaskId" to "task-a","focusSessionIds" to JSONArray(listOf("s")),"progressBasisPoints" to 5000,at=now+1000)
            val next=render();assertSame(first.scene.sources.first(),next.scene.sources.first());val after=present(next.scene)
            val old=before.getJSONObject("resources");val current=after.getJSONObject("resources")
            for(owner in listOf("world","building:b",PacketOwners.CLOUDS))assertEquals(owner,old.getJSONObject("owners").getJSONArray(owner).toString(),current.getJSONObject("owners").getJSONArray(owner).toString())
            assertNotEquals(old.getJSONObject("owners").getJSONArray("building:a").toString(),current.getJSONObject("owners").getJSONArray("building:a").toString())
            for(owner in listOf("world","building:b",PacketOwners.CLOUDS)){val bindings=old.getJSONObject("owners").getJSONArray(owner)
                repeat(bindings.length()){i->val binding=bindings.getJSONObject(i)
                    for((field,pool)in listOf("geometry" to "geometries","texture" to "textures")){
                        val key=binding.getString(field);assertEquals(old.getJSONObject(pool).getJSONObject(key).getInt("identity"),current.getJSONObject(pool).getJSONObject(key).getInt("identity"))
                    }
                }
            }
            screen("local-update")
            record("local-update",JSONObject().put("schema",1).put("before",before).put("after",after))
        }finally{builder.clear();compiler.clear()}
    }
    @Test fun nativePrecipitationContinuesDuringOrbitZoomAndPauseWithoutSeedUploads(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
        try{
            val input=builder.terrain(builder.prepare(WorldFacts.from(facts())))
            val rain=compiler.prepare(WorldRequestIdentity("synthetic-rain.db",0,1),input,options.copy(weather=NativeWeatherOverride(NativeWeatherKind.RAIN,
                precipitationIntensity=.35,visualPrecipitationIntensity=.65)))
            val before=present(rain.scene);val reference=AtomicReference<com.blockcolc.world.filament.NativeWorldView>()
            foreground.scenario.onActivity{reference.set(it.generatedWorld)};val view=checkNotNull(reference.get())
            assertEquals(32,before.getJSONObject("resources").getInt("precipitationPackets"));assertTrue(before.getJSONObject("resources").getInt("precipitationActiveCount")>0)
            screen("rain-before")
            val resizeBaseline=diagnostic(view).getJSONObject("resources").getInt("precipitationFieldSyncs")
            var originalHeight=0
            foreground.scenario.onActivity{originalHeight=view.layoutParams.height;view.layoutParams=view.layoutParams.apply{height=(view.width/2.0).toInt()};view.requestLayout()}
            val wide=awaitDiagnostic(view){it.getJSONObject("camera").getDouble("aspect")>1.8&&it.getJSONObject("resources").getInt("precipitationFieldSyncs")>resizeBaseline}
            val camera=wide.getJSONObject("camera");val position=rain.scene.camera.volume
            val distance=camera.getDouble("distance");val pitch=camera.getDouble("pitch");val azimuth=camera.getDouble("azimuth")
            val target=DoubleArray(3){camera.getJSONArray("target").getDouble(it)}
            val eye=doubleArrayOf(target[0]+distance*kotlin.math.cos(pitch)*kotlin.math.sin(azimuth),target[1]+distance*kotlin.math.sin(pitch),target[2]+distance*kotlin.math.cos(pitch)*kotlin.math.cos(azimuth))
            val clipping=position.frame(eye,distance);val runtime=checkNotNull(rain.precipitation.source.precipitation)
            val expected=WeatherFieldState(runtime.context).update(runtime.descriptor,runtime.context.populations.single(),eye,target,camera.getDouble("fov"),camera.getDouble("aspect"),clipping.near,clipping.far,view.height/view.resources.displayMetrics.density.toDouble())
            val actual=wide.getJSONObject("resources").getJSONObject("precipitationField")
            for((key,value)in listOf("centerX" to expected.field.centerX,"centerZ" to expected.field.centerZ,"spanX" to expected.field.spanX,"spanZ" to expected.field.spanZ))assertEquals("wide viewport $key",value,actual.getDouble(key),1e-6)
            foreground.scenario.onActivity{view.layoutParams=view.layoutParams.apply{height=originalHeight};view.requestLayout()}
            awaitDiagnostic(view){it.getJSONObject("camera").getDouble("aspect")<1.0}
            fun drag(dx:Float,dy:Float){
                val down=android.os.SystemClock.uptimeMillis()
                fun send(action:Int,x:Float,y:Float){instrumentation.runOnMainSync{
                    val event=android.view.MotionEvent.obtain(down,android.os.SystemClock.uptimeMillis(),action,x,y,0)
                    try{assertTrue(view.onTouchEvent(event))}finally{event.recycle()}
                }}
                send(android.view.MotionEvent.ACTION_DOWN,200f,300f)
                for(i in 1..16){send(android.view.MotionEvent.ACTION_MOVE,200f+dx*i/16,300f+dy*i/16);android.os.SystemClock.sleep(35)}
                send(android.view.MotionEvent.ACTION_UP,200f+dx,300f+dy)
            }
            fun zoomOut() {
                val down=android.os.SystemClock.uptimeMillis()
                val properties=Array(2){index->android.view.MotionEvent.PointerProperties().apply{id=index;toolType=android.view.MotionEvent.TOOL_TYPE_FINGER}}
                fun send(action:Int, count:Int, span:Float) {
                    val points=Array(2){index->android.view.MotionEvent.PointerCoords().apply{
                        x=360f+(if(index==0)-span else span)/2;y=320f;pressure=1f;size=1f
                    }}
                    instrumentation.runOnMainSync {
                        val event=android.view.MotionEvent.obtain(down,android.os.SystemClock.uptimeMillis(),action,count,properties,points,
                            0,0,1f,1f,0,0,android.view.InputDevice.SOURCE_TOUCHSCREEN,0)
                        try{assertTrue(view.onTouchEvent(event))}finally{event.recycle()}
                    }
                }
                val pointer=1 shl android.view.MotionEvent.ACTION_POINTER_INDEX_SHIFT
                send(android.view.MotionEvent.ACTION_DOWN,1,360f)
                send(android.view.MotionEvent.ACTION_POINTER_DOWN or pointer,2,360f)
                for(i in 1..16){send(android.view.MotionEvent.ACTION_MOVE,2,360f-i*9f);android.os.SystemClock.sleep(35)}
                send(android.view.MotionEvent.ACTION_POINTER_UP or pointer,2,216f)
                send(android.view.MotionEvent.ACTION_UP,1,216f)
            }
            drag(240f,0f);val orbit=diagnostic(view);zoomOut()
            val zoom=awaitDiagnostic(view){it.getJSONObject("camera").getDouble("distance")>orbit.getJSONObject("camera").getDouble("distance")*1.2}
            assertNotEquals(before.getJSONObject("camera").getDouble("azimuth"),orbit.getJSONObject("camera").getDouble("azimuth"))
            for(state in listOf(orbit,zoom)){
                val resources=state.getJSONObject("resources");val old=before.getJSONObject("resources")
                assertTrue(resources.getDouble("weatherClockElapsedMs")>old.getDouble("weatherClockElapsedMs")+300)
                assertEquals(old.getInt("instanceRowUploads"),resources.getInt("instanceRowUploads"))
                for(key in listOf("owners","geometries","textures"))assertEquals(key,old.getJSONObject(key).toString(),resources.getJSONObject(key).toString())
            }
            val zoomResources=zoom.getJSONObject("resources");val orbitResources=orbit.getJSONObject("resources")
            val zoomField=zoomResources.getJSONObject("precipitationField");val orbitField=orbitResources.getJSONObject("precipitationField")
            assertTrue(zoomField.getDouble("spanX")*zoomField.getDouble("spanZ")>orbitField.getDouble("spanX")*orbitField.getDouble("spanZ"))
            assertTrue(zoomResources.getInt("precipitationActiveCount")>orbitResources.getInt("precipitationActiveCount"))
            screen("rain-zoom")
            foreground.scenario.onActivity{view.pause()};val paused=awaitDiagnostic(view){!it.getBoolean("active")};android.os.SystemClock.sleep(650)
            assertEquals(paused.getJSONObject("resources").getDouble("weatherClockElapsedMs"),diagnostic(view).getJSONObject("resources").getDouble("weatherClockElapsedMs"),0.0)
            foreground.scenario.onActivity{view.resume()}
            val resumed=awaitDiagnostic(view){it.getLong("frames")>paused.getLong("frames")}
            assertTrue(resumed.getJSONObject("resources").getDouble("weatherClockElapsedMs")-paused.getJSONObject("resources").getDouble("weatherClockElapsedMs")<400)
            val snow=compiler.prepare(WorldRequestIdentity("synthetic-rain.db",0,1),input,options.copy(weather=NativeWeatherOverride(NativeWeatherKind.SNOW,
                precipitationIntensity=.7,visualPrecipitationIntensity=.85)))
            val done=CountDownLatch(1);val accepted=AtomicReference<Boolean>()
            view.updateEnvironment(rain.scene.presentationIdentity,20,snow.environment.uniforms(),snow.clouds.source,snow.precipitation.source){accepted.set(it);done.countDown()}
            assertTrue(done.await(10,TimeUnit.SECONDS));assertEquals(true,accepted.get())
            val afterSnow=awaitDiagnostic(view){it.getLong("environmentVersion")==20L&&it.getJSONObject("resources").getInt("precipitationActiveCount")>0}
            assertEquals(48,afterSnow.getJSONObject("resources").getInt("precipitationPackets"));assertEquals(0L,afterSnow.getLong("environmentFailures"))
            for(owner in listOf("world","building:a","building:b"))assertEquals(owner,before.getJSONObject("resources").getJSONObject("owners").getJSONArray(owner).toString(),afterSnow.getJSONObject("resources").getJSONObject("owners").getJSONArray(owner).toString())
            fun groundIdentity(state:JSONObject):Int {val textures=state.getJSONObject("resources").getJSONObject("textures");return textures.getJSONObject(textures.keys().asSequence().single{it.startsWith("r32f:")}).getInt("identity")}
            assertEquals(groundIdentity(before),groundIdentity(afterSnow));screen("snow-zoom")
            val other=NativePrecipitationCompiler().prepare(snow.precipitationContext,snow.environment.weather,options.quality.cloudDensity,snow.clouds.randomTail)
            assertNotEquals(other.source.uploadIdentity,snow.precipitation.source.uploadIdentity);assertEquals(other.key,snow.precipitation.key)
            val same=snow.scene.withPresentation(sources=snow.scene.sources.map{if(it.owner==PacketOwners.PRECIPITATION)other.source else it})
            val recognized=present(same)
            for(key in listOf("owners","geometries","textures"))assertEquals(key,afterSnow.getJSONObject("resources").getJSONObject(key).toString(),recognized.getJSONObject("resources").getJSONObject(key).toString())
            assertEquals(afterSnow.getJSONObject("resources").getInt("instanceRowUploads"),recognized.getJSONObject("resources").getInt("instanceRowUploads"))
            assertEquals(afterSnow.getJSONObject("resources").getJSONArray("nativeWeatherOrigins").toString(),recognized.getJSONObject("resources").getJSONArray("nativeWeatherOrigins").toString())
            val clear=compiler.prepare(WorldRequestIdentity("synthetic-rain.db",0,1),input,options);val clearDone=CountDownLatch(1)
            view.updateEnvironment(same.presentationIdentity,30,clear.environment.uniforms(),clear.clouds.source,clear.precipitation.source){accepted.set(it);clearDone.countDown()}
            assertTrue(clearDone.await(10,TimeUnit.SECONDS));assertEquals(true,accepted.get())
            val afterClear=awaitDiagnostic(view){it.getLong("environmentVersion")==30L&&it.getJSONObject("resources").getInt("precipitationPackets")==0}
            assertEquals(0,afterClear.getJSONObject("resources").getInt("precipitationActiveCount"))
            assertTrue(afterClear.getJSONObject("resources").getJSONObject("textures").keys().asSequence().none{it.startsWith("r32f:")})
            val staleDone=CountDownLatch(1);view.updateEnvironment(rain.scene.presentationIdentity,40,rain.environment.uniforms(),rain.clouds.source,rain.precipitation.source){accepted.set(it);staleDone.countDown()}
            assertTrue(staleDone.await(10,TimeUnit.SECONDS));assertEquals(false,accepted.get());screen("rain-cleared")
            record("precipitation",JSONObject().put("schema",1).put("before",before).put("wide",wide).put("orbit",orbit).put("zoom",zoom).put("paused",paused).put("resumed",resumed)
                .put("snow",afterSnow).put("recognized",recognized).put("clear",afterClear).put("scope","Generated Surface rain/snow movement, physical zoom density, visible-time pause, atomic weather owners and GPU reuse; not final weather/performance approval"))
        }finally{builder.clear();compiler.clear()}
    }
    @Test fun qualityAndWorldColourChangeOnTheSameWorldWithoutReplacingOwners(){
        val base=doubleArrayOf(.8,.6,.4)
        val source=NativePacketBuilder("world").also{packets->
            val matrix=java.nio.FloatBuffer.wrap(floatArrayOf(300f,0f,0f,0f,0f,300f,0f,0f,0f,0f,1f,0f,0f,0f,-100f,1f))
            packets.add(NativeSkyGeometry.celestial(),NativeRenderMaterial(color=LinearRgb(.8f,.6f,.4f),unlit=true,fog=false),matrix,castShadow=false,receiveShadow=false)
        }.build()
        val camera=NativeSceneCamera(BlockPoint(0.0,0.0,0.0),BlockPoint(0.0,0.0,100.0),200.0,40.0,
            SourceCamera(40.0,listOf(listOf(-150.0,-150.0,-101.0),listOf(150.0,150.0,-99.0)),120.0,.82,.91,1.5,120.0))
        val lighting=NativeEnvironment.sample(now,java.util.TimeZone.getTimeZone("UTC"),NativeLightingQuality.HIGH,40.0,240.0,100.0,
            override=NativeWeatherOverride(NativeWeatherKind.CLEAR)).lighting.copy(exposure=1f,fog=null)
        fun scene(post:SourcePost)=NativeGeneratedScene(listOf(source),lighting,post,camera,0,1)
        val initial=present(scene(SourcePost.NONE));val reference=AtomicReference<com.blockcolc.world.filament.NativeWorldView>()
        foreground.scenario.onActivity{reference.set(it.generatedWorld)};val view=checkNotNull(reference.get());val pixels=JSONArray()
        fun pixel(label:String,rgb:IntArray){
            val location=IntArray(2);instrumentation.runOnMainSync{view.getLocationOnScreen(location)}
            val actual=screen("post-$label",SkyPixel(location[0]+view.width/2,location[1]+view.height/2,rgb))
            pixels.put(JSONObject().put("label",label).put("expectedRgb",JSONArray(rgb.toList())).put("actualArgb",Integer.toHexString(actual)))
        }
        pixel("none",terminalPixel(base,1.0))
        val highPost=SourcePost.native(NativeLightingQuality.HIGH);val high=present(scene(highPost))
        assertTrue(high.getJSONObject("colorPipeline").getJSONObject("config").getBoolean("bloom"))
        fun quant(x:Double)=kotlin.math.floor(x.coerceIn(0.0,1.0)*255+.5)/255
        val encoded=DoubleArray(3){quant(base[it])};val t=((encoded.max()-.72+.22)/(.22*2)).coerceIn(0.0,1.0);val contribution=t*t*(3-2*t)
        val bloom=DoubleArray(3){encoded[it]+quant(encoded[it]*contribution)*.32};val highRgb=terminalPixel(bloom,1.0)
        pixel("high",highRgb)
        val adjustment=SourceWorldColor(50,110,120);view.worldColor(adjustment)
        val colour=awaitDiagnostic(view){it.getJSONObject("colorPipeline").getJSONObject("config").getInt("saturation")==50&&it.getLong("frames")>high.getLong("frames")}
        val y=(highRgb[0]*.2126+highRgb[1]*.7152+highRgb[2]*.0722)/255
        val graded=IntArray(3){i->val rgb=y+(highRgb[i]/255.0-y)*.5;kotlin.math.floor((((rgb-.5)*1.2+.5)*1.1).coerceIn(0.0,1.0)*255+.5).toInt()}
        pixel("graded",graded)
        assertEquals(high.getJSONObject("colorPipeline").getInt("targetsCreated"),colour.getJSONObject("colorPipeline").getInt("targetsCreated"))
        assertEquals(high.getJSONObject("colorPipeline").getJSONObject("config").getInt("sourceTexture"),colour.getJSONObject("colorPipeline").getJSONObject("config").getInt("sourceTexture"))
        val low=present(scene(SourcePost.NONE));pixel("restored",terminalPixel(base,1.0))
        assertFalse(low.getJSONObject("colorPipeline").getJSONObject("config").getBoolean("bloom"));assertEquals(1,low.getJSONObject("colorPipeline").getInt("liveTargets"))
        for(next in listOf(high,colour,low)){
            val old=initial.getJSONObject("resources");val resources=next.getJSONObject("resources")
            for(key in listOf("owners","geometries","textures"))assertEquals(key,old.getJSONObject(key).toString(),resources.getJSONObject(key).toString())
            assertEquals(old.getInt("instanceRowUploads"),resources.getInt("instanceRowUploads"))
        }
        record("post",JSONObject().put("schema",1).put("initial",initial).put("high",high).put("colour",colour).put("restored",low).put("pixels",pixels))
    }
    @Test fun rejectedWorldEnvironmentRollsBackTheAlreadyPublishedPostTargets(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
        try{
            val world=builder.terrain(builder.prepare(WorldFacts.from(facts())))
            val frame=compiler.prepare(WorldRequestIdentity("synthetic-post-rollback.db",0,1),world,options.copy(weather=NativeWeatherOverride(NativeWeatherKind.CLOUDY)))
            fun scene(lighting:SourceLighting,post:SourcePost)=frame.scene.withPresentation(lighting=lighting,post=post)
            val initialScene=scene(frame.scene.lighting,SourcePost.NONE);val initial=present(initialScene)
            val reference=AtomicReference<com.blockcolc.world.filament.NativeWorldView>()
            foreground.scenario.onActivity{activity->reference.set(activity.generatedWorld)}
            val view=checkNotNull(reference.get());val cloud=checkNotNull(frame.clouds.source.world).packets.first()
            // Valid finite input, deliberately outside the current native cloud
            // capability. This is an adoption rejection, not a driver/OOM fault.
            val point=SourceLight("PointLight",listOf(1f,1f,1f),1f,listOf(0f,0f,0f),listOf(0f,cloud.bounds.min.y,0f),false,listOf(0f,0f,0f),100f,0f)
            repeat(12){
                val rejected=CountDownLatch(1);val rejectedMessage=AtomicReference<String>()
                foreground.scenario.onActivity{activity->activity.onGeneratedError={rejectedMessage.set(it);rejected.countDown()}}
                val invalid=scene(frame.scene.lighting.copy(lights=frame.scene.lighting.lights+point),SourcePost.native(NativeLightingQuality.HIGH))
                view.updateGenerated(invalid)
                assertTrue(rejected.await(20,TimeUnit.SECONDS));assertEquals("NATIVE_UPDATE_ERROR",rejectedMessage.get())
                android.os.SystemClock.sleep(80)
            }
            val failed=diagnostic(view);assertFalse(failed.getBoolean("failed"));assertEquals(initialScene.presentationIdentity,failed.getLong("presentationIdentity"))
            val old=initial.getJSONObject("colorPipeline");val next=failed.getJSONObject("colorPipeline")
            assertEquals(old.getJSONObject("config").toString(),next.getJSONObject("config").toString());assertEquals(1,next.getInt("liveTargets"))
            for(key in listOf("owners","geometries","textures"))assertEquals(key,initial.getJSONObject("resources").getJSONObject(key).toString(),failed.getJSONObject("resources").getJSONObject(key).toString())
            val recovered=present(scene(frame.scene.lighting,SourcePost.native(NativeLightingQuality.HIGH)))
            assertFalse(recovered.getBoolean("failed"));assertTrue(recovered.getJSONObject("colorPipeline").getJSONObject("config").getBoolean("bloom"));assertEquals(4,recovered.getJSONObject("colorPipeline").getInt("liveTargets"))
            for(key in listOf("owners","geometries","textures"))assertEquals(key,initial.getJSONObject("resources").getJSONObject(key).toString(),recovered.getJSONObject("resources").getJSONObject(key).toString())
            screen("post-rollback-recovered")
            record("post-rollback",JSONObject().put("schema",1).put("initial",initial).put("failed",failed).put("recovered",recovered)
                .put("rejectionCount",12).put("scope","Rejected unsupported cloud point-light input after post publication; not a driver fault"))
        }finally{builder.clear();compiler.clear()}
    }
    @Test fun cameraFogTracksZoomAndKeepsTheLatestWeatherWithoutRepackingOwners(){
        val base=LinearRgb(.05f,.55f,.08f);val tint=listOf(.15f,.25f,.6f)
        val source=NativePacketBuilder("world").also{packets->
            val matrix=java.nio.FloatBuffer.wrap(floatArrayOf(300f,0f,0f,0f,0f,300f,0f,0f,0f,0f,1f,0f,0f,0f,-100f,1f))
            packets.add(NativeSkyGeometry.celestial(),NativeRenderMaterial(color=base,unlit=true,fog=true),matrix,castShadow=false,receiveShadow=false)
        }.build()
        val camera=NativeSceneCamera(BlockPoint(0.0,0.0,0.0),BlockPoint(0.0,0.0,100.0),200.0,40.0,
            SourceCamera(40.0,listOf(listOf(-150.0,-150.0,-101.0),listOf(150.0,150.0,-99.0)),120.0,.82,.91,1.5,120.0))
        val raw=NativeEnvironment.sample(now,java.util.TimeZone.getTimeZone("UTC"),NativeLightingQuality.HIGH,40.0,240.0,100.0,
            override=NativeWeatherOverride(NativeWeatherKind.CLEAR))
        val clearProjection=NativeFogProjection(NativeWeatherKind.CLEAR,40.0,240.0)
        val sampled=clearProjection.range(100.0)
        val lighting=raw.lighting.copy(exposure=1f,fog=SourceFog(tint,sampled.near.toFloat(),sampled.far.toFloat()))
        val scene=NativeGeneratedScene(listOf(source),lighting,SourcePost.NONE,camera,0,1,fogProjection=clearProjection)
        val initial=present(scene);val reference=AtomicReference<com.blockcolc.world.filament.NativeWorldView>()
        foreground.scenario.onActivity{reference.set(it.generatedWorld)};val view=checkNotNull(reference.get())
        val pixels=JSONArray()
        fun checkFog(label:String,state:JSONObject,range:NativeFogRange){
            val distance=state.getJSONObject("camera").getDouble("distance")
            val projected=state.getJSONObject("resources").optJSONObject("projectedFog")
            if(projected!=null){assertEquals(range.near,projected.getDouble("near"),1e-6);assertEquals(range.far,projected.getDouble("far"),1e-6)}
            val depth=distance+100;val t=((depth-range.near)/(range.far-range.near)).coerceIn(0.0,1.0);val factor=t*t*(3-2*t)
            val rgb=terminalPixel(DoubleArray(3){i->val c=listOf(base.red,base.green,base.blue)[i].toDouble();c+(tint[i]-c)*factor},1.0)
            val location=IntArray(2);instrumentation.runOnMainSync{view.getLocationOnScreen(location)}
            val actual=screen("fog-$label",SkyPixel(location[0]+view.width/2,location[1]+view.height/2,rgb))
            pixels.put(JSONObject().put("label",label).put("expectedRgb",JSONArray(rgb.toList())).put("actualArgb",Integer.toHexString(actual)))
        }
        checkFog("initial",initial,sampled)
        val down=android.os.SystemClock.uptimeMillis()
        fun send(action:Int,y:Float){instrumentation.runOnMainSync{
            val event=android.view.MotionEvent.obtain(down,android.os.SystemClock.uptimeMillis(),action,200f,y,0)
            try{assertTrue(view.onTouchEvent(event))}finally{event.recycle()}
        }}
        send(android.view.MotionEvent.ACTION_DOWN,400f);send(android.view.MotionEvent.ACTION_MOVE,250f);send(android.view.MotionEvent.ACTION_UP,250f)
        val zoom=awaitDiagnostic(view){it.getJSONObject("camera").getDouble("distance")<80&&it.getLong("frames")>initial.getLong("frames")}
        val distance=zoom.getJSONObject("camera").getDouble("distance");checkFog("zoom",zoom,clearProjection.range(distance))
        // This sample still contains the OLD camera distance. Only its weather
        // profile is adopted; the GPU range must use the latest zoom instead.
        val mistProjection=clearProjection.copy(kind=NativeWeatherKind.MIST);val oldMist=mistProjection.range(100.0)
        val mist=NativeSceneEnvironment(lighting.copy(fog=SourceFog(tint,oldMist.near.toFloat(),oldMist.far.toFloat())),fogProjection=mistProjection)
        view.updateEnvironment(scene.presentationIdentity,1,mist)
        val weather=awaitDiagnostic(view){it.getLong("environmentVersion")==1L&&it.getLong("frames")>zoom.getLong("frames")}
        assertNotEquals(oldMist.far,weather.getJSONObject("resources").getJSONObject("projectedFog").getDouble("far"))
        checkFog("mist",weather,mistProjection.range(distance))
        view.updateEnvironment(scene.presentationIdentity,2,NativeSceneEnvironment(lighting))
        val frozen=awaitDiagnostic(view){it.getLong("environmentVersion")==2L&&it.getLong("frames")>weather.getLong("frames")}
        assertTrue(frozen.getJSONObject("resources").isNull("projectedFog"));checkFog("frozen",frozen,sampled)
        view.updateEnvironment(scene.presentationIdentity,3,mist)
        val restored=awaitDiagnostic(view){it.getLong("environmentVersion")==3L&&it.getLong("frames")>frozen.getLong("frames")}
        checkFog("restored",restored,mistProjection.range(distance))
        val staleDone=CountDownLatch(1);val staleAccepted=AtomicReference<Boolean>()
        view.updateEnvironment(scene.presentationIdentity,2,NativeSceneEnvironment(lighting)){staleAccepted.set(it);staleDone.countDown()}
        assertTrue(staleDone.await(10,TimeUnit.SECONDS));assertEquals(false,staleAccepted.get())
        val stale=diagnostic(view);assertEquals(3L,stale.getLong("environmentVersion"))
        for(next in listOf(zoom,weather,frozen,restored,stale)){
            val old=initial.getJSONObject("resources");val resources=next.getJSONObject("resources")
            for(key in listOf("owners","geometries","textures"))assertEquals(key,old.getJSONObject(key).toString(),resources.getJSONObject(key).toString())
            assertEquals(old.getInt("instanceRowUploads"),resources.getInt("instanceRowUploads"));assertEquals(0L,next.getLong("environmentFailures"))
        }
        record("fog",JSONObject().put("schema",1).put("initial",initial).put("zoom",zoom).put("mist",weather).put("frozen",frozen).put("restored",restored).put("stale",stale).put("pixels",pixels))
    }
    @Test fun skyAndCelestialUniformsChangeWithTimeAndWeatherWithoutRebuildingAnyOwner(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler()
        try{
            val world=builder.terrain(builder.prepare(WorldFacts.from(facts())))
            val day=compiler.prepare(WorldRequestIdentity("synthetic-sky.db",0,1),world,options)
            val eye=BlockPoint(0.0,60.0,30.0);val direction=checkNotNull(day.environment.sky).sunDirection
            val camera=NativeSceneCamera(BlockPoint(eye.x+direction.x*100,eye.y+direction.y*100,eye.z+direction.z*100),eye,220.0,40.0,day.scene.camera.volume)
            val scene=day.scene.withPresentation(camera=camera)
            val before=present(scene,fixedCamera=true);assertEquals(3,before.getJSONObject("resources").getInt("skyPackets"))
            val reference=AtomicReference<com.blockcolc.world.filament.NativeWorldView>();foreground.scenario.onActivity{reference.set(it.generatedWorld)};val view=checkNotNull(reference.get())
            val visible=before.getJSONObject("resources").getJSONObject("nativeSkyVisible")
            assertTrue(visible.getBoolean("DOME"));assertTrue(visible.getBoolean("SUN"));assertFalse(visible.getBoolean("MOON"));assertEquals(0.0,before.getDouble("nightClockSeconds"),0.0)
            screen("sky-day")
            val night=day.environmentContext.sample(DomainTime.millis("2026-10-25T16:00:00.000Z"))
            val nightDone=CountDownLatch(1);val accepted=AtomicReference<Boolean>()
            view.updateEnvironment(scene.presentationIdentity,1,night.uniforms()){accepted.set(it);nightDone.countDown()}
            assertTrue(nightDone.await(10,TimeUnit.SECONDS));assertEquals(true,accepted.get())
            val afterNight=awaitDiagnostic(view){it.getLong("environmentVersion")==1L&&it.getBoolean("nightActive")&&it.getDouble("nightClockSeconds")>.25}
            val nightVisible=afterNight.getJSONObject("resources").getJSONObject("nativeSkyVisible")
            assertFalse(nightVisible.getBoolean("SUN"));assertTrue(nightVisible.getBoolean("MOON"))
            val uniforms=afterNight.getJSONObject("resources").getJSONObject("nativeUniforms")
            assertEquals(uniforms.getDouble("nightStars"),uniforms.getJSONObject("sky").getDouble("stars"),0.0)
            assertEquals(uniforms.getDouble("nightGalaxy"),uniforms.getJSONObject("sky").getDouble("galaxy"),0.0);screen("sky-night")
            val storm=day.environmentContext.copy(weather=NativeWeatherOverride(NativeWeatherKind.RAIN,true)).sample(DomainTime.millis("2026-10-25T16:00:00.000Z"))
            val stormDone=CountDownLatch(1);view.updateEnvironment(scene.presentationIdentity,2,storm.uniforms()){accepted.set(it);stormDone.countDown()}
            assertTrue(stormDone.await(10,TimeUnit.SECONDS));assertEquals(true,accepted.get())
            val afterStorm=awaitDiagnostic(view){it.getLong("environmentVersion")==2L&&!it.getBoolean("nightActive")}
            val hidden=afterStorm.getJSONObject("resources").getJSONObject("nativeSkyVisible");assertTrue(hidden.getBoolean("DOME"));assertFalse(hidden.getBoolean("SUN"));assertFalse(hidden.getBoolean("MOON"))
            android.os.SystemClock.sleep(450);val held=diagnostic(view);assertEquals(afterStorm.getDouble("nightClockSeconds"),held.getDouble("nightClockSeconds"),0.0)
            for(state in listOf(afterNight,afterStorm,held)){val resources=state.getJSONObject("resources")
                for(key in listOf("owners","geometries","textures"))assertEquals(key,before.getJSONObject("resources").getJSONObject(key).toString(),resources.getJSONObject(key).toString())
                assertEquals(before.getJSONObject("resources").getInt("instanceRowUploads"),resources.getInt("instanceRowUploads"))
            }
            // This camera faces the local noon Sun: the 45-degree meridian
            // passes through row 3 of the actual 24x12 sphere. The storm has
            // no stars or sprites, so its centre has a known gradient colour.
            val weights=checkNotNull(NativeSkyGeometry.dome().colors());val gradient=checkNotNull(storm.sky).gradient;val offset=3*25*3
            val expectedPixel=terminalPixel(DoubleArray(3){i->weights.get(offset)*gradient.horizon[i].toDouble()+weights.get(offset+1)*gradient.zenith[i]+weights.get(offset+2)*gradient.lower[i]},storm.lighting.exposure.toDouble())
            val point=IntArray(2);foreground.scenario.onActivity{view.getLocationOnScreen(point);point[0]+=view.width/2;point[1]+=view.height/2}
            val actualPixel=screen("sky-storm",SkyPixel(point[0],point[1],expectedPixel))
            record("sky",JSONObject().put("schema",1).put("day",before).put("night",afterNight).put("storm",afterStorm).put("held",held)
                .put("stormExpectedRgb",JSONArray(expectedPixel.toList())).put("stormActualArgb",Integer.toHexString(actualPixel))
                .put("scope","Native dome and celestial uniform visibility/clock/resource checks on held cloud layout; complete tone mapping and visual matrix remain pending"))
        }finally{builder.clear();compiler.clear()}
    }
}
