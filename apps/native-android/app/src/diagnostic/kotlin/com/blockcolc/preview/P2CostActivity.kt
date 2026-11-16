package com.blockcolc.preview

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.blockcolc.domain.*
import com.blockcolc.focus.*
import com.blockcolc.storage.*
import com.blockcolc.world.WorldFixtures
import com.blockcolc.world.filament.NativeWorldView
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Bounded integrated cost route in the isolated debug preview, not the final App shell. */
class P2CostActivity:ComponentActivity(){
    private val main=Handler(Looper.getMainLooper())
    private val worker=Executors.newSingleThreadExecutor()
    private var nativeWorld:NativeWorldView?=null;private var web:ReferenceWorldView?=null
    private val runtime by lazy{PreviewRuntime.get(this)}
    private var phase by mutableStateOf("IDLE");private var ready by mutableStateOf(false)
    private var busy by mutableStateOf(false);private var message by mutableStateOf("准备同条件世界")
    private var sequence by mutableIntStateOf(0)
    private var data=JSONObject();private var fixture="ocean";private var run="";private var backend=""
    private var domain:DomainDocument?=null;private val operations=JSONArray()
    private var busyInput:Long?=null;private var busyFrame:Long?=null
    private val uiFrames=JSONArray()
    private var created=0L
    private fun save(){
        if(backend=="native")data.put("operations",operations)
        data.put("phase",phase).put("sequence",sequence).put("ready",ready).put("commonUiFrames",uiFrames).put("activityCreatedNs",created.toString())
        val atomic=android.util.AtomicFile(File(filesDir,"p2-cost-$run.json"));val stream=atomic.startWrite()
        try{stream.write(data.toString().toByteArray());atomic.finishWrite(stream)}catch(e:Exception){atomic.failWrite(stream);throw e}
    }
    override fun onCreate(savedInstanceState:Bundle?){
        super.onCreate(savedInstanceState);check(BuildConfig.DEBUG)
        created=System.nanoTime();fixture=WorldFixtures.requireName(intent.getStringExtra("fixture")?:"ocean")
        run=intent.getStringExtra("costRun")!!;require(run.matches(Regex("[a-z0-9-]{1,80}")))
        backend=intent.getStringExtra("costBackend")!!;require(backend in setOf("native","web"))
        data=JSONObject().put("kind","p2-integrated-cost").put("backend",backend).put("fixture",fixture).put("runId",run)
            .put("startedNs",created.toString()).put("completed",false).put("width",720).put("height",960).put("timingSchema",2)
            .put("scope","Shared Compose controls; actual P2 actor/SQLite/Filament versus formal ApplicationService/IndexedDB/Three. First-workshop prepared cache; not whole final App or general native world generation.")
        if(backend=="native")worker.execute{
            try{
                val begin=System.nanoTime();val initial=runtime.testRead().get(45,TimeUnit.SECONDS).domain
                runtime.testRecording(true).get(45,TimeUnit.SECONDS);domain=initial
                main.post{data.put("initial",initial.canonical).put("loadStartNs",begin.toString()).put("databaseReadyNs",System.nanoTime().toString());save()}
            }catch(e:Exception){fail(e)}
        }
        setContent{MaterialTheme{
            LaunchedEffect(busyInput){val input=busyInput;if(input!=null){withFrameNanos{};busyFrame=System.nanoTime();uiFrames.put(JSONObject().put("kind","busy").put("inputNs",input.toString()).put("frameNs",busyFrame.toString()));save()}}
            LaunchedEffect(phase,sequence,ready){if(ready){withFrameNanos{};uiFrames.put(JSONObject().put("kind","saved-state").put("sequence",sequence).put("phase",phase).put("frameNs",System.nanoTime().toString()));save()}}
            Column(Modifier.fillMaxSize().background(Color(0xffedf1ee)).windowInsetsPadding(WindowInsets.safeDrawing)){
                Text("P2 · $backend · $fixture",Modifier.height(32.dp));Text(message,Modifier.height(28.dp))
                if(backend=="native")AndroidView(factory={ctx->NativeWorldView(ctx,fixture,false,true,true,true,false,true,true,true,true,false,false,null,null,false,false,initialConstruction=0){status->
                    if(status.startsWith("ERROR"))fail(IllegalStateException(status))
                    if(status.startsWith("P1 submitted")){ready=true;message="世界就绪";data.put("worldSubmittedNs",System.nanoTime().toString());nativeWorld?.sampleRuntime();save()}
                }.also{nativeWorld=it;it.resume()}},modifier=Modifier.fillMaxWidth().aspectRatio(.75f),onRelease={it.close()})
                else AndroidView(factory={ctx->ReferenceWorldView(ctx,fixture,"day",null,false,false,true,null,p2Run=run,businessReport={report->
                    data=report
                    if(report.has("failed")){message="ERROR: "+report.getString("failed");busy=false}
                    else{ready=report.optBoolean("ready");phase=report.getString("phase");sequence=report.getInt("sequence");busy=false;busyInput=null;message=if(report.optBoolean("completed"))"统计已保存" else "世界就绪"}
                }){} .also{web=it}},modifier=Modifier.fillMaxWidth().aspectRatio(.75f),onRelease={it.close()})
                Text("$phase · $sequence",Modifier.height(32.dp).semantics{contentDescription="cost-phase"})
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceEvenly){
                    for((action,title)in listOf("start" to "开始专注","early" to "提前完成","report" to "提交推进","stats" to "统计")){
                        val enabled=ready&&!busy&&when(action){"start"->phase in setOf("IDLE","READY");"early"->phase=="FOCUS";"report"->phase=="REPORT";else->phase=="DONE"}
                        Button(onClick={act(action)},enabled=enabled,modifier=Modifier.weight(1f).padding(horizontal=2.dp).semantics{contentDescription="cost-$action"},contentPadding=PaddingValues(4.dp)){Text(if(busy)"…"else title,maxLines=1,style=MaterialTheme.typography.labelSmall)}
                    }
                }
            }
        }}
    }
    private fun fail(error:Throwable){main.post{message="ERROR: "+error.toString();busy=false;data.put("failed",error.toString());save()}}
    private fun act(action:String){
        check(!busy&&ready);val input=System.nanoTime();busy=true;busyInput=input;busyFrame=null
        val seq=sequence;val at=intent.getLongExtra("businessBase",0)+seq*1000L;require(at>System.currentTimeMillis())
        if(backend=="web"){web!!.businessAction(action,input,at);return}
        worker.execute{
            try{
                val op=JSONObject().put("action",action).put("sequence",seq).put("inputNs",input.toString())
                val timing=P2OperationCost()
                val outcome=if(action=="stats")null else runtime.testMeasuredOperation(timing){c->when(action){
                    "start"->{if(c.load().recovery.plan==null)c.confirm("confirm",PlanRequest("cost-plan","complex-0",null,PlanMode.MINIMAL,3,60000,0),at);c.start("start-$seq",false,at)}
                    "early"->c.manual("early-$seq",true,false,"other",null,at)
                    "report"->c.report("report",JSONArray().put(JSONObject().put("reportId","cost-report").put("projectId","complex-0").put("subtaskId","read").put("progressBasisPoints",5000).put("rounds",3)),JSONArray(),at)
                    else->error("Unknown action")
                }}.get(60,TimeUnit.SECONDS)
                val state=outcome?.state?:runtime.testRead().get(60,TimeUnit.SECONDS);domain=state.domain
                op.put("savedNs",System.nanoTime().toString())
                if(outcome!=null)op.put("timing",timing.json())
                val attribution=FocusProjection.attribution(state.domain);op.put("projectedNs",System.nanoTime().toString())
                val journal=JSONArray(runtime.testRecording().get(60,TimeUnit.SECONDS))
                main.post{
                    op.put("busyFrameNs",busyFrame?.toString()?:JSONObject.NULL)
                    phase=if(action=="report"||action=="stats")"DONE"else state.recovery.plan!!.phase.name
                    sequence++;operations.put(op);data.put("final",state.domain.canonical).put("commands",journal).put("attribution",attribution).put("completed",action=="stats")
                    if(action=="report"){val progress=DomainEngine.progress(state.domain.json().getJSONArray("projects").getJSONObject(0));op.put("progress",progress);nativeWorld!!.construction(progress,state.token.revision)}
                    busy=false;busyInput=null;save()
                }
            }catch(e:Throwable){fail(e)}
        }
    }
    override fun onResume(){super.onResume();nativeWorld?.resume();web?.onResume()}
    override fun onPause(){nativeWorld?.pause();web?.onPause();super.onPause()}
    override fun onDestroy(){nativeWorld?.close();nativeWorld=null;web?.close();web=null;worker.shutdown();super.onDestroy()}
}
