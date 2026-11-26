package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.cloud.CloudTransport
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.StrictJson
import com.blockcolc.presentation.FocusDraft
import com.blockcolc.presentation.DraftSchedule
import com.blockcolc.presentation.FocusDecision
import com.blockcolc.presentation.FocusEndReason
import com.blockcolc.storage.PlanMode
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Synthetic account and isolated application database. The optional test
 * tunnel changes transport only: IP hostname and the real CA are verified. */
class P3CloudTest {
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private fun await(timeout:Long=180000,condition:()->Boolean){
        val end=android.os.SystemClock.elapsedRealtime()+timeout
        while(!condition()&&android.os.SystemClock.elapsedRealtime()<end)android.os.SystemClock.sleep(50)
        assertTrue("Cloud operation timed out",condition())
    }
    @Test fun encryptedCredentialsRecoverAtomicBackupAndMissingResourcesKeepTheSharedChoice(){
        val directory=File(context.noBackupFilesDir,"cloud-test-"+UUID.randomUUID()).apply{check(mkdir())}
        val resources=File(context.cacheDir,"p3-cloud-resource-"+UUID.randomUUID())
        val preferences="cloud-resource-"+resources.name
        var resourceController:com.blockcolc.preview.resources.NativeResourceController?=null
        try{
            val storage=com.blockcolc.cloud.CloudSessionStorage(context,directory)
            val session=com.blockcolc.cloud.CloudSession("synthetic-token-"+UUID.randomUUID(),"synthetic-account","synthetic-user","synthetic-device")
            storage.write(session);val ciphertext=File(directory,"cloud-session.enc").readBytes()
            assertFalse(String(ciphertext).contains(session.token));assertEquals(session,storage.read())
            File(directory,"cloud-session.enc.bak").writeBytes(ciphertext);assertTrue(File(directory,"cloud-session.enc").delete());assertEquals(session,storage.read())
            storage.write(null);assertNull(storage.read())
            val choices=CloudResourceChoices(context,preferences);choices.save("a".repeat(64),"b".repeat(64))
            val original=choices.read().toString()
            val controller=com.blockcolc.preview.resources.NativeResourceController.isolated(context,resources);resourceController=controller
            controller.cloudSelection("a".repeat(64),"b".repeat(64));await{controller.snapshot().ready&&!controller.snapshot().busy}
            assertNull(controller.snapshot().error);assertNull(controller.snapshot().metadata!!.activeId);assertNull(controller.snapshot().metadata!!.baseId)
            assertEquals(original,choices.read().toString())
        }finally{resourceController?.closeForTest();check(directory.parentFile==context.noBackupFilesDir);assertTrue(directory.deleteRecursively())
            check(resources.parentFile==context.cacheDir);if(resources.exists())assertTrue(resources.deleteRecursively());context.deleteSharedPreferences(preferences)}
    }
    @Test fun actualNativeWriterSyncsPreferencesNotesPlanTakeoverAndRollingBackup(){
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        val args=InstrumentationRegistry.getArguments()
        val proxy=if(args.getString("p3CloudTunnel")=="true")Proxy(Proxy.Type.HTTP,InetSocketAddress("127.0.0.1",18888))else null
        val transport=CloudTransport(context,proxy=proxy)
        val checkPresence=args.getString("p3CloudPresence")=="true"
        if(checkPresence){check(proxy!=null);check(transport.request("/v1/test/presence").getBoolean("localOnly"))}
        assertTrue(transport.request("/healthz").getBoolean("ok"))
        val runtime=PreviewRuntime.get(context);var preferences=false;var cloudTesting=false
        val database=runtime.testDatabase(true,prepareAssets=false).get(30,TimeUnit.SECONDS)
        val directory=File(context.noBackupFilesDir,"cloud-test-"+UUID.randomUUID())
        var controller:NativeCloudController?=null
        val username="p3_"+UUID.randomUUID().toString().replace("-","").take(16)
        val password=UUID.randomUUID().toString()+"-synthetic"
        try{
            runtime.testClientPreferences(true).get(30,TimeUnit.SECONDS);preferences=true
            runtime.testCloud(true).get(30,TimeUnit.SECONDS);cloudTesting=true
            runtime.create("Synthetic cloud project",false);await{runtime.latest.projects.size==1&&!runtime.latest.busy}
            val project=runtime.latest.projects.single();val task=runtime.latest.choices.first{it.id==project.id}.tasks.first().id
            val request="cloud-plan-"+UUID.randomUUID();runtime.confirmPlan(FocusDraft(project.id,task,PlanMode.ROUNDS,DraftSchedule.Rounds(2)),request)
            await{runtime.latest.receipts.any{it.id==request}}
            assertEquals("READY",runtime.latest.phase)
            val client=NativeCloudController.isolated(context,runtime,transport,directory);controller=client;client.start();await{client.snapshot().ready}
            client.login(username,password,true);await{!client.snapshot().busy&&(client.snapshot().lastSync!=null||client.snapshot().error!=null)}
            assertNull(client.snapshot().error);assertTrue(client.snapshot().owned)
            File(context.filesDir,"p3-cloud-native-account.json").writeText(JSONObject().put("syntheticUsername",username).put("syntheticAccount",client.snapshot().account!!.getString("id")).toString())
            val token=transport.request("/v1/login","POST",body=JSONObject().put("username",username).put("password",password)
                .put("deviceId","synthetic_tablet_123456789").put("deviceName","Synthetic tablet").toString()).getString("token")
            fun api(path:String,method:String="GET",body:JSONObject?=null)=transport.request("/v1/$path",method,token,body?.toString())
            var head=api("workspace");val cloudEntries=head.getJSONObject("entries")
            assertEquals(2,JSONObject(cloudEntries.getString("@plan")).getJSONObject("plan").getInt("totalRounds"))
            val sharedPreferences=JSONObject(cloudEntries.getString("@preferences"));sharedPreferences.remove("resourceSelection")
            assertEquals(runtime.latest.preferences.canonical(),StrictJson.render(sharedPreferences))
            val execution=api("execution/claim","POST",JSONObject().put("generation",head.getJSONObject("execution").getLong("generation")).put("takeover",true))
            val key="quickNotes/tablet-note";val note=StrictJson.render(JSONObject().put("ordinal",0).put("value",JSONObject().put("id","tablet-note").put("text","来自另一台设备").put("completed",false).put("createdAt",com.blockcolc.domain.DomainTime.format(System.currentTimeMillis()))))
            api("sync/commit","POST",JSONObject().put("requestId",UUID.randomUUID().toString()).put("epoch",head.getString("epoch")).put("execution",execution.getLong("generation"))
                .put("changes",org.json.JSONArray().put(JSONObject().put("key",key).put("before",JSONObject.NULL).put("canonical",note))))
            val before=client.snapshot().lastSync!!;client.refresh();await{!client.snapshot().busy&&(client.snapshot().lastSync!=before||client.snapshot().error!=null)}
            assertNull(client.snapshot().error);assertFalse(client.snapshot().owned);assertTrue(runtime.latest.notes.any{it.id=="tablet-note"})
            assertEquals(CloudReceipt(CloudAction.SYNC,CloudResult.COMPLETE),client.snapshot().receipt)
            val noteRequest="note-"+UUID.randomUUID();runtime.command(DomainEngine.command("AddQuickNote","noteId" to "phone-note","text" to "offline first"),noteRequest)
            await{runtime.latest.receipts.any{it.id==noteRequest}}
            val old=client.snapshot().lastSync!!;client.refresh();await{!client.snapshot().busy&&(client.snapshot().lastSync!=old||client.snapshot().error!=null)};assertNull(client.snapshot().error)
            head=api("workspace");assertTrue(head.getJSONObject("entries").has("quickNotes/phone-note"));assertTrue(head.getJSONObject("entries").has(key))
            val last=client.snapshot().lastSync!!;client.takeover();await{!client.snapshot().busy&&(client.snapshot().lastSync!=last||client.snapshot().error!=null)};assertNull(client.snapshot().error);assertTrue(client.snapshot().owned)
            assertEquals(2,runtime.testRead().get().recovery.plan!!.totalRounds)
            val beforeBackup=client.snapshot().lastSync;client.captureBackup();await{!client.snapshot().busy&&(client.snapshot().lastSync!=beforeBackup||client.snapshot().error!=null)};assertNull(client.snapshot().error);assertNotNull(client.snapshot().backup)
            val oldEpoch=head.getString("epoch");val beforeRestore=client.snapshot().lastSync;client.restoreBackup();await{client.snapshot().lastSync!=beforeRestore||client.snapshot().error!=null}
            await{!client.snapshot().busy};assertNull(client.snapshot().error)
            assertNotEquals(oldEpoch,api("workspace").getString("epoch"))
            // Recovery snapshots do not resurrect a running plan or its local
            // continuation grant. A deliberate live takeover above does.
            assertNull(runtime.testRead().get().recovery.plan)
            assertNull(runtime.testRead().get().recovery.automatic)
            if(checkPresence)verifyPersistedFocus(runtime,client,{ api(it) },project.id,task)
            await{!client.snapshot().busy}
            val remote=api("workspace")
            api("workspace/replace","POST",JSONObject().put("revision",remote.getLong("revision"))
                .put("entries",remote.getJSONObject("entries")).put("requestId",UUID.randomUUID().toString()))
            client.refresh()
            await{client.snapshot().receipt==CloudReceipt(CloudAction.SYNC,CloudResult.COMPLETE)}
            assertFalse(client.snapshot().choiceRequired)
            verifyDeviceLogoutAndReplacement(runtime,client,transport,directory,token,project.id,task)
            val originalDomain=runtime.testRead().get().domain.sha256
            val nativeDevice=checkNotNull(com.blockcolc.cloud.CloudSessionStorage(context,directory).read()).device
            val secondToken=transport.request("/v1/login","POST",body=JSONObject().put("username",username).put("password",password)
                .put("deviceId","synthetic_tablet_123456789").put("deviceName","Synthetic tablet").toString()).getString("token")
            transport.request("/v1/devices/revoke","POST",secondToken,JSONObject().put("id",nativeDevice).toString())
            client.refresh()
            await{client.snapshot().receipt==CloudReceipt(CloudAction.SYNC,CloudResult.FAILED,"UNAUTHORIZED")}
            client.refreshFriends()
            assertFalse(client.snapshot().busy)
            assertEquals(originalDomain,runtime.testRead().get().domain.sha256)
            File(context.filesDir,"p3-cloud-native.json").writeText(JSONObject().put("schema",1).put("syntheticUsername",username).put("syntheticAccount",client.snapshot().account!!.getString("id"))
                .put("nativeWriter",true).put("planTakeover",true).put("readonlyFence",true).put("notesMerged",true).put("rollingBackupRestored",true).put("tlsVerified",true).put("tunnel",proxy!=null).toString())
            client.logout();await{client.snapshot().account==null}
        }finally{
            controller?.testClose()
            if(cloudTesting)runtime.testCloud(false).get(30,TimeUnit.SECONDS)
            if(preferences)runtime.testClientPreferences(false).get(30,TimeUnit.SECONDS)
            runtime.testDatabase(false,prepareAssets=false).get(30,TimeUnit.SECONDS)
            context.deleteDatabase(database)
            val presentation=File(context.filesDir,"presentation-$database");if(presentation.isDirectory)presentation.deleteRecursively()
            if(directory.isDirectory){check(directory.parentFile==context.noBackupFilesDir);directory.deleteRecursively()}
            if(android.os.Build.VERSION.SDK_INT>=24){context.deleteSharedPreferences("cloud-execution-isolated");context.deleteSharedPreferences("cloud-device-isolated");context.deleteSharedPreferences("cloud-resource-choice-isolated");context.deleteSharedPreferences("native-ui-$database")}
        }
    }

    private fun verifyDeviceLogoutAndReplacement(runtime:PreviewRuntime,client:NativeCloudController,transport:CloudTransport,directory:File,
        tabletToken:String,project:String,task:String){
        val login=checkNotNull(com.blockcolc.cloud.CloudSessionStorage(context,directory).read())
        fun api(path:String,method:String="GET",body:JSONObject?=null,token:String=login.token)=transport.request("/v1/$path",method,token,body?.toString())
        val head=api("workspace")
        val at=com.blockcolc.domain.DomainTime.format(System.currentTimeMillis())
        val additional="quickNotes/after-tablet-replace"
        val entries=head.getJSONObject("entries").put(additional,StrictJson.render(JSONObject().put("ordinal",2).put("value",
            JSONObject().put("id","after-tablet-replace").put("createdAt",at).put("text","Keep the independent cloud note").put("completed",false))))
        api("workspace/replace","POST",JSONObject().put("revision",head.getLong("revision")).put("entries",entries)
            .put("requestId",UUID.randomUUID().toString()),tabletToken)
        api("logout","POST",JSONObject(),tabletToken)
        val replaced=api("workspace")
        api("execution/claim","POST",JSONObject().put("generation",replaced.getJSONObject("execution").getLong("generation")))
        client.refresh()
        await{!client.snapshot().busy&&client.snapshot().receipt==CloudReceipt(CloudAction.SYNC,CloudResult.COMPLETE)}
        assertFalse(client.snapshot().choiceRequired)
        assertEquals(listOf(login.device),client.snapshot().devices.map{it.getString("id")})
        assertTrue(client.snapshot().owned)

        val start="merge-start-"+UUID.randomUUID()
        runtime.beginFocus(FocusDraft(project,task,PlanMode.ROUNDS,DraftSchedule.Rounds(1)),start)
        await{runtime.latest.receipts.any{it.id==start&&it.saved}}
        val active=runtime.testRead().get().domain.activeFocusSession()!!.getString("id")
        val stop="merge-stop-"+UUID.randomUUID()
        runtime.decideFocus(FocusDecision.Interrupt(FocusEndReason.OTHER),stop)
        await{runtime.latest.receipts.any{it.id==stop&&it.saved}}
        client.refresh()
        await{!client.snapshot().busy&&client.snapshot().receipt==CloudReceipt(CloudAction.SYNC,CloudResult.COMPLETE)}
        assertTrue(client.snapshot().owned);assertFalse(client.snapshot().choiceRequired)
        val merged=api("workspace")
        assertTrue(merged.getJSONObject("entries").has("focusHistory/$active"))
        assertTrue(merged.getJSONObject("entries").has(additional))
        assertTrue(runtime.latest.notes.any{it.id=="after-tablet-replace"})

        client.choose("local")
        await{!client.snapshot().busy&&client.snapshot().receipt==CloudReceipt(CloudAction.REPLACE_CLOUD,CloudResult.COMPLETE)}
        val accepted=api("workspace")
        assertNotEquals(merged.getString("epoch"),accepted.getString("epoch"))
        assertEquals(login.device,accepted.getJSONObject("execution").getString("owner"))
        repeat(2){
            client.refresh()
            await{!client.snapshot().busy&&client.snapshot().receipt==CloudReceipt(CloudAction.SYNC,CloudResult.COMPLETE)}
            assertFalse(client.snapshot().choiceRequired)
            assertEquals(accepted.getString("epoch"),api("workspace").getString("epoch"))
        }
    }

    private fun verifyPersistedFocus(runtime:PreviewRuntime,client:NativeCloudController,api:(String)->JSONObject,project:String,task:String){
        val begin="live-start-"+UUID.randomUUID()
        runtime.beginFocus(FocusDraft(project,task,PlanMode.ROUNDS,DraftSchedule.Rounds(1)),begin)
        await{runtime.latest.receipts.any{it.id==begin&&it.saved}}
        val active=runtime.testRead().get().domain.activeFocusSession()!!.getString("id")
        client.refresh()
        await{client.snapshot().receipt==CloudReceipt(CloudAction.SYNC,CloudResult.COMPLETE)}
        val live=api("sync/head")
        assertTrue(live.getBoolean("focusLocked"))
        assertEquals(active,JSONObject(api("workspace").getJSONObject("entries")
            .getString("\$/activeFocusSession")).getString("id"))

        val stop="live-stop-"+UUID.randomUUID()
        runtime.decideFocus(FocusDecision.Interrupt(FocusEndReason.OTHER),stop)
        await{runtime.latest.receipts.any{it.id==stop&&it.saved}}
        client.refresh()
        await{client.snapshot().receipt==CloudReceipt(CloudAction.SYNC,CloudResult.COMPLETE)}
        val entries=api("workspace").getJSONObject("entries")
        assertEquals("null",entries.getString("\$/activeFocusSession"))
        assertTrue(entries.has("focusHistory/$active"))
        val settled=api("sync/head")
        assertTrue(settled.getJSONObject("packages").getJSONObject("focus").getLong("revision")>
            live.getJSONObject("packages").getJSONObject("focus").getLong("revision"))
    }
}
