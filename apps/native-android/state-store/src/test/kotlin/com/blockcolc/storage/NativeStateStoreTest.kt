package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.domain.PipelineCost
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

class NativeStateStoreTest {
    @get:Rule val temporary = TemporaryFolder()
    private fun state(name: String) = DomainDocument.fromJson(JSONObject(javaClass.getResource("/state-oracle.json")!!.readText()).getJSONObject("states").getJSONObject(name))
    private fun database() = JdbcStateDatabase(temporary.root.toPath().resolve("state.db"))
    @Test fun recoveryRootsAndFileImportStagePreferencesWithTheWorkspace() {
        val old = """{"breakMinutes":5,"focusMinutes":45,"habitFocusMinutes":25,"habitTargetRounds":12}"""
        val new = """{"breakMinutes":5,"focusMinutes":45,"habitFocusMinutes":60,"habitTargetRounds":30}"""
        val stamp = "2026-10-01T09:00:00.000Z"
        var current = old
        database().use { db ->
            val store = NativeStateStore(db)
            store.bindBackupPreferences { current }
            val initial = store.initialize(com.blockcolc.domain.DomainEngine.initial("UTC"))
            val daily = checkNotNull(store.captureDaily(initial.token, stamp).root)
            val export = BackupCodec.read(store.exportBackup(stamp))
            assertEquals(old, export.preferences)
            current = new
            val imported = store.importBackup(initial.token, "with-portable-prefs", export, stamp)
            assertEquals(old, NativeStateStore(db).pendingPreferences())
            store.acknowledgePreferences(old)
            val rollback = checkNotNull(imported.rollbackId)
            val restored = store.restore(imported.token, "restore-import-rollback", rollback, stamp)
            assertEquals(new, store.pendingPreferences())
            store.acknowledgePreferences(new)
            store.restore(restored.token, "restore-daily-preferences", daily.id, stamp)
            assertEquals(old, NativeStateStore(db).pendingPreferences())
        }
    }
    private fun ready() = RecoveryContext(SavedPlan("plan", "host", "read", PlanMode.ROUNDS, 2, emptyList(), PlanPhase.READY, 60000, 300000), ContinuationGrant("grant", 0, null))
    private fun active() = ready().let { it.copy(plan = it.plan!!.copy(phase = PlanPhase.FOCUS, currentSessionId = "s1", phaseEndsAt = "2026-10-01T08:01:00.000Z",hasStarted=true)) }
    private class Observed(private val delegate:SqlDatabase,private val stamped:Boolean=false):SqlDatabase {
        val writes=mutableListOf<Pair<String,List<Any?>>>()
        var after: (() -> Unit)?=null
        private var rollbacks=0L
        override fun <T> transaction(block:(SqlSession)->T):T {
            val result=try{delegate.transaction{sql->block(object:SqlSession{
                override fun execute(sqlText:String,args:List<Any?>):Int {writes.add(sqlText to args);return sql.execute(sqlText,args)}
                override fun query(sqlText:String,args:List<Any?>)=sql.query(sqlText,args)
                override fun readStamp():SqlReadStamp? {
                    if(!stamped)return null
                    fun read(name:String)=(sql.query(name).single().single() as Number).toLong()
                    return SqlReadStamp("observed-pinned",read("PRAGMA main.data_version"),read("SELECT total_changes()"),
                        read("PRAGMA main.schema_version"),rollbacks,read("PRAGMA temp.schema_version"))
                }
            })}}catch(error:Throwable){rollbacks++;throw error}
            after?.let{after=null;it()};return result
        }
        override fun close()=delegate.close()
    }
    @Test fun olderRecoveryEncodingCanBeReadAndNormalizedByTheNextCommit(){
        database().use{db->
            val store=NativeStateStore(db);val initial=store.initialize(state("goal"));store.commit(initial.token,"plan",initial.domain,ready())
            val legacy=JSONObject(ready().canonical());val p=legacy.getJSONObject("plan")
            for(k in listOf("terminalRest","cancelled","cancellationCategory","cancellationNote","hasStarted"))p.remove(k)
            db.transaction{it.execute("UPDATE local_recovery SET canonical=? WHERE id=1",listOf(legacy.toString()))}
            val loaded=store.load()!!;assertEquals(ready(),loaded.recovery)
            store.commit(loaded.token,"normalize-control",loaded.domain,loaded.recovery)
            assertEquals(ready(),store.load()!!.recovery)
            assertEquals(ready().canonical(),db.transaction{it.query("SELECT canonical FROM local_recovery WHERE id=1")}.single()[0])
        }
    }
    @Test fun noOpWritesOnlyRevisionAndReceiptAndChangedRowsAreGenuinelyIncremental(){
        database().use{db->
            val observed=Observed(db);val store=NativeStateStore(observed);val before=store.initialize(state("notes"));observed.writes.clear()
            val noop=store.commit(before.token,"noop",before.domain,RecoveryContext())
            assertEquals(2,observed.writes.size);assertTrue(observed.writes[0].first.startsWith("UPDATE state_meta "));assertTrue(observed.writes[1].first.startsWith("INSERT INTO command_receipts"))
            observed.writes.clear()
            val next=before.domain.json();next.getJSONArray("quickNotes").getJSONObject(0).put("text","改一条便签")
            val doc=DomainDocument.fromJson(next);val committed=store.commit(noop.token,"edit",doc,RecoveryContext())
            assertEquals(3,observed.writes.size);assertTrue(observed.writes[0].first.startsWith("UPDATE domain_records "));assertEquals("quickNotes",observed.writes[0].second[2])
            assertEquals(doc,store.load()!!.domain);observed.writes.clear()
            assertTrue(store.commit(noop.token,"edit",doc,RecoveryContext()).replayed);assertTrue(observed.writes.isEmpty());assertEquals(committed.token,store.load()!!.token)
        }
    }
    @Test fun aVerifiedFocusStartWritesTheSingletonWithoutSplittingItsBlueprints() {
        database().use{db->
            val original=state("goal").json()
            original.getJSONObject("worldSettings").put("worldSeed","开场".repeat(140_000))
            val observed=Observed(db);val store=NativeStateStore(observed)
            val before=store.initialize(DomainDocument.fromOwnedJson(original))
            assertEquals(before,store.load())
            observed.writes.clear()
            val command=DomainEngine.command("StartFocus","sessionId" to "s1","projectId" to "host","subtaskId" to "read","plannedDurationMs" to 60_000)
            val started=DomainEngine.execute(before.domain,command,DomainTime.millis("2026-10-01T08:00:00.000Z"))
            assertTrue(started.error,started.ok)
            assertNotNull(started.state.activeFocusWireFrom(before.domain))
            assertNull(started.state.activeFocusWireFrom(state("goal")))
            assertNull(DomainDocument.parse(started.state.canonical).activeFocusWireFrom(before.domain))
            val sections=mutableSetOf<String>()
            var assetHashes=0
            val receipt=PipelineCost.collect({name,_,_,_->
                sections.add(name)
                if(name=="storage.asset-digest")assetHashes++
            }){
                store.commit(before.token,"start-splice",started.state,active())
            }
            assertFalse("storage.split" in sections)
            assertEquals(1,assetHashes)
            assertEquals(listOf("domain_values","local_recovery","state_meta","command_receipts"),
                observed.writes.map{it.first.split(' ').let{tokens->if(tokens[0]=="INSERT")tokens[2].substringBefore('(')else tokens[1]}})
            assertEquals(StoredState(receipt.token,started.state,active()),store.load())
        }
    }
    private fun largeAssetState():DomainDocument {
        val root=state("goal").json()
        val body=root.getJSONArray("buildingBlueprintResources").getJSONObject(0).getJSONObject("blueprint")
        val cells=JSONArray()
        for(z in 0..15)for(y in 0..15)for(x in 0..63)cells.put(JSONObject()
            .put("x",x).put("y",y).put("z",z).put("materialId","wood").put("stage","walls").put("buildOrder",4000))
        body.put("bounds",JSONObject().put("minX",0).put("maxX",63).put("minY",0).put("maxY",15).put("minZ",0).put("maxZ",15))
        body.put("voxels",cells)
        return DomainDocument.fromOwnedJson(root)
    }
    @Test fun coldLargeAssetReadKeepsTheExactDomainAndRejectsAnEditedBody(){
        org.junit.Assume.assumeTrue(Runtime.getRuntime().availableProcessors()>=3)
        val root=state("goal").json()
        val resources=root.getJSONArray("buildingBlueprintResources")
        val resource=resources.getJSONObject(0)
        val cells=JSONArray()
        for(z in 0..7)for(y in 0..7)for(x in 0..31)cells.put(JSONObject()
            .put("x",x).put("y",y).put("z",z).put("materialId","wood").put("stage","walls").put("buildOrder",4000))
        val bounds=JSONObject().put("minX",0).put("maxX",31).put("minY",0).put("maxY",7).put("minZ",0).put("maxZ",7)
        for(index in 0..7){
            val entry=JSONObject(resource.toString()).put("id","cold-resource-$index")
            entry.getJSONObject("blueprint").put("id","cold-resource-$index").put("bounds",bounds).put("voxels",cells)
            resources.put(entry)
        }
        // Copy once so the assembled input has no shared mutable nodes.
        val original=DomainDocument.fromJson(root)
        database().use{db->
            val expected=NativeStateStore(db).initialize(original)
            val stages=mutableSetOf<String>()
            val actual=PipelineCost.collect({name,_,_,_->stages.add(name)}){checkNotNull(NativeStateStore(db).load())}
            assertEquals(expected.token,actual.token)
            assertEquals(expected.recovery,actual.recovery)
            assertEquals(original.sha256,actual.domain.sha256)
            assertEquals(original.canonical,actual.domain.canonical)
            assertTrue("storage.asset-read-pipeline" in stages)
            assertTrue("storage.candidate-wire-hash" in stages)
            assertFalse("blueprint.parallel-proof" in stages)
            db.transaction{it.execute("UPDATE blueprint_assets SET canonical=replace(canonical,?,?) WHERE sha=(SELECT sha FROM blueprint_assets ORDER BY length(canonical) DESC LIMIT 1)",
                listOf("\"wood\"","\"roof\""))}
            assertThrows(StorageCorruption::class.java){NativeStateStore(db).load()}
        }
    }
    @Test fun repeatedAssetProofComparesRealBodiesAndRejectsASameSizeEdit(){
        database().use{db->
            val store=NativeStateStore(db)
            store.initialize(largeAssetState())
            val before=checkNotNull(store.load())
            val command=DomainEngine.command("StartFocus","sessionId" to "s1","projectId" to "host","subtaskId" to "read","plannedDurationMs" to 60_000)
            val started=DomainEngine.execute(before.domain,command,DomainTime.millis("2026-10-01T08:00:00.000Z"))
            assertTrue(started.error,started.ok)
            val stages=mutableListOf<String>()
            PipelineCost.collect({name,_,_,_->stages.add(name)}){
                val receipt=store.commit(before.token,"start-ranges",started.state,active())
                assertEquals(StoredState(receipt.token,started.state,active()),store.load())
            }
            assertTrue(stages.count{it=="storage.asset-compare"}>=2)
            assertFalse("storage.asset-digest" in stages)
            db.transaction{it.execute("UPDATE blueprint_assets SET canonical=replace(canonical,?,?) WHERE sha=(SELECT sha FROM blueprint_assets ORDER BY length(canonical) DESC LIMIT 1)",
                listOf("\"wood\"","\"roof\""))}
            assertThrows(StorageCorruption::class.java){store.load()}
        }
    }
    @Test fun stampedFocusWriteReusesBodiesOnlyAcrossItsUnchangedCommit(){
        val path=temporary.root.toPath().resolve("stamped-focus.db")
        Observed(JdbcStateDatabase(path),stamped=true).use{db->
            val store=NativeStateStore(db)
            store.initialize(largeAssetState())
            val before=checkNotNull(store.load())
            val command=DomainEngine.command("StartFocus","sessionId" to "s1","projectId" to "host","subtaskId" to "read","plannedDurationMs" to 60_000)
            val started=DomainEngine.execute(before.domain,command,DomainTime.millis("2026-10-01T08:00:00.000Z"))
            assertTrue(started.error,started.ok)
            val largeAsset="(SELECT sha FROM blueprint_assets ORDER BY length(canonical) DESC LIMIT 1)"
            JdbcStateDatabase(path,false).use{other->
                val key=other.transaction{it.query("SELECT $largeAsset").single().single() as String}
                val original=other.transaction{it.blueprintBody(key)}
                db.after={other.transaction{it.execute("UPDATE blueprint_assets SET canonical=? WHERE sha=?",listOf(original+" ",key))}}
                assertThrows(StorageCorruption::class.java){store.commit(before.token,"stale-stamp",started.state,active())}
                other.transaction{
                    assertEquals(0,(it.query("SELECT COUNT(*) FROM command_receipts WHERE request_id='stale-stamp'").single().single() as Number).toInt())
                    it.execute("UPDATE blueprint_assets SET canonical=? WHERE sha=?",listOf(original,key))
                }
            }
            assertEquals(before,store.load())
            val stages=mutableListOf<String>()
            PipelineCost.collect({name,_,_,_->stages.add(name)}){
                val receipt=store.commit(before.token,"stamped-focus",started.state,active())
                assertEquals(StoredState(receipt.token,started.state,active()),store.load())
            }
            assertTrue("storage.prewrite-stamp" in stages)
            assertFalse("storage.prewrite-inputs" in stages)
            assertTrue("storage.focus-readback-controls" in stages)
            assertFalse("storage.read-inputs" in stages)

            val resetAfterFocus=store.replace(store.load()!!.token,"idle-for-external-write",before.domain)
            assertEquals(before.domain,store.load()!!.domain)
            val externalRecovery=active().let{it.copy(automatic=it.automatic!!.copy(replacementGeneration=resetAfterFocus.token.replacementGeneration))}
            val external=store.commit(resetAfterFocus.token,"external-focus",started.state,externalRecovery)
            JdbcStateDatabase(path,false).use{other->
                val key=other.transaction{it.query("SELECT $largeAsset").single().single() as String}
                val body=other.transaction{it.blueprintBody(key)}
                other.transaction{it.execute("UPDATE blueprint_assets SET canonical=? WHERE sha=?",listOf(body+" ",key))}
                assertThrows(StorageCorruption::class.java){store.load()}
                other.transaction{it.execute("UPDATE blueprint_assets SET canonical=? WHERE sha=?",listOf(body,key))}
            }
            assertEquals(StoredState(external.token,started.state,externalRecovery),store.load())

            val reset=store.replace(store.load()!!.token,"fresh-idle",before.domain)
            db.transaction{it.execute("CREATE TRIGGER focus_corruption AFTER UPDATE ON domain_values WHEN NEW.name='activeFocusSession' BEGIN UPDATE blueprint_assets SET canonical=canonical||' ' WHERE sha=$largeAsset; END")}
            assertEquals(before.domain,store.load()!!.domain)
            val saved=store.commit(reset.token,"trigger-focus",started.state,active().copy(automatic=null))
            assertEquals(reset.token.revision+1,saved.token.revision)
            assertThrows(StorageCorruption::class.java){store.load()}
        }
    }
    @Test fun differentialWritesHandleRecordReorderingRemovalAndAssetCollection(){
        database().use{db->
            val store=NativeStateStore(db);val original=state("notes").json();val notes=original.getJSONArray("quickNotes")
            notes.put(JSONObject(notes.getJSONObject(0).toString()).put("id","second").put("text","另一个"))
            val initial=store.initialize(DomainDocument.fromJson(original))
            val next=initial.domain.json();val source=next.getJSONArray("quickNotes");val reordered=org.json.JSONArray().put(source.getJSONObject(1)).put(source.getJSONObject(0));next.put("quickNotes",reordered)
            val reorderedDoc=DomainDocument.fromJson(next);val first=store.commit(initial.token,"reorder",reorderedDoc,RecoveryContext());assertEquals(reorderedDoc,store.load()!!.domain)
            next.put("quickNotes",org.json.JSONArray().put(reordered.getJSONObject(0)))
            // The resource is no longer live, but its shared project blueprint
            // and the independent recovery root must remain valid.
            next.put("buildingBlueprintResources",org.json.JSONArray());val reduced=DomainDocument.fromJson(next)
            store.captureDaily(first.token,"2026-10-24T08:00:00.000Z");val root=store.backupRoots().single()
            val second=store.commit(first.token,"remove",reduced,RecoveryContext());assertEquals(reduced,store.load()!!.domain)
            assertTrue(db.transaction{it.query("SELECT sha FROM blueprint_assets")}.isNotEmpty())
            store.restore(second.token,"restore-reorder",root.id,"2026-10-24T09:00:00.000Z");assertEquals(reorderedDoc,store.load()!!.domain)
        }
    }
    @Test fun damageBetweenThePreparationReadAndTheWriteTransactionIsNotSilentlyRepaired(){
        database().use{db->
            val observed=Observed(db);val store=NativeStateStore(observed);val original=store.initialize(state("notes"));store.load()
            observed.after={db.transaction{it.execute("UPDATE domain_values SET canonical='999' WHERE name='schemaVersion'")}}
            observed.writes.clear()
            assertTrue(runCatching{store.commit(original.token,"reject",original.domain,RecoveryContext())}.exceptionOrNull() is StorageCorruption)
            assertTrue(observed.writes.isEmpty());assertEquals("999",db.transaction{it.query("SELECT canonical FROM domain_values WHERE name='schemaVersion'")}.single()[0])
            assertEquals(0L,(db.transaction{it.query("SELECT COUNT(*) FROM command_receipts")}.single()[0] as Number).toLong())
        }
    }
    @Test fun validatedReadReuseStillChecksRealRowsAndNeverTrustsOnlyARevision(){
        database().use{db->
            val store=NativeStateStore(db);store.initialize(state("notes"));val first=store.load()!!
            assertSame(first.domain,store.load()!!.domain)
            db.transaction{it.execute("UPDATE domain_values SET canonical='999' WHERE name='schemaVersion'")}
            assertTrue(runCatching{store.load()}.exceptionOrNull() is StorageCorruption)
        }
    }
    @Test fun largeReadWitnessReusesTheDocumentButStillDetectsAllExternalContentChanges(){
        database().use{db->
            val store=NativeStateStore(db);val doc=state("decay");store.initialize(doc)
            val calendar=db.transaction{it.query("SELECT canonical FROM domain_values WHERE name='calendar'").single()[0] as String}
            val padding=" ".repeat(1024*1024+127)
            db.transaction{it.execute("UPDATE domain_values SET canonical=? WHERE name='calendar'",listOf(padding+calendar))}
            val first=store.load()!!;assertEquals(doc,first.domain);assertSame(first.domain,store.load()!!.domain)
            // Same token and same normalized domain, different actual bytes:
            // force fresh validation rather than trusting metadata or identity.
            db.transaction{it.execute("UPDATE domain_values SET canonical=? WHERE name='calendar'",listOf(padding+calendar+" "))}
            val second=store.load()!!;assertEquals(doc,second.domain);assertNotSame(first.domain,second.domain)
            assertSame(second.domain,store.load()!!.domain)
            db.transaction{it.execute("UPDATE blueprint_assets SET canonical=canonical||' ' WHERE sha=(SELECT sha FROM blueprint_assets LIMIT 1)")}
            assertTrue(runCatching{store.load()}.exceptionOrNull() is StorageCorruption)
        }
    }
    @Test fun aSuccessfulCommitReusesOnlyTheValidatedDocumentAndStillReadsEveryRealInput(){
        database().use{db->
            val store=NativeStateStore(db);val initial=store.initialize(state("empty"));val candidate=state("notes")
            store.commit(initial.token,"notes",candidate,RecoveryContext())
            assertSame(candidate,store.load()!!.domain)
            db.transaction{it.execute("UPDATE domain_records SET canonical='null' WHERE section='quickNotes'")}
            assertTrue(runCatching{store.load()}.exceptionOrNull() is StorageCorruption)
        }
    }
    @Test fun commitProofIsNotPublishedBeforeCommitOrOnAReplayOfAnOlderReceipt(){
        database().use{db->
            var fail=false;val store=NativeStateStore(db){if(fail&&it=="before-commit")error("rollback")}
            val first=store.initialize(state("empty"));val candidate=state("notes");fail=true
            assertTrue(runCatching{store.commit(first.token,"retry",candidate,RecoveryContext())}.isFailure)
            assertEquals(first,store.load());fail=false
            val saved=store.commit(first.token,"retry",candidate,RecoveryContext());assertSame(candidate,store.load()!!.domain)
            store.commit(saved.token,"newer",state("empty"),RecoveryContext())
            assertTrue(store.commit(first.token,"retry",candidate,RecoveryContext()).replayed)
            assertEquals(state("empty"),store.load()!!.domain)
        }
    }
    @Test fun externalRowsWrittenImmediatelyAfterCommitCannotBeHiddenByThePreparedProof(){
        val path=temporary.root.toPath().resolve("after-commit.db")
        JdbcStateDatabase(path).use{db->JdbcStateDatabase(path,false).use{other->
            val store=NativeStateStore(db);val first=store.initialize(state("empty"));val notes=state("notes")
            val committed=store.commit(first.token,"notes",notes,RecoveryContext())
            NativeStateStore(other).replace(committed.token,"external",state("goal"))
            assertEquals(state("goal"),store.load()!!.domain)
        }}
    }
    @Test fun anotherConnectionAndFailedWritesCannotLeaveAStaleValidationProof(){
        val path=temporary.root.toPath().resolve("proof.db")
        JdbcStateDatabase(path).use{db->
            val store=NativeStateStore(db);val first=store.initialize(state("empty"));assertEquals(first,store.load())
            JdbcStateDatabase(path,false).use{other->NativeStateStore(other).replace(first.token,"external",state("notes"))}
            assertEquals(state("notes"),store.load()!!.domain)
            val before=store.load()!!;val failing=NativeStateStore(db){if(it=="before-commit")error("rollback")}
            assertTrue(runCatching{failing.replace(before.token,"failed",state("empty"))}.isFailure)
            assertEquals(before,store.load())
        }
    }
    @Test fun warmRecoveryRootsStillRejectModifiedImmutableBlocks(){
        database().use{db->
            val store=NativeStateStore(db);val initial=store.initialize(state("notes"))
            store.captureDaily(initial.token,"2026-10-23T08:00:00.000Z");assertEquals(1,store.backupRoots().size);assertEquals(1,store.backupRoots().size)
            db.transaction{it.execute("UPDATE backup_blocks SET canonical='null' WHERE sha=(SELECT sha FROM backup_blocks LIMIT 1)")}
            assertTrue(runCatching{store.backupRoots()}.exceptionOrNull() is StorageCorruption)
        }
    }
    @Test fun allFormalAcceptedStatesRoundTripWithoutDroppingFields() {
        database().use { db ->
            val cases = JSONObject(javaClass.getResource("/state-oracle.json")!!.readText()).getJSONArray("cases")
            val store = NativeStateStore(db); var token: StateToken? = null
            for (i in 0 until cases.length()) {
                val c = cases.getJSONObject(i); if (!c.getBoolean("ok")) continue
                val doc = DomainDocument.parse(c.getString("canonical"))
                token = if (token == null) store.initialize(doc).token else store.replace(token, "case-$i", doc).token
                val loaded = store.load()!!; assertEquals(c.getString("name"), doc, loaded.domain); assertEquals(token, loaded.token); assertNull(loaded.recovery.plan)
            }
        }
    }
    @Test fun restartPreservesGranularStateAndDeduplicatesImmutableBlueprints() {
        val path = temporary.root.toPath().resolve("state.db"); val expected = state("decay")
        JdbcStateDatabase(path).use { db ->
            val store = NativeStateStore(db); store.initialize(expected)
            assertEquals(2L, db.transaction { (it.query("SELECT COUNT(*) FROM blueprint_assets").single()[0] as Number).toLong() })
            assertTrue(db.transaction { (it.query("SELECT COUNT(*) FROM domain_records").single()[0] as Number).toLong() } > 10)
            assertEquals(expected, store.load()!!.domain)
        }
        JdbcStateDatabase(path, false).use { assertEquals(expected, NativeStateStore(it).load()!!.domain) }
    }
    @Test fun factAndAuthorizedPlanCommitAndReplayAreAtomic() {
        database().use { db ->
            val store = NativeStateStore(db); val initial = store.initialize(state("goal")); val document = state("active")
            val committed = store.commit(initial.token, "start", document, active())
            val read = store.load()!!; assertEquals(document, read.domain); assertEquals(active(), read.recovery)
            val replay = store.commit(initial.token, "start", document, active()); assertTrue(replay.replayed); assertEquals(committed.token, replay.token)
            assertEquals(1L, store.load()!!.token.revision)
            val reused = runCatching { store.commit(initial.token, "start", state("notes"), RecoveryContext()) }.exceptionOrNull()
            assertTrue(reused is StorageConflict && reused.reason == "REQUEST_ID_REUSED")
        }
    }
    @Test fun everyInjectedWriteFailureRollsBackFactsContextRevisionAssetsAndReceipt() {
        for (stage in listOf("after-assets", "after-records", "before-meta", "before-commit")) {
            val dir = temporary.newFolder(); JdbcStateDatabase(dir.toPath().resolve("failure.db")).use { db ->
                val store = NativeStateStore(db); val initial = store.initialize(state("empty"))
                val failing = NativeStateStore(db) { if (it == stage) error("Injected $stage") }
                assertTrue(runCatching { failing.commit(initial.token, "start", state("active"), active()) }.isFailure)
                assertEquals(initial, store.load()); assertEquals(0L, db.transaction { (it.query("SELECT COUNT(*) FROM command_receipts").single()[0] as Number).toLong() })
                assertEquals(0L, db.transaction { (it.query("SELECT COUNT(*) FROM blueprint_assets").single()[0] as Number).toLong() })
                assertFalse(store.commit(initial.token, "start", state("active"), active()).replayed)
            }
        }
    }
    @Test fun failedInitializationStaysEmptyAndDoesNotSeedOverCorruption() {
        database().use { db ->
            val broken = NativeStateStore(db) { if (it == "before-commit") error("Disk full") }
            assertTrue(runCatching { broken.initialize(state("notes")) }.isFailure); assertNull(NativeStateStore(db).load())
            db.transaction { it.execute("INSERT INTO domain_values(name,canonical) VALUES('schemaVersion','15')") }
            assertTrue(runCatching { NativeStateStore(db).initialize(state("empty")) }.exceptionOrNull() is StorageCorruption)
            assertEquals(1L, db.transaction { (it.query("SELECT COUNT(*) FROM domain_values").single()[0] as Number).toLong() })
        }
    }
    @Test fun twoConnectionsCannotLoseAnUpdate() {
        val path = temporary.root.toPath().resolve("race.db"); val barrier = CountDownLatch(1)
        JdbcStateDatabase(path).use { first -> JdbcStateDatabase(path, false).use { second ->
            val token = NativeStateStore(first).initialize(state("empty")).token
            val pool = Executors.newFixedThreadPool(2)
            try {
                val jobs = listOf(first, second).mapIndexed { i, db -> pool.submit(Callable { barrier.await(); runCatching { NativeStateStore(db).commit(token, "writer-$i", state("notes"), RecoveryContext()) } }) }
                barrier.countDown(); val results = jobs.map { it.get() }; assertEquals(1, results.count { it.isSuccess }); assertTrue(results.single { it.isFailure }.exceptionOrNull() is StorageConflict)
                assertEquals(1L, NativeStateStore(first).load()!!.token.revision)
            } finally { pool.shutdownNow() }
        } }
    }
    @Test fun replacementRevokesSameIdAuthorizationAndAllOldEvents() {
        database().use { db ->
            val store = NativeStateStore(db); val initial = store.initialize(state("goal")); val start = store.commit(initial.token, "start", state("active"), active())
            val replacement = store.replace(start.token, "import", state("active"))
            assertEquals(StateToken(2, 1), replacement.token); assertEquals(RecoveryContext(), store.load()!!.recovery)
            assertTrue(store.replace(start.token, "import", state("active")).replayed)
            assertTrue(runCatching { store.commit(start.token, "late-alarm", state("complete"), RecoveryContext()) }.exceptionOrNull() is StorageConflict)
            assertTrue(runCatching { store.commit(initial.token, "start", state("active"), active()) }.exceptionOrNull() is StorageConflict)
            assertTrue(runCatching { store.commit(replacement.token, "stale-grant", state("active"), active()) }.isFailure)
            assertEquals(state("active"), store.load()!!.domain)
        }
    }
    @Test fun manualWaitingDoesNotInferAuthorizationFromHistory() {
        database().use { db ->
            val store = NativeStateStore(db); val initial = store.initialize(state("complete"))
            val plan = ready().plan!!.copy(completedSessionIds = listOf("s1"),hasStarted=true)
            store.commit(initial.token, "manual-wait", initial.domain, RecoveryContext(plan, null))
            assertNull(store.load()!!.recovery.automatic)
        }
    }
    @Test fun corruptionCannotBeOverwrittenByNormalSaveOrInitialize() {
        database().use { db ->
            val store = NativeStateStore(db); val initial = store.initialize(state("decay"))
            db.transaction { it.execute("UPDATE blueprint_assets SET canonical='{}'") }
            assertTrue(runCatching { store.load() }.exceptionOrNull() is StorageCorruption)
            assertTrue(runCatching { store.commit(initial.token, "overwrite", state("empty"), RecoveryContext()) }.exceptionOrNull() is StorageCorruption)
            assertTrue(runCatching { store.initialize(state("empty")) }.exceptionOrNull() is StorageCorruption)
        }
    }
    @Test fun entityReorderingAndRemovalPreserveArrayOrder() {
        database().use { db ->
            val store = NativeStateStore(db); val initial = store.initialize(state("decay")); val changed = initial.domain.json()
            val notes = changed.getJSONArray("quickNotes"); val first = notes.getJSONObject(0)
            notes.put(JSONObject(first.toString()).put("id", "second")); notes.put(JSONObject(first.toString()).put("id", "third"))
            val many = DomainDocument.fromJson(changed); val token = store.commit(initial.token, "add", many, RecoveryContext()).token
            changed.put("quickNotes", org.json.JSONArray().put(notes.getJSONObject(2)).put(notes.getJSONObject(0)))
            val reordered = DomainDocument.fromJson(changed); store.commit(token, "reorder-remove", reordered, RecoveryContext())
            assertEquals(reordered, store.load()!!.domain)
        }
    }
    @Test fun corruptLocalControlAndReplayedReceiptDoNotHideCorruption() {
        database().use { db ->
            val store = NativeStateStore(db); val token = store.initialize(state("goal")).token
            store.commit(token, "start", state("active"), active())
            val malformed = JSONObject(active().canonical()); malformed.getJSONObject("plan").put("id", 123)
            db.transaction { it.execute("UPDATE local_recovery SET canonical=?", listOf(malformed.toString())) }
            assertTrue(runCatching { store.load() }.exceptionOrNull() is StorageCorruption)
            assertTrue(runCatching { store.commit(token, "start", state("active"), active()) }.exceptionOrNull() is StorageCorruption)
        }
    }
    @Test fun completedMonumentMayKeepReportButCannotStartAnotherRound() {
        val doc = state("finite-monument")
        val history = doc.json().getJSONArray("focusHistory"); val completed = (0 until history.length()).map { history.getJSONObject(it) }
            .filter { it.getString("id") in setOf("early-read", "early-write") }.map { it.getString("id") }
        val report = RecoveryContext(SavedPlan("finished", "host", "write", PlanMode.ROUNDS, 2, completed, PlanPhase.REPORT, 60000, 300000))
        report.validate(doc, 0)
        assertTrue(runCatching { report.copy(plan = report.plan!!.copy(phase = PlanPhase.READY)).validate(doc, 0) }.isFailure)
    }
}
