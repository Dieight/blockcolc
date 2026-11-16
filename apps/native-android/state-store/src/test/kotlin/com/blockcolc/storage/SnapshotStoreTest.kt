package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SnapshotStoreTest {
    @get:Rule val temporary = TemporaryFolder()
    private fun state(name: String) = DomainDocument.fromJson(JSONObject(javaClass.getResource("/state-oracle.json")!!.readText()).getJSONObject("states").getJSONObject(name))
    private fun db() = JdbcStateDatabase(temporary.root.toPath().resolve("snapshots.db"))
    private val at = "2026-10-22T08:00:00.000Z"
    @Test fun importAndRestoreAreOneTransactionWithTwoIndependentRollbackRoots() {
        db().use { db ->
            val store = NativeStateStore(db); var current = store.initialize(state("notes"))
            val incoming = BackupCodec.read(BackupCodec.write(state("decay"), at, true))
            val imported = store.importBackup(current.token, "import", incoming, at)
            assertNotNull(imported.rollbackId); assertEquals(state("decay"), store.load()!!.domain)
            assertTrue(store.importBackup(current.token, "import", incoming, at).replayed)
            val restored = store.restore(imported.token, "restore", imported.rollbackId!!, at)
            assertEquals(state("notes"), store.load()!!.domain); assertEquals(2L, restored.token.replacementGeneration)
            val again = store.restore(restored.token, "restore-again", restored.rollbackId!!, at)
            assertEquals(state("decay"), store.load()!!.domain)
            assertEquals(2, store.backupRoots().size)
            store.backupRoots().forEach { root -> db.transaction { assertNotNull(SnapshotStore.read(it, root.id)) } }
            assertEquals(3L, again.token.replacementGeneration)
        }
    }
    @Test fun pruningKnownContentStillVerifiesEveryPersistedBlockBeforeCollecting(){
        db().use{database->
            val document=state("decay");val store=NativeStateStore(database);store.initialize(document)
            val layout=RecordLayout.split(document)
            val known=ValidatedRecordContent(RecordLayout.contentDigest(layout.values,layout.records,RecordLayout.verifiedAssetKeysDigest(layout.assets.keys)),document)
            database.transaction{sql->
                val prepared=SnapshotStore.prepare(document)
                repeat(3){i->SnapshotStore.save(sql,"prune-$i","rollback",at,null,0,"before-import","test",prepared)}
            }
            var validations=0
            com.blockcolc.domain.PipelineCost.collect({name,_,_,_->if(name=="domain.validate")validations++}){
                database.transaction{SnapshotStore.prune(it,known)}
            }
            assertEquals(0,validations)
            assertEquals(2,database.transaction{SnapshotStore.list(it).size})
            database.transaction{it.execute("UPDATE backup_blocks SET bytes=bytes+1 WHERE sha=(SELECT sha FROM backup_blocks LIMIT 1)")}
            assertThrows(StorageCorruption::class.java){database.transaction{SnapshotStore.prune(it,known)}}
            assertEquals(2,database.transaction{SnapshotStore.list(it).size})
            assertEquals(document,store.load()!!.domain)
        }
    }
    @Test fun failureAfterRollbackRootPreservesEverythingAndCanRetry() {
        db().use { db ->
            val store = NativeStateStore(db); val before = store.initialize(state("notes"))
            val incoming = BackupCodec.read(BackupCodec.write(state("decay"), at))
            val failing = NativeStateStore(db) { if (it == "after-rollback-root") error("Disk fault") }
            assertTrue(runCatching { failing.importBackup(before.token, "import", incoming, at) }.isFailure)
            assertEquals(before, store.load()); assertTrue(store.backupRoots().isEmpty())
            assertEquals(0L, db.transaction { (it.query("SELECT COUNT(*) FROM backup_blocks").single()[0] as Number).toLong() })
            assertFalse(store.importBackup(before.token, "import", incoming, at).replayed)
        }
    }
    @Test fun dailyMergesToOneRootDeduplicatesAndDoesNotAdvanceBusinessRevision() {
        db().use { db ->
            val store = NativeStateStore(db); val initial = store.initialize(state("notes"))
            val first = store.captureDaily(initial.token, at); assertTrue(first.changed)
            val size = db.transaction { (it.query("SELECT COUNT(*) FROM backup_blocks").single()[0] as Number).toLong() }
            assertFalse(store.captureDaily(initial.token, at).changed)
            val token = store.commit(initial.token, "rename", state("decay"), RecoveryContext()).token
            assertTrue(store.captureDaily(token, "2026-10-23T08:00:00.000Z").changed)
            val roots = store.backupRoots(); assertEquals(1, roots.size); assertEquals("2026-10-23", roots[0].date)
            assertEquals(state("decay"), db.transaction { SnapshotStore.read(it, roots[0].id) })
            assertEquals(token, store.load()!!.token)
            assertFalse(store.captureDaily(token, "2026-10-21T08:00:00.000Z").changed)
            assertTrue(size > 0)
            val links = db.transaction { (it.query("SELECT COUNT(DISTINCT sha) FROM backup_links").single()[0] as Number).toLong() }
            assertEquals(links, db.transaction { (it.query("SELECT COUNT(*) FROM backup_blocks").single()[0] as Number).toLong() })
        }
    }
    @Test fun oversizedOrCorruptDailyCannotReplaceLastRecoveryPoint() {
        db().use { db ->
            val store = NativeStateStore(db); val s = store.initialize(state("notes")); val first = store.captureDaily(s.token, at).root!!
            assertTrue(store.captureDaily(s.token, "2026-10-23T08:00:00.000Z", 1).overBudget)
            assertEquals(first.id, store.backupRoots().single().id)
            db.transaction { it.execute("UPDATE backup_blocks SET canonical='null' WHERE sha=(SELECT sha FROM backup_links LIMIT 1)") }
            assertTrue(runCatching { store.captureDaily(s.token, "2026-10-23T08:00:00.000Z") }.exceptionOrNull() is StorageCorruption)
            assertEquals(s, store.load())
        }
    }
    @Test fun dailyFailureRollsBackRootPruningAndBlockCollection() {
        db().use { db ->
            val store = NativeStateStore(db); val initial = store.initialize(state("notes")); val first = store.captureDaily(initial.token, at).root!!
            val failure = NativeStateStore(db) { if (it == "after-daily-root") error("Full disk") }
            assertTrue(runCatching { failure.captureDaily(initial.token, "2026-10-23T08:00:00.000Z") }.isFailure)
            assertEquals(first.id, store.backupRoots().single().id)
            assertEquals(initial.domain, db.transaction { SnapshotStore.read(it, first.id) })
        }
    }
    @Test fun migrationFromFirstStorageLayoutRetainsDataRevisionAndAuthorization() {
        JdbcStateDatabase(temporary.root.toPath().resolve("legacy.db"), false).use { db ->
            val doc = state("notes"); val layout = RecordLayout.split(doc)
            db.transaction { sql ->
                StateSchema.originalStatements.forEach { sql.execute(it) }
                layout.values.forEach { (name, body) -> sql.execute("INSERT INTO domain_values(name,canonical) VALUES(?,?)", listOf(name, body)) }
                layout.records.forEach { r -> sql.execute("INSERT INTO domain_records(section,record_key,ordinal,canonical) VALUES(?,?,?,?)", listOf(r.section, r.key, r.ordinal, r.canonical)) }
                layout.assets.forEach { (sha, body) -> sql.execute("INSERT INTO blueprint_assets(sha,canonical) VALUES(?,?)", listOf(sha, body)) }
                sql.execute("INSERT INTO state_meta(id,layout_version,revision,replacement_generation,domain_sha) VALUES(1,1,7,4,?)", listOf(doc.sha256))
                sql.execute("INSERT INTO local_recovery(id,canonical) VALUES(1,?)", listOf(RecoveryContext().canonical()))
                StateSchema.upgrade(sql, 1, 2)
            }
            assertEquals(StoredState(StateToken(7, 4), doc, RecoveryContext()), NativeStateStore(db).load())
        }
    }
    @Test fun previousDayIsExplicitAndUnchangedContentReusesBlocksAcrossRestarts(){
        db().use{db->
            val store=NativeStateStore(db);val initial=store.initialize(state("notes"))
            val first=store.captureDaily(initial.token,at,targetDate="2026-10-21").root!!
            val blocks=db.transaction{it.query("SELECT sha,canonical,bytes FROM backup_blocks ORDER BY sha")}
            assertEquals("2026-10-21",first.date)
            val reopened=NativeStateStore(db)
            assertFalse(reopened.captureDaily(initial.token,at,targetDate="2026-10-21").changed)
            assertTrue(reopened.captureDaily(initial.token,"2026-10-23T08:00:00.000Z",targetDate="2026-10-22").changed)
            assertEquals(blocks,db.transaction{it.query("SELECT sha,canonical,bytes FROM backup_blocks ORDER BY sha")})
            assertEquals(1,store.backupRoots().size);assertEquals(initial,store.load())
            assertTrue(runCatching{store.captureDaily(initial.token,at,targetDate="2026-10-23")}.isFailure)
        }
    }
    @Test fun unchangedDailyReplacementAndRestoreReuseOnlyCheckedContent(){
        db().use{db->
            val store=NativeStateStore(db);val initial=store.initialize(state("notes"))
            val first=store.captureDaily(initial.token,at).root!!
            val sections=mutableListOf<String>()
            com.blockcolc.domain.PipelineCost.collect({name,_,_,_->sections+=name}){
                assertTrue(store.captureDaily(initial.token,"2026-10-23T08:00:00.000Z").changed)
                val current=store.backupRoots().single()
                assertNotEquals(first.id,current.id)
                store.restore(initial.token,"same-daily-restore",current.id,"2026-10-23T09:00:00.000Z")
            }
            assertFalse("Identical persisted content must not rebuild another domain tree",sections.contains("domain.validate"))
            assertEquals(initial.domain,store.load()!!.domain)
            db.transaction{it.execute("UPDATE backup_blocks SET canonical=canonical || ' ' WHERE sha=(SELECT sha FROM backup_links LIMIT 1)")}
            assertThrows(StorageCorruption::class.java){store.captureDaily(store.load()!!.token,"2026-10-24T08:00:00.000Z")}
        }
    }
    @Test fun scheduledFailureCanRetryWithoutDroppingAnIndependentRollback(){
        db().use{db->
            val store=NativeStateStore(db);val before=store.initialize(state("notes"))
            val imported=store.importBackup(before.token,"import-daily",BackupCodec.read(BackupCodec.write(state("decay"),at)),at)
            val failure=NativeStateStore(db){if(it=="after-daily-root")error("Disk fault")}
            assertTrue(runCatching{failure.captureDaily(imported.token,at,targetDate="2026-10-21")}.isFailure)
            assertEquals(listOf(imported.rollbackId),store.backupRoots().map{it.id})
            val daily=store.captureDaily(imported.token,at,targetDate="2026-10-21")
            assertTrue(daily.changed);assertEquals(2,store.backupRoots().size)
            assertFalse(store.captureDaily(imported.token,at,targetDate="2026-10-20").changed)
            assertEquals(state("notes"),db.transaction{SnapshotStore.read(it,imported.rollbackId!!)})
        }
    }
    @Test fun concurrentPreviousDayChecksCommitExactlyOneRoot(){
        val path=temporary.root.toPath().resolve("concurrent-daily.db")
        JdbcStateDatabase(path).use{first->JdbcStateDatabase(path,false).use{second->
            val a=NativeStateStore(first);val b=NativeStateStore(second);val initial=a.initialize(state("notes"))
            val gate=java.util.concurrent.CountDownLatch(1);val executor=java.util.concurrent.Executors.newFixedThreadPool(2)
            try{
                val futures=listOf(a,b).map{storage->executor.submit<DailyCapture>{check(gate.await(5,java.util.concurrent.TimeUnit.SECONDS));storage.captureDaily(initial.token,at,targetDate="2026-10-21")}}
                gate.countDown();val results=futures.map{it.get(15,java.util.concurrent.TimeUnit.SECONDS)}
                assertEquals(1,results.count{it.changed});assertEquals(1,results.map{it.root!!.id}.toSet().size)
                assertEquals(1,a.backupRoots().size);assertEquals(initial,b.load())
            }finally{executor.shutdownNow()}
        }}
    }
}
