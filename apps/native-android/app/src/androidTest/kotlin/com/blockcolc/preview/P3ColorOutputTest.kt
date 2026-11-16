package com.blockcolc.preview

import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.blockcolc.world.*
import com.blockcolc.world.filament.NativeWorldView
import com.blockcolc.world.generation.BlockPoint
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.nio.FloatBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs
import kotlin.math.tan

/** Pixel interiors come from actual production Three shaders and compositors,
 * exported by tools/export-native-output-oracle.mjs. This is not a BRDF or
 * edge-antialiasing oracle; its exact coverage is recorded in the JSON. */
class P3ColorOutputTest {
    @get:Rule val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val label get()=checkNotNull(InstrumentationRegistry.getArguments().getString("p3Group"))
    private fun oracle()=javaClass.classLoader!!.getResourceAsStream("native-output-oracle.json")!!.use{JSONObject(it.bufferedReader().readText())}
    private fun rgb(a:JSONArray)=LinearRgb(a.getDouble(0).toFloat(),a.getDouble(1).toFloat(),a.getDouble(2).toFloat())
    private fun list(a:JSONArray)=List(3){a.getDouble(it).toFloat()}
    private fun record(name:String,value:JSONObject){File(context.filesDir,"p3-world-$name.json").writeText(value.put("caseLabel",label).toString())}
    private fun camera()=NativeSceneCamera(BlockPoint(0.0,0.0,0.0),BlockPoint(0.0,0.0,100.0),200.0,40.0,
        SourceCamera(40.0,listOf(listOf(-200.0,-200.0,-150.0),listOf(200.0,200.0,100.0)),240.0,.82,.91,1.5,120.0))
    private fun lighting(spec:JSONObject,exposure:Float)=SourceLighting(exposure,list(spec.getJSONArray("clear")),listOf(
        SourceLight("DirectionalLight",listOf(1f,1f,1f),0f,listOf(0f,0f,1f),listOf(0f,0f,100f),false,listOf(0f,0f,0f),0f,0f),
        SourceLight("HemisphereLight",listOf(1f,1f,1f),0f,listOf(0f,1f,0f),listOf(0f,100f,0f),false,listOf(0f,0f,0f),0f,0f)),false,emptyList(),
        spec.getJSONObject("fog").let{SourceFog(list(it.getJSONArray("color")),it.getDouble("near").toFloat(),it.getDouble("far").toFloat())})
    private fun plane(builder:NativePacketBuilder,depth:Double,x:Double,y:Double,sx:Double,sy:Double,material:NativeRenderMaterial){
        val halfH=tan(40.0*Math.PI/360)*depth;val halfW=halfH*.75
        val matrix=floatArrayOf((sx*halfW).toFloat(),0f,0f,0f,0f,(sy*halfH).toFloat(),0f,0f,0f,0f,1f,0f,
            ((x*2-1)*halfW).toFloat(),((1-y*2)*halfH).toFloat(),(100-depth).toFloat(),1f)
        builder.add(NativeSkyGeometry.celestial(),material,FloatBuffer.wrap(matrix),castShadow=false,receiveShadow=false)
    }
    private fun present(scene:NativeGeneratedScene):Pair<NativeWorldView,JSONObject>{
        val done=CountDownLatch(1);val error=AtomicReference<String>();val view=AtomicReference<NativeWorldView>()
        foreground.scenario.onActivity{activity->activity.onGeneratedFrame={if(it==scene.presentationIdentity)done.countDown()}
            activity.onGeneratedError={error.set(it);done.countDown()};activity.presentGenerated(scene,fixedCamera=true);view.set(activity.generatedWorld)}
        assertTrue("Generated colour scene did not become ready",done.await(60,TimeUnit.SECONDS));assertNull(error.get())
        return view.get() to diagnostic(view.get()).also{assertFalse(it.getBoolean("failed"));assertEquals("Colour interiors require the source camera, not a settlement orbit",0.0,it.getJSONObject("camera").getDouble("pitch"),1e-8)}
    }
    private fun diagnostic(view:NativeWorldView):JSONObject{val result=AtomicReference<JSONObject>();val ready=CountDownLatch(1)
        view.generatedDiagnostics{result.set(it);ready.countDown()};assertTrue(ready.await(10,TimeUnit.SECONDS));return result.get()}
    private fun pixels(view:NativeWorldView,name:String,expected:JSONArray):JSONArray{
        val location=IntArray(2);instrumentation.runOnMainSync{view.getLocationOnScreen(location)}
        val file=File(context.filesDir,"p3-world-$label-output-$name.png")
        val device=UiDevice.getInstance(instrumentation);device.waitForIdle(1000);android.os.SystemClock.sleep(120)
        assertTrue(device.takeScreenshot(file));val bitmap=checkNotNull(android.graphics.BitmapFactory.decodeFile(file.path));val results=JSONArray()
        try{repeat(expected.length()){index->val e=expected.getJSONObject(index)
            val x=location[0]+(e.getDouble("x")*view.width).toInt();val y=location[1]+(e.getDouble("y")*view.height).toInt()
            val actual=bitmap.getPixel(x,y);val channels=List(3){(actual shr(16-it*8))and 255};val desired=e.getJSONArray("rgba")
            val delta=List(3){abs(channels[it]-desired.getInt(it))}
            results.put(JSONObject().put("name",e.getString("name")).put("expected",desired).put("actual",JSONArray(channels)).put("delta",JSONArray(delta)))
        }}finally{bitmap.recycle()};return results
    }
    @Test fun sourceDirectAndBloomMatchActualThreeInteriorPixels()=compareGrid(false)
    @Test fun litEmissionTransparencyAndCutoutsUseTheSameSourceColourPolicy()=compareGrid(true)
    private fun compareGrid(lit:Boolean){
        val spec=oracle();val root=NativePacketBuilder("world");val tiles=NativePacketBuilder("building:output")
        assertEquals("178",spec.getString("three"));assertEquals(6,spec.getJSONArray("cases").length());assertEquals(12,spec.getJSONArray("tiles").length())
        plane(root,220.0,.5,.5,1.92,1.92,NativeRenderMaterial(color=rgb(spec.getJSONArray("background")),unlit=true,fog=false))
        val definitions=spec.getJSONArray("tiles")
        repeat(definitions.length()){index->val tile=definitions.getJSONObject(index)
            val color=rgb(tile.getJSONArray("color"))
            plane(tiles,tile.getDouble("depth"),tile.getDouble("x"),tile.getDouble("y"),.4,.5,NativeRenderMaterial(color=if(lit)LinearRgb.BLACK else color,
                unlit=!lit,emission=if(lit)color else LinearRgb.BLACK,emissionStrength=if(lit)1f else 0f,
                opacity=tile.getDouble("alpha").toFloat(),transparent=tile.getBoolean("transparent"),fog=tile.getBoolean("fog"),
                toneMapped=tile.getBoolean("toneMapped"),alphaCutoff=tile.getDouble("cutoff").toFloat()))}
        val sources=listOf(root.build(),tiles.build());val results=JSONArray();var previous:JSONObject?=null;var maximum=0
        val cases=spec.getJSONArray("cases")
        repeat(cases.length()){index->val c=cases.getJSONObject(index);val grade=c.getJSONObject("grade")
            assertEquals(13,c.getJSONArray("pixels").length())
            val post=SourcePost.native(if(c.getBoolean("high"))NativeLightingQuality.HIGH else NativeLightingQuality.LOW).copy(
                worldColor=SourceWorldColor(grade.getInt("saturation"),grade.getInt("brightness"),grade.getInt("contrast")))
            val (view,state)=present(NativeGeneratedScene(sources,lighting(spec,c.getDouble("exposure").toFloat()),post,camera(),0,1))
            assertEquals(!c.getBoolean("high"),state.getJSONObject("colorPipeline").getJSONObject("config").getBoolean("direct"))
            assertEquals(if(c.getBoolean("high"))2 else spec.getJSONObject("gpu").getInt("samples"),state.getJSONObject("colorPipeline").getJSONObject("config").getInt("sampleCount"))
            previous?.let{old->for(key in listOf("owners","geometries","textures"))assertEquals(key,old.getJSONObject("resources").getJSONObject(key).toString(),state.getJSONObject("resources").getJSONObject(key).toString())}
            previous=state
            val samples=pixels(view,(if(lit)"lit-"else"")+c.getString("name"),c.getJSONArray("pixels"))
            repeat(samples.length()){i->repeat(3){channel->maximum=maxOf(maximum,samples.getJSONObject(i).getJSONArray("delta").getInt(channel))}}
            results.put(JSONObject().put("name",c.getString("name")).put("pixels",samples).put("state",state))
        }
        record(if(lit)"output-lit"else"output",JSONObject().put("schema",1).put("oracleThree",spec.getString("three")).put("referenceEvidenceSha256",spec.getString("referenceEvidenceSha256"))
            .put("scope",spec.getString("scope")+if(lit)" Native lit materials have zero diffuse/direct light and pure emission; this isolates the lit evaluator and alpha path without claiming BRDF equivalence."else"")
            .put("results",results).put("maxChannelDelta",maximum))
        assertTrue("Actual source colour interiors differ by $maximum; inspect all recorded samples",maximum<=3)
    }
    @Test fun zeroIntensitySunStillEncodesMappedAndUnmappedLitEmission(){
        val spec=oracle();val results=JSONArray();var maximum=0
        val sourceCases=spec.getJSONArray("cases")
        for(case in 0..1){val sourceCase=sourceCases.getJSONObject(case);val samples=JSONArray();val root=NativePacketBuilder("world")
            for(mapped in listOf(true,false)){
                val tileIndex=if(mapped)0 else 1;val expected=sourceCase.getJSONArray("pixels").getJSONObject(tileIndex)
                val x=if(mapped).25 else .75
                plane(root,100.0,x,.5,.8,1.5,NativeRenderMaterial(color=LinearRgb.BLACK,unlit=false,fog=false,toneMapped=mapped,
                    emission=rgb(spec.getJSONArray("tiles").getJSONObject(0).getJSONArray("color")),emissionStrength=1f))
                samples.put(JSONObject(expected.toString()).put("x",x).put("y",.5))
            }
            val scene=NativeGeneratedScene(listOf(root.build()),lighting(spec,sourceCase.getDouble("exposure").toFloat()).copy(fog=null),
                SourcePost.native(NativeLightingQuality.LOW),camera(),0,1)
            val (view,state)=present(scene)
            val actual=pixels(view,"zero-sun-$case",samples);repeat(actual.length()){i->repeat(3){channel->maximum=maxOf(maximum,actual.getJSONObject(i).getJSONArray("delta").getInt(channel))}}
            results.put(JSONObject().put("case",sourceCase.getString("name")).put("pixels",actual).put("state",state))
            if(case==0){
                fun update(version:Long,direct:Boolean,exposure:Float):Boolean{val done=CountDownLatch(1);val accepted=AtomicReference<Boolean>()
                    view.updateEnvironment(scene.presentationIdentity,version,NativeSceneEnvironment(scene.lighting.copy(exposure=exposure),directColor=direct)){
                        accepted.set(it);done.countDown()};assertTrue(done.await(10,TimeUnit.SECONDS));return accepted.get()}
                assertFalse(update(20,false,1.4f));val refused=diagnostic(view)
                assertEquals(state.getLong("environmentUpdates"),refused.getLong("environmentUpdates"));assertEquals(state.getLong("environmentFailures")+1,refused.getLong("environmentFailures"))
                assertEquals(state.getJSONObject("colorPipeline").toString(),refused.getJSONObject("colorPipeline").toString())
                assertTrue(update(21,true,1.4f));val updated=diagnostic(view)
                for(key in listOf("owners","geometries","textures"))assertEquals(key,state.getJSONObject("resources").getJSONObject(key).toString(),updated.getJSONObject("resources").getJSONObject(key).toString())
                val bright=sourceCases.getJSONObject(1).getJSONArray("pixels");val expected=JSONArray()
                for(i in 0..1)expected.put(JSONObject(bright.getJSONObject(i).toString()).put("x",if(i==0).25 else .75).put("y",.5))
                val changed=pixels(view,"zero-sun-independent",expected);repeat(changed.length()){i->repeat(3){channel->maximum=maxOf(maximum,changed.getJSONObject(i).getJSONArray("delta").getInt(channel))}}
                results.put(JSONObject().put("case","independent-exposure-and-rejected-colour-path").put("pixels",changed).put("refused",refused).put("state",updated))
            }
        }
        record("output-zero-sun",JSONObject().put("schema",1).put("results",results).put("maxChannelDelta",maximum)
            .put("scope","Zero-intensity directional variant, pure emission only; not a lit BRDF comparison"))
        assertTrue("Zero-sun native colour variant differs by $maximum",maximum<=3)
    }
}
