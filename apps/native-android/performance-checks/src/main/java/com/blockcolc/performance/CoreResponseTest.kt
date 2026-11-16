package com.blockcolc.performance

import android.os.Bundle
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Observe only AFTER the host has sent its timed touch. This test never
 * launches the target or issues input, and cannot create a focus by itself. */
@RunWith(AndroidJUnit4::class)
class CoreResponseTest {
    @Test fun observeTheResultOfTheHostsSinglePhysicalTouch(){
        val instrumentation=InstrumentationRegistry.getInstrumentation();val args=InstrumentationRegistry.getArguments()
        val target="com.blockcolc.preview";val label=checkNotNull(args.getString("p3Case"))
        val touch=CoreTouch.from(args)
        require(label.matches(Regex("[a-z0-9-]{1,60}")))
        val expected=checkNotNull(args.getString("p3TargetSha"));require(expected.matches(Regex("[a-f0-9]{64}")))
        val automation=instrumentation.uiAutomation;val device=UiDevice.getInstance(instrumentation)
        fun shell(command:String)=android.os.ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(command))
            .use{it.bufferedReader(Charsets.UTF_8).readText().trim()}
        val app=instrumentation.context.packageManager.getApplicationInfo(target,0)
        assertEquals(0,app.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)
        val apk=shell("pm path $target").lineSequence().first().removePrefix("package:")
        require(apk.matches(Regex("[/A-Za-z0-9~_+=.\\-]+")))
        assertEquals(expected,shell("sha256sum $apk").split(Regex("\\s+")).first())
        val result=JSONObject().put("completed",false).put("caseLabel",label).put("targetSha256",expected)
            .put("action",touch.wire)
            .put("scope","Post-input observer only. No target launch or input is issued; host monotonic timing and stopped-process evidence are separate.")
        val config=Configurator.getInstance();val idle=config.waitForIdleTimeout;config.waitForIdleTimeout=0
        try{
            assertTrue("The host must have launched a live target",shell("pidof $target").isNotBlank())
            val until=SystemClock.elapsedRealtime()+5000;var accepted=false
            while(SystemClock.elapsedRealtime()<until&&!accepted){
                if(android.os.Build.VERSION.SDK_INT>=33)automation.clearCache()
                val response=device.findObject(touch.destination())
                accepted=response!=null&&response.isEnabled&&!response.visibleBounds.isEmpty
                if(!accepted)SystemClock.sleep(10)
            }
            result.put("actionAccepted",accepted).put("completed",true)
        }finally{
            config.waitForIdleTimeout=idle
            instrumentation.context.filesDir.resolve("core-response-$label.xml").outputStream().use{device.dumpWindowHierarchy(it)}
            shell("am force-stop $target")
            instrumentation.sendStatus(2,Bundle().apply{putString("p3CoreStartup",result.toString())})
        }
    }
}
