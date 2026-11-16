package com.blockcolc.performance

import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.regex.Pattern

/** Separate-process user controls against the optimized application, no probe bridge. */
@RunWith(AndroidJUnit4::class)
class CoreStartupTest {
    @Test fun aColdCoreCanActuallyStartFocusBeforeWaitingForTheWorld(){
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val args=InstrumentationRegistry.getArguments();val device=UiDevice.getInstance(instrumentation)
        val target="com.blockcolc.preview";val label=checkNotNull(args.getString("p3Case"))
        require(label.matches(Regex("[a-z0-9-]{1,80}")))
        val expected=checkNotNull(args.getString("p3TargetSha"));require(expected.matches(Regex("[a-f0-9]{64}")))
        val minimal=args.getString("p3Minimal")=="1"
        val newWorkspace=args.getString("p3NewWorkspace")=="1"
        val warmOnly=args.getString("p3WarmOnly")=="1"
        val resumedTask=args.getString("p3ResumeTask")
        require(resumedTask==null||!newWorkspace&&!minimal&&!warmOnly)
        val awaitWorld=args.getString("p3AwaitWorld")=="1"
        require(!awaitWorld||!newWorkspace&&!warmOnly&&android.os.Build.VERSION.SDK_INT>=30)
        val profile=args.getString("p3Profile")?.also{require(it.matches(Regex("/data/local/tmp/blockcolc-core-[a-f0-9]+\\.trace")))}
        fun shell(text:String)=device.executeShellCommand(text).trim()
        val info=instrumentation.context.packageManager.getApplicationInfo(target,0)
        assertEquals(0,info.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)
        val apk=shell("pm path $target").lineSequence().first().removePrefix("package:")
        require(apk.matches(Regex("[/A-Za-z0-9~_+=.\\-]+")))
        assertEquals(expected,shell("sha256sum $apk").split(Regex("\\s+")).first())
        fun clear(){if(android.os.Build.VERSION.SDK_INT>=33)instrumentation.uiAutomation.clearCache()else instrumentation.uiAutomation.rootInActiveWindow?.refresh()}
        fun node(description:String):AccessibilityNodeInfo? {
            val queue=java.util.ArrayDeque<AccessibilityNodeInfo>()
            instrumentation.uiAutomation.rootInActiveWindow?.let{queue.add(it)}
            while(queue.isNotEmpty()){
                val item=queue.removeFirst();if(item.contentDescription?.toString()==description)return item
                for(i in 0 until item.childCount)item.getChild(i)?.let{queue.add(it)}
            };return null
        }
        fun find(selector:BySelector):UiObject2 {
            val until=SystemClock.elapsedRealtime()+30000
            while(SystemClock.elapsedRealtime()<until){clear();device.findObject(selector)?.takeIf{it.isEnabled&&!it.visibleBounds.isEmpty}?.let{return it};SystemClock.sleep(10)}
            throw AssertionError("The cold core did not expose an enabled control")
        }
        val result=JSONObject().put("completed",false).put("caseLabel",label).put("targetSha256",expected).put("minimal",minimal).put("newWorkspace",newWorkspace).put("profilingEnabled",profile!=null).put("warmOnly",warmOnly)
            .put("targetCoreMs",1000).put("scope","Non-debuggable application, cold process, actual enabled core control and completed focus UI. Includes accessibility observation overhead; Android fully drawn, independent fixed-time physical input and world readiness remain separate.")
        val config=Configurator.getInstance();val previousIdle=config.waitForIdleTimeout;config.waitForIdleTimeout=0
        try{
            shell("am force-stop $target");assertEquals("",shell("pidof $target"));clear()
            val started=SystemClock.elapsedRealtimeNanos()
            result.put("launchEpochMs",System.currentTimeMillis())
            val recording=profile?.let{"--start-profiler $it --sampling 10000 --clock-type thread-cpu "}?:""
            val launch=shell("am start -W ${recording}-n $target/.MainActivity");result.put("launch",launch)
            assertTrue(launch.contains("Status: ok"));assertFalse(launch.contains("Error:"))
            val control=find(when{
                resumedTask!=null->By.desc("专注操作区")
                newWorkspace->By.text("下一页")
                minimal->By.desc("结束时间，上下滑动或按方向键调整")
                else->By.text(Pattern.compile("开始 [0-9]+ 轮"))
            })
            if(resumedTask!=null)find(By.text(resumedTask))
            val core=SystemClock.elapsedRealtimeNanos();result.put("coreAvailableMs",(core-started)/1e6).put("coreTargetMet",core-started<=1_000_000_000L)
            if(android.os.Build.VERSION.SDK_INT>=30)result.put("worldAtCore",node("聚落世界")?.stateDescription?.toString())
            if(warmOnly){
                // Untimed preparation only. The host verifies the completed
                // cache file before a separate cold-process measurement.
                SystemClock.sleep(5000);result.put("completed",true);return
            }
            if(minimal){
                val clock=checkNotNull(node("结束时间，上下滑动或按方向键调整"))
                assertTrue(clock.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_PROGRESS.id,Bundle().apply{
                    putFloat(AccessibilityNodeInfo.ACTION_ARGUMENT_PROGRESS_VALUE,18f)
                }))
                // This is the existing accessible deadline control, not a
                // database/diagnostic shortcut. Confirm with real double taps.
                clear()
            }
            val bounds=control.visibleBounds;val input=SystemClock.elapsedRealtimeNanos()
            if(newWorkspace)result.put("action","first-use").put("calibratedBounds",bounds.flattenToString())
            assertTrue(device.click(bounds.centerX(),bounds.centerY()))
            if(minimal||resumedTask!=null){SystemClock.sleep(65);assertTrue(device.click(bounds.centerX(),bounds.centerY()))}
            result.put("inputReturnedMs",(SystemClock.elapsedRealtimeNanos()-input)/1e6)
            if(resumedTask!=null){
                find(By.text("结束本次专注"))
                result.put("resumedExistingFocus",true)
                    .put("doubleTapToFocusControlsMs",(SystemClock.elapsedRealtimeNanos()-input)/1e6).put("completed",true)
                return
            }
            if(newWorkspace){
                find(By.text("把任务建成世界"))
                result.put("tapToNextTutorialPageMs",(SystemClock.elapsedRealtimeNanos()-input)/1e6).put("completed",true)
                return
            }
            find(By.desc("专注操作区"))
            val focused=SystemClock.elapsedRealtimeNanos()
            result.put("tapToFocusUiMs",(focused-input)/1e6).put("launchToFocusUiMs",(focused-started)/1e6)
            if(android.os.Build.VERSION.SDK_INT>=30)result.put("worldAtFocus",node("聚落世界")?.stateDescription?.toString())
            if(awaitWorld){
                val deadline=SystemClock.elapsedRealtime()+90000
                do{
                    clear()
                    if(node("聚落世界")?.stateDescription?.toString()=="世界已就绪"){
                        result.put("worldAvailableMs",(SystemClock.elapsedRealtimeNanos()-started)/1e6)
                        break
                    }
                    SystemClock.sleep(50)
                }while(SystemClock.elapsedRealtime()<deadline)
                assertTrue("The world did not finish after the first focus action",result.has("worldAvailableMs"))
            }
            result.put("completed",true)
        }catch(error:Throwable){result.put("failure",error.javaClass.simpleName+": "+error.message);throw error}
        finally{
            if(profile!=null)shell("am profile stop $target")
            shell("pidof $target").toIntOrNull()?.let{result.put("processId",it)}
            instrumentation.context.filesDir.resolve("core-startup-$label.xml").outputStream().use{device.dumpWindowHierarchy(it)}
            config.waitForIdleTimeout=previousIdle
            shell("am force-stop $target")
            instrumentation.sendStatus(2,Bundle().apply{putString("p3CoreStartup",result.toString())})
        }
    }
}
