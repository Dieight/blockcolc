package com.blockcolc.preview

import android.content.Intent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.*
import com.blockcolc.storage.BackupCodec
import com.blockcolc.world.filament.NativeWorldView
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Launch the shipped composition root and its actual Activity lifecycle.
 * Synthetic facts and preferences use the actor's existing isolated context. */
@RunWith(AndroidJUnit4::class)
class P3ActualRootLifecycleTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private val runtime get()=PreviewRuntime.get(context)

    @Test fun ordinaryActivityRetainsItsCameraThroughHomeAndRoutes()=verify(false)
    @Test fun minimalActivityRetainsItsCameraThroughHome()=verify(true)

    private fun verify(minimal:Boolean){
        val name=runtime.testDatabase(true).get(30,TimeUnit.SECONDS)
        var preferences=false;var scenario:ActivityScenario<MainActivity>?=null
        try{
            runtime.testClientPreferences(true).get(30,TimeUnit.SECONDS);preferences=true
            val now=System.currentTimeMillis()
            val created=DomainEngine.execute(DomainEngine.initial("UTC"),DomainEngine.command("CreateProject",
                "projectId" to "root-work","title" to "生命周期工坊","blueprintId" to "builtin-small-workshop",
                "subtasks" to JSONArray().put(JSONObject().put("id","root-task").put("title","建造"))),now)
            check(created.ok){created.error!!}
            runtime.testOperation{it.importBackup("p3-actual-root",BackupCodec.read(BackupCodec.write(created.state,DomainTime.format(now))),now)}.get(30,TimeUnit.SECONDS)
            runtime.updatePreferences{it.copy(minimalMode=minimal,themeMode="dark",realWeatherEnabled=false,autoCheckUpdates=false)}
            compose.waitUntil(10000){!runtime.latest.preferencesSaving&&runtime.latest.preferences.minimalMode==minimal}
            scenario=ActivityScenario.launch(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            compose.waitUntil(30000){compose.onAllNodesWithTag("workspace-ready").fetchSemanticsNodes().isNotEmpty()}
            val before=stableFrame()
            val device=androidx.test.uiautomator.UiDevice.getInstance(instrumentation)
            fun homeAndReturn():JSONObject{
                device.pressHome();device.waitForIdle(1000)
                context.startActivity(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP))
                return stableFrame()
            }
            val returned=homeAndReturn();sameCamera(before,returned)
            if(!minimal){
                for(page in listOf("任务","统计","设置","计时")){
                    compose.onNodeWithContentDescription(page).performClick();compose.waitForIdle()
                }
                sameCamera(returned,stableFrame())
            }
            fun worldAction(label:String){
                if(compose.onAllNodesWithContentDescription(label).fetchSemanticsNodes().isEmpty()){
                    compose.onNodeWithContentDescription("显示世界操作").performClick();android.os.SystemClock.sleep(450)
                }
                compose.onNodeWithContentDescription(label).performClick()
            }
            val camera=returned.getJSONObject("camera");val limits=returned.getJSONObject("navigation")
            val distance=camera.getDouble("fittedDistance").coerceIn(limits.getDouble("minimum"),limits.getDouble("maximum"))
            worldAction("重置视角")
            val reset=stableFrame{kotlin.math.abs(it.getJSONObject("camera").getDouble("distance")-distance)<1e-8}
            assertEquals(limits.optString("selected"),reset.getJSONObject("navigation").optString("selected"))
            sameCamera(reset,homeAndReturn())
            if(!reset.getJSONObject("navigation").isNull("selected"))worldAction("重置地图")
            val mapped=stableFrame{it.getJSONObject("navigation").isNull("selected")}
            sameCamera(mapped,homeAndReturn())
            worldAction("室内视角")
            val indoors=stableFrame{it.getJSONObject("interior").optBoolean("active")&&it.getJSONObject("interior").getLong("presentedSequence")==it.getJSONObject("interior").getLong("sequence")}
            repeat(3){sameCamera(indoors,homeAndReturn())}
            val report=JSONObject().put("completed",true).put("minimal",minimal).put("isolatedDatabase",name)
                .put("caseLabel",InstrumentationRegistry.getArguments().getString("p3Group"))
                .put("before",before).put("returned",returned).put("reset",reset).put("map",mapped)
                .put("scope","Actual MainActivity and NativeApp, automatic onResume/onStop, Home/return, both resets and ordinary tab routes. Emulator functionality, not phone performance.")
            context.filesDir.resolve("p3-actual-root-${if(minimal)"minimal"else"ordinary"}.json").writeText(report.toString())
        }finally{
            try{scenario?.close()}finally{
                try{if(preferences)runtime.testClientPreferences(false).get(30,TimeUnit.SECONDS)}
                finally{runtime.testDatabase(false).get(30,TimeUnit.SECONDS)}
            }
        }
    }

    private fun frame():JSONObject?{
        val world=AtomicReference<NativeWorldView?>()
        instrumentation.runOnMainSync{
            fun find(view:android.view.View):NativeWorldView?{
                if(view is NativeWorldView)return view
                if(view is android.view.ViewGroup)for(i in 0 until view.childCount)find(view.getChildAt(i))?.let{return it}
                return null
            }
            for(activity in androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED)){
                if(activity is MainActivity)find(activity.window.decorView)?.let{world.set(it)}
            }
        }
        val found=world.get()?:return null
        val result=AtomicReference<JSONObject>();val ready=CountDownLatch(1)
        found.generatedDiagnostics(false){result.set(it);ready.countDown()}
        assertTrue(ready.await(10,TimeUnit.SECONDS));return result.get()
    }
    private fun stableFrame(accept:(JSONObject)->Boolean={true}):JSONObject{
        var result=JSONObject()
        compose.waitUntil(90000){
            val value=frame()
            if(value==null)false else{
                result=value
                value.optBoolean("active")&&value.optBoolean("surfaceShown")&&value.optBoolean("swapReady")&&
                    value.optLong("gpuReadyFrames")>0&&value.isNull("pendingPresentation")&&!value.optBoolean("fencePending")&&
                    !value.getJSONObject("navigation").optBoolean("opening")&&accept(value)
            }
        };return result
    }
    private fun sameCamera(before:JSONObject,after:JSONObject){
        // Logical camera equality missed a resized display viewport overwriting
        // the smaller offscreen render target after Surface recreation.
        for(value in listOf(before,after)){
            val viewport=value.getJSONObject("worldViewport")
            val target=value.getJSONObject("colorPipeline").getJSONObject("config")
            assertEquals(target.getInt("width"),viewport.getInt("width"))
            assertEquals(target.getInt("height"),viewport.getInt("height"))
            assertEquals(0,viewport.getInt("left"));assertEquals(0,viewport.getInt("bottom"))
        }
        val a=before.getJSONObject("camera");val b=after.getJSONObject("camera")
        for(key in listOf("distance","fittedDistance","pitch","azimuth","fov"))assertEquals(key,a.getDouble(key),b.getDouble(key),1e-8)
        for(key in listOf("width","height"))assertEquals(key,a.getInt(key),b.getInt(key))
        for(i in 0..2)assertEquals("target[$i]",a.getJSONArray("target").getDouble(i),b.getJSONArray("target").getDouble(i),1e-8)
        for(key in listOf("presentationHeight","presentationTop"))assertEquals(key,before.getInt(key),after.getInt(key))
        assertEquals(before.getJSONObject("navigation").optString("selected"),after.getJSONObject("navigation").optString("selected"))
    }
}
