package com.blockcolc.performance

import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.regex.Pattern

/** External observer of the optimized App. No diagnostic Activity or database
 * bridge participates in the measured process. The host owns and restores the
 * isolated data and credentials before this observer is launched. */
@RunWith(AndroidJUnit4::class)
class P4WorkspaceTest {
    @Test fun coldWorldAndVisibleOperations() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val args=InstrumentationRegistry.getArguments()
        val device=UiDevice.getInstance(instrumentation)
        val pkg="com.blockcolc.preview"
        val label=checkNotNull(args.getString("p4Case"))
        val expected=checkNotNull(args.getString("p4TargetSha"))
        val action=args.getString("p4Action")?:"cold"
        val preset=args.getString("p4VisualPreset")
        require(preset==null||preset=="clear-afternoon")
        require(label.matches(Regex("[a-z0-9-]{1,80}")))
        require(expected.matches(Regex("[a-f0-9]{64}")))
        require(action in setOf("cold","routes","gestures","pinch","resume"))
        fun shell(command:String)=device.executeShellCommand(command).trim()
        val app=instrumentation.context.packageManager.getApplicationInfo(pkg,0)
        assertEquals("Performance samples require a non-debuggable App",0,app.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)
        require(app.sourceDir.matches(Regex("[/A-Za-z0-9~_+=.\\-]+")))
        assertEquals(expected,shell("sha256sum ${app.sourceDir}").split(Regex("\\s+")).first())
        fun clear(){if(android.os.Build.VERSION.SDK_INT>=33)instrumentation.uiAutomation.clearCache()else instrumentation.uiAutomation.rootInActiveWindow?.refresh()}
        fun world():AccessibilityNodeInfo? {
            val pending=java.util.ArrayDeque<AccessibilityNodeInfo>()
            instrumentation.uiAutomation.rootInActiveWindow?.let(pending::add)
            while(pending.isNotEmpty()){
                val item=pending.removeFirst()
                if(item.contentDescription?.toString()=="聚落世界")return item
                for(i in 0 until item.childCount)item.getChild(i)?.let(pending::add)
            }
            return null
        }
        fun until(timeout:Long=90000,condition:()->Boolean):Long {
            val end=SystemClock.elapsedRealtime()+timeout
            do{clear();if(condition())return SystemClock.elapsedRealtimeNanos();SystemClock.sleep(20)}while(SystemClock.elapsedRealtime()<end)
            error("Visible workspace condition timed out: $action")
        }
        fun tapTab(text:String){
            val tab=device.findObject(By.desc(text))?:error("Missing navigation: $text")
            val bounds=tab.visibleBounds
            assertTrue(tab.isEnabled&&!bounds.isEmpty)
            assertTrue(device.click(bounds.centerX(),bounds.centerY()))
        }
        val config=Configurator.getInstance();val idle=config.waitForIdleTimeout;config.waitForIdleTimeout=0
        val report=JSONObject().put("completed",false).put("case",label).put("action",action).put("apkSha256",expected)
            .put("scope","Cold process; optimized non-debuggable App; separate accessibility observer. GPU/world semantics and system presentation remain separate metrics.")
        try {
            shell("am force-stop $pkg");assertEquals("",shell("pidof $pkg"));clear()
            val monotonic=System.nanoTime()
            val started=SystemClock.elapsedRealtimeNanos();report.put("launchBootNs",started.toString()).put("launchMonotonicNs",monotonic.toString())
            val launch=shell("am start -W ${preset?.let{"--es p4VisualPreset $it "}?:""}-n $pkg/.MainActivity")
            report.put("launch",launch);assertTrue(launch.contains("Status: ok")&&launch.contains("LaunchState: COLD"))
            val core=until{
                device.findObject(By.text(Pattern.compile("开始 [0-9]+ 轮")))?.let{it.isEnabled&&!it.visibleBounds.isEmpty}==true ||
                    device.findObject(By.desc("结束时间，上下滑动或按方向键调整"))?.let{it.isEnabled&&!it.visibleBounds.isEmpty}==true
            }
            report.put("coreObservedMs",(core-started)/1e6)
            val ready=until(180000){
                assertFalse("World preparation failed",device.hasObject(By.text("世界暂未准备好")))
                world()?.stateDescription?.toString()=="世界已就绪"
            }
            report.put("worldObservedBootNs",ready.toString()).put("worldObservedMs",(ready-started)/1e6)
            // A named system-log marker lets the host align this observation
            // with SurfaceFlinger without treating GPU readiness as a frame.
            shell("log -p i -t BlockcolcP4 p4-world-observed-$label")
            SystemClock.sleep(1500)
            if(action=="routes"){
                val routes=JSONArray()
                report.put("routeStartBootNs",SystemClock.elapsedRealtimeNanos().toString())
                for(page in listOf("任务","统计","设置")){
                    clear();val begin=SystemClock.elapsedRealtimeNanos();tapTab(page)
                    val selected=until(20000){
                        // Compose exposes a Tab's selection through its
                        // accessibility state; UiObject2.isSelected is not a
                        // portable receipt for the destination page. Observe
                        // that page's actual content instead.
                        val destination=when(page){
                            "任务"->device.findObject(By.text("新增任务"))
                            "统计"->device.findObject(By.desc("专注日历"))?:device.findObject(By.text("新的成就"))
                            else->device.findObject(By.text("普通任务"))
                        }
                        destination?.let{!it.visibleBounds.isEmpty}==true
                    }
                    val achievement=page=="统计"&&device.hasObject(By.text("新的成就"))
                    if(achievement){
                        // A real first statistics visit may announce earned
                        // achievements. Keep and report that destination; use
                        // its real dismiss gesture before measuring the return.
                        val close=device.findObject(By.text("全部关闭"))
                        if(close!=null&&!close.visibleBounds.isEmpty)device.click(close.visibleBounds.centerX(),close.visibleBounds.centerY())else device.pressBack()
                        until(20000){device.findObject(By.desc("专注日历"))?.let{!it.visibleBounds.isEmpty}==true}
                    }
                    SystemClock.sleep(700)
                    clear();val back=SystemClock.elapsedRealtimeNanos();tapTab("计时")
                    val visible=until(20000){device.findObject(By.text(Pattern.compile("开始 [0-9]+ 轮")))?.let{it.isEnabled&&!it.visibleBounds.isEmpty}==true}
                    val resident=until(20000){world()?.stateDescription?.toString()=="世界已就绪"}
                    routes.put(JSONObject().put("page",page).put("selectMs",(selected-begin)/1e6).put("firstAchievementShown",achievement).put("timerControlMs",(visible-back)/1e6).put("timerWorldMs",(resident-back)/1e6))
                    SystemClock.sleep(700)
                }
                report.put("routes",routes)
                report.put("routeEndBootNs",SystemClock.elapsedRealtimeNanos().toString())
            }else if(action=="gestures"){
                val rect=android.graphics.Rect();checkNotNull(world()).getBoundsInScreen(rect)
                assertTrue(rect.width()>100&&rect.height()>100)
                report.put("gestureStartBootNs",SystemClock.elapsedRealtimeNanos().toString())
                shell("log -p i -t BlockcolcP4 p4-gestures-start-$label")
                repeat(6){i->
                    val left=rect.left+rect.width()/3;val right=rect.right-rect.width()/3;val y=rect.top+rect.height()/3
                    assertTrue(device.swipe(if(i%2==0)left else right,y,if(i%2==0)right else left,y,45))
                    SystemClock.sleep(250)
                }
                shell("log -p i -t BlockcolcP4 p4-gestures-end-$label")
                report.put("gestureEndBootNs",SystemClock.elapsedRealtimeNanos().toString())
            }else if(action=="pinch"){
                val target=checkNotNull(device.findObject(By.desc("聚落世界")))
                val bounds=target.visibleBounds
                assertTrue(bounds.width()>100&&bounds.height()>100)
                val began=SystemClock.elapsedRealtimeNanos()
                target.pinchOpen(.55f,500)
                val ended=SystemClock.elapsedRealtimeNanos()
                assertEquals(bounds,device.findObject(By.desc("聚落世界"))?.visibleBounds)
                report.put("pinchStartBootNs",began.toString()).put("pinchEndBootNs",ended.toString())
            }else if(action=="resume"){
                val before=android.graphics.Rect();checkNotNull(world()).getBoundsInScreen(before)
                device.pressHome();SystemClock.sleep(1200)
                val began=SystemClock.elapsedRealtimeNanos();shell("am start -W -n $pkg/.MainActivity")
                val resumed=until(20000){world()?.stateDescription?.toString()=="世界已就绪"}
                val after=android.graphics.Rect();checkNotNull(world()).getBoundsInScreen(after)
                assertEquals(before,after);report.put("resumeWorldMs",(resumed-began)/1e6)
                try {
                    assertTrue(device.openNotification())
                    until(5000){device.currentPackageName=="com.android.systemui"}
                    val dismissed=SystemClock.elapsedRealtimeNanos()
                    shell("cmd statusbar collapse")
                    val available=until(10000){device.currentPackageName==pkg&&world()?.stateDescription?.toString()=="世界已就绪"}
                    // ColorOS returns accessibility focus before SystemUI stops
                    // intercepting touches. Check the input window independently.
                    val shadeWindow=Regex("""name=[^,]*NotificationShade,.*touchableRegion=\[""")
                    val deadline=SystemClock.elapsedRealtime()+5000
                    while (shell("dumpsys input").lineSequence().any(shadeWindow::containsMatchIn)) {
                        check(SystemClock.elapsedRealtime()<deadline) { "Notification shade still owns the touch region" }
                        SystemClock.sleep(20)
                    }
                    val inputReady=SystemClock.elapsedRealtimeNanos()
                    val again=android.graphics.Rect();checkNotNull(world()).getBoundsInScreen(again)
                    report.put("shadeDismissBootNs",dismissed.toString()).put("shadeWorldMs",(available-dismissed)/1e6)
                        .put("shadeInputReadyMs",(inputReady-dismissed)/1e6)
                        .put("firstShadeBounds",again.toShortString())
                    assertTrue(again.width()>100&&again.height()>100)
                    val x=again.left+again.width()/3
                    val y=again.top+again.height()/3
                    val swiping=SystemClock.elapsedRealtimeNanos()
                    assertTrue(device.swipe(x,y,again.right-again.width()/3,y,45))
                    report.put("afterShadeSwipeStartBootNs",swiping.toString())
                        .put("afterShadeSwipeEndBootNs",SystemClock.elapsedRealtimeNanos().toString())
                    val settled=until(10000){
                        val bounds=android.graphics.Rect()
                        world()?.getBoundsInScreen(bounds)
                        bounds==before
                    }
                    report.put("shadeBoundsConfirmedMs",(settled-dismissed)/1e6)
                } finally {shell("cmd statusbar collapse")}
            }
            report.put("pid",shell("pidof $pkg")).put("completed",true)
        }catch(error:Throwable){report.put("failure",error.javaClass.simpleName+": "+error.message);throw error}
        finally {
            if(!report.optBoolean("completed"))runCatching{
                val file=instrumentation.context.filesDir.resolve("p4-failure-$label.xml")
                file.outputStream().use{device.dumpWindowHierarchy(it)}
                device.takeScreenshot(instrumentation.context.filesDir.resolve("p4-failure-$label.png"))
            }
            config.waitForIdleTimeout=idle
            instrumentation.sendStatus(2,Bundle().apply{putString("p4Workspace",report.toString())})
        }
    }
}
