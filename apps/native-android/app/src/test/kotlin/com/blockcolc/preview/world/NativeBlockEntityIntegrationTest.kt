package com.blockcolc.preview.world

import com.blockcolc.domain.*
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.world.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class NativeBlockEntityIntegrationTest {
    private val now=DomainTime.millis("2026-10-27T04:00:00.000Z")
    private val options=WorldRenderOptions(now,"UTC",weather=NativeWeatherOverride(NativeWeatherKind.CLEAR))
    private fun blueprint(title:String):JSONObject {
        fun face(text:String)=JSONObject().put("lines",JSONArray(listOf(text,"方块钟","", "26.3"))).put("dyeColor","black").put("glowing",false)
        fun voxel(x:Int,id:String)=JSONObject().put("x",x).put("y",0).put("z",0).put("materialId","wood").put("stage","details").put("buildOrder",0).put("sourceBlockId",id)
        val voxels=JSONArray().put(voxel(0,"minecraft:oak_sign").put("sourceBlockState",JSONObject().put("rotation","2"))
            .put("sign",JSONObject().put("front",face(title)).put("back",face("Back"))))
            .put(voxel(1,"minecraft:campfire").put("sourceBlockState",JSONObject().put("facing","west").put("lit","true"))
                .put("campfire",JSONObject().put("slots",JSONArray().put(JSONObject().put("slot",0).put("itemId","minecraft:potato").put("count",2)))))
            .put(voxel(2,"minecraft:stone"))
        return JSONObject().put("schemaVersion",1).put("id","entity-fixture").put("title","Static entity test")
            .put("bounds",JSONObject().put("minX",0).put("maxX",2).put("minY",0).put("maxY",0).put("minZ",0).put("maxZ",0)).put("voxels",voxels)
    }
    private fun state(text:String="Front"):DomainDocument {
        var state=DomainEngine.initial("UTC")
        for(id in listOf("a","b")){val result=DomainEngine.execute(state,DomainEngine.command("CreateProject","projectId" to id,"title" to id,"blueprintId" to "entity-fixture",
            "importedBlueprint" to blueprint(if(id=="a")text else "Stable"),"subtasks" to JSONArray().put(JSONObject().put("id","task-$id").put("title",id))),now)
            check(result.ok){result.error!!};state=result.state}
        return state
    }
    private fun pixels(seed:String=""):NativePixelTexture {
        val bytes=ByteArray(128*64*4);val hash=seed.hashCode();repeat(4){bytes[it]=(hash ushr(it*8)).toByte()}
        return NativePixelTexture(128,64,ByteBuffer.wrap(bytes),mipmaps=false,wrapS=1001,wrapT=1001,minFilter=1006,magFilter=1006,anisotropy=1f)
    }
    @Test fun importedMetadataRendersOnItsOwnOwnerAndOnlyChangedSignTextInvalidatesThatOwner(){
        val fail=AtomicBoolean(false);var rasterized=0
        val compiler=NativeWorldPacketCompiler(NativeSignRasterizer{check(!fail.get()){ "Synthetic raster failure" };rasterized++;pixels(it.lines.joinToString())});val builder=WorldPlanBuilder()
        try{
            fun render(document:DomainDocument,revision:Long)=compiler.prepare(WorldRequestIdentity("isolated.db",0,revision),builder.terrain(builder.prepare(WorldFacts.from(document))),options)
            val state=state();val first=render(state,1);assertEquals(0,first.pendingBlockEntities);assertEquals(3,rasterized)
            fun owner(frame:NativeWorldFrame,id:String)=frame.scene.sources.single{it.owner==id}
            val a=owner(first,"building:a");assertEquals(2,a.textures.count{it.width==128&&it.height==64&&!it.mipmaps})
            val packed=checkNotNull(a.world);val textPackets=packed.packets.filter{p->JSONObject(packed.materials[p.material]).getBoolean("unlit")}
            assertEquals(2,textPackets.size);assertTrue(textPackets.all{!it.castShadow&&!it.receiveShadow})
            val renamed=DomainEngine.execute(state,DomainEngine.command("RenameProject","projectId" to "a","title" to "Renamed"),now+1).let{check(it.ok);it.state}
            val same=render(renamed,2);for(i in 0..2)assertSame(first.scene.sources[i],same.scene.sources[i]);assertEquals(3,rasterized)
            fail.set(true);assertThrows(IllegalStateException::class.java){render(state("Changed"),3)}
            fail.set(false);val recovered=render(renamed,4);for(i in 0..2)assertSame(first.scene.sources[i],recovered.scene.sources[i])
            val edited=render(state("Changed"),5);assertSame(first.scene.sources[0],edited.scene.sources[0]);assertSame(owner(first,"building:b"),owner(edited,"building:b"));assertNotSame(a,owner(edited,"building:a"))
            assertEquals(4,rasterized);assertEquals(first.terrainKey,edited.terrainKey);assertEquals(first.sceneryKey,edited.sceneryKey)
            assertEquals(state.sha256,state().sha256)
        }finally{compiler.clear();builder.clear()}
    }
    @Test fun workerReceivesTheRasterizerPortAndPreparesAllTextOffItsDeliveryThread(){
        val queue=LinkedBlockingQueue<Runnable>();val threads=ArrayList<String>();val results=ArrayList<PreparedWorldRequest>()
        val worker=WorldGenerationWorker({queue.add(it)},NativeSignRasterizer{threads+=Thread.currentThread().name;pixels()})
        try{
            worker.request(WorldRequestIdentity("isolated.db",0,1),state(),WorldTerrainOptions(rendering=options),results::add){throw AssertionError(it)}
            (queue.poll(45,TimeUnit.SECONDS)?:throw AssertionError("Generated world never reached delivery")).run()
            assertEquals(1,results.size);assertEquals(0,results.single().frame!!.pendingBlockEntities)
            assertEquals(3,threads.size);assertTrue(threads.all{it=="blockcolc-world-generation"})
        }finally{worker.close();assertTrue(worker.awaitTermination(15,TimeUnit.SECONDS))}
    }
}
