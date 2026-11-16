package com.blockcolc.preview

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.blockcolc.domain.*
import com.blockcolc.preview.world.*
import com.blockcolc.world.*
import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Real Android Canvas, generation worker and Filament drawing. Test facts
 * stay in memory; the runner restores the preview APKs and its existing DB. */
class P3StaticBlockEntitiesTest {
    @get:Rule val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val label get()=(InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone").also{require(it.matches(Regex("[a-z0-9-]{1,60}")))}
    private val now=DomainTime.millis("2026-10-27T04:00:00.000Z")
    private fun blueprint(front:String):JSONObject {
        fun face(text:String,dye:String="black",glow:Boolean=false)=JSONObject().put("lines",JSONArray(listOf(text,"方块钟","", "26.3"))).put("dyeColor",dye).put("glowing",glow)
        fun voxel(x:Int,y:Int,z:Int,id:String)=JSONObject().put("x",x).put("y",y).put("z",z).put("materialId","wood").put("stage","details").put("buildOrder",0).put("sourceBlockId",id)
        val voxels=JSONArray()
        for(x in 0..8)for(z in 0..3)voxels.put(voxel(x,0,z,"minecraft:stone").put("materialId","stone"))
        for((i,id)in listOf("oak_sign","oak_wall_sign","birch_hanging_sign","birch_wall_hanging_sign").withIndex())voxels.put(voxel(1+i*2,2,0,"minecraft:$id")
            .put("sourceBlockState",JSONObject().put("rotation","0").put("facing","south"))
            .put("sign",JSONObject().put("front",face(front)).put("back",face("Back","white",true))))
        for((i,id)in listOf("campfire","soul_campfire","campfire").withIndex())voxels.put(voxel(2+i*2,1,2,"minecraft:$id").put("sourceBlockState",JSONObject().put("facing","east").put("lit",if(i==2)"false"else"true"))
            .put("campfire",JSONObject().put("slots",JSONArray((0..3).map{s->JSONObject().put("slot",s).put("itemId",if(s%2==0)"minecraft:beef"else"minecraft:potato").put("count",s+1)}))))
        return JSONObject().put("schemaVersion",1).put("id","entity-fixture").put("title","Imported static entities")
            .put("bounds",JSONObject().put("minX",0).put("maxX",8).put("minY",0).put("maxY",2).put("minZ",0).put("maxZ",3)).put("voxels",voxels)
    }
    private fun facts(text:String="Native"):DomainDocument {
        var state=DomainEngine.initial("UTC")
        for(id in listOf("a","b")){val result=DomainEngine.execute(state,DomainEngine.command("CreateProject","projectId" to id,"title" to id,"blueprintId" to "entity-fixture",
            "importedBlueprint" to blueprint(if(id=="a")text else "Stable"),"subtasks" to JSONArray().put(JSONObject().put("id","task-$id").put("title",id))),now)
            check(result.ok){result.error!!};state=result.state}
        return state
    }
    private fun pixels(texture:NativePixelTexture):IntArray {
        val input=texture.pixels();return IntArray(texture.width*texture.height){val r=input.get().toInt()and 255;val g=input.get().toInt()and 255;val b=input.get().toInt()and 255;val a=input.get().toInt()and 255
            (a shl 24)or(r shl 16)or(g shl 8)or b}
    }
    private fun present(scene:NativeGeneratedScene):JSONObject {
        val done=CountDownLatch(1);val error=AtomicReference<String>()
        foreground.scenario.onActivity{it.onGeneratedFrame={id->if(id==scene.presentationIdentity)done.countDown()};it.onGeneratedError={message->error.set(message);done.countDown()};it.presentGenerated(scene)}
        assertTrue("Native static entity scene never submitted a frame",done.await(80,TimeUnit.SECONDS));assertNull(error.get())
        val result=AtomicReference<JSONObject>();val diagnostic=CountDownLatch(1)
        foreground.scenario.onActivity{it.generatedWorld!!.generatedDiagnostics{value->result.set(value);diagnostic.countDown()}}
        assertTrue(diagnostic.await(10,TimeUnit.SECONDS));return result.get().also{assertFalse(it.getBoolean("failed"));assertEquals(scene.presentationIdentity,it.getLong("presentationIdentity"))}
    }
    private fun screen(name:String){
        val file=File(context.filesDir,"p3-world-$label-$name.png");val device=UiDevice.getInstance(instrumentation)
        device.waitForIdle(1000);android.os.SystemClock.sleep(120);check(device.takeScreenshot(file));assertTrue(file.length()>4096)
    }
    @Test fun androidGlyphsAndImportedSignCampfireOwnersRenderAndUpdateIndependently(){
        val rasterizer=AndroidSignRasterizer();val blank=SignFace(listOf("","","",""),"black",false);val base=pixels(rasterizer.rasterize(blank))
        val mainFailure=AtomicReference<Exception>()
        instrumentation.runOnMainSync{try{rasterizer.rasterize(blank)}catch(e:Exception){mainFailure.set(e)}}
        assertTrue(mainFailure.get() is IllegalStateException)
        val atlas=Bitmap.createBitmap(512,256,Bitmap.Config.ARGB_8888);val canvas=Canvas(atlas);val glyphs=JSONArray()
        try{
            for((index,color)in NativeStaticBlockEntities.dyeColors.keys.withIndex()){
                val face=SignFace(listOf("Native / 中", "方块钟 26.3", "", "Four lines"),color,index%2==0)
                val texture=rasterizer.rasterize(face);val rgba=pixels(texture);val changed=rgba.indices.count{rgba[it]!=base[it]}
                assertTrue("Actual Android text did not alter the opaque wood tile",changed>40);assertTrue(rgba.all{it ushr 24==255})
                val tile=Bitmap.createBitmap(rgba,128,64,Bitmap.Config.ARGB_8888)
                try{canvas.drawBitmap(tile,(index%4*128).toFloat(),(index/4*64).toFloat(),null)}finally{tile.recycle()}
                glyphs.put(JSONObject().put("dye",color).put("glowing",face.glowing).put("changedPixels",changed).put("rgbaSha256",texture.sha256))
            }
            File(context.filesDir,"p3-world-$label-sign-glyphs.png").outputStream().use{check(atlas.compress(Bitmap.CompressFormat.PNG,100,it))}
        }finally{atlas.recycle()}
        val queue=LinkedBlockingQueue<Runnable>();val threadNames=ArrayList<String>();val ready=ArrayList<PreparedWorldRequest>()
        val worker=WorldGenerationWorker({queue.add(it)},NativeSignRasterizer{threadNames+=Thread.currentThread().name;rasterizer.rasterize(it)})
        try{
            val options=WorldTerrainOptions(rendering=WorldRenderOptions(now,"UTC",weather=NativeWeatherOverride(NativeWeatherKind.CLEAR),outlines=NativeOutlineVisibility.OFF))
            fun prepare(document:DomainDocument,revision:Long):PreparedWorldRequest {
                worker.request(WorldRequestIdentity("in-memory-entities",0,revision),document,options,ready::add){throw AssertionError(it)}
                (queue.poll(60,TimeUnit.SECONDS)?:throw AssertionError("Entity world never reached UI delivery")).run();return ready.last()
            }
            val state=facts();val beforeSha=state.sha256;val first=prepare(state,1);val frame=first.frame!!
            assertEquals(0,frame.pendingBlockEntities);assertTrue(threadNames.isNotEmpty());assertTrue(threadNames.all{it=="blockcolc-world-generation"})
            val tiles=frame.scene.sources.filter{it.owner.startsWith("building:")}.flatMap{it.textures}.filter{it.width==128&&it.height==64&&!it.mipmaps}
            assertEquals(3,tiles.map{it.samplingIdentity}.distinct().size)
            val before=present(frame.scene);screen("entities-world")
            fun closeup(prepared:PreparedWorldRequest):NativeGeneratedScene {
                val f=prepared.frame!!;val b=prepared.plan.buildings.first();val p=b.placement;val c=f.scene.camera
                val point=BlockPoint(p.worldPosition.x+p.blueprintOffset.x+4,p.worldPosition.y+1.1,p.worldPosition.z+p.blueprintOffset.z+1)
                val camera=NativeSceneCamera(point,BlockPoint(point.x+5,point.y+4,point.z+5),20.0,c.fov,c.volume.copy(framingRadius=6.0),c.aspect)
                return f.scene.withPresentation(camera=camera)
            }
            val focused=present(closeup(first));screen("entities-closeup")
            val edited=prepare(facts("Updated"),2);val after=present(closeup(edited));screen("entities-edited")
            val ownersBefore=focused.getJSONObject("ownerIdentities");val ownersAfter=after.getJSONObject("ownerIdentities")
            assertEquals(ownersBefore.getString("world"),ownersAfter.getString("world"));assertEquals(ownersBefore.getString("building:b"),ownersAfter.getString("building:b"));assertNotEquals(ownersBefore.getString("building:a"),ownersAfter.getString("building:a"))
            assertEquals(beforeSha,state.sha256);assertEquals(0,edited.frame!!.pendingBlockEntities)
            File(context.filesDir,"p3-world-static-entities.json").writeText(JSONObject().put("schema",1).put("caseLabel",label).put("glyphs",glyphs).put("rasterThreads",JSONArray(threadNames))
                .put("before",before).put("focused",focused).put("after",after).put("beforeSourceSha",beforeSha).put("sourceShaAfterRead",state.sha256)
                .put("pendingBlockEntities",edited.frame!!.pendingBlockEntities).put("scope","Real native glyph rasterization, in-memory domain to generation worker to Filament; owner updates and displayed frames. Exact Minecraft fonts/items, animated fire/smoke and resource-pack bodies are outside this static fallback scope.").toString())
        }finally{worker.close();assertTrue(worker.awaitTermination(15,TimeUnit.SECONDS))}
    }
}
