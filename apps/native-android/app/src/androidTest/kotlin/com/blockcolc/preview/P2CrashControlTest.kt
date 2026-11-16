package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.*
import com.blockcolc.focus.*
import com.blockcolc.storage.*
import com.blockcolc.storage.android.AndroidStateDatabase
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/** Host runs the three methods separately. The middle method intentionally kills its own test process. */
class P2CrashControlTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private val control get()=File(context.filesDir,"p2-crash-control.json")
    private fun command()=DomainEngine.command("DeleteActiveProject","projectId" to "complex-0")
    private fun state()=JSONObject(control.readText())
    private fun database(c:JSONObject)=c.getString("database").also{require(it.matches(Regex("p2-crash-[a-f0-9-]+\\.db")))}
    @Test fun prepare(){
        val name="p2-crash-${UUID.randomUUID()}.db"
        val doc=DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()})
        AndroidStateDatabase(context,name).use{NativeStateStore(it).initialize(doc)}
        control.writeText(JSONObject().put("database",name).put("sha",doc.sha256).put("preparedAt",System.currentTimeMillis()).toString())
    }
    @Test fun dieBeforeTransactionCommit(){
        val c=state();val name=database(c)
        AndroidStateDatabase(context,name).use{db->
            val store=NativeStateStore(db){checkpoint->if(checkpoint=="before-commit"){
                val marker=JSONObject().put("database",name).put("checkpoint",checkpoint).put("pid",android.os.Process.myPid()).put("preparedAt",c.getLong("preparedAt"))
                FileOutputStream(File(context.filesDir,"p2-crash-marker.json")).use{it.write(marker.toString().toByteArray());it.fd.sync()}
                android.os.Process.killProcess(android.os.Process.myPid());error("Own process unexpectedly survived")
            }}
            assertEquals(c.getString("sha"),store.load()!!.domain.sha256)
            FocusCoordinator(store,name).command("crash-request",command(),System.currentTimeMillis())
            fail("Expected actual process death, not a caught exception")
        }
    }
    @Test fun verifyCrashRecoveryAndSameRequestRetry(){
        val c=state();val name=database(c);val marker=JSONObject(File(context.filesDir,"p2-crash-marker.json").readText())
        assertEquals(name,marker.getString("database"));assertNotEquals(android.os.Process.myPid(),marker.getInt("pid"))
        val result=JSONObject().put("completed",false).put("killedPid",marker.getInt("pid")).put("recoveryPid",android.os.Process.myPid())
        AndroidStateDatabase(context,name).use{db->
            val store=NativeStateStore(db);val before=store.load()!!
            assertEquals(c.getString("sha"),before.domain.sha256);assertEquals(StateToken(0,0),before.token)
            assertEquals(0,store.backupRoots().size)
            assertNull(store.receipt(0,"crash-request",StrictJson.sha(StrictJson.render(command()))))
            val coordinator=FocusCoordinator(store,name);val now=System.currentTimeMillis()
            val retried=coordinator.command("crash-request",command(),now)
            assertEquals(1L,retried.state.token.revision);assertNotEquals(before.domain,retried.state.domain)
            assertEquals(retried.state,coordinator.command("crash-request",command(),now+1).state)
            assertEquals(1,store.backupRoots().size)
            result.put("priorStateAndNoOrphanRollback",true).put("sameRequestRetryExactlyOnce",true).put("completed",true)
        }
        File(context.filesDir,"p2-crash-recovery.json").writeText(result.toString())
        context.deleteDatabase(name) // This test's UUID DB only; never the selected preview DB.
    }
}
