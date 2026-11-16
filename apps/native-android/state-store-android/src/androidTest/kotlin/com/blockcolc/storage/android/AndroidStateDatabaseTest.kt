package com.blockcolc.storage.android

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.storage.SqlDatabase
import com.blockcolc.storage.SqlSession
import com.blockcolc.storage.StateSchema
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

/** Isolated library test DB, not the preview or formal App's existing data. */
class AndroidStateDatabaseTest {
    @Test fun sqliteAdapterCommitsRollsBackAndReopensWithoutRecreating() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "p2-contract-${UUID.randomUUID()}.db"
        try {
            AndroidStateDatabase(context, name).use { db ->
                db.transaction { sql ->
                    sql.execute("INSERT INTO domain_values(name,canonical) VALUES(?,?)", listOf("test", "\"中文😀\""))
                    assertEquals(1, sql.execute("UPDATE domain_values SET canonical=? WHERE name=?", listOf("\"saved\"", "test")))
                }
                assertTrue(runCatching { db.transaction { sql -> sql.execute("DELETE FROM domain_values"); error("Injected failure") } }.isFailure)
                assertEquals("\"saved\"", db.transaction { it.query("SELECT canonical FROM domain_values WHERE name=?", listOf("test")).single()[0] })
                assertEquals(0, db.transaction { it.execute("UPDATE domain_values SET canonical='unused' WHERE name='absent'") })
            }
            AndroidStateDatabase(context, name).use { db ->
                assertEquals("\"saved\"", db.transaction { it.query("SELECT canonical FROM domain_values").single()[0] })
            }
        } finally { context.deleteDatabase(name) }
    }
    @Test fun sqliteSchemaAndBoundArgumentsAreActuallySupported() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "p2-contract-${UUID.randomUUID()}.db"
        try { AndroidStateDatabase(context, name).use { db ->
            db.transaction { sql ->
                assertEquals(1, sql.execute("INSERT OR IGNORE INTO blueprint_assets(sha,canonical) VALUES(?,?)", listOf("a".repeat(64), "{}")))
                assertEquals(0, sql.execute("INSERT OR IGNORE INTO blueprint_assets(sha,canonical) VALUES(?,?)", listOf("a".repeat(64), "ignored")))
                assertTrue(sql.query("SELECT name FROM sqlite_master WHERE type='table'").size >= 6)
            }
        } } finally { context.deleteDatabase(name) }
    }
}
