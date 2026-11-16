package com.blockcolc.preview

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.*
import java.io.ByteArrayInputStream
import java.io.File
import org.json.JSONObject

/** Same-device production reference inside this one preview, never the formal database. */
class ReferenceWorldView(context:Context,fixture:String,profile:String,benchmarkRun:String?,skyProbe:Boolean,moonProbe:Boolean,runtime:Boolean,animalProbe:String?,private val p2Run:String?=null,private val businessReport:((JSONObject)->Unit)?=null,private val status:(String)->Unit):WebView(context) {
    private val main=Handler(Looper.getMainLooper())
    @Volatile private var closed=false
    @Volatile private var focused=false
    private val fixtureName=com.blockcolc.world.WorldFixtures.requireName(fixture)
    init {
        require(profile in setOf("day","night","rain","snow"))
        settings.javaScriptEnabled=true;settings.domStorageEnabled=p2Run!=null;settings.allowFileAccess=false;settings.allowContentAccess=false
        webViewClient=object:WebViewClient(){
            override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse {
                val uri=request.url;val name=uri.path?.removePrefix("/")?:return blocked()
                if(uri.scheme!="https"||uri.host!="p1.blockcolc.invalid"||!name.startsWith("web/")||name.contains("..")||name.contains('\\'))return blocked()
                if(name=="web/frozen-camera-$fixtureName.json")return try{
                    val text=context.assets.open("$fixtureName.world.json").bufferedReader().use{it.readText()};require(text.length<=16*1024*1024)
                    val input=JSONObject(text)
                    val frozen=JSONObject().put("camera",input.getJSONObject("camera"))
                    input.optJSONObject("resourcePack")?.let{frozen.put("resourcePack",it)}
                    input.optJSONObject("animalRuntime")?.let{frozen.put("animalRuntime",it)}
                    WebResourceResponse("application/json","UTF-8",ByteArrayInputStream(frozen.toString().toByteArray(Charsets.UTF_8)))
                }catch(_:Exception){blocked()}
                if(name=="web/controlled-resource-pack.json")return try{
                    WebResourceResponse("application/json","UTF-8",context.assets.open("resource-pack.json"))
                }catch(_:java.io.IOException){blocked()}
                if(name=="web/p2-fixture-domain.json"&&p2Run!=null)return WebResourceResponse("application/json","UTF-8",context.assets.open("p2-fixture-domain.json"))
                return try{WebResourceResponse(when{
                    name.endsWith(".html")->"text/html";name.endsWith(".js")->"application/javascript"
                    name.endsWith(".png")->"image/png";name.endsWith(".json")->"application/json";else->"application/octet-stream"
                },"UTF-8",context.assets.open(name))}catch(_:java.io.IOException){blocked()}
            }
            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest)=request.url.host!="p1.blockcolc.invalid"
        }
        addJavascriptInterface(object{
            @JavascriptInterface fun foreground()=focused&&!closed
            @JavascriptInterface fun monotonicNs()=System.nanoTime().toString()
            @JavascriptInterface fun save(raw:String){
                require(raw.length<=if(p2Run==null)65536 else 2*1024*1024);val report=JSONObject(raw)
                require(report.getString("fixture")==fixtureName)
                if(p2Run!=null){
                    require(report.getString("runId")==p2Run)
                    File(context.filesDir,"p2-cost-$p2Run.json").writeText(raw)
                    main.post{if(!closed)businessReport?.invoke(report)};return
                }
                val run=report.optString("runId")
                require(run.isEmpty()||run.matches(Regex("[a-z0-9-]{1,80}")))
                File(context.filesDir,if(run.isEmpty())"p1-web-$fixtureName.json" else "p1-orbit-$run.json").writeText(raw)
                main.post{if(!closed)status(when{
                    report.has("failed")->"ERROR: reference: "+report.getString("failed")
                    run.isNotEmpty()->"Reference orbit completed · $fixtureName"
                    report.optBoolean("updated")->"Reference owner-check submitted · $fixtureName"
                    report.optBoolean("sampled")->"Reference runtime sampled · $fixtureName"
                    else->"Reference submitted · $fixtureName"
                })}
            }
        },"P1Reference")
        require(benchmarkRun==null||benchmarkRun.matches(Regex("[a-z0-9-]{1,80}")))
        require(p2Run==null||p2Run.matches(Regex("[a-z0-9-]{1,80}")))
        val entry=if(p2Run==null)"reference.html" else "p2-reference.html"
        loadUrl("https://p1.blockcolc.invalid/web/apps/native-android/tools/$entry?fixture=$fixtureName&profile=$profile&skyProbe=$skyProbe&moonProbe=$moonProbe&runtime=$runtime"+(benchmarkRun?.let{"&benchmarkRun=$it"}?:"")+(animalProbe?.let{"&animalProbe=$it"}?:"")+(p2Run?.let{"&p2Run=$it"}?:""))
    }
    private fun blocked()=WebResourceResponse("text/plain","UTF-8",404,"Not found",emptyMap(),ByteArrayInputStream(ByteArray(0)))
    override fun onWindowFocusChanged(value:Boolean){super.onWindowFocusChanged(value);focused=value}
    fun updateOwner(){evaluateJavascript("window.p1ReferenceUpdate?.()",null)}
    fun sampleRuntime(){evaluateJavascript("window.p1ReferenceSample?.()",null)}
    fun businessAction(action:String,inputNs:Long,at:Long){
        check(p2Run!=null);require(action in setOf("start","early","report","stats"))
        evaluateJavascript("window.p2CostAction("+JSONObject.quote(action)+","+JSONObject.quote(inputNs.toString())+","+at+")",null)
    }
    fun close(){if(closed)return;closed=true;stopLoading();removeJavascriptInterface("P1Reference");destroy()}
}
