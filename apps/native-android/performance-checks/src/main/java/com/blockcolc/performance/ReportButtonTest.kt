package com.blockcolc.performance

import android.os.Bundle
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.StaleObjectException
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.regex.Pattern
import java.io.File

/** The measured application has no test bridge. Fixtures are prepared before
 * installing it; this process only launches it and uses visible user controls. */
@RunWith(AndroidJUnit4::class)
class ReportButtonTest {
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val device get()=UiDevice.getInstance(instrumentation)
    private val target="com.blockcolc.preview"
    private fun shell(command:String)=device.executeShellCommand(command).trim()
    private fun find(selector:BySelector,timeout:Long=20000):UiObject2 {
        val until=SystemClock.elapsedRealtime()+timeout
        while(SystemClock.elapsedRealtime()<until){device.findObject(selector)?.let{return it};SystemClock.sleep(20)}
        throw AssertionError("Visible control not found: $selector")
    }
    private fun delivery(report:JSONObject,debug:Boolean):Long {
        val started=SystemClock.elapsedRealtime()
        val until=started+30000
        var nextDump=0L
        while(SystemClock.elapsedRealtime()<until){
            // A disabled button changes its text without an input/focus
            // event. Refresh the accessibility root rather than accepting a
            // cached pre-submission hierarchy throughout the short receipt.
            if(android.os.Build.VERSION.SDK_INT>=33)assertTrue(instrumentation.uiAutomation.clearCache())
            else instrumentation.uiAutomation.rootInActiveWindow?.refresh()
            val label=device.findObject(By.textStartsWith("材料已送达"))
            if(label!=null){
                val observed=SystemClock.elapsedRealtimeNanos()
                val rendered=label.text
                report.put("deliveryRenderedText",rendered)
                assertEquals("材料已送达！",rendered)
                return observed
            }
            if(debug&&SystemClock.elapsedRealtime()-started<5000&&SystemClock.elapsedRealtime()>=nextDump){
                val name="delivery-"+SystemClock.elapsedRealtime()+".xml"
                File(instrumentation.context.filesDir,name).outputStream().use{device.dumpWindowHierarchy(it)}
                nextDump=SystemClock.elapsedRealtime()+300
            }
            SystemClock.sleep(20)
        }
        throw AssertionError("The saved delivery was not exposed to accessibility")
    }
    @android.annotation.TargetApi(30)
    private fun currentWorld(report:JSONObject):Long {
        check(android.os.Build.VERSION.SDK_INT>=30)
        val until=SystemClock.elapsedRealtime()+180000
        while(SystemClock.elapsedRealtime()<until){
            if(android.os.Build.VERSION.SDK_INT>=33)assertTrue(instrumentation.uiAutomation.clearCache())
            val pending=java.util.ArrayDeque<android.view.accessibility.AccessibilityNodeInfo>()
            instrumentation.uiAutomation.rootInActiveWindow?.let{pending.add(it)}
            while(pending.isNotEmpty()){
                val node=pending.removeFirst()
                if(node.contentDescription?.toString()=="聚落世界"){
                    val state=node.stateDescription?.toString();report.put("worldRenderedState",state)
                    if(state=="世界已就绪")return SystemClock.elapsedRealtimeNanos()
                }
                for(index in 0 until node.childCount)node.getChild(index)?.let{pending.add(it)}
            }
            SystemClock.sleep(20)
        }
        throw AssertionError("The requested scene never acknowledged its own presentation")
    }
    private fun tap(selector:BySelector){
        val bounds=find(selector).visibleBounds
        assertFalse("The requested user control is offscreen",bounds.isEmpty)
        shell("input tap ${bounds.centerX()} ${bounds.centerY()}")
        SystemClock.sleep(150) // Setup only; never included in the measured tap.
    }
    private fun scrollTo(selector:BySelector):UiObject2 {
        repeat(35){
            try{device.findObject(selector)?.takeIf{it.visibleBounds.height()>0}?.let{return it}}
            catch(_:StaleObjectException){SystemClock.sleep(20);return@repeat}
            device.swipe(device.displayWidth/2,device.displayHeight*4/5,device.displayWidth/2,device.displayHeight*2/5,25)
            SystemClock.sleep(150)
        }
        throw AssertionError("Control was not reachable in the report: $selector")
    }
    private fun projectDisclosure(title:String,open:Boolean) {
        val text=scrollTo(By.text(title))
        val row=if(text.isClickable)text else checkNotNull(text.parent)
        assertTrue("The project header must expose an enabled disclosure row",row.isClickable&&row.isEnabled)
        val next=By.text(if(open)"收起" else "展开")
        val bounds=row.visibleBounds
        assertFalse("The project disclosure must be on screen",bounds.isEmpty)
        shell("input tap ${bounds.centerX()} ${bounds.centerY()}")
        // Read the new state before starting a drag. A missed tap on a
        // moving panel must not be reported as a missing progress option.
        find(next,2500)
        SystemClock.sleep(250)
    }
    private fun thermal():Int {
        val raw=shell("dumpsys battery")
        return Regex("(?m)^\\s*temperature:\\s*(\\d+)").find(raw)?.groupValues?.get(1)?.toInt()?:error("No battery temperature")
    }
    private fun awaitVisibleReport(){
        val deadline=SystemClock.elapsedRealtime()+180000
        while(SystemClock.elapsedRealtime()<deadline){
            assertFalse("The world failed before the sample; this is not a usable performance case",device.hasObject(By.text("世界暂未准备好")))
            if (device.hasObject(By.textContains("轮专注已结束"))) {
                currentWorld(JSONObject())
                return
            }
            SystemClock.sleep(50)
        }
        throw AssertionError("The real report and world did not finish loading")
    }
    @Test fun realReportButtonInTheOptimizedApplicationSavesAndReturnsToTheWorkbench(){
        val args=InstrumentationRegistry.getArguments()
        val label=checkNotNull(args.getString("p3Group"));require(label.matches(Regex("[a-z0-9-]{1,60}")))
        val title=checkNotNull(args.getString("p3ProjectTitle"))
        val expectedSha=checkNotNull(args.getString("p3TargetSha"));require(expectedSha.matches(Regex("[a-f0-9]{64}")))
        val model=android.os.Build.MODEL
        val emulator=android.os.Build.FINGERPRINT.contains("generic")||model.contains("sdk")
        val functionalOnly=args.getString("p3FunctionalOnly")=="1"
        val debugDelivery=args.getString("p3DebugDelivery")=="1"
        assertTrue("Diagnostic hierarchy capture is not a performance sample",!debugDelivery||functionalOnly)
        assertTrue("Emulators can check the harness, not phone performance",!emulator||functionalOnly)
        val info=instrumentation.context.packageManager.getApplicationInfo(target,0)
        assertEquals("The measured preview must not be debuggable",0,info.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)
        val remote=shell("pm path $target").lineSequence().first().removePrefix("package:")
        // UiAutomation executes an argument string rather than a shell script;
        // shell quotes would become literal characters in this filename.
        require(remote.startsWith("/data/app/")&&remote.endsWith("/base.apk")&&remote.matches(Regex("[/A-Za-z0-9~_+=.\\-]+")))
        assertEquals(expectedSha,shell("sha256sum $remote").split(Regex("\\s+")).first())
        val report=JSONObject().put("completed",false).put("caseLabel",label).put("model",model).put("targetSha256",expectedSha)
            .put("functionalOnly",functionalOnly).put("observationSleepMs",20)
            .put("scope","Actual pointer tap in a separate process against the optimized, non-debuggable preview. Saved delivery, normal workbench and the world accessibility state after its own scene GPU acknowledgement are observed separately. No exact SurfaceFlinger presentation timestamp or actor-only timing claim.")
        val config=Configurator.getInstance();val idle=config.waitForIdleTimeout
        config.waitForIdleTimeout=0
        try{
            val before=thermal();report.put("temperatureBeforeDeciC",before)
            if(!functionalOnly)assertTrue("Outside the measured thermal range",before in 1 until 380)
            val launch=shell("am start -W -n $target/.MainActivity");assertFalse(launch.contains("Error:"))
            awaitVisibleReport();report.put("initialWorldReady",true)
            SystemClock.sleep(1800) // Setup only, after the first frame and its opening motion.
            projectDisclosure(title,true)
            val progress=By.text(Pattern.compile("推进至\\s*50%"))
            scrollTo(progress);tap(progress)
            repeat(3){tap(By.desc("增加轮数"))}
            // Collapse via the real control, then inspect the summary. Scrolling
            // a tall expanded row while it is still changing creates stale
            // accessibility objects and can inject gestures into its options.
            projectDisclosure(title,false)
            scrollTo(By.text("一次提交本次推进"))
            val assigned=By.textStartsWith("已分配")
            val assignedText=scrollTo(assigned).text
            report.put("assignedRenderedText",assignedText)
            assertEquals("已分配3/3轮·未分配0",assignedText.filterNot{it.isWhitespace()||it=='\u00a0'})
            val submit=find(By.text("一次提交本次推进"));assertTrue(submit.isEnabled)
            val submitBounds=submit.visibleBounds
            // Timestamp directly around the injected input, with no target
            // runtime call, domain command or diagnostic queue on this path.
            val input=SystemClock.elapsedRealtimeNanos();assertTrue(device.click(submitBounds.centerX(),submitBounds.centerY()))
            val inputReturned=SystemClock.elapsedRealtimeNanos()
            report.put("inputBootNs",input.toString()).put("inputReturnedBootNs",inputReturned.toString())
            val delivered=delivery(report,debugDelivery)
            report.put("deliveredObservedBootNs",delivered.toString()).put("tapToDeliveredMs",(delivered-input)/1e6)
            val ready=find(By.text("调整"),180000);assertTrue(ready.isEnabled)
            // World tools intentionally fade out. The retained tools are not
            // a receipt for the requested scene; use its accessibility state.
            assertFalse("The returned world must not be a failed scene",device.hasObject(By.text("世界暂未准备好")))
            assertFalse("The returned world must have finished replacing its scene",device.hasObject(By.text("正在建造世界")))
            val returned=SystemClock.elapsedRealtimeNanos()
            val worldAcknowledged=currentWorld(report)
            val after=thermal();report.put("temperatureAfterDeciC",after)
            if(!functionalOnly)assertTrue("The sample heated outside its thermal range",after in 1 until 380)
            report.put("inputBootNs",input.toString()).put("inputReturnedBootNs",inputReturned.toString())
                .put("deliveredObservedBootNs",delivered.toString()).put("workbenchObservedBootNs",returned.toString())
                .put("tapToDeliveredMs",(delivered-input)/1e6).put("tapToWorkbenchMs",(returned-input)/1e6)
                .put("worldAcknowledgedObservedBootNs",worldAcknowledged.toString()).put("tapToWorldAcknowledgedMs",(worldAcknowledged-input)/1e6)
                .put("allocatedRounds",3).put("selectedProgressBasisPoints",5000).put("completed",true)
        }finally{
            File(instrumentation.context.filesDir,"report-ui-$label.xml").outputStream().use{device.dumpWindowHierarchy(it)}
            config.waitForIdleTimeout=idle
            instrumentation.sendStatus(2,Bundle().apply{putString("p3Performance",report.toString())})
        }
    }
}
