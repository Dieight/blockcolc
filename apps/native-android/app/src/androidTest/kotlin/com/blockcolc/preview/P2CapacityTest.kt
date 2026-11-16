package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.*
import com.blockcolc.focus.*
import com.blockcolc.storage.*
import com.blockcolc.storage.android.AndroidStateDatabase
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

/** Synthetic capacity and atomicity cases. Never touches the selected preview DB. */
class P2CapacityTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private fun initial()=DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()})
    private val at="2026-10-23T08:00:00.000Z"
    private fun save(name:String,value:JSONObject)=File(context.filesDir,"p2-$name.json").writeText(value.toString())
    private fun importAndRoundTripLarge(store:NativeStateStore,token:StateToken,result:JSONObject):StateToken{
        // All archive construction/import/export intermediates die at this
        // method boundary, before the separate daily-merge/restore workflow.
        // Keep the real 20,000 records; do not inflate the heap or shrink input.
        val raw=initial().json();val history=raw.getJSONArray("focusHistory")
        repeat(20000){i->val start=DomainTime.millis("2026-09-16T00:00:00.000Z")+i*61000L
            history.put(JSONObject().put("id","capacity-$i").put("projectId","complex-0").put("subtaskId","read")
                .put("startedAt",DomainTime.format(start)).put("endsAt",DomainTime.format(start+60000)).put("plannedDurationMs",60000).put("timeZoneAtStart","Asia/Shanghai")
                .put("status","interrupted").put("interruptedAt",DomainTime.format(start+1000)).put("interruptionReason","user-cancelled")
                .put("interruptionCategory","other").put("interruptionNote","容量验证".repeat(40)).put("actualDurationMs",1000))}
        val large=DomainDocument.fromOwnedJson(raw);val wire=BackupCodec.write(large,at)
        val bytes=StrictJson.utf8Size(wire);assertTrue("real payload exceeds the obsolete 10 MiB ceiling",bytes>10*1024*1024)
        val begin=System.nanoTime();val parsed=BackupCodec.read(wire);assertEquals(large.sha256,parsed.domain.sha256)
        result.put("parseMs",(System.nanoTime()-begin)/1e6).put("wireBytes",bytes).put("history",history.length())
        val imported=store.importBackup(token,"large-import",parsed,at);assertEquals(large.sha256,store.load()!!.domain.sha256)
        val exported=store.exportBackup(at);assertEquals(large.sha256,BackupCodec.read(exported).domain.sha256)
        return imported.token
    }

    @Test fun oversizedSqliteTextRowsKeepUnicodeNullNumbersAliasesAndOrder(){
        val name="p2-large-row-${UUID.randomUUID()}.db"
        try{AndroidStateDatabase(context,name).use{db->
            val large="汉😀'\"".repeat(500000)
            db.transaction{sql->
                sql.execute("CREATE TABLE capacity_rows(id INTEGER PRIMARY KEY,body TEXT,other TEXT,n INTEGER,v REAL,missing TEXT)")
                sql.execute("INSERT INTO capacity_rows VALUES(1,?,?,?,0.125,NULL)",listOf("small","null",9007199254740991L))
                sql.execute("INSERT INTO capacity_rows VALUES(2,?,?,?,0.375,NULL)",listOf(large,"",-9007199254740991L))
                val rows=sql.query("SELECT body AS payload,other,n,v,missing FROM capacity_rows WHERE id>=? ORDER BY id DESC",listOf(1))
                assertEquals(2,rows.size);assertEquals(listOf(large,"",-9007199254740991L,0.375,null),rows[0])
                assertEquals(listOf("small","null",9007199254740991L,0.125,null),rows[1])
            }
            save("large-row-reader",JSONObject().put("completed",true).put("textBytes",StrictJson.utf8Size(large)))
        }}finally{context.deleteDatabase(name)}
    }

    @Test fun largeRealBackupRoundTripsAndMergesOnAndroidSqlite() {
        val name="p2-capacity-${UUID.randomUUID()}.db";val result=JSONObject().put("completed",false)
        try { AndroidStateDatabase(context,name).use { db ->
            val store=NativeStateStore(db);val first=store.initialize(initial());val begin=System.nanoTime()
            val imported=importAndRoundTripLarge(store,first.token,result)
            store.captureDaily(imported,at);store.captureDaily(imported,"2026-10-24T08:00:00.000Z")
            assertEquals(1,store.backupRoots().count{it.kind=="daily"})
            val rollback=store.backupRoots().single{it.kind=="rollback"}
            store.restore(imported,"large-restore",rollback.id,at);assertEquals(first.domain,store.load()!!.domain)
            result.put("roundTripAndRollbackMs",(System.nanoTime()-begin)/1e6).put("completed",true)
        }}catch(error:Throwable){result.put("failure",error.toString());throw error}
        finally{save("capacity",result);context.deleteDatabase(name)}
    }

    /** Optional local, user-owned archive. It stays outside the APK and uses
     * a disposable DB. This complements the long-history case with the large
     * blueprint bodies and resource mixtures found in actual exported data. */
    @Test fun capturedLargeBackupRoundTripsWithoutReplacingSelectedDatabase(){
        val args=InstrumentationRegistry.getArguments()
        org.junit.Assume.assumeTrue("A local captured backup is supplied only to this explicit capacity run",args.containsKey("p3CapacityCapture")&&args.containsKey("p3CapacitySha256"))
        val filename=checkNotNull(args.getString("p3CapacityCapture"))
        val digest=checkNotNull(args.getString("p3CapacitySha256"))
        require(filename.matches(Regex("p3-startup-capture-[a-f0-9-]{36}\\.json"))&&digest.matches(Regex("[a-f0-9]{64}")))
        val source=File(context.filesDir,filename);require(source.isFile&&source.length() in 10L*1024*1024+1..StrictJson.FILE_LIMIT.toLong())
        val actual=java.security.MessageDigest.getInstance("SHA-256")
        source.inputStream().use{stream->val buffer=ByteArray(65536);while(true){val n=stream.read(buffer);if(n<0)break;actual.update(buffer,0,n)}}
        assertEquals(digest,actual.digest().joinToString(""){"%02x".format(it.toInt()and 255)})
        val name="p2-capacity-captured-${UUID.randomUUID()}.db"
        val result=JSONObject().put("completed",false).put("wireBytes",source.length()).put("sourceSha256",digest)
        fun import(store:NativeStateStore,token:StateToken):Pair<StateToken,String>{
            val started=System.nanoTime();val parsed=BackupCodec.read(source.readText())
            result.put("parseMs",(System.nanoTime()-started)/1e6)
            val projection=parsed.domain.projectionJson()
            result.put("projects",projection.getJSONArray("projects").length()).put("history",projection.getJSONArray("focusHistory").length())
            val receipt=store.importBackup(token,"captured-import",parsed,at)
            assertEquals(parsed.domain.sha256,store.load()!!.domain.sha256)
            return receipt.token to parsed.domain.sha256
        }
        fun export(store:NativeStateStore,sha:String){assertEquals(sha,BackupCodec.read(store.exportBackup(at)).domain.sha256)}
        try{AndroidStateDatabase(context,name).use{db->
            val store=NativeStateStore(db);val first=store.initialize(initial());val started=System.nanoTime()
            val (token,sha)=import(store,first.token);export(store,sha)
            store.captureDaily(token,at);store.captureDaily(token,"2026-10-24T08:00:00.000Z")
            assertEquals(1,store.backupRoots().count{it.kind=="daily"})
            val rollback=store.backupRoots().single{it.kind=="rollback"}
            store.restore(token,"captured-restore",rollback.id,at)
            assertEquals(first.domain,store.load()!!.domain)
            result.put("roundTripAndRollbackMs",(System.nanoTime()-started)/1e6).put("completed",true)
        }}catch(error:Throwable){result.put("failure",error.toString());throw error}
        finally{save("capacity-captured",result);context.deleteDatabase(name)}
    }

    @Test fun archiveLimitsAndAmplificationRejectBeforeReplacingAnything() {
        val name="p2-limit-${UUID.randomUUID()}.db";val result=JSONObject().put("completed",false)
        try { AndroidStateDatabase(context,name).use { db ->
            val store=NativeStateStore(db);val first=store.initialize(initial())
            // One allocation; decode must reject its size before producing another large string.
            val overflow=runCatching{BackupCodec.read(ByteArray(StrictJson.FILE_LIMIT+1))}.exceptionOrNull()
            assertTrue(overflow is StateInputException&&(overflow as StateInputException).code=="LIMIT_EXCEEDED")
            result.put("rejectedWireBytes",StrictJson.FILE_LIMIT+1)
            val envelope=JSONObject(BackupCodec.write(first.domain,at,compact=true));envelope.remove("checksum")
            val payload=envelope.getJSONObject("payload");val state=payload.getJSONObject("state")
            val props=JSONObject();repeat(64){props.put("property_$it","x".repeat(128))}
            val style=JSONObject().put("materialId","stone").put("stage","foundation").put("buildOrder",1)
                .put("sourceBlockId","minecraft:stone").put("sourceBlockState",props)
            val coords=JSONArray();repeat(500){i->coords.put(JSONArray().put(i%10).put((i/10)%5).put(i/50).put(0))}
            val blueprint=JSONObject().put("schemaVersion",1).put("id","capacity-packed").put("title","容量验证")
                .put("bounds",JSONObject().put("minX",0).put("maxX",9).put("minY",0).put("maxY",4).put("minZ",0).put("maxZ",9))
                .put("palette",JSONArray().put(style)).put("voxels",coords)
            payload.put("blueprints",JSONArray().put(blueprint))
            val resources=JSONArray();repeat(200){i->resources.put(JSONObject().put("id","capacity-resource-$i").put("displayName","容量验证")
                .put("createdAt",at).put("blueprint",JSONObject().put("\$blueprint",0)))}
            state.put("buildingBlueprintResources",resources)
            envelope.put("checksum",StrictJson.sha(StrictJson.render(envelope)))
            val amplified=StrictJson.render(envelope);val failure=runCatching{BackupCodec.read(amplified)}.exceptionOrNull()
            assertTrue("must hit expansion budget, not a later unrelated validation",failure is BackupRejected&&failure.message!!.contains("budget"))
            assertEquals(first,store.load());assertEquals(0,store.backupRoots().size)
            result.put("amplificationWireBytes",StrictJson.utf8Size(amplified)).put("priorStateRetained",true).put("completed",true)
        }}catch(error:Throwable){result.put("failure",error.toString());throw error}
        finally{save("capacity-limits",result);context.deleteDatabase(name)}
    }

    @Test fun actualSqliteTicketsAreIdempotentAndCannotCrossAnImport() {
        val name="p2-stale-${UUID.randomUUID()}.db"
        try{AndroidStateDatabase(context,name).use{db->
            val store=NativeStateStore(db);store.initialize(initial());val c=FocusCoordinator(store,name);val now=DomainTime.millis(at)
            c.confirm("plan",PlanRequest("capacity-plan","complex-0",null,PlanMode.MINIMAL,3,1000,0),now)
            val started=c.start("start",true,now);val ticket=c.deadline(started.state)!!
            assertEquals(started.state,c.reconcile("same-deadline",now+500,ticket).state)
            val due=c.reconcile("same-deadline",now+1000,ticket);val repeated=c.reconcile("same-deadline",now+1001,ticket)
            assertEquals(due.state,repeated.state)
            c.importBackup("replacement",BackupCodec.read(BackupCodec.write(initial(),at)),now+1100)
            val replacement=c.load();assertEquals(replacement,c.reconcile("old-after-import",now+99999,ticket).state)
            assertEquals(RecoveryContext(),replacement.recovery)
            save("device-idempotence",JSONObject().put("completed",true).put("beforeGeneration",started.state.token.replacementGeneration)
                .put("afterGeneration",replacement.token.replacementGeneration))
        }}finally{context.deleteDatabase(name)}
    }
}
