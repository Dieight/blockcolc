package com.blockcolc.world.filament

import org.json.JSONObject
import java.io.File
import kotlin.math.PI

/** Preview-only, bounded camera workload. SurfaceFlinger fences are collected
 * separately; submittedFrames is deliberately not called displayed FPS. */
internal class OrbitMeasurement(private val file:File,private val runId:String,private val fixture:String,
                                private val camera:JSONObject,private val dynamicRuntime:Boolean,private val profile:String,
                                private val diagnostics:()->JSONObject) {
    private var startNs=0L;private var beginNs=0L;private var submittedFrames=0
    private var before:JSONObject?=null
    var completed=false;private set
    init {require(runId.matches(Regex("[a-z0-9-]{1,80}")))}
    fun angle(now:Long):Double {
        if(startNs==0L)startNs=now
        if(beginNs==0L&&now-startNs>=3_000_000_000L){before=diagnostics();beginNs=System.nanoTime()}
        return if(beginNs==0L)0.0 else ((now-beginNs)/10e9).coerceIn(0.0,1.0)*2*PI
    }
    fun presentedSubmit(now:Long,focused:Boolean):Boolean {
        if(beginNs==0L||completed)return false
        submittedFrames++
        if(now-beginNs<10_000_000_000L)return false
        completed=true
        file.writeText(JSONObject().put("kind","p1-bounded-orbit").put("backend","OPENGL").put("runId",runId).put("fixture",fixture)
            .put("beginMonotonicNs",beginNs.toString()).put("endMonotonicNs",now.toString())
            .put("requestedDurationMs",10000).put("submittedFrames",submittedFrames).put("foregroundGuard",focused)
            .put("width",720).put("height",960).put("ratio",.55).put("pitch",PI/6).put("camera",camera)
            .put("before",before).put("after",diagnostics()).put("dynamicRuntime",dynamicRuntime).put("profile",profile)
            .put("scope",if(dynamicRuntime)"Matched dynamic world rotation; screen fences and complete process memory are collected separately, not whole-App startup" else "Frozen dynamic behavior, static negative control only")
            .put("p1GatePassed",false).toString())
        return true
    }
}
