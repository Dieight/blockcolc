package com.blockcolc.preview

import android.util.Base64
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.blockcolc.domain.*
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.preview.world.*
import com.blockcolc.world.*
import com.blockcolc.world.generation.*
import com.blockcolc.world.filament.NativeWorldView
import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class P3NativeResourceTerrainTest{
    @get:Rule(order=0) val waiting=P3UiWaitDiagnostics()
    @get:Rule(order=1) val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val label get()=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-resource-terrain-oracle.json")!!.readText())}
    private fun record(kind:String,value:JSONObject){
        // Failure reporting must stay small: do not parse the multi-megabyte
        // texture oracle while handling a real renderer memory failure.
        val report=value.put("schema",1).put("caseLabel",label)
        if(kind!="failure")report.put("sourceHashes",oracle.getJSONObject("sourceHashes"))
        File(context.filesDir,"p3-world-resource-terrain-$kind.json").writeText(report.toString())
    }
    @Test fun androidCropsAndSamplingMatchAllSourceTerrainCases(){
        val rows=oracle.getJSONArray("cases");var count=0
        for(i in 0 until rows.length()){
            val row=rows.getJSONObject(i);NativeResourceArchive.from(Base64.decode(row.getString("zip"),Base64.DEFAULT)).use{archive->
                val assets=NativeResourceWorldAssets.prepare(ResourcePackStack.of(ResourcePackAssets.prepare(archive)))
                val expected=row.getJSONObject("expected");assertEquals(expected.length(),assets.terrain.tiles.size)
                assertNull(assets.terrain.material(TerrainMaterial.WATER,NativeSurfaceState()))
                for((kind,tile)in assets.terrain.tiles){
                    count++;val e=expected.getJSONObject(kind.wireValue);val texture=tile.texture
                    assertEquals(e.getInt("width"),texture.width);assertEquals(e.getInt("height"),texture.height);assertEquals(e.getString("rgbaSha256"),texture.sha256)
                    assertEquals(e.getInt("color"),tile.color);assertEquals(e.getInt("minFilter"),texture.minFilter);assertEquals(e.getInt("magFilter"),texture.magFilter)
                    assertTrue(texture.mipmaps);assertTrue(texture.pixels().isReadOnly);assertEquals(1000,texture.wrapS);assertEquals(1000,texture.wrapT)
                }
            }
        }
        assertEquals(13,rows.length());assertEquals(83,count);record("cpu",JSONObject().put("cases",rows.length()).put("tiles",count))
    }
    private fun diagnostic(view:NativeWorldView):JSONObject{
        val done=CountDownLatch(1);val value=AtomicReference<JSONObject>();view.generatedDiagnostics{value.set(it);done.countDown()}
        assertTrue(done.await(10,TimeUnit.SECONDS));return value.get()
    }
    private fun present(scene:NativeGeneratedScene):Pair<NativeWorldView,JSONObject>{
        val presentation=scene.presentationIdentity
        val done=CountDownLatch(1);val error=AtomicReference<String>();val view=AtomicReference<NativeWorldView>()
        foreground.scenario.onActivity{activity->activity.onGeneratedFrame={id->if(id==presentation)done.countDown()}
            activity.onGeneratedError={value->error.set(value);done.countDown()};activity.presentGenerated(scene);view.set(activity.generatedWorld);activity.generatedWorld?.resume()}
        try{
            val received=done.await(80,TimeUnit.SECONDS)
            if(!received||error.get()!=null){
                record("failure",JSONObject().put("presentation",presentation).put("error",error.get())
                    .put("diagnostic",runCatching{diagnostic(view.get())}.getOrNull()))
                assertTrue("Terrain scene did not produce a GPU receipt",received);assertNull(error.get())
            }
            return view.get() to diagnostic(view.get()).also{assertFalse(it.getBoolean("failed"));assertTrue(it.getLong("frames")>0)}
        }finally{
            foreground.scenario.onActivity{activity->activity.onGeneratedFrame=null;activity.onGeneratedError=null}
        }
    }
    /** Comparisons retain only hashes and diagnostics, never earlier CPU frames
     * or packet buffers while the next full world is being prepared. */
    private data class SurfaceReceipt(val terrainKey:String,val geometryKeys:List<String>,val textureKeys:List<String>,val diagnostic:JSONObject)
    private fun screenshot(suffix:String):String{
        val file=File(context.filesDir,"p3-world-$label-terrain-$suffix.png");android.os.SystemClock.sleep(250)
        assertTrue(UiDevice.getInstance(instrumentation).takeScreenshot(file));assertTrue(file.length()>4096);return file.name
    }
    /** Rebuild real source blueprints through the current planner/compiler.
     * The client JAR is supplied privately by the runner, never an APK asset. */
    @Test fun twentyFiveSourceBuildingsRenderAcrossEnvironmentsAndTheRealClientPack(){
        val args=InstrumentationRegistry.getArguments()
        val path=checkNotNull(args.getString("p3CapacityArchive"))
        val expectedSha=checkNotNull(args.getString("p3CapacityArchiveSha"))
        require(path=="p3-capacity-$label.jar"&&expectedSha.matches(Regex("[a-f0-9]{64}")))
        val initial=DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()})
        assertEquals(25,initial.projectionJson().getJSONArray("projects").length())
        val business=initial.sha256
        val results=JSONArray();val screens=JSONArray()
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler(AndroidSignRasterizer());val allocator=AndroidPacketBuffers(context)
        var revision=0L;var view:NativeWorldView?=null
        val now=DomainTime.millis("2026-09-15T08:00:00.000Z")
        fun save(){File(context.filesDir,"p3-world-large-capacity.json").writeText(JSONObject()
            .put("schema",1).put("caseLabel",label).put("projects",25).put("sourceDomainSha256",business)
            .put("archiveSha256",expectedSha).put("runs",results).put("screenshots",screens).toString())}
        fun world(environment:WorldEnvironment):WorldTerrainPlan{
            val changed=DomainEngine.execute(initial,DomainEngine.command("ConfigureWorldEnvironment","environmentStyle" to environment.wireValue),now)
            assertTrue(changed.error,changed.ok)
            // Match the production generation worker's allocation scope for
            // source terrain as well as final packets. Otherwise this test
            // retains heap arrays that the actual Android path maps privately.
            val result=NativePacketBuffers.using(allocator){builder.terrain(builder.prepare(WorldFacts.from(changed.state)))}
            assertEquals(25,result.input.buildings.size)
            assertTrue("The large fixture must contain complex source blueprints",result.input.buildings.sumOf{it.blueprint.voxels.size}>10000)
            return result
        }
        fun render(world:WorldTerrainPlan,resources:NativeResourceWorldAssets?,stage:String):List<String>{
            val started=android.os.SystemClock.elapsedRealtime()
            val frame=NativePacketBuffers.using(allocator){compiler.prepare(WorldRequestIdentity("large-capacity.db",0,revision++),world,
                WorldRenderOptions(now,"Asia/Shanghai",quality=NativeLightingQuality.HIGH,aspect=.75,
                    weather=NativeWeatherOverride(NativeWeatherKind.CLEAR),resources=resources))}
            val cpuMs=android.os.SystemClock.elapsedRealtime()-started
            val heapBefore=Runtime.getRuntime()
            File(context.filesDir,"p3-world-large-capacity-stage.json").writeText(JSONObject().put("schema",1).put("caseLabel",label)
                .put("stage",stage).put("phase","before-gpu").put("compileMs",cpuMs)
                .put("javaHeapUsedBytes",heapBefore.totalMemory()-heapBefore.freeMemory()).put("javaHeapLimitBytes",heapBefore.maxMemory())
                .put("mappedPacketBytesCumulative",allocator.mappedBytes)
                .put("directPacketBytesCumulative",allocator.directBytes)
                .put("pickingEstimatedBytes",frame.scene.picking.estimatedBytes)
                .put("packetBytes",frame.scene.sources.sumOf{it.world?.byteSize?.toLong()?:0L})
                .put("maximumVertexUploadBytes",frame.scene.sources.flatMap{it.world?.geometries.orEmpty()}.maxOf{it.vertexCount*64L}).toString())
            val shown=present(frame.scene);view=shown.first
            assertTrue(shown.second.getLong("gpuReadyFrames")>0)
            val root=frame.scene.sources.first{it.owner=="world"}
            val keys=root.geometryKeys.toList()
            screens.put(screenshot("large-$stage"))
            val heap=Runtime.getRuntime()
            results.put(JSONObject().put("stage",stage).put("environment",world.input.spatial.environment.wireValue)
                .put("buildings",world.input.buildings.size).put("compileMs",cpuMs)
                .put("javaHeapUsedBytes",heap.totalMemory()-heap.freeMemory()).put("javaHeapLimitBytes",heap.maxMemory())
                .put("nativeHeapBytes",android.os.Debug.getNativeHeapAllocatedSize()).put("diagnostic",shown.second))
            save();return keys
        }
        val captureFailure=args.getString("p3CaptureFailureHeap")=="1"
        if(captureFailure)com.blockcolc.world.filament.NativeWorldFailureEvidence.arm(context,label)
        try{
            for(environment in WorldEnvironment.entries)render(world(environment),null,"${environment.wireValue}-original")
            val coast=world(WorldEnvironment.COAST)
            val before=render(coast,null,"coast-before-resource")
            NativeResourceArchive.open(File(context.filesDir,path)).use{archive->
                assertTrue(archive.clientJar);assertEquals(expectedSha,archive.inputSha256)
                val resources=NativePacketBuffers.using(allocator){NativeResourceWorldAssets.prepare(ResourcePackStack.of(ResourcePackAssets.prepare(archive)))}
                val heap=Runtime.getRuntime()
                File(context.filesDir,"p3-world-large-capacity-stage.json").writeText(JSONObject().put("schema",1).put("caseLabel",label).put("stage","coast-client-26-3").put("phase","resources-ready")
                    .put("javaHeapUsedBytes",heap.totalMemory()-heap.freeMemory()).put("javaHeapLimitBytes",heap.maxMemory()).put("atlas",JSONObject(resources.textures.atlas.memoryEstimate)).toString())
                render(coast,resources,"coast-client-26-3")
            }
            val restored=render(coast,null,"coast-restored")
            assertEquals(before,restored);assertEquals(business,initial.sha256)
            save()
        }catch(error:Throwable){
            if(captureFailure)com.blockcolc.world.filament.NativeWorldFailureEvidence.capture(error)
            throw error
        }finally{com.blockcolc.world.filament.NativeWorldFailureEvidence.reset();view?.let{instrumentation.runOnMainSync{it.pause()}};compiler.clear();builder.clear()}
    }
    @Test fun fourGeneratedWorldsAdoptCroppedTilesAndRestoreTheirOriginalSurfaces(){
        val rows=oracle.getJSONArray("cases");val row=(0 until rows.length()).map{rows.getJSONObject(it)}.first{it.getString("name")=="terrain-gallery"}
        val now=DomainTime.millis("2026-10-28T12:00:00.000Z")
        fun command(state:DomainDocument,type:String,vararg fields:Pair<String,Any?>):DomainDocument{
            val result=DomainEngine.execute(state,DomainEngine.command(type,*fields),now);assertTrue(result.error,result.ok);return result.state
        }
        val initial=command(DomainEngine.initial("UTC"),"CreateProject","projectId" to "a","title" to "Terrain",
            "blueprintId" to "builtin-small-workshop","subtasks" to JSONArray().put(JSONObject().put("id","t").put("title","Task")))
        NativeResourceArchive.from(Base64.decode(row.getString("zip"),Base64.DEFAULT)).use{archive->
            val assets=NativeResourceWorldAssets.prepare(ResourcePackStack.of(ResourcePackAssets.prepare(archive)))
            val results=JSONArray();val screens=JSONArray()
            val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler();var view:NativeWorldView?=null;var revision=0L
            try{for(environment in WorldEnvironment.entries){
                    val document=command(initial,"ConfigureWorldEnvironment","environmentStyle" to environment.wireValue)
                    val world=builder.terrain(builder.prepare(WorldFacts.from(document)))
                    // The instrumentation host has a width x (width * 4/3) world.
                    val options=WorldRenderOptions(now,"UTC",quality=NativeLightingQuality.BALANCED,weather=NativeWeatherOverride(NativeWeatherKind.CLEAR),aspect=.75)
                    val terrainGroups=TerrainMaterial.entries.count{world.terrain.topIndices(it).hasRemaining()}+
                        listOf(TerrainMaterial.DIRT,TerrainMaterial.STONE).count{world.terrain.sideIndices(it).hasRemaining()}
                    val kinds=assets.terrain.tiles.filterKeys{world.terrain.topIndices(it).hasRemaining()}.keys
                    assertTrue(kinds.isNotEmpty())
                    fun render(resources:NativeResourceWorldAssets?,stage:String):SurfaceReceipt{
                        val frame=compiler.prepare(WorldRequestIdentity("isolated-terrain.db",0,revision++),world,options.copy(resources=resources))
                        val root=frame.scene.sources.first{it.owner=="world"}
                        if(resources!=null)for(kind in kinds)assertTrue(root.textures.any{it.samplingIdentity==resources.terrain.tiles.getValue(kind).texture.samplingIdentity})
                        val shown=present(frame.scene);view=shown.first
                        screens.put(screenshot("${environment.wireValue}-$stage"))
                        val runtime=Runtime.getRuntime()
                        shown.second.put("javaHeapUsedBytes",runtime.totalMemory()-runtime.freeMemory()).put("javaHeapLimitBytes",runtime.maxMemory())
                        return SurfaceReceipt(frame.terrainKey,root.geometryKeys.toList(),root.textures.map{it.samplingIdentity},shown.second)
                    }
                    val first=render(null,"original");val second=render(assets,"adopted")
                    assertEquals(first.geometryKeys.take(terrainGroups),second.geometryKeys.take(terrainGroups));assertEquals(first.terrainKey,second.terrainKey)
                    val third=render(null,"restored")
                    assertEquals(first.geometryKeys,third.geometryKeys);assertEquals(first.textureKeys,third.textureKeys)
                    results.put(JSONObject().put("environment",environment.wireValue).put("materials",JSONArray(kinds.map{it.wireValue}))
                        .put("before",first.diagnostic).put("adopted",second.diagnostic).put("restored",third.diagnostic).put("terrainGeometryUnchanged",true).put("originalTexturesRestored",true))
                    record("visible",JSONObject().put("environments",results).put("screenshots",screens))
            }}finally{view?.let{instrumentation.runOnMainSync{it.pause()}};compiler.clear();builder.clear()}
            record("visible",JSONObject().put("environments",results).put("screenshots",screens))
        }
    }
}
