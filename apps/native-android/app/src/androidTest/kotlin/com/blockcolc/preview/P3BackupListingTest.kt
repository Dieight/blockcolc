package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.*
import com.blockcolc.storage.BackupCodec
import com.blockcolc.storage.android.AndroidStateDatabase
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Archive validation is lazy, but a damaged archive must remain unusable.
 * Only a newly owned test database is modified. */
class P3BackupListingTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private val runtime get()=PreviewRuntime.get(context)
    private fun refresh(saved:Boolean){
        val request=UUID.randomUUID().toString();runtime.refreshBackups(request)
        runtime.testRead().get(30,TimeUnit.SECONDS)
        assertEquals(saved,runtime.latest.receipts.single{it.id==request}.saved)
        assertEquals(saved,runtime.latest.backupListingReady)
    }
    @Test fun damagedBackupCannotBlockValidCoreOrBeAdvertisedAsRestorable(){
        val name=runtime.testDatabase(true).get(30,TimeUnit.SECONDS)
        var preferences=false
        try{
            runtime.testClientPreferences(true).get(30,TimeUnit.SECONDS);preferences=true
            val now=System.currentTimeMillis()
            val initial=DomainEngine.initial("UTC")
            runtime.testOperation{it.importBackup("backup-listing",BackupCodec.read(BackupCodec.write(initial,DomainTime.format(now))),now)}.get(30,TimeUnit.SECONDS)
            // An older imported pool legitimately receives newly bundled
            // rewards on its first open. Finish that upgrade before testing
            // a later read-only resume against the exact same domain.
            runtime.start();val baseline=runtime.testRead().get(30,TimeUnit.SECONDS)
            assertTrue(runtime.latest.ready);assertFalse(runtime.latest.backupListingReady)
            refresh(true);assertTrue(runtime.latest.roots.isNotEmpty())
            val db=AndroidStateDatabase(context,name)
            try{
                val originals=db.transaction{it.query("SELECT sha,canonical FROM backup_blocks ORDER BY sha")}
                assertTrue(originals.isNotEmpty())
                db.transaction{it.execute("UPDATE backup_blocks SET canonical='corrupt'")}
                runtime.start();val current=runtime.testRead().get(30,TimeUnit.SECONDS)
                assertEquals(baseline.domain.sha256,current.domain.sha256)
                assertTrue(runtime.latest.ready);assertNull(runtime.latest.error);assertFalse(runtime.latest.backupListingReady)
                refresh(false)
                assertTrue(runtime.latest.ready);assertNull(runtime.latest.error)
                db.transaction{sql->originals.forEach{sql.execute("UPDATE backup_blocks SET canonical=? WHERE sha=?",listOf(it[1],it[0]))}}
                refresh(true)
            }finally{db.close()}
        }finally{
            try{if(preferences)runtime.testClientPreferences(false).get(30,TimeUnit.SECONDS)}
            finally{runtime.testDatabase(false).get(30,TimeUnit.SECONDS)}
        }
    }
}
