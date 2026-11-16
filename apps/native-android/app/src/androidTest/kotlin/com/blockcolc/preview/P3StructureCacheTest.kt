package com.blockcolc.preview

import android.os.Debug
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.DomainDocument
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.preview.world.*
import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Same frozen 25-building facts; no database selection or GPU warm-up is
 * smuggled into the CPU timing. Each planner/cache owner is newly created. */
class P3StructureCacheTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun coldOwnersRestoreVerifiedGeometryForTheSameComplexTownAndCorruptFilesRegenerate(){
        val root=File(context.cacheDir,"p3-structure-"+UUID.randomUUID()).canonicalFile
        val domain=DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()})
        val facts=WorldFacts.from(domain);val port=AndroidStructureCache(context,root,writeDelayMs=0)
        val samples=JSONArray();var hitCount=0
        val observed=object:OriginalStructureStorage by port{
            override fun read(key:String,cancelled:()->Boolean)=port.read(key,cancelled)?.also{hitCount++}
        }
        fun prepare(cached:Boolean):WorldCpuPlan{
            val planner=WorldPlanBuilder(structures=OriginalStructureCache(storage=if(cached)observed else null))
            val wall=SystemClock.elapsedRealtimeNanos();val cpu=Debug.threadCpuTimeNanos()
            return planner.prepare(facts).also{samples.put(JSONObject().put("cached",cached).put("wallMs",(SystemClock.elapsedRealtimeNanos()-wall)/1e6)
                .put("cpuMs",(Debug.threadCpuTimeNanos()-cpu)/1e6).put("hits",hitCount).put("buildings",it.buildings.size))}
        }
        try{
            val original=prepare(true);assertEquals(25,original.buildings.size);assertTrue(port.awaitWritesForTest(45,TimeUnit.SECONDS))
            val files=File(root,"original-structures").listFiles()!!.filter{it.name.endsWith(".bin")};assertTrue(files.isNotEmpty())
            for(i in 0..2){val restored=prepare(true);val live=prepare(false)
                assertEquals(original.spatial.key,restored.spatial.key);assertEquals(live.buildings.map{it.fact.id},restored.buildings.map{it.fact.id})
                for((a,b)in live.buildings.zip(restored.buildings)){
                    val key=OriginalStructureCodec.key(a.originalGeometry.inputKey,a.originalGeometry.origin)
                    assertArrayEquals(a.fact.id,OriginalStructureCodec.encode(key,a.originalGeometry),OriginalStructureCodec.encode(key,b.originalGeometry))
                }
            }
            assertTrue(hitCount>=files.size*3)
            val damaged=files.first();damaged.writeBytes(byteArrayOf(1,2,3));assertNull(port.read(damaged.name.removeSuffix(".bin")){false})
            prepare(true);assertTrue(port.awaitWritesForTest(45,TimeUnit.SECONDS));assertNotNull(port.read(damaged.name.removeSuffix(".bin")){false})
            File(context.filesDir,"p3-structure-cache.json").writeText(JSONObject().put("schema",1).put("sourceSha",domain.sha256).put("samples",samples)
                .put("files",files.size).put("bytes",files.sumOf{it.length()}).put("corruptionRegenerated",true)
                .put("scope","Emulator Android CPU planner, identical 25-building source; excludes full-world GPU and whole-App cold startup").toString())
        }finally{port.close();assertTrue(port.awaitTermination(30,TimeUnit.SECONDS));check(root.parentFile==context.cacheDir.canonicalFile);if(root.exists())assertTrue(root.deleteRecursively())}
    }
}
