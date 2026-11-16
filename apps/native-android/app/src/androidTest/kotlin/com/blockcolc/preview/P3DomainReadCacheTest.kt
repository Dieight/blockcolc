package com.blockcolc.preview

import android.os.Debug
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.PipelineCost
import com.blockcolc.storage.*
import com.blockcolc.storage.android.AndroidDomainReadCache
import com.blockcolc.storage.android.AndroidStateDatabase
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.TimeUnit

/** Host runs each phase in a fresh instrumentation process against a new
 * captured-data DB. This is an IO/correctness experiment, not UI startup time. */
class P3DomainReadCacheTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private val args=InstrumentationRegistry.getArguments()
    @Test fun removeOnlyTheOwnedExperimentKeyAndCache(){
        require(args.getString("p3CheckpointPhase")=="cleanup")
        val scope=checkNotNull(args.getString("p3CheckpointScope"));require(scope.matches(Regex("p3-cache-[a-f0-9]+")))
        val alias="${context.packageName}.$scope.wrap.v1"
        val store=java.security.KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        store.deleteEntry(alias);assertFalse(store.containsAlias(alias))
        android.util.AtomicFile(File(context.noBackupFilesDir,"$scope-key.bin")).delete()
        val directory=File(context.cacheDir,scope)
        val own=Regex("(?:[a-f0-9]{64}-[a-f0-9]{64}|blueprints-[a-f0-9]{64})\\.bin(?:\\.bak|\\.new)?")
        directory.listFiles().orEmpty().forEach{file->check(file.isFile&&own.matches(file.name));check(file.delete())}
        if(directory.exists())check(directory.delete())
        File(context.filesDir,"p3-domain-cache-cleanup.json").writeText(JSONObject().put("caseLabel",args.getString("p3Group")).put("completed",true).put("scope",scope).toString())
    }
    private class Meter(val cache:AndroidDomainReadCache):DomainReadCache {
        var hits=0;var misses=0;var blueprintHits=0
        override fun read(contentDigest:String,domainSha:String,parts:()->List<String>)=cache.read(contentDigest,domainSha,parts).also{if(it==null)misses++ else hits++}
        override fun readBlueprints(assetDigest:String)=cache.readBlueprints(assetDigest).also{if(it!=null)blueprintHits++}
        override fun offer(contentDigest:String,domain:DomainDocument,blueprints:BlueprintCheckpointSource?)=cache.offer(contentDigest,domain,blueprints)
    }
    @Test fun authenticatedCheckpointMatchesRealSqliteWithoutHidingChangedOrDamagedFacts(){
        val name=checkNotNull(args.getString("p3CheckpointDatabase"));require(name.matches(Regex("p2-checkpoint-[a-f0-9]+\\.db")))
        val scope=checkNotNull(args.getString("p3CheckpointScope"));require(scope.matches(Regex("p3-cache-[a-f0-9]+")))
        val expected=checkNotNull(args.getString("p3CheckpointDomain"));require(expected.matches(Regex("[a-f0-9]{64}")))
        val phase=checkNotNull(args.getString("p3CheckpointPhase"));require(phase in setOf("write","read"))
        val database=AndroidStateDatabase(context,name);val cache=AndroidDomainReadCache(context,scope);val meter=Meter(cache)
        try{
            val spans=linkedMapOf<String,Long>()
            val started=SystemClock.elapsedRealtimeNanos();val cpu=Debug.threadCpuTimeNanos()
            val loaded=PipelineCost.collect({stage,begin,end,_->
                if(stage.startsWith("storage.")||stage.startsWith("checkpoint.")||stage.startsWith("blueprint.")||
                    stage.startsWith("domain.")||stage.startsWith("json."))
                    spans[stage]=(spans[stage]?:0)+(end-begin)
            }){checkNotNull(NativeStateStore(database,meter).load())}
            val cpuMs=(Debug.threadCpuTimeNanos()-cpu)/1e6;val wallMs=(SystemClock.elapsedRealtimeNanos()-started)/1e6
            assertEquals(expected,loaded.domain.sha256);assertNull(loaded.recovery.plan);assertNull(loaded.domain.activeFocusSession())
            assertEquals(if(phase=="read")1 else 0,meter.hits)
            cache.flush().get(90,TimeUnit.SECONDS)
            val entries=File(context.cacheDir,scope).listFiles().orEmpty().filter{it.name.endsWith(".bin")}
            assertEquals(2,entries.size)
            val documents=entries.single{!it.name.startsWith("blueprints-")}
            val blueprints=entries.single{it.name.startsWith("blueprints-")}
            assertTrue(documents.length() in 1..1_000_000);assertTrue(blueprints.length() in 1..64_000)
            var changedRevisionUsesBlueprints=false
            var damagedBlueprintCacheFallsBack=false
            fun damage(file:File){RandomAccessFile(file,"rw").use{it.seek(it.length()-1);val last=it.read();it.seek(it.length()-1);it.write(last xor 1)}}
            if(phase=="read"){
                // Corrupt only the owned cache. A miss must fall back to the
                // actual valid SQLite data, then repair this disposable file.
                damage(documents)
                val misses=meter.misses;val beforeBlueprintHits=meter.blueprintHits
                assertEquals(expected,NativeStateStore(database,meter).load()!!.domain.sha256);assertEquals(misses+1,meter.misses)
                assertEquals(beforeBlueprintHits+1,meter.blueprintHits)
                cache.flush().get(90,TimeUnit.SECONDS)
                assertEquals(expected,NativeStateStore(database,meter).load()!!.domain.sha256)
                val original=database.transaction{it.query("SELECT canonical FROM domain_values WHERE name='schemaVersion'").single().single() as String}
                try{
                    database.transaction{it.execute("UPDATE domain_values SET canonical='999' WHERE name='schemaVersion'")}
                    assertThrows(StorageCorruption::class.java){NativeStateStore(database,meter).load()}
                }finally{database.transaction{it.execute("UPDATE domain_values SET canonical=? WHERE name='schemaVersion'",listOf(original))}}
                val recovery=database.transaction{it.query("SELECT canonical FROM local_recovery WHERE id=1").single().single() as String}
                val hits=meter.hits
                try{
                    database.transaction{it.execute("UPDATE local_recovery SET canonical='{}' WHERE id=1")}
                    assertThrows(StorageCorruption::class.java){NativeStateStore(database,meter).load()};assertEquals(hits+1,meter.hits)
                }finally{database.transaction{it.execute("UPDATE local_recovery SET canonical=? WHERE id=1",listOf(recovery))}}
                assertEquals(expected,NativeStateStore(database,meter).load()!!.domain.sha256)

                // Commit a real session without creating an exact index for
                // its new revision. The validated blueprint set is reusable.
                val readOnly=object:DomainReadCache by meter{
                    override fun offer(contentDigest:String,domain:DomainDocument,blueprints:BlueprintCheckpointSource?)=Unit
                }
                val writer=NativeStateStore(database,readOnly);val before=checkNotNull(writer.load())
                val changed=DomainEngine.execute(before.domain,DomainEngine.command("StartFocus",
                    "sessionId" to "cache-fixture:${java.util.UUID.randomUUID()}","subtaskId" to null,"plannedDurationMs" to 60000,
                    "marathon" to true,"deferredSettlement" to true),System.currentTimeMillis())
                assertTrue(changed.error,changed.ok)
                val saved=writer.commit(before.token,"checkpoint-revision-fixture",changed.state,RecoveryContext())
                val blueprintHits=meter.blueprintHits
                val reused=NativeStateStore(database,readOnly).load()
                assertEquals(StoredState(saved.token,changed.state,RecoveryContext()),reused)
                assertEquals(blueprintHits+1,meter.blueprintHits)
                changedRevisionUsesBlueprints=true
                damage(blueprints)
                assertEquals(reused,NativeStateStore(database,readOnly).load())
                assertEquals(blueprintHits+1,meter.blueprintHits)
                damagedBlueprintCacheFallsBack=true
            }
            val result=JSONObject().put("completed",true).put("caseLabel",args.getString("p3Group")).put("phase",phase)
                .put("domainSha",expected).put("database",name).put("cacheScope",scope).put("wallMs",wallMs).put("threadCpuMs",cpuMs)
                .put("storageStagesWallMs",JSONObject(spans.mapValues{it.value/1e6}))
                .put("maxHeapMiB",Runtime.getRuntime().maxMemory()/1048576).put("cacheBytes",documents.length())
                .put("blueprintCacheBytes",blueprints.length()).put("changedRevisionUsesBlueprints",changedRevisionUsesBlueprints)
                .put("damagedBlueprintCacheFallsBack",damagedBlueprintCacheFallsBack)
                .put("scope","Fresh Android instrumentation process, same captured actual SQLite rows, default heap and real Android Keystore. Storage experiment only; Debug timing is not app startup timing.")
            File(context.filesDir,"p3-domain-cache-$phase.json").writeText(result.toString())
        }finally{cache.flush().get(90,TimeUnit.SECONDS);cache.close();database.close()}
    }
}
