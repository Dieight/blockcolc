package com.blockcolc.preview

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Color
import com.blockcolc.world.filament.NativeWorldView
import com.blockcolc.world.WorldFixtures

class MainActivity:ComponentActivity() {
    private var world:NativeWorldView?=null
    private var reference:ReferenceWorldView?=null
    private var stopTrace:(()->Unit)?=null
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        if(BuildConfig.DEBUG&&intent.hasExtra("costBackend")){
            startActivity(android.content.Intent(this,P2CostActivity::class.java).putExtras(intent));finish();return
        }
        if (!intent.hasExtra("fixture") || intent.getBooleanExtra("business", false)) {
            P2Trace.begin(this,intent.getStringExtra("p2Run"));stopTrace=P2Trace.observe(this)
            val runtime = PreviewRuntime.get(this)
            val diagnostic=BuildConfig.DEBUG&&(intent.hasExtra("p2Run")||intent.getBooleanExtra("business",false)||intent.hasExtra("benchmarkRun"))
            setContent {
                if(diagnostic)PreviewApp(runtime,intent.getStringExtra("fixture")?:"ocean",intent.getStringExtra("benchmarkRun"),{world=it},intent.getBooleanExtra("skipWorld",false))
                else NativeApp(runtime)
            }
            runtime.start()
            return
        }
        val fixture=WorldFixtures.requireName(intent.getStringExtra("fixture")?:"ocean")
        val projectionOnly=intent.getBooleanExtra("projectionOnly",false)
        val culling=intent.getBooleanExtra("culling",true)
        val surfaceEffects=intent.getBooleanExtra("surfaceEffects",true)
        val shadows=intent.getBooleanExtra("shadows",true)
        val colorProbe=intent.getBooleanExtra("colorProbe",false)
        val surfaceOptics=intent.getBooleanExtra("surfaceOptics",true)
        val nightReflections=intent.getBooleanExtra("nightReflections",true)
        val webReference=intent.getBooleanExtra("webReference",false)
        val fog=intent.getBooleanExtra("fog",true)
        val runtime=intent.getBooleanExtra("runtime",!webReference)
        val weatherOnly=intent.getBooleanExtra("weatherOnly",false)
        val animalOnly=intent.getBooleanExtra("animalOnly",false)
        val animalProbe=intent.getStringExtra("animalProbe")?.also{require(it in setOf("land","fish","bird"))}
        val benchmarkRun=intent.getStringExtra("benchmarkRun")?.also{require(it.matches(Regex("[a-z0-9-]{1,80}")))}
        val skyProbe=intent.getBooleanExtra("skyProbe",false)
        val moonProbe=intent.getBooleanExtra("moonProbe",false)
        val profile=(intent.getStringExtra("profile")?:"day").also{require(it in setOf("day","night","rain","snow"))}
        setContent {
            var status by remember {mutableStateOf("P1 loading production packets; formal data untouched")}
            MaterialTheme {
                Column(Modifier.fillMaxSize().background(Color(0xffedf1ee)).windowInsetsPadding(WindowInsets.safeDrawing)) {
                    Text(status,Modifier.fillMaxWidth().height(76.dp).padding(12.dp),style=MaterialTheme.typography.bodySmall)
                    if(webReference) AndroidView(factory={context->ReferenceWorldView(context,fixture,profile,benchmarkRun,skyProbe,moonProbe,runtime,animalProbe){status=it}.also{reference=it}},modifier=Modifier.fillMaxWidth().aspectRatio(.75f))
                    else AndroidView(factory={context->NativeWorldView(context,fixture,projectionOnly,culling,surfaceEffects,shadows,colorProbe,surfaceOptics,nightReflections,fog,runtime,weatherOnly,animalOnly,animalProbe,benchmarkRun,skyProbe,moonProbe){status=it;android.util.Log.i("BlockcolcP1",it)}.also{world=it;it.resume()}},modifier=Modifier.fillMaxWidth().aspectRatio(.75f))
                    Text("Drag horizontally to rotate; vertically to zoom. This is a renderer gate, not a UI redesign or full native App.",Modifier.padding(12.dp))
                    Row(Modifier.padding(horizontal=12.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        val ready=status.startsWith("P1 submitted")||status.startsWith("Reference submitted")||status.contains("runtime sampled")
                        Button(onClick={world?.runOwnerCheck();reference?.updateOwner()},enabled=ready,modifier=Modifier.weight(1f)){Text("Verify owner update")}
                        Button(onClick={world?.sampleRuntime();reference?.sampleRuntime()},enabled=ready||status.contains("owner-check submitted"),modifier=Modifier.weight(1f)){Text("Sample runtime")}
                    }
                }
            }
        }
    }
    override fun onResume(){super.onResume();world?.resume();reference?.onResume();if(!intent.hasExtra("fixture")||intent.getBooleanExtra("business",false))PreviewRuntime.get(this).foreground(true)}
    override fun onPause(){world?.pause();reference?.onPause();super.onPause()}
    override fun onStop(){if(!intent.hasExtra("fixture")||intent.getBooleanExtra("business",false))PreviewRuntime.get(this).activityStopped(this);super.onStop()}
    override fun onDestroy(){stopTrace?.invoke();stopTrace=null;world?.close();world=null;reference?.close();reference=null;super.onDestroy()}
}
