package com.blockcolc.preview

import android.util.Base64
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.blockcolc.domain.*
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.preview.world.*
import com.blockcolc.world.*
import com.blockcolc.world.filament.NativeWorldView
import com.blockcolc.world.generation.*
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

/** The ordinary generation/compiler/renderer path, including external fluid
 * layers and special models in one owner. Synthetic archive stays test-only. */
class P3ExternalSpecialsGpuTest {
    @get:Rule val activity=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private fun diagnostic(view:NativeWorldView):JSONObject {
        val done=CountDownLatch(1);val value=AtomicReference<JSONObject>()
        view.generatedDiagnostics{value.set(it);done.countDown()};assertTrue(done.await(10,TimeUnit.SECONDS));return value.get()
    }
    @Test fun theVisibleWorldAdoptsAnimatedFluidsAndSpecialModelsAndRestoresItsOriginalOwner(){
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
        val oracle=JSONObject(javaClass.getResource("/resource-special-oracle.json")!!.readText())
        val ids=listOf("water","oak_slab","chest","chest","dragon_wall_head","red_wall_banner","end_portal","oak_sign")
        val voxels=JSONArray(ids.mapIndexed{index,id->
            val properties=when(index){0->JSONObject().put("level","0");1->JSONObject().put("waterlogged","true");
                2->JSONObject().put("facing","north").put("type","left");3->JSONObject().put("facing","north").put("type","right");
                4->JSONObject().put("facing","west");5->JSONObject().put("facing","north");else->JSONObject()}
            JSONObject().put("x",index%4*3).put("y",0).put("z",index/4*3).put("materialId","stone").put("stage","foundation").put("buildOrder",0)
                .put("sourceBlockId","minecraft:$id").put("sourceBlockState",properties)
        })
        val blueprint=JSONObject().put("schemaVersion",1).put("id","external-specials").put("title","Special model gallery")
            .put("bounds",JSONObject().put("minX",0).put("maxX",9).put("minY",0).put("maxY",0).put("minZ",0).put("maxZ",3)).put("voxels",voxels)
        val now=DomainTime.millis("2026-10-30T07:00:00.000Z")
        val created=DomainEngine.execute(DomainEngine.initial("UTC"),DomainEngine.command("CreateProject","projectId" to "gallery","title" to "Gallery",
            "blueprintId" to "external-specials","importedBlueprint" to blueprint,"subtasks" to JSONArray().put(JSONObject().put("id","task").put("title","Task"))),now)
        assertTrue(created.error,created.ok)
        val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler(AndroidSignRasterizer());var view:NativeWorldView?=null
        val screenshots=JSONArray()
        fun present(frame:NativeWorldFrame,label:String):JSONObject {
            val done=CountDownLatch(1);val error=AtomicReference<String>()
            activity.scenario.onActivity{host->host.onGeneratedFrame={id->if(id==frame.scene.presentationIdentity)done.countDown()}
                host.onGeneratedError={value->error.set(value);done.countDown()};host.presentGenerated(frame.scene);view=host.generatedWorld}
            assertTrue("Special-model GPU frame did not submit",done.await(80,TimeUnit.SECONDS));assertNull(error.get())
            instrumentation.runOnMainSync{view!!.navigate("gallery")}
            android.os.SystemClock.sleep(250)
            val name="p3-world-$group-specials-$label.png"
            assertTrue(UiDevice.getInstance(instrumentation).takeScreenshot(File(instrumentation.targetContext.filesDir,name)));screenshots.put(name)
            return diagnostic(view!!).also{assertFalse(it.getBoolean("failed"));assertTrue(it.getLong("gpuReadyFrames")>0)}
        }
        try{NativeResourceArchive.from(Base64.decode(oracle.getString("zip"),Base64.DEFAULT)).use{archive->
            val resources=NativeResourceWorldAssets.prepare(ResourcePackStack.of(ResourcePackAssets.prepare(archive)))
            val world=builder.terrain(builder.prepare(WorldFacts.from(created.state)))
            val options=WorldRenderOptions(now,"UTC",quality=NativeLightingQuality.BALANCED,weather=NativeWeatherOverride(NativeWeatherKind.CLEAR))
            val first=compiler.prepare(WorldRequestIdentity("specials-isolated.db",0,0),world,options)
            val original=first.scene.sources.first{it.owner=="building:gallery"};val before=present(first,"original")
            val adopted=compiler.prepare(WorldRequestIdentity("specials-isolated.db",0,1),world,options.copy(resources=resources))
            val source=adopted.scene.sources.first{it.owner=="building:gallery"}
            assertTrue(source.surfaces.any{it.optics.atlas!=null});assertTrue(source.surfaces.any{it.optics.fluidSurface})
            assertTrue("One owner must retain fluid/model animation bindings",source.atlasSchedules.isNotEmpty())
            val middle=present(adopted,"resource")
            val removed=compiler.prepare(WorldRequestIdentity("specials-isolated.db",0,2),world,options)
            assertEquals(original.geometryKeys,removed.scene.sources.first{it.owner=="building:gallery"}.geometryKeys)
            val after=present(removed,"removed")
            File(instrumentation.targetContext.filesDir,"p3-world-resource-specials-visible.json").writeText(JSONObject().put("schema",1).put("caseLabel",group)
                .put("before",before).put("adopted",middle).put("removed",after).put("screenshots",screenshots).put("sourceHashes",oracle.getJSONObject("sourceHashes")).toString())
        }}finally{view?.let{instrumentation.runOnMainSync{it.pause()}};compiler.clear();builder.clear()}
    }
}
