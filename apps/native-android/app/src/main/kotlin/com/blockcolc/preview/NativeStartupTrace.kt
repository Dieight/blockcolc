package com.blockcolc.preview

/** Bounded diagnostic spans. Production takes the direct path and publishes
 * normal Android fully-drawn timing, without experimental data or a sampler. */
object NativeStartupTrace {
    private data class Span(val id:Long,val stage:String,val thread:String,val start:Long,val end:Long)
    private val gate=Any()
    private val spans=ArrayDeque<Span>()
    private var sequence=0L
    @PublishedApi internal fun record(stage:String,start:Long,end:Long){
        if(!BuildConfig.NATIVE_DIAGNOSTICS)return
        synchronized(gate){
            if(spans.size==256)spans.removeFirst()
            spans.addLast(Span(++sequence,stage,Thread.currentThread().name,start,end))
        }
    }
    /** A bounded, metadata-only receipt. It survives logcat buffer rotation;
     * no documents, resource buffers or callbacks are retained. */
    internal fun cursor():Long=if(BuildConfig.NATIVE_DIAGNOSTICS)synchronized(gate){sequence}else 0
    internal fun since(cursor:Long):org.json.JSONArray {
        val result=org.json.JSONArray()
        if(BuildConfig.NATIVE_DIAGNOSTICS)synchronized(gate){
            for(span in spans)if(span.id>cursor)result.put(org.json.JSONObject()
                .put("id",span.id).put("stage",span.stage).put("thread",span.thread)
                .put("startBootNs",span.start.toString()).put("endBootNs",span.end.toString())
                .put("durationMs",(span.end-span.start)/1e6))
        }
        return result
    }
    inline fun <T> measure(stage:String,benchmark:Boolean=false,work:()->T):T {
        val diagnostic=BuildConfig.NATIVE_DIAGNOSTICS
        if(!diagnostic&&(!benchmark||BuildConfig.BUILD_TYPE!="benchmark"))return work()
        val start=android.os.SystemClock.elapsedRealtimeNanos()
        if(diagnostic)android.os.Trace.beginSection("blockcolc:$stage")
        try{return work()}finally{
            if(diagnostic)android.os.Trace.endSection()
            val end=android.os.SystemClock.elapsedRealtimeNanos()
            if(diagnostic)record(stage,start,end)
            android.util.Log.i("BlockcolcStartup","stage=$stage startNs=$start endNs=$end durationMs=${(end-start)/1e6}")
        }
    }
    /** Inclusive wall times for the first real focus command. No SQL, data,
     * user labels, sampling or command arguments are retained. */
    internal fun <T> measureFocusWrite(work:()->T):T = measurePipeline("focus-write",work){name->
        name.startsWith("storage.")||name=="domain.execute"||name=="recovery.validate"||name=="json.sha"
    }
    internal fun <T> measureInitialRead(work:()->T):T = if(BuildConfig.BUILD_TYPE!="benchmark")work() else measurePipeline("first-read",work){name->
        name.startsWith("storage.")||name.startsWith("checkpoint.")||name=="blueprint.parallel-proof"||
            name=="blueprint.stream-validate"||name=="domain.validate"||name.startsWith("json.")
    }
    private fun <T> measurePipeline(label:String,work:()->T,include:(String)->Boolean):T {
        val totals=linkedMapOf<String,Long>()
        return try{
            com.blockcolc.domain.PipelineCost.collect({name,start,end,_->
                if(include(name))totals[name]=(totals[name]?:0)+end-start
            },work)
        }finally{
            val timings=org.json.JSONObject(totals.mapValues{it.value/1e6})
            android.util.Log.i("BlockcolcStartup","$label=$timings")
        }
    }
    // Benchmark uses only these existing low-frequency lifecycle receipts;
    // full spans, buffers and diagnostic routes remain disabled. The user
    // release removes this branch as well as the loading comparison extras.
    fun point(stage:String){if(BuildConfig.NATIVE_DIAGNOSTICS||BuildConfig.BUILD_TYPE=="benchmark")android.util.Log.i("BlockcolcStartup","point=$stage atNs=${android.os.SystemClock.elapsedRealtimeNanos()}")}
}
