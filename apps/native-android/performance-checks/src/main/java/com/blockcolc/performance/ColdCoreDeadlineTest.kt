package com.blockcolc.performance

import android.os.Bundle
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.regex.Pattern

internal enum class CoreTouch(val wire:String) {
    FOCUS("focus"),TASKS("tasks"),STATISTICS("statistics"),SETTINGS("settings"),MINIMAL_STATS("minimal-stats"),FIRST_USE("first-use");

    fun control():BySelector=when(this){
        FOCUS->By.text(Pattern.compile("开始 [0-9]+ 轮"))
        TASKS->By.desc("任务")
        STATISTICS->By.desc("统计")
        SETTINGS->By.desc("设置")
        MINIMAL_STATS->By.desc("结束时间，上下滑动或按方向键调整")
        FIRST_USE->By.text("下一页")
    }
    fun destination():BySelector=when(this){
        FOCUS->By.desc("专注操作区")
        TASKS->By.text("任务与施工")
        STATISTICS->By.desc("专注日历")
        SETTINGS->By.text("搜索设置")
        MINIMAL_STATS->By.desc(Pattern.compile("今日实际专注 .*"))
        FIRST_USE->By.text("把任务建成世界")
    }
    companion object {
        fun from(args:Bundle):CoreTouch {
            val minimal=args.getString("p3Minimal")=="1"
            val action=args.getString("p3StartupAction")
            val touch=if(action==null)if(minimal)MINIMAL_STATS else FOCUS else entries.single{it.wire==action}
            require((touch==MINIMAL_STATS)==minimal)
            return touch
        }
    }
}

/** Calibrate only before force-stop. Timed input uses shell touchscreen events
 * at fixed coordinates, with no accessibility lookup before the input. */
@RunWith(AndroidJUnit4::class)
class ColdCoreDeadlineTest {
    @Test fun aCalibratedPhysicalActionIsAcceptedBeforeTheCoreDeadline(){
        val instrumentation=InstrumentationRegistry.getInstrumentation();val args=InstrumentationRegistry.getArguments()
        val device=UiDevice.getInstance(instrumentation);val automation=instrumentation.uiAutomation
        val target="com.blockcolc.preview";val label=checkNotNull(args.getString("p3Case"));require(label.matches(Regex("[a-z0-9-]{1,60}")))
        val expected=checkNotNull(args.getString("p3TargetSha"));require(expected.matches(Regex("[a-f0-9]{64}")))
        val minimal=args.getString("p3Minimal")=="1"
        val touch=CoreTouch.from(args)
        val calibrationOnly=args.getString("p3CalibrationOnly")=="1"
        val suppliedBounds=args.getString("p3CalibratedBounds")?.let{wire->
            require(!minimal&&wire.matches(Regex("[0-9]+,[0-9]+,[0-9]+,[0-9]+")))
            checkNotNull(android.graphics.Rect.unflattenFromString(wire.replace(',',' '))).also{require(it.left>=0&&it.top>=0&&it.width()>0&&it.height()>0&&it.right<=device.displayWidth&&it.bottom<=device.displayHeight)}
        }
        require(!calibrationOnly||suppliedBounds==null)
        val deadline=args.getString("p3InputDeadlineMs")?.toLong()?.also{require(it in 500..950)}?:if(minimal)650L else 750L
        fun shell(command:String)=android.os.ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(command))
            .use{it.bufferedReader(Charsets.UTF_8).readText().trim()}
        val app=instrumentation.context.packageManager.getApplicationInfo(target,0)
        assertEquals(0,app.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)
        val apk=shell("pm path $target").lineSequence().first().removePrefix("package:")
        require(apk.matches(Regex("[/A-Za-z0-9~_+=.\\-]+")));assertEquals(expected,shell("sha256sum $apk").split(Regex("\\s+")).first())
        fun clear(){if(android.os.Build.VERSION.SDK_INT>=33)automation.clearCache()else automation.rootInActiveWindow?.refresh()}
        fun find(selector:BySelector,timeout:Long):UiObject2? {
            val end=SystemClock.elapsedRealtime()+timeout
            while(SystemClock.elapsedRealtime()<end){
                clear();device.findObject(selector)?.takeIf{it.isEnabled&&!it.visibleBounds.isEmpty}?.let{return it}
                SystemClock.sleep(10)
            };return null
        }
        val start=touch.control()
        val result=JSONObject().put("completed",false).put("caseLabel",label).put("targetSha256",expected).put("minimal",minimal)
            .put("action",touch.wire).put("calibrationOnly",calibrationOnly)
            .put("targetCoreMs",1000).put("inputScheduledMs",deadline)
            .put("scope","Untimed coordinate/cache calibration, force-stop and verified fresh process; fixed-time actual touchscreen action without a timed accessibility lookup. Proves an upper bound on usable core only when the action succeeds. It does not replace the separate accessibility-availability result.")
        val config=Configurator.getInstance();val idle=config.waitForIdleTimeout;config.waitForIdleTimeout=0
        try{
            val response=touch.destination()
            val bounds=suppliedBounds?:run{
                shell("am force-stop $target");shell("am start -W -n $target/.MainActivity")
                val found=checkNotNull(find(start,30000)){"Calibration did not expose the real control"}.visibleBounds
                assertNull("The intended response must not already be visible during calibration",find(response,150))
                SystemClock.sleep(3000) // Untimed cache completion; no focus command.
                found
            }
            result.put("calibrationLaunchInThisMeasurement",suppliedBounds==null)
            if(suppliedBounds!=null)result.put("scope","Coordinates supplied from a retained, hash-checked identical UI; no calibration launch or timed accessibility lookup. Fresh process, one physical touchscreen action, actual focus result required. The host records cache exclusion separately.")
            result.put("calibratedBounds",bounds.flattenToString()).put("displayWidth",device.displayWidth)
            if(calibrationOnly){result.put("completed",true);return}
            shell("am force-stop $target");assertEquals("",shell("pidof $target"));clear()
            result.put("verifiedPriorProcessStopped",true)
            val begun=SystemClock.elapsedRealtimeNanos();result.put("launchEpochMs",System.currentTimeMillis())
            // A fixed-time input must not be serialized behind am's window
            // wait. The stopped-process guard above proves a cold process.
            val launch=shell("am start -n $target/.MainActivity")
            result.put("launch",launch).put("launchCommandReturnedMs",(SystemClock.elapsedRealtimeNanos()-begun)/1e6)
            assertTrue(launch.contains("Starting:"));assertFalse(launch.contains("Error:"))
            val remaining=deadline*1000000L-(SystemClock.elapsedRealtimeNanos()-begun)
            if(remaining>0)SystemClock.sleep(remaining/1000000L)
            result.put("inputStartedMs",(SystemClock.elapsedRealtimeNanos()-begun)/1e6)
            // Unlike UiAutomation.injectInputEvent, the shell input command
            // does not synchronize all pending window/surface animations.
            if(minimal)shell("input touchscreen swipe ${device.displayWidth*4/5} ${bounds.centerY()} ${device.displayWidth/5} ${bounds.centerY()} 120")
            else shell("input touchscreen tap ${bounds.centerX()} ${bounds.centerY()}")
            val returned=(SystemClock.elapsedRealtimeNanos()-begun)/1e6;result.put("inputReturnedByMs",returned)
            val observed=find(response,5000)
            val accepted=observed!=null
            result.put("actionAccepted",accepted).put("resultObservedByMs",(SystemClock.elapsedRealtimeNanos()-begun)/1e6)
                .put("coreTargetMet",accepted&&returned<=1000.0)
            if(accepted)result.put("coreProvedUsableByMs",returned)
            else result.put("idleBoundsAfterInput",find(start,5000)?.visibleBounds?.flattenToString())
            result.put("completed",true)
        }catch(error:Throwable){result.put("failure",error.javaClass.simpleName+": "+error.message);throw error}
        finally{
            instrumentation.context.filesDir.resolve("core-deadline-$label.xml").outputStream().use{device.dumpWindowHierarchy(it)}
            config.waitForIdleTimeout=idle;shell("am force-stop $target")
            instrumentation.sendStatus(2,Bundle().apply{putString("p3CoreStartup",result.toString())})
        }
    }
}
