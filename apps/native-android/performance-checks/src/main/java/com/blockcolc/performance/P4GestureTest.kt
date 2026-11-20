package com.blockcolc.performance

import android.app.UiAutomation
import android.os.Bundle
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Identical physical input for the already-ready TS reference and native App.
 * The host verifies each real world first; this observer neither starts it nor
 * rewrites a camera, setting, task, clock, or world. */
@RunWith(AndroidJUnit4::class)
class P4GestureTest {
    @Test fun rotateTheAlreadyReadyWorld() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val args=InstrumentationRegistry.getArguments()
        val device=UiDevice.getInstance(instrumentation)
        val pkg=checkNotNull(args.getString("p4Package"))
        val expected=checkNotNull(args.getString("p4TargetSha"))
        val bounds=checkNotNull(args.getString("p4Bounds"))
        val timed=args.getString("p4Input")?.let{require(it=="timed");true}?:false
        require(pkg in setOf("com.blockcolc.preview","com.blockcolc.reference"))
        require(expected.matches(Regex("[a-f0-9]{64}"))&&bounds.matches(Regex("[0-9]{1,5}(,[0-9]{1,5}){3}")))
        val box=bounds.split(',').map(String::toInt)
        require(box[0]>=0&&box[1]>=0&&box[2]<=device.displayWidth&&box[3]<=device.displayHeight&&box[2]-box[0]>100&&box[3]-box[1]>100)
        val info=instrumentation.context.packageManager.getApplicationInfo(pkg,0)
        assertEquals(0,info.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)
        require(info.sourceDir.matches(Regex("[/A-Za-z0-9~_+=.\\-]+")))
        assertEquals(expected,device.executeShellCommand("sha256sum ${info.sourceDir}").trim().split(Regex("\\s+")).first())
        assertEquals(pkg,device.currentPackageName)
        val config=Configurator.getInstance();val idle=config.waitForIdleTimeout;config.waitForIdleTimeout=0
        val report=JSONObject().put("completed",false).put("package",pkg).put("sha256",expected).put("bounds",bounds)
            .put("input",if(timed)"784ms at 8ms cadence"else"UiDevice 45 steps")
            .put("scope","Six alternating touchscreen swipes and 250ms pauses. Already-ready real world; external input only. System presentation is captured separately.")
        try {
            report.put("gestureStartBootNs",SystemClock.elapsedRealtimeNanos().toString())
            val left=box[0]+(box[2]-box[0])/3;val right=box[2]-(box[2]-box[0])/3;val y=box[1]+(box[3]-box[1])/3
            val sweeps=JSONArray()
            repeat(6){i->
                val from=if(i%2==0)left else right
                val to=if(i%2==0)right else left
                val start=SystemClock.elapsedRealtimeNanos()
                val swipe=if(timed)timedSwipe(instrumentation.uiAutomation,from,to,y)else{
                    assertTrue(device.swipe(from,y,to,y,45))
                    JSONObject()
                }
                sweeps.put(swipe.put("startBootNs",start.toString()).put("endBootNs",SystemClock.elapsedRealtimeNanos().toString()))
                SystemClock.sleep(250)
            }
            report.put("swipes",sweeps)
            report.put("gestureEndBootNs",SystemClock.elapsedRealtimeNanos().toString()).put("completed",true)
        }finally{config.waitForIdleTimeout=idle;instrumentation.sendStatus(2,Bundle().apply{putString("p4Gesture",report.toString())})}
    }

    private fun timedSwipe(automation:UiAutomation,from:Int,to:Int,y:Int):JSONObject {
        val steps=98
        val periodMs=8L
        val down=SystemClock.uptimeMillis()
        val sent=JSONArray()
        var x=from.toFloat()
        fun inject(action:Int,eventTime:Long):Boolean {
            val event=MotionEvent.obtain(down,eventTime,action,x,y.toFloat(),0)
            return try {
                event.source=InputDevice.SOURCE_TOUCHSCREEN
                automation.injectInputEvent(event,false)
            }finally{event.recycle()}
        }
        var released=false
        try {
            for(step in 0..steps){
                val deadline=down+step*periodMs
                val waitMs=deadline-SystemClock.uptimeMillis()
                if(waitMs>0)SystemClock.sleep(waitMs)
                val now=SystemClock.uptimeMillis()
                x=from+(to-from)*(step.toFloat()/steps)
                val action=when(step){0->MotionEvent.ACTION_DOWN;steps->MotionEvent.ACTION_UP;else->MotionEvent.ACTION_MOVE}
                assertTrue("Gesture input rejected at step $step",inject(action,now))
                sent.put(now-down)
            }
            released=true
            return JSONObject().put("inputOffsetsMs",sent)
        }finally{
            if(!released)inject(MotionEvent.ACTION_CANCEL,SystemClock.uptimeMillis())
        }
    }
}
