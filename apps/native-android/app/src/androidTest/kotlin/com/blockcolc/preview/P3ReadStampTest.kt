package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.DomainEngine
import com.blockcolc.storage.*
import com.blockcolc.storage.android.AndroidStateDatabase
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

/** Real SQLite connection/transaction invalidation; every file is test-owned. */
class P3ReadStampTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private class Meter(val actual:AndroidStateDatabase):SqlDatabase {
        var reads=0
        override fun <T> transaction(block:(SqlSession)->T):T=actual.transaction{sql->block(object:SqlSession by sql{
            override fun query(text:String,args:List<Any?>):List<List<Any?>>{reads++;return sql.query(text,args)}
            override fun largeText(text:String,args:List<Any?>):String{reads++;return sql.largeText(text,args)}
        })}
        override fun close()=actual.close()
    }
    private fun run(block:(String,AndroidStateDatabase,Meter,NativeStateStore)->Unit){
        val name="p2-stamp-${UUID.randomUUID()}.db";check(!context.getDatabasePath(name).exists())
        val db=AndroidStateDatabase(context,name);val meter=Meter(db);val store=NativeStateStore(meter)
        try{store.initialize(DomainEngine.initial("UTC"));block(name,db,meter,store)}
        finally{db.close();check(context.deleteDatabase(name))}
    }
    @Test fun unchangedInputsReuseValidationButSameTokenLocalEditsAreReadAndRejected()=run{_,db,meter,store->
        val first=checkNotNull(store.load());meter.reads=0
        val second=checkNotNull(store.load());assertEquals(first,second);assertNotSame(first.recovery,second.recovery);assertEquals(0,meter.reads)
        db.transaction{it.execute("UPDATE domain_values SET canonical=canonical||' ' WHERE name='activeProjectId'")}
        assertEquals(first,store.load());assertTrue(meter.reads>0)
        meter.reads=0;assertEquals(first,store.load());assertEquals(0,meter.reads)
        db.transaction{it.execute("UPDATE local_recovery SET canonical='{}' WHERE id=1")}
        assertTrue(runCatching{store.load()}.exceptionOrNull() is StorageCorruption)
    }
    @Test fun anotherConnectionCannotConcealASameTokenEdit()=run{name,_,meter,store->
        val before=checkNotNull(store.load());meter.reads=0
        AndroidStateDatabase(context,name).use{other->other.transaction{it.execute("UPDATE local_recovery SET canonical='{}' WHERE id=1")}}
        assertTrue(runCatching{store.load()}.exceptionOrNull() is StorageCorruption)
        assertTrue(meter.reads>0);assertEquals(0L,before.token.revision)
    }
    @Test fun temporarySchemaChangesInvalidateThePhysicalConnectionProof()=run{_,db,meter,store->
        val before=checkNotNull(store.load())
        db.transaction{it.execute("CREATE TEMP TABLE local_recovery(id INTEGER,canonical TEXT)")}
        meter.reads=0
        assertTrue(runCatching{store.load()}.exceptionOrNull() is StorageCorruption)
        assertTrue(meter.reads>0)
        db.transaction{it.execute("DROP TABLE temp.local_recovery")}
        assertEquals(before,store.load())
    }
    @Test fun anOuterRollbackCannotLeaveAnUncommittedRevisionInTheReadCache()=run{_,db,meter,store->
        val before=checkNotNull(store.load())
        val fault=IllegalStateException("owned rollback")
        assertSame(fault,runCatching{db.transaction{sql->
            sql.execute("UPDATE state_meta SET revision=revision+1 WHERE id=1")
            assertEquals(before.token.revision+1,store.load()!!.token.revision)
            throw fault
        }}.exceptionOrNull())
        meter.reads=0;assertEquals(before,store.load());assertTrue(meter.reads>0)
    }
    @Test fun reconnectAndPostWriteTriggersRequireActualRowsAgain()=run{_,db,meter,store->
        val before=checkNotNull(store.load());val first=db.transaction{it.readStamp()!!}
        db.close();val next=db.transaction{it.readStamp()!!}
        assertNotEquals(first.connection,next.connection)
        meter.reads=0;assertEquals(before,store.load());assertTrue(meter.reads>0)
        db.transaction{it.execute("CREATE TRIGGER corrupt_after_meta AFTER UPDATE ON state_meta BEGIN UPDATE local_recovery SET canonical='{}' WHERE id=1; END")}
        assertEquals(before,store.load())
        store.commit(before.token,"trigger-proof",before.domain,before.recovery)
        assertTrue(runCatching{store.load()}.exceptionOrNull() is StorageCorruption)
    }
}
