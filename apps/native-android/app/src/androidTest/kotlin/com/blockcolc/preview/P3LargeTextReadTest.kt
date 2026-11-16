package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.storage.android.AndroidStateDatabase
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class P3LargeTextReadTest {
    @Test fun mixedLargeCellsKeepOrderUnicodeAndBindingsWithoutAWindowOverflow(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val name="p2-largecells-${UUID.randomUUID()}.db"
        check(!context.getDatabasePath(name).exists())
        val texts=listOf("", "small", "汉😀字".repeat(450_000), "tail", "x".repeat(3*1024*1024))
        try{AndroidStateDatabase(context,name).use{db->db.transaction{sql->
            sql.execute("CREATE TABLE lab_cells(id INTEGER PRIMARY KEY, label TEXT NOT NULL, body TEXT)")
            texts.forEachIndexed{i,text->sql.execute("INSERT INTO lab_cells(id,label,body) VALUES(?,?,?)",listOf(i,"row-$i",text))}
            val rows=sql.largeTextRows("SELECT label,body FROM lab_cells WHERE id>=? AND id<? ORDER BY id",listOf(0,texts.size))
            assertEquals(texts.indices.map{listOf("row-$it",texts[it])},rows)
            texts.forEachIndexed{i,text->assertEquals(text,sql.largeText("SELECT body FROM lab_cells WHERE id=?",listOf(i)))}
            assertTrue(runCatching{sql.largeText("SELECT body FROM lab_cells WHERE id=-1")}.isFailure)
            assertTrue(runCatching{sql.largeText("SELECT body FROM lab_cells")}.isFailure)
            sql.execute("UPDATE lab_cells SET body=CAST(body AS BLOB) WHERE id=1")
            assertTrue(runCatching{sql.largeTextRows("SELECT body FROM lab_cells WHERE id=1")}.isFailure)
            sql.execute("UPDATE lab_cells SET body=CAST(body AS BLOB) WHERE id=2")
            assertTrue(runCatching{sql.largeTextRows("SELECT body FROM lab_cells WHERE id=2")}.isFailure)
            assertTrue(runCatching{sql.largeText("SELECT body FROM lab_cells WHERE id=2")}.isFailure)
            sql.execute("UPDATE lab_cells SET body=NULL WHERE id=3")
            assertTrue(runCatching{sql.largeTextRows("SELECT body FROM lab_cells WHERE id=3")}.isFailure)
            assertTrue(runCatching{sql.largeText("SELECT body FROM lab_cells WHERE id=3")}.isFailure)
            val address="a".repeat(64)
            sql.execute("INSERT INTO blueprint_assets(sha,canonical) VALUES(?,?)",listOf(address,texts[2]))
            assertEquals(texts[2],sql.blueprintBody(address))
            assertTrue(runCatching{sql.blueprintBody("b".repeat(64))}.isFailure)
            sql.execute("UPDATE blueprint_assets SET canonical=CAST(canonical AS BLOB) WHERE sha=?",listOf(address))
            assertTrue(runCatching{sql.blueprintBody(address)}.isFailure)
        }}}finally{
            val path=context.getDatabasePath(name).canonicalFile
            check(path.parentFile==context.getDatabasePath("scope.db").canonicalFile.parentFile)
            check(context.deleteDatabase(name))
        }
    }
}
