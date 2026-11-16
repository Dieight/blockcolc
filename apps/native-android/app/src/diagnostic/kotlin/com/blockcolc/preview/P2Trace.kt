package com.blockcolc.preview

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.FrameMetrics
import android.view.Window
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/** Isolated-preview diagnostics, never included in a formal/private release. */
object P2Trace {
    private val writer=Executors.newSingleThreadExecutor{r->Thread(r,"blockcolc-p2-trace")}
    private var run:String?=null;private var app:Context?=null;private var started=0L;private var startedMonotonic=0L
    private val events=arrayListOf<Pair<String,Long>>()
    private val frames=arrayListOf<Double>()
    @Synchronized fun begin(context:Context,id:String?){
        require(id==null||id.matches(Regex("[a-z0-9-]{1,80}")))
        run=id;app=context.applicationContext;started=SystemClock.elapsedRealtimeNanos();startedMonotonic=System.nanoTime();events.clear();frames.clear()
        event("activity-create",started)
    }
    @Synchronized fun event(name:String,at:Long=SystemClock.elapsedRealtimeNanos()){
        if(run==null)return
        if(events.none{it.first==name})events.add(name to at)
        flush()
    }
    @Synchronized fun frame(duration:Long){if(run==null)return;if(frames.size<2000)frames.add(duration/1e6);if(frames.size%20==0)flush()}
    @Synchronized fun flush(){
        val id=run?:return;val context=app?:return
        val data=JSONObject().put("run",id).put("startedElapsedNs",started).put("startedMonotonicNs",startedMonotonic)
            .put("processStartElapsedMs",if(Build.VERSION.SDK_INT>=24)android.os.Process.getStartElapsedRealtime()else JSONObject.NULL)
            .put("events",JSONArray(events.map{JSONObject().put("name",it.first).put("elapsedMs",(it.second-started)/1e6).put("boottimeNs",it.second)}))
            .put("uiFrameDurationsMs",JSONArray(frames)).put("scope","P2 isolated process, real SQLite and active world; render submission is not screen presentation")
        val text=data.toString();writer.execute{val file=android.util.AtomicFile(File(context.filesDir,"p2-startup-$id.json"));val stream=file.startWrite();try{stream.write(text.toByteArray());file.finishWrite(stream)}catch(e:Exception){file.failWrite(stream)}}
    }
    fun observe(activity:Activity):()->Unit {
        if(Build.VERSION.SDK_INT<24)return{}
        val thread=HandlerThread("blockcolc-p2-frames").apply{start()}
        val listener=Window.OnFrameMetricsAvailableListener{_,m,_->frame(m.getMetric(FrameMetrics.TOTAL_DURATION))}
        activity.window.addOnFrameMetricsAvailableListener(listener,Handler(thread.looper))
        return {activity.window.removeOnFrameMetricsAvailableListener(listener);flush();thread.quitSafely()}
    }
}
