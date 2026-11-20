package com.blockcolc.preview

import android.graphics.Bitmap
import android.os.Debug
import android.os.Process
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.preview.world.AndroidPacketBuffers
import com.blockcolc.preview.world.AndroidSignRasterizer
import com.blockcolc.preview.world.PaperWorldMesh
import com.blockcolc.preview.world.NativeWorldPacketCompiler
import com.blockcolc.preview.world.WorldPlanBuilder
import com.blockcolc.preview.world.WorldRenderOptions
import com.blockcolc.preview.world.WorldRequestIdentity
import com.blockcolc.preview.world.WorldTerrainPlan
import com.blockcolc.preview.world.NativeWorldSession
import com.blockcolc.preview.world.PreparedWorldRequest
import com.blockcolc.preview.world.WorldTerrainOptions
import com.blockcolc.world.NativeLightingQuality
import com.blockcolc.world.NativeOutlineVisibility
import com.blockcolc.world.NativePacketBuffers
import com.blockcolc.world.NativeSceneCamera
import com.blockcolc.world.NativeSky
import com.blockcolc.world.NativeWeatherKind
import com.blockcolc.world.NativeWeatherOverride
import com.blockcolc.world.NativeGlassRegion
import com.blockcolc.world.NativeCloudCompiler
import com.blockcolc.world.NativePrecipitationCompiler
import com.blockcolc.world.SourceWorldColor
import com.blockcolc.preview.world.NativeWorldFrame
import com.blockcolc.world.SourceCamera
import com.blockcolc.world.filament.NativeWorldView
import com.blockcolc.world.generation.BlockPoint
import com.blockcolc.world.generation.WorldEnvironment
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

class P4PaperWorldRenderTest {
    @get:Rule val host = ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val instruments get() = InstrumentationRegistry.getInstrumentation()
    private val arguments get() = InstrumentationRegistry.getArguments()
    private val output get() = instruments.targetContext.filesDir
    private val now = DomainTime.millis("2026-11-19T07:00:00.000Z")

    @Test fun paperRootIsReusedAfterReopeningAndDuringConstruction() {
        val context=instruments.targetContext
        val directory=File(context.cacheDir,"p4-paper-cache-${UUID.randomUUID()}")
        val options=WorldTerrainOptions(rendering=WorldRenderOptions(now,"UTC",NativeLightingQuality.PAPER,
            weather=NativeWeatherOverride(NativeWeatherKind.CLEAR),outlines=NativeOutlineVisibility.OFF))
        fun apply(state:DomainDocument,command:JSONObject,time:Long=now):DomainDocument {
            val result=DomainEngine.execute(state,command,time)
            check(result.ok){result.error.orEmpty()}
            return result.state
        }
        var initial=apply(DomainEngine.initial("UTC"),DomainEngine.command("ConfigureWorldEnvironment","environmentStyle" to "classic-island"))
        for(id in listOf("paper-a","paper-b")){
            initial=apply(initial,DomainEngine.command("CreateProject","projectId" to id,"title" to id,
                "blueprintId" to "builtin-small-workshop","subtasks" to JSONArray().put(JSONObject().put("id","task-$id").put("title",id))))
        }
        initial=apply(initial,DomainEngine.command("SwitchActiveProject","projectId" to "paper-a"))
        fun prepare(session:NativeWorldSession,state:DomainDocument,revision:Long):PreparedWorldRequest {
            val done=CountDownLatch(1)
            val result=AtomicReference<PreparedWorldRequest>()
            val failure=AtomicReference<Exception>()
            session.request(WorldRequestIdentity("paper-cache-check",0,revision),state,options,
                onReady={result.set(it);done.countDown()},onFailure={failure.set(it);done.countDown()})
            assertTrue("Paper cache test exceeded world preparation deadline",done.await(110,TimeUnit.SECONDS))
            failure.get()?.let{throw AssertionError("Paper cache preparation failed",it)}
            return checkNotNull(result.get())
        }
        fun <T> session(block:(NativeWorldSession)->T):T {
            val session=NativeWorldSession(context,{it.run()},directory)
            try{return block(session)}finally{
                session.close()
                assertTrue(session.awaitTermination(20,TimeUnit.SECONDS))
            }
        }
        try{
            val coldKeys=session{owner->
                val result=checkNotNull(prepare(owner,initial,1).frame)
                val deadline=SystemClock.uptimeMillis()+25_000
                while(owner.paperCacheStatsForTest()?.commits==0L&&SystemClock.uptimeMillis()<deadline)SystemClock.sleep(25)
                assertEquals(1L,checkNotNull(owner.paperCacheStatsForTest()).commits)
                result.scene.sources.first().geometryKeys
            }
            var progressed=apply(initial,DomainEngine.command("StartFocus","sessionId" to "paper-focus","subtaskId" to "task-paper-a","plannedDurationMs" to 1000))
            progressed=apply(progressed,DomainEngine.command("CompleteFocus"),now+1000)
            progressed=apply(progressed,DomainEngine.command("ReportSubtaskProgress","reportId" to "paper-report","subtaskId" to "task-paper-a",
                "focusSessionIds" to JSONArray(listOf("paper-focus")),"progressBasisPoints" to 6000),now+1000)
            session{owner->
                val warm=checkNotNull(prepare(owner,initial,1).frame).scene.sources.associateBy{it.owner}
                assertEquals(1L,checkNotNull(owner.paperCacheStatsForTest()).hits)
                assertEquals(coldKeys,warm.getValue("world").geometryKeys)
                assertTrue(checkNotNull(warm.getValue("world").world).geometries.all{it.paper})
                val after=checkNotNull(prepare(owner,progressed,2).frame).scene.sources.associateBy{it.owner}
                assertSame(warm.getValue("world"),after.getValue("world"))
                assertSame(warm.getValue("building:paper-b"),after.getValue("building:paper-b"))
                assertNotSame(warm.getValue("building:paper-a"),after.getValue("building:paper-a"))
                assertTrue(after.getValue("building:paper-a").geometryKeys.isNotEmpty())
                assertEquals(1L,checkNotNull(owner.paperCacheStatsForTest()).hits)
            }
        }finally{
            require(directory.canonicalFile.parentFile==context.cacheDir.canonicalFile&&directory.name.startsWith("p4-paper-cache-"))
            if(directory.exists())check(directory.deleteRecursively())
        }
    }

    @Test fun drawsAndRotatesTheGeneratedSettlement() {
        val mode = checkNotNull(arguments.getString("paperMode")).also { require(it in setOf("paper", "low", "app-paper")) }
        val appPaper = mode == "app-paper"
        val environment = WorldEnvironment.fromWire(checkNotNull(arguments.getString("paperWorld")))
        require(environment in setOf(WorldEnvironment.FLOATING, WorldEnvironment.COAST))
        val label = checkNotNull(arguments.getString("p3Group")).also { require(it.matches(Regex("[a-z0-9-]{1,55}"))) }
        val capture = arguments.getString("paperCapture") == "true"
        val target = instruments.targetContext
        val width = 720
        val height = 960
        val report = JSONObject().put("mode", mode).put("environment", environment.wireValue)
            .put("width", width).put("height", height)
        val builder = WorldPlanBuilder()
        val allocator = AndroidPacketBuffers(target)
        val compiler = if (mode != "paper") NativeWorldPacketCompiler(AndroidSignRasterizer(), allocator, parallel = true) else null
        var native: NativeWorldView? = null
        var paper: P4PaperWorldView? = null
        try {
            val base = target.assets.open("p2-fixture-domain.json").bufferedReader().use { DomainDocument.parse(it.readText()) }
            val state = DomainEngine.execute(base, DomainEngine.command("ConfigureWorldEnvironment", "environmentStyle" to environment.wireValue), now)
            check(state.ok) { state.error.toString() }
            val facts = WorldFacts.from(state.state)
            assertEquals(25, facts.buildings.size)
            val blankPss = pss()
            val commonStart = bootTime()
            val world = NativePacketBuffers.using(allocator) { builder.terrain(builder.prepare(facts,null,!appPaper) { false }) }
            val sharedMs = milliseconds(commonStart, bootTime())
            val commonPss = pss()
            val camera = overviewCamera(world, width.toDouble() / height, appPaper)
            val inputDigest = world.cacheKey + ":" + world.sceneryKey
            report.put("sharedMs", sharedMs).put("blankPssKb", blankPss).put("sharedPssKb", commonPss)
                .put("layout", world.input.spatial.key).put("terrain", world.cacheKey).put("scenery", world.sceneryKey)
                .put("input", inputDigest).put("buildings", facts.buildings.size).put("terrainSourceTriangles", world.terrain.triangleCount)
                .put("sceneryObjects", world.scenery.objects.size).put("biomeTopQuads", JSONObject().also { counts ->
                    for (material in com.blockcolc.world.generation.TerrainMaterial.entries)
                        counts.put(material.wireValue, world.terrain.topIndices(material).remaining() / 6)
                })

            val ready = CountDownLatch(1)
            val frameReadyAt = AtomicLong()
            val error = AtomicReference<String>()
            val packStart = bootTime()
            val mesh = if (mode == "paper") PaperWorldMesh.prepare(world, allocator) else null
            val prepared = compiler?.prepare(WorldRequestIdentity("paper-benchmark-only", 0, 1), world,
                WorldRenderOptions(now, "Asia/Shanghai", if (appPaper) NativeLightingQuality.PAPER else NativeLightingQuality.LOW,
                    camera.aspect, NativeWeatherOverride(NativeWeatherKind.CLEAR)))
            val frame = prepared?.scene?.withPresentation(camera = camera)
            val packEnd = bootTime()
            if (mesh != null) {
                assertTrue(mesh.buildingQuads > 0 && mesh.terrainQuads > 0)
                if (environment == WorldEnvironment.COAST) assertTrue(mesh.reefVoxels > 0)
                report.put("terrainQuads", mesh.terrainQuads).put("buildingQuads", mesh.buildingQuads)
                    .put("sceneryQuads", mesh.sceneryQuads).put("reefVoxels", mesh.reefVoxels)
                    .put("triangles", mesh.triangles).put("vertexIndexBytes", mesh.uploadedBytes)
                    .put("drawBatches", mesh.land.size + mesh.water.size)
            }
            if (frame != null) {
                val memory = frame.footprint
                report.put("packetBytes", frame.inventory.payloadBytes).put("sourceGeometryBytes", memory.geometryBytes)
                    .put("sourceInstanceBytes", memory.instanceBytes).put("sourceTextureBytes", memory.textureBytes)
                    .put("sourceBatches", frame.sources.sumOf { it.world?.packets?.size ?: 0 })
                    .put("preset", if(appPaper)"paper" else "performance").put("post", frame.post.toString())
            }
            val mountAt = bootTime()
            host.scenario.onActivity { activity ->
                val view = if (mesh != null) P4PaperWorldView(activity, camera, mesh, environment == WorldEnvironment.FLOATING) {
                    frameReadyAt.set(it)
                    ready.countDown()
                }.also { paper = it } else {
                    val scene = checkNotNull(frame)
                    NativeWorldView.generated(activity, scene, { _, _, identity ->
                        if (identity == scene.presentationIdentity) {
                            frameReadyAt.set(bootTime())
                            ready.countDown()
                        }
                    }, { status ->
                        if (status.startsWith("ERROR:") || status == "NATIVE_UPDATE_ERROR") {
                            error.set(status)
                            ready.countDown()
                        }
                    }).also { native = it }
                }
                val root = FrameLayout(activity)
                root.addView(view, FrameLayout.LayoutParams(width, height, Gravity.CENTER))
                activity.setContentView(root)
                native?.resume()
            }
            assertTrue("World never reached the first complete frame", ready.await(80, TimeUnit.SECONDS))
            assertNull(error.get())
            val view = native ?: checkNotNull(paper)
            report.put("packMs", milliseconds(packStart, packEnd)).put("mountNs", mountAt.toString())
                .put("completeNs", frameReadyAt.get().toString()).put("gpuReadyFromMountMs", milliseconds(mountAt, frameReadyAt.get()))

            SystemClock.sleep(600)
            val idlePss = pss()
            val idleCpu = Process.getElapsedCpuTime()
            val idleStart = bootTime()
            SystemClock.sleep(1000)
            report.put("idleAppCpuMs", Process.getElapsedCpuTime() - idleCpu).put("idleWallMs", milliseconds(idleStart, bootTime()))
            if (capture) capture(view, "$label-overview")

            val motionCpu = Process.getElapsedCpuTime()
            val start = bootTime()
            rotation(view, width, height)
            val end = bootTime()
            val rotationCpu = Process.getElapsedCpuTime() - motionCpu
            report.put("rotationStartNs", start.toString()).put("rotationEndNs", end.toString())
                .put("rotationWallMs", milliseconds(start, end)).put("rotationAppCpuMs", rotationCpu)
                .put("steadyPssKb", idlePss).put("afterRotationPssKb", pss())
                .put("rssPeakKb", File("/proc/self/status").useLines { lines ->
                    lines.firstOrNull { it.startsWith("VmHWM:") }?.trim()?.split(Regex("\\s+"))?.getOrNull(1)?.toIntOrNull()
                })
            if (capture) {
                SystemClock.sleep(220)
                capture(view, "$label-rotated")
                if (paper != null) {
                    host.scenario.onActivity { paper?.zoom(2.15) }
                    SystemClock.sleep(420)
                    capture(view, "$label-close")
                }
            }
            if (native != null) {
                val done = CountDownLatch(1)
                val latest = AtomicReference<JSONObject>()
                checkNotNull(native).generatedDiagnostics(false) { result -> latest.set(result); done.countDown() }
                assertTrue(done.await(10, TimeUnit.SECONDS))
                val value = latest.get()
                assertTrue(value.getLong("frames") > 10 && !value.getBoolean("failed"))
                report.put("nativeViewport", value.getJSONObject("worldViewport")).put("nativeRender", value.optJSONObject("colorPipeline"))
                if(appPaper) assertPaperUpdates(checkNotNull(native),checkNotNull(prepared),checkNotNull(frame).presentationIdentity,view,label,report)
            }
            File(output, "$label.json").writeText(report.toString(2))
        } finally {
            host.scenario.onActivity {
                native?.close()
                paper?.onPause()
            }
            compiler?.close()
            builder.clear()
        }
    }

    private fun bootTime() = SystemClock.elapsedRealtimeNanos()
    private fun milliseconds(from: Long, to: Long) = (to - from) / 1e6
    private fun pss() = Debug.MemoryInfo().also { Debug.getMemoryInfo(it) }.totalPss

    private fun assertPaperUpdates(native:NativeWorldView,prepared:NativeWorldFrame,presentation:Long,view:View,label:String,report:JSONObject) {
        fun diagnose():JSONObject {
            val result=AtomicReference<JSONObject>()
            val done=CountDownLatch(1)
            native.generatedDiagnostics { result.set(it);done.countDown() }
            assertTrue(done.await(10,TimeUnit.SECONDS))
            return result.get()
        }
        val original=diagnose().getJSONObject("resources").getJSONObject("owners").getJSONArray("world").toString()
        val cloudCompiler=NativeCloudCompiler()
        val rainCompiler=NativePrecipitationCompiler()
        val modes=listOf(NativeWeatherKind.SNOW,NativeWeatherKind.RAIN,NativeWeatherKind.MIST)
        native.glassRegions(listOf(NativeGlassRegion(0f,0f,1f,.32f,.004f,.004f,1.14f,.96f,1f)))
        native.worldColor(SourceWorldColor(85,105,108))
        for((i,kind) in modes.withIndex()){
            val context=prepared.environmentContext.copy(weather=NativeWeatherOverride(kind,thunderstorm=kind==NativeWeatherKind.RAIN))
            val sample=context.sample(now+if(kind==NativeWeatherKind.MIST)21_600_000 else 0)
            val cloud=cloudCompiler.prepare(prepared.cloudContext,sample.weather,context.quality.cloudDensity,paper=true)
            val rain=rainCompiler.prepare(prepared.precipitationContext,sample.weather,context.quality.cloudDensity,cloud.randomTail,paper=true)
            val adopted=CountDownLatch(1)
            val accepted=AtomicReference(false)
            native.updateEnvironment(presentation,(i+1).toLong(),sample.uniforms(),cloud.source,rain.source){
                accepted.set(it);adopted.countDown()
            }
            assertTrue("Paper did not adopt ${kind.wire}",adopted.await(15,TimeUnit.SECONDS)&&accepted.get())
            SystemClock.sleep(420)
            val drawn=diagnose()
            val resources=drawn.getJSONObject("resources")
            assertEquals(original,resources.getJSONObject("owners").getJSONArray("world").toString())
            if(kind==NativeWeatherKind.SNOW||kind==NativeWeatherKind.RAIN){
                assertTrue(rain.capacity==1024&&resources.getInt("precipitationActiveCount") in 1..1024)
            }
            assertTrue(resources.getInt("animalUploadFrames")>0)
            val pipeline=drawn.getJSONObject("colorPipeline")
            assertEquals(1,pipeline.getInt("glassRegions"))
            assertEquals(85,pipeline.getJSONObject("config").getInt("saturation"))
            assertTrue(!drawn.getBoolean("failed"))
            if(arguments.getString("paperCapture")=="true")capture(view,"$label-${kind.wire}")
        }
        report.put("paperWeatherLive",true).put("paperStableWorldOwner",true).put("paperColorAndGlass",true).put("paperAnimalsUploaded",true)
    }

    private fun overviewCamera(world: WorldTerrainPlan, aspect: Double, paper: Boolean): NativeSceneCamera {
        val bounds = world.terrain.bounds
        val width = bounds.maxX - bounds.minX
        val depth = bounds.maxZ - bounds.minZ
        val center = BlockPoint((bounds.minX + bounds.maxX) / 2, (bounds.maxY + bounds.minY) * .20, (bounds.minZ + bounds.maxZ) / 2)
        // Both paths use the same pivot and see the distant regions during
        // the drag, including the entire coastline at the initial heading.
        val radius = sqrt(width * width + depth * depth) * .91
        val fov = 40.0
        val halfVertical = fov * PI / 360.0
        val distance = radius * 1.04 / sin(minOf(halfVertical, atan(tan(halfVertical) * aspect)))
        val pitch = 38 * PI / 180
        val horizontal = distance * .45 * cos(pitch) / sqrt(2.0)
        val eye = BlockPoint(center.x + horizontal, center.y + distance * .45 * sin(pitch), center.z + horizontal)
        val volume = SourceCamera(radius, listOf(listOf(bounds.minX, bounds.minY, bounds.minZ), listOf(bounds.maxX, bounds.maxY, bounds.maxZ)),
            NativeSky.RADIUS, .82, .91, 1.5, NativeSky.RADIUS)
        return NativeSceneCamera(center, eye, distance, fov, volume, aspect, paper=paper)
    }

    private fun rotation(view: View, width: Int, height: Int) {
        val down = SystemClock.uptimeMillis()
        val y = height * .53f
        fun send(action: Int, x: Float) {
            instruments.runOnMainSync {
                val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0)
                try { view.onTouchEvent(event) } finally { event.recycle() }
            }
        }
        send(MotionEvent.ACTION_DOWN, width * .20f)
        // 150 evenly spaced input samples, 30 per second. Remain within the
        // viewport and keep the stream going across each change of direction.
        for (i in 1..150) {
            val target = down + i * 1000 / 30L
            SystemClock.sleep((target - SystemClock.uptimeMillis()).coerceAtLeast(0))
            val offset = i % 60
            val sweep = (if (offset < 30) offset else 60 - offset) / 30f
            send(MotionEvent.ACTION_MOVE, width * (.20f + .60f * sweep))
        }
        send(MotionEvent.ACTION_UP, width * .80f)
    }

    private fun capture(view: View, name: String) {
        val location = IntArray(2)
        instruments.runOnMainSync { view.getLocationOnScreen(location) }
        val screen = checkNotNull(instruments.uiAutomation.takeScreenshot())
        val bitmap = Bitmap.createBitmap(screen, location[0], location[1], view.width, view.height)
        try {
            val colors = HashSet<Int>()
            for (y in 32 until bitmap.height - 32 step 21)
                for (x in 32 until bitmap.width - 32 step 21) colors += bitmap.getPixel(x, y)
            File(output, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            assertTrue("$name had only ${colors.size} sampled colors", colors.size > 16)
        } finally {
            if (bitmap !== screen) bitmap.recycle()
            screen.recycle()
        }
    }
}
