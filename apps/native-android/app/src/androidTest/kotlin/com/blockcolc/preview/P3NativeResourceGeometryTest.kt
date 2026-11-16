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

class P3NativeResourceGeometryTest{
    @get:Rule val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val label get()=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-resource-geometry-oracle.json")!!.readText())}
    private fun record(name:String,value:JSONObject){File(context.filesDir,"p3-world-resource-$name.json").writeText(value.put("schema",1).put("caseLabel",label).toString())}
    private fun state(o:JSONObject)=o.keys().asSequence().associateWith{o.getString(it)}
    @Test fun allSourceGeometryFacesAndFallbacksMatchOnAndroid(){
        val rows=oracle.getJSONArray("cases");var queries=0;var accepted=0
        repeat(rows.length()){i->val row=rows.getJSONObject(i)
            NativeResourceArchive.from(Base64.decode(row.getString("zip"),Base64.DEFAULT)).use{archive->
                val stack=ResourcePackStack.of(ResourcePackAssets.prepare(archive));val atlas=NativeResourceAtlas.build(stack);val resolver=stack.resolver()
                val requests=row.getJSONArray("queries");repeat(requests.length()){j->queries++;val q=requests.getJSONObject(j);val id=q.getString("blockId");val properties=state(q.getJSONObject("state"))
                    val position=q.optJSONObject("position")?.let{ResourceBlockPosition(it.getDouble("x"),it.getDouble("y"),it.getDouble("z"))}
                    val actual=NativeResourceGeometry.compile(id,properties,NativeResourceAtlasMapping.geometry(resolver.geometry(id,properties,position),atlas),atlas)
                    val e=q.getJSONObject("expected");val name="${row.getString("name")}:$j"
                    if(e.has("fallback")){assertTrue(name,actual is NativeResourceModelResult.Fallback)
                        if(e.getString("fallback")!="UNCOMPILED")assertEquals(name,e.getString("fallback"),(actual as NativeResourceModelResult.Fallback).reason)}
                    else{accepted++;assertTrue(name,actual is NativeResourceModelResult.Model);val parts=(actual as NativeResourceModelResult.Model).parts;val wanted=e.getJSONArray("parts");assertEquals(name,wanted.length(),parts.size)
                        for(k in parts.indices){val part=parts[k];val expected=wanted.getJSONObject(k);val g=part.geometry
                            assertEquals(name,expected.getInt("page"),part.page);assertEquals(name,expected.getString("alphaMode"),part.alphaMode)
                            val p=g.positions();val n=g.normals();val uv=g.textureCoordinates()!!;val c=g.colors()!!;val a=g.colorAlpha()!!;val values=expected.getJSONArray("vertex")
                            assertEquals(name,values.length(),g.vertexCount*12)
                            repeat(g.vertexCount){v->for(axis in 0..11){val actualValue=when(axis){in 0..2->p.get(v*3+axis);in 3..5->n.get(v*3+axis-3);in 6..7->uv.get(v*2+axis-6);in 8..10->c.get(v*3+axis-8);else->a.get(v)}
                                assertEquals("$name part$k vertex$v channel$axis",values.getDouble(v*12+axis),actualValue.toDouble(),1e-7)}}
                            val ix=g.indices()!!;val expectedIndex=expected.getJSONArray("indices");assertEquals(name,expectedIndex.length(),ix.remaining());repeat(ix.remaining()){v->assertEquals(name,expectedIndex.getInt(v),ix.get(v))}
                        }
                    }
                }
            }
        }
        assertEquals(161,rows.length());assertEquals(904,queries);assertEquals(704,accepted)
        record("geometry",JSONObject().put("cases",rows.length()).put("queries",queries).put("accepted",accepted).put("fallbacks",queries-accepted).put("sourceHashes",oracle.getJSONObject("sourceHashes")))
    }
    private fun diagnostic(view:NativeWorldView):JSONObject{
        val done=CountDownLatch(1);val result=AtomicReference<JSONObject>();view.generatedDiagnostics{result.set(it);done.countDown()}
        assertTrue(done.await(10,TimeUnit.SECONDS));return result.get()
    }
    private fun present(scene:NativeGeneratedScene):Pair<NativeWorldView,JSONObject>{
        val done=CountDownLatch(1);val error=AtomicReference<String>();val view=AtomicReference<NativeWorldView>()
        foreground.scenario.onActivity{activity->activity.onGeneratedFrame={id->if(id==scene.presentationIdentity)done.countDown()}
            activity.onGeneratedError={value->error.set(value);done.countDown()};activity.presentGenerated(scene);view.set(activity.generatedWorld)}
        assertTrue("Resource model scene did not submit",done.await(80,TimeUnit.SECONDS));assertNull(error.get())
        return view.get() to diagnostic(view.get()).also{assertFalse(it.getBoolean("failed"));assertTrue(it.getLong("frames")>0)}
    }
    private fun screenshot(suffix:String):String{
        val file=File(context.filesDir,"p3-world-$label-models-$suffix.png");android.os.SystemClock.sleep(250)
        assertTrue(UiDevice.getInstance(instrumentation).takeScreenshot(file));assertTrue(file.length()>4096);return file.name
    }
    @Test fun normalGeneratedWorldUsesTheModelGalleryAndRemovingThePackRestoresOriginalGeometry(){
        val rows=oracle.getJSONArray("cases");val row=(0 until rows.length()).map{rows.getJSONObject(it)}.first{it.getString("name")=="render-gallery"}
        val blueprint=JSONObject().put("schemaVersion",1).put("id","resource-gallery").put("title","Resource gallery")
            .put("bounds",JSONObject().put("minX",0).put("maxX",6).put("minY",0).put("maxY",0).put("minZ",0).put("maxZ",6))
            .put("voxels",JSONArray((0..8).map{i->JSONObject().put("x",i%3*3).put("y",0).put("z",i/3*3).put("materialId","stone")
                .put("stage","foundation").put("buildOrder",0).put("sourceBlockId","minecraft:gallery$i")}))
        val now=DomainTime.millis("2026-10-27T07:00:00.000Z")
        val result=DomainEngine.execute(DomainEngine.initial("UTC"),DomainEngine.command("CreateProject","projectId" to "gallery","title" to "Gallery",
            "blueprintId" to "resource-gallery","importedBlueprint" to blueprint,"subtasks" to JSONArray().put(JSONObject().put("id","task").put("title","Task"))),now)
        assertTrue("Gallery domain input: ${result.error}",result.ok);val builder=WorldPlanBuilder();val compiler=NativeWorldPacketCompiler();var view:NativeWorldView?=null
        try{NativeResourceArchive.from(Base64.decode(row.getString("zip"),Base64.DEFAULT)).use{archive->
            val assets=NativeResourceWorldAssets.prepare(ResourcePackStack.of(ResourcePackAssets.prepare(archive)))
            val world=builder.terrain(builder.prepare(WorldFacts.from(result.state)));val options=WorldRenderOptions(now,"UTC",quality=NativeLightingQuality.BALANCED,weather=NativeWeatherOverride(NativeWeatherKind.CLEAR))
            var revision=0L
            fun frame(resources:NativeResourceWorldAssets?)=compiler.prepare(WorldRequestIdentity("isolated-gallery.db",0,revision++),world,options.copy(resources=resources))
            val source=frame(null);val original=source.scene.sources.first{it.owner=="building:gallery"};assertFalse(original.surfaces.any{it.optics.atlas!=null})
            val first=present(source.scene);view=first.first
            instrumentation.runOnMainSync{first.first.navigate("gallery")};val originalScreen=screenshot("original")
            val model=frame(assets);val building=model.scene.sources.first{it.owner=="building:gallery"}
            assertTrue(building.surfaces.any{it.optics.atlas!=null});assertTrue(building.world!!.geometries.count{it.vertexPreparation=="atlas-static-v1"}>=8)
            val second=present(model.scene);instrumentation.runOnMainSync{second.first.navigate("gallery")};val modelScreen=screenshot("resource")
            val adopted=diagnostic(second.first);assertEquals("native-generated",adopted.getString("sourceKind"))
            val removed=frame(null);assertEquals(original.geometryKeys,removed.scene.sources.first{it.owner=="building:gallery"}.geometryKeys)
            val third=present(removed.scene);instrumentation.runOnMainSync{third.first.navigate("gallery")};val removedScreen=screenshot("removed")
            record("geometry-visible",JSONObject().put("before",first.second).put("adopted",adopted).put("removed",diagnostic(third.first))
                .put("screenshots",JSONArray(listOf(originalScreen,modelScreen,removedScreen))).put("modelGeometryCount",building.world!!.geometries.count{it.vertexPreparation=="atlas-static-v1"})
                .put("sourceHashes",oracle.getJSONObject("sourceHashes")))
        }}finally{view?.let{instrumentation.runOnMainSync{it.pause()}};compiler.clear();builder.clear()}
    }
}
