package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/** One bounded snapshot if a UI method (including rule startup) takes 45 s.
 * This lives only in instrumentation and never samples a user preview. */
class P3UiWaitDiagnostics:TestWatcher(){
    private var executor:ScheduledExecutorService?=null
    override fun starting(description:Description){
        // UiAutomation connects before the Activity rule. Apply the requested
        // rotation through that same connection, then measure the real window
        // in the test; a shell settings write can be superseded on connection.
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        when(InstrumentationRegistry.getArguments().getString("p3ExpectedOrientation")){
            "landscape"->androidx.test.uiautomator.UiDevice.getInstance(instrumentation).setOrientationLeft()
            "portrait"->androidx.test.uiautomator.UiDevice.getInstance(instrumentation).setOrientationNatural()
        }
        executor=Executors.newSingleThreadScheduledExecutor{r->Thread(r,"p3-ui-wait-record").apply{isDaemon=true}}.also{worker->worker.schedule({
            runCatching{
                val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
                val label=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
                require(label.matches(Regex("[a-z0-9-]{1,60}")))
                val threads=Thread.getAllStackTraces().entries.filter{(thread,frames)->
                    thread.name=="main"||thread.name.startsWith("Instr:")||thread.name.startsWith("blockcolc-")||frames.any{it.className.startsWith("androidx.test.")}
                }.sortedBy{if(it.key.name=="main")"0"else it.key.name}.take(16)
                val rows=JSONArray();threads.forEach{(thread,frames)->rows.put(JSONObject().put("name",thread.name).put("state",thread.state.name)
                    .put("frames",JSONArray(frames.take(60).map{it.toString()})))}
                val file=File(context.filesDir,"p3-world-ui-wait.json")
                val previous=runCatching{JSONObject(file.readText())}.getOrNull()?.takeIf{it.optString("caseLabel")==label}
                val records=previous?.optJSONArray("waits")?:JSONArray()
                if(records.length()<8)records.put(JSONObject().put("method",description.methodName).put("threads",rows))
                file.writeText(JSONObject().put("schema",1).put("caseLabel",label).put("waits",records).toString())
                val bitmap=instrumentation.uiAutomation.takeScreenshot()
                if(bitmap!=null)try{File(context.filesDir,"p3-pages-$label-ui-wait-${UUID.randomUUID()}.png").outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}}finally{bitmap.recycle()}
            }
        },45,TimeUnit.SECONDS)}
    }
    override fun finished(description:Description){executor?.shutdownNow();executor=null}
}
