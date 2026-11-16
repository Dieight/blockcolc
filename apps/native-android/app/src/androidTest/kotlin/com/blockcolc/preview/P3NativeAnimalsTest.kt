package com.blockcolc.preview

import android.os.Handler
import android.os.HandlerThread
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.blockcolc.domain.*
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.preview.world.*
import com.blockcolc.world.*
import com.blockcolc.world.generation.*
import com.blockcolc.world.filament.*
import com.google.android.filament.Engine
import com.google.android.filament.Filament
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Actual generated terrain, vegetation and business owners on OnePlus. All
 * documents are synthetic and kept in memory; no formal App or saved state. */
class P3NativeAnimalsTest {
    @get:Rule val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val now=DomainTime.millis("2026-10-25T12:00:00.000Z")
    private val options=WorldRenderOptions(now,"UTC",weather=NativeWeatherOverride(NativeWeatherKind.CLEAR),outlines=NativeOutlineVisibility.OFF)
    private val label get()=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
    private fun apply(s:DomainDocument,type:String,vararg values:Pair<String,Any?>,at:Long=now):DomainDocument {
        val result=DomainEngine.execute(s,DomainEngine.command(type,*values),at);check(result.ok){"$type ${result.error}"};return result.state
    }
    private fun facts():DomainDocument {
        var state=DomainEngine.initial("UTC")
        for(id in listOf("a","b"))state=apply(state,"CreateProject","projectId" to id,"title" to "Animal check $id","blueprintId" to "builtin-small-workshop",
            "subtasks" to JSONArray().put(JSONObject().put("id","t-$id").put("title","Animal task $id")))
        return apply(state,"ConfigureWorldEnvironment","environmentStyle" to WorldEnvironment.VALLEY.wireValue)
    }
    private fun progressed(input:DomainDocument):DomainDocument {
        var state=apply(input,"SwitchActiveProject","projectId" to "a")
        state=apply(state,"StartFocus","sessionId" to "s","subtaskId" to "t-a","plannedDurationMs" to 1000)
        state=apply(state,"CompleteFocus",at=now+1000)
        return apply(state,"ReportSubtaskProgress","reportId" to "r","subtaskId" to "t-a","focusSessionIds" to JSONArray(listOf("s")),"progressBasisPoints" to 5000,at=now+1000)
    }
    private fun diagnostic(view:NativeWorldView):JSONObject {
        val done=CountDownLatch(1);val value=AtomicReference<JSONObject>();view.generatedDiagnostics{value.set(it);done.countDown()}
        assertTrue(done.await(10,TimeUnit.SECONDS));return checkNotNull(value.get())
    }
    private fun await(view:NativeWorldView,condition:(JSONObject)->Boolean):JSONObject {
        val end=android.os.SystemClock.uptimeMillis()+15000;var value=diagnostic(view)
        while(!condition(value)&&android.os.SystemClock.uptimeMillis()<end){android.os.SystemClock.sleep(40);value=diagnostic(view)}
        assertTrue("Animal state did not settle: $value",condition(value));return value
    }
    private fun present(scene:NativeGeneratedScene):Pair<NativeWorldView,JSONObject> {
        val done=CountDownLatch(1);val failure=AtomicReference<String>();val view=AtomicReference<NativeWorldView>()
        val expectedPresentation=scene.presentationIdentity
        foreground.scenario.onActivity{activity->activity.onGeneratedFrame={id->if(id==expectedPresentation)done.countDown()}
            activity.onGeneratedError={failure.set(it);done.countDown()};activity.presentGenerated(scene);view.set(checkNotNull(activity.generatedWorld))}
        assertTrue("Animal scene was not presented",done.await(80,TimeUnit.SECONDS));assertNull(failure.get())
        return view.get() to await(view.get()){it.getLong("presentationIdentity")==scene.presentationIdentity&&!it.getBoolean("failed")}
    }
    private fun animals(value:JSONObject)=value.getJSONObject("resources").getJSONObject("nativeAnimals")
    private fun screen(name:String){
        val file=File(context.filesDir,"p3-world-$label-animals-$name.png")
        assertTrue(UiDevice.getInstance(instrumentation).takeScreenshot(file));assertTrue(file.length()>4096)
    }
    @Test fun fourWorldsMoveRespondToRealTapsPauseAndKeepTheAnimalRowsDuringConstruction(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler();val rows=JSONArray()
        val state=facts();val original=state.sha256
        try{
            for((index,style)in WorldEnvironment.entries.withIndex()){
                val document=apply(state,"ConfigureWorldEnvironment","environmentStyle" to style.wireValue)
                val world=builder.terrain(builder.prepare(WorldFacts.from(document)))
                val scene=compiler.prepare(WorldRequestIdentity("animal-memory",0,index.toLong()),world,options).scene
                val (view,_)=present(scene);val actual=await(view){animals(it).getInt("updates")>0}
                assertEquals(scene.animals!!.initial.agents.size,animals(actual).getInt("count"));assertTrue(animals(actual).getInt("count")>=8)
                val runtime=Runtime.getRuntime();actual.put("managedHeapBytes",runtime.totalMemory()-runtime.freeMemory()).put("managedHeapLimit",runtime.maxMemory())
                println("P3_ANIMAL_WORLD "+JSONObject().put("environment",style.wireValue).put("managedHeapBytes",actual.getLong("managedHeapBytes")).put("pickEstimate",scene.picking.estimatedBytes))
                screen(style.name.lowercase());rows.put(JSONObject().put("environment",style.wireValue).put("display",actual))
            }
            fun render(document:DomainDocument,revision:Long)=compiler.prepare(WorldRequestIdentity("animal-memory",0,revision),builder.terrain(builder.prepare(WorldFacts.from(document))),options).scene
            val source=render(state,5);val land=source.animals!!.initial.agents.first{it.kind=="land"};val p=land.position
            val target=BlockPoint(p.x,p.y+.65,p.z);val camera=NativeSceneCamera(target,BlockPoint(p.x+7,p.y+6,p.z+7),24.0,40.0,source.camera.volume.copy(framingRadius=6.0),source.camera.aspect)
            val (view,_)=present(source.withPresentation(camera=camera));val before=await(view){animals(it).getInt("updates")>0}
            val moving=await(view){value->value.getJSONObject("resources").getInt("animalUploadFrames")>before.getJSONObject("resources").getInt("animalUploadFrames")&&
                animals(value).getJSONArray("agents").let{a->(0 until a.length()).any{a.getJSONObject(it).getDouble("traveled")>.04}}}
            assertTrue(moving.getJSONObject("resources").getInt("animalUploadFrames")>before.getJSONObject("resources").getInt("animalUploadFrames"))
            val targets=moving.getJSONObject("navigation").getJSONArray("animalTargets")
            val point=(0 until targets.length()).map{targets.getJSONObject(it)}.first{it.getInt("id")==land.id}
            val location=IntArray(2);instrumentation.runOnMainSync{view.getLocationOnScreen(location)}
            assertTrue(UiDevice.getInstance(instrumentation).click(location[0]+point.getDouble("x").toInt(),location[1]+point.getDouble("y").toInt()))
            val tapped=await(view){it.getJSONObject("navigation").optString("lastPickId").startsWith("animal:")}
            assertEquals("blockcolc-native-pick",tapped.getJSONObject("navigation").getString("pickThread"))
            assertTrue(animals(tapped).getJSONArray("agents").let{a->(0 until a.length()).any{a.getJSONObject(it).getInt("reactions")>0}});screen("closeup-tapped")
            instrumentation.runOnMainSync{view.pause()};val paused=await(view){!it.getBoolean("active")}
            android.os.SystemClock.sleep(350);val held=diagnostic(view);assertEquals(animals(paused).getDouble("time"),animals(held).getDouble("time"),0.0)
            instrumentation.runOnMainSync{view.resume()};val resumed=await(view){it.getLong("frames")>held.getLong("frames")}
            assertTrue(animals(resumed).getDouble("time")-animals(held).getDouble("time")<.25)
            val next=render(progressed(state),6).withPresentation(camera=camera);val (_,after)=present(next)
            val previousOwners=resumed.getJSONObject("ownerIdentities");val nextOwners=after.getJSONObject("ownerIdentities")
            for(owner in listOf("world","building:b",PacketOwners.ANIMALS))assertEquals(owner,previousOwners.getString(owner),nextOwners.getString(owner))
            assertNotEquals(previousOwners.getString("building:a"),nextOwners.getString("building:a"))
            assertEquals(animals(resumed).getInt("count"),animals(after).getInt("count"));assertEquals(1,animals(after).getInt("ownerReplacements"))
            assertEquals(original,state.sha256)
            File(context.filesDir,"p3-world-animals.json").writeText(JSONObject().put("schema",1).put("caseLabel",label).put("environments",rows)
                .put("before",before).put("moving",moving).put("tapped",tapped).put("paused",paused).put("resumed",resumed).put("constructed",after).put("sourceUnchanged",true).toString())
        }finally{builder.clear();compiler.clear()}
    }
    @Test fun failedGpuUploadKeepsTheAnimalPopulationAndCollisionUntilTheCompleteOwnerSwap(){
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler();val state=facts()
        val first=compiler.prepare(WorldRequestIdentity("animal-memory",0,0),builder.terrain(builder.prepare(WorldFacts.from(state))),options).scene
        val next=compiler.prepare(WorldRequestIdentity("animal-memory",0,1),builder.terrain(builder.prepare(WorldFacts.from(progressed(state)))),options).scene
        val thread=HandlerThread("blockcolc-p3-animals-gpu").apply{start()};val done=CountDownLatch(1);val failure=AtomicReference<Throwable>()
        Handler(thread.looper).post{
            var engine:Engine?=null;var packets:PacketRenderer?=null;var scene:com.google.android.filament.Scene?=null
            try{
                Filament.init();val e=Engine.create(Engine.Backend.OPENGL);engine=e;val s=e.createScene();scene=s
                val renderer=PacketRenderer(e,s,context.assets);packets=renderer;renderer.loadGenerated(first);e.flushAndWait()
                val before=renderer.diagnostics();val owner="building:a";val token=checkNotNull(renderer.ownerToken(owner));val source=next.sources.first{it.owner==owner}
                assertThrows(IllegalStateException::class.java){renderer.replaceGeneratedMany(listOf(source),mapOf(owner to token),failAfterPackets=1,animals=next.animals)}
                e.flushAndWait();val rejected=renderer.diagnostics()
                assertEquals(before.getJSONObject("nativeAnimals").toString(),rejected.getJSONObject("nativeAnimals").toString());assertEquals(token,renderer.ownerToken(owner))
                assertTrue(renderer.replaceGeneratedMany(listOf(source),mapOf(owner to token),animals=next.animals).accepted);e.flushAndWait()
                val accepted=renderer.diagnostics();assertEquals(1,accepted.getJSONObject("nativeAnimals").getInt("ownerReplacements"))
                assertEquals(before.getJSONObject("nativeAnimals").getInt("count"),accepted.getJSONObject("nativeAnimals").getInt("count"))
                File(context.filesDir,"p3-world-animals-rollback.json").writeText(JSONObject().put("schema",1).put("caseLabel",label).put("before",before).put("rejected",rejected).put("accepted",accepted).toString())
            }catch(error:Throwable){failure.set(error)}finally{
                try{packets?.close();engine?.let{e->e.flushAndWait();scene?.let{e.destroyScene(it)};e.destroy()}}catch(error:Throwable){failure.get()?.addSuppressed(error)?:failure.set(error)}
                done.countDown();thread.quitSafely()
            }
        }
        try{assertTrue(done.await(90,TimeUnit.SECONDS));failure.get()?.let{throw AssertionError("Native animal upload transaction failed",it)}}
        finally{thread.quitSafely();builder.clear();compiler.clear()}
    }
}
