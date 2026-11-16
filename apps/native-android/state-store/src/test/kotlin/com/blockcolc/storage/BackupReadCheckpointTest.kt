package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.nio.file.Path
import java.util.UUID

class BackupReadCheckpointTest {
    @get:Rule val temporary=TemporaryFolder()
    private fun state()=DomainDocument.fromJson(JSONObject(javaClass.getResource("/state-oracle.json")!!.readText()).getJSONObject("states").getJSONObject("notes"))
    /** Real SQLite, with the same stamp inputs as the Android pinned session. */
    private class Stamped(path:Path):SqlDatabase {
        private val delegate=JdbcStateDatabase(path);private var identity=UUID.randomUUID().toString();private var rolledBack=0L
        var blockReads=0;var failAfterRead=false
        fun reconnectIdentity(){identity=UUID.randomUUID().toString()}
        override fun <T> transaction(block:(SqlSession)->T):T = try{
            delegate.transaction{sql->
                val result=block(object:SqlSession by sql {
                    override fun readStamp():SqlReadStamp {
                        fun number(text:String)=(sql.query(text).single().single() as Number).toLong()
                        return SqlReadStamp(identity,number("PRAGMA main.data_version"),number("SELECT total_changes()"),number("PRAGMA main.schema_version"),rolledBack)
                    }
                    override fun largeTextRows(text:String,args:List<Any?>):List<List<String>> {
                        if(text.contains("FROM backup_blocks"))blockReads++
                        return sql.largeTextRows(text,args)
                    }
                })
                if(failAfterRead){failAfterRead=false;error("rollback after checked read")}
                result
            }
        }catch(error:Throwable){rolledBack++;throw error}
        override fun close()=delegate.close()
    }
    @Test fun unchangedPhysicalReadsReuseOnlyThePreviouslyCheckedRecoveryList(){
        Stamped(temporary.root.toPath().resolve("roots.db")).use{db->
            val store=NativeStateStore(db);val initial=store.initialize(state())
            store.captureDaily(initial.token,"2026-10-23T08:00:00.000Z")
            val first=store.backupRoots();val reads=db.blockReads
            assertEquals(first,store.backupRoots());assertEquals(reads,db.blockReads)
            assertFalse(store.captureDaily(initial.token,"2026-10-23T09:00:00.000Z").changed)
            assertEquals(reads,db.blockReads)
            assertThrows(UnsupportedOperationException::class.java){(first as MutableList<BackupRoot>).clear()}
            db.transaction{it.execute("UPDATE backup_blocks SET canonical='null' WHERE sha=(SELECT sha FROM backup_blocks LIMIT 1)")}
            assertThrows(StorageCorruption::class.java){store.backupRoots()}
            assertTrue(db.blockReads>reads)
        }
    }
    @Test fun externalWritesWithUnchangedApplicationRevisionAreStillRejected(){
        val path=temporary.root.toPath().resolve("external.db")
        Stamped(path).use{db->
            val store=NativeStateStore(db);val initial=store.initialize(state())
            store.captureDaily(initial.token,"2026-10-23T08:00:00.000Z");store.backupRoots()
            JdbcStateDatabase(path,false).use{other->other.transaction{it.execute("UPDATE backup_blocks SET bytes=bytes+1 WHERE sha=(SELECT sha FROM backup_blocks LIMIT 1)")}}
            assertEquals(initial.token,store.load()!!.token)
            assertThrows(StorageCorruption::class.java){store.backupRoots()}
        }
    }
    @Test fun connectionSchemaAndRollbackChangesRecheckTheActualTables(){
        Stamped(temporary.root.toPath().resolve("boundaries.db")).use{db->
            val store=NativeStateStore(db);val initial=store.initialize(state())
            store.captureDaily(initial.token,"2026-10-23T08:00:00.000Z");val roots=store.backupRoots()
            var reads=db.blockReads
            db.reconnectIdentity();assertEquals(roots,store.backupRoots());assertTrue(db.blockReads>reads);reads=db.blockReads
            db.transaction{it.execute("CREATE TABLE unrelated_schema_change (id INTEGER)")}
            assertEquals(roots,store.backupRoots());assertTrue(db.blockReads>reads);reads=db.blockReads
            db.failAfterRead=true;assertThrows(IllegalStateException::class.java){store.backupRoots()}
            assertEquals(roots,store.backupRoots());assertTrue(db.blockReads>reads)
        }
    }
}
