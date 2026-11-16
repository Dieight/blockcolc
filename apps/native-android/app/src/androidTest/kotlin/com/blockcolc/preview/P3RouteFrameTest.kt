package com.blockcolc.preview

import android.content.Intent
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.FrameMetrics
import android.view.View
import android.view.ViewGroup
import android.view.Window
import androidx.test.core.app.ActivityScenario
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.storage.BackupCodec
import com.blockcolc.presentation.WorkspaceDetails
import com.blockcolc.world.filament.NativeWorldView
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Actual Activity and Android frame clock. No Compose test clock, sampler,
 * GC, permission changes or formal App. Setup and teardown are not timed.
 * Emulator diagnostic attribution is not a phone/release performance claim. */
@SdkSuppress(minSdkVersion=24)
class P3RouteFrameTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private val runtime get()=PreviewRuntime.get(context)
    private val device get()=UiDevice.getInstance(instrumentation)

    @Test(timeout=480000) fun actualTwentyFiveBuildingRoutesKeepTheirWorldAndRecordWindowFrames(){
        val database=runtime.testDatabase(true).get(30,TimeUnit.SECONDS)
        var preferences=false;var scenario:ActivityScenario<MainActivity>?=null
        val metricsThread=HandlerThread("blockcolc-route-metrics").apply{start()}
        val frames=CopyOnWriteArrayList<LongArray>()
        var window:Window?=null
        val listener=Window.OnFrameMetricsAvailableListener{_,frame,_->
            frames.add(longArrayOf(frame.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP),frame.getMetric(FrameMetrics.TOTAL_DURATION),
                frame.getMetric(FrameMetrics.LAYOUT_MEASURE_DURATION),frame.getMetric(FrameMetrics.DRAW_DURATION),frame.getMetric(FrameMetrics.SYNC_DURATION)))
        }
        val config=Configurator.getInstance();val originalIdle=config.waitForIdleTimeout
        try{
            runtime.testClientPreferences(true).get(30,TimeUnit.SECONDS);preferences=true
            runtime.testOperation{coordinator->
                val source=DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()})
                val now=System.currentTimeMillis()
                val changed=DomainEngine.execute(source,DomainEngine.command("ConfigureWorldEnvironment","environmentStyle" to "mosaic-coast"),now)
                check(changed.ok){changed.error!!}
                check(changed.state.json().isNull("activeFocusSession"))
                coordinator.importBackup("route-frame-fixture",BackupCodec.read(BackupCodec.write(changed.state,DomainTime.format(now))),now)
            }.get(60,TimeUnit.SECONDS)
            runtime.testFirstUse(false,false).get(30,TimeUnit.SECONDS)
            runtime.updatePreferences{it.copy(minimalMode=false,themeMode="light",realWeatherEnabled=false,autoCheckUpdates=false)}
            await(15000){!runtime.latest.preferencesSaving&&!runtime.latest.preferences.minimalMode}
            // Historic unlocks are not part of route latency. Acknowledge the
            // synthetic fixture before mounting UI, through the normal durable
            // receipt path. Never dismiss a sheet during a measured interval.
            await(30000){runtime.latest.workspace?.details==WorkspaceDetails.READY}
            val acknowledged=CountDownLatch(1)
            val failed=AtomicReference<Boolean>(true)
            runtime.acknowledgeAchievements(runtime.latest.workspace!!.achievements.filter{it.unlocked}.map{it.definition.id}){_,error->
                failed.set(error);acknowledged.countDown()
            }
            assertTrue(acknowledged.await(15,TimeUnit.SECONDS));assertFalse(failed.get())
            scenario=ActivityScenario.launch(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            config.waitForIdleTimeout=0
            val before=stableFrame()
            val originalView=worldView()
            assertEquals(25,runtime.latest.projects.size)
            for(label in listOf("任务","统计","设置","计时")){
                navigate(label)
                SystemClock.sleep(500)
            }
            stableFrame()
            scenario.onActivity{activity->window=activity.window;activity.window.addOnFrameMetricsAvailableListener(listener,Handler(metricsThread.looper))}
            val samples=JSONArray()
            repeat(3){cycle->
                for(label in listOf("任务","统计","设置")){
                    navigate(label);SystemClock.sleep(450)
                    val started=System.nanoTime()
                    navigate("计时")
                    val inputReturned=System.nanoTime()
                    SystemClock.sleep(850)
                    val ended=System.nanoTime()
                    val captured=frames.filter{it[0]>=started&&it[0]<=ended}
                    assertTrue("No actual Window frames for $label -> timer",captured.isNotEmpty())
                    samples.put(JSONObject().put("cycle",cycle).put("from",label).put("inputReturnedMs",(inputReturned-started)/1e6)
                        .put("frames",JSONArray(captured.map{JSONArray(it.toList())})))
                }
            }
            val after=stableFrame();assertSame(originalView,worldView())
            assertEquals(before.getLong("generation"),after.getLong("generation"))
            assertEquals(before.getLong("revision"),after.getLong("revision"))
            val label=InstrumentationRegistry.getArguments().getString("p3Group")?:"route-frames"
            require(label.matches(Regex("[a-z0-9-]{1,80}")))
            val report=JSONObject().put("schema",1).put("caseLabel",label).put("completed",true).put("projects",25).put("worldRetained",true)
                .put("samples",samples).put("heapLimitBytes",Runtime.getRuntime().maxMemory())
                .put("scope","Actual MainActivity, physical tab taps and Android Window frame metrics; 25-building coast; no Compose test clock. Emulator diagnostic attribution, not phone/release performance.")
            File(context.filesDir,"p3-route-frames-$label.json").writeText(report.toString())
        }catch(error:Throwable){
            val label=InstrumentationRegistry.getArguments().getString("p3Group")?:"route-frames"
            if(label.matches(Regex("[a-z0-9-]{1,80}"))){
                runCatching{device.takeScreenshot(File(context.filesDir,"p3-$label-failure.png"))}
                runCatching{device.dumpWindowHierarchy(File(context.filesDir,"p3-$label-failure.xml"))}
            }
            throw error
        }finally{
            config.waitForIdleTimeout=originalIdle
            instrumentation.runOnMainSync{window?.removeOnFrameMetricsAvailableListener(listener)}
            metricsThread.quitSafely();metricsThread.join(2000)
            try{scenario?.close()}finally{
                try{if(preferences)runtime.testClientPreferences(false).get(30,TimeUnit.SECONDS)}
                finally{runtime.testDatabase(false).get(30,TimeUnit.SECONDS)}
            }
        }
    }

    private fun navigate(label:String){
        val node=device.findObject(By.desc(label))?:throw AssertionError("Missing navigation tab: $label")
        val bounds=node.visibleBounds;assertFalse(bounds.isEmpty)
        assertTrue(device.click(bounds.centerX(),bounds.centerY()))
    }
    private fun worldView():NativeWorldView?{
        val found=AtomicReference<NativeWorldView?>()
        instrumentation.runOnMainSync{
            fun find(view:View):NativeWorldView?{
                if(view is NativeWorldView)return view
                if(view is ViewGroup)for(i in 0 until view.childCount)find(view.getChildAt(i))?.let{return it}
                return null
            }
            for(activity in androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED))
                if(activity is MainActivity)find(activity.window.decorView)?.let{found.set(it)}
        };return found.get()
    }
    private fun stableFrame():JSONObject{
        var last=JSONObject()
        await(180000){
            val world=worldView()?:return@await false
            val value=AtomicReference<JSONObject>();val ready=CountDownLatch(1)
            world.generatedDiagnostics(false){value.set(it);ready.countDown()}
            if(!ready.await(10,TimeUnit.SECONDS))return@await false
            last=value.get()
            last.optBoolean("active")&&last.optBoolean("surfaceShown")&&last.optBoolean("swapReady")&&last.optLong("gpuReadyFrames")>0&&
                last.isNull("pendingPresentation")&&!last.optBoolean("fencePending")&&!last.getJSONObject("navigation").optBoolean("opening")
        };return last
    }
    private fun await(timeout:Long,accept:()->Boolean){
        val until=SystemClock.elapsedRealtime()+timeout
        while(SystemClock.elapsedRealtime()<until){if(accept())return;SystemClock.sleep(50)}
        throw AssertionError("Route frame test did not reach its required state")
    }
}
