package com.blockcolc.preview

import android.content.Intent
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiObject2
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** All files/DBs are within the independent preview. No formal package, plan or settings. */
class P2DeviceTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private val runtime get()=PreviewRuntime.get(context)
    private fun initial()=DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()})
    private fun spec(mode:PlanMode=PlanMode.MINIMAL)=PlanRequest(UUID.randomUUID().toString(),"complex-0",if(mode==PlanMode.MINIMAL)null else "read",mode,3,3000,1000)
    private fun save(name:String,value:JSONObject){require(name.matches(Regex("[a-z0-9-]+")));File(context.filesDir,"p2-$name.json").writeText(value.toString())}
    private fun waitUntil(ms:Long=45000,predicate:()->Boolean){val until=SystemClock.elapsedRealtime()+ms;while(!predicate()){if(SystemClock.elapsedRealtime()>until)error("P2 condition timed out");Thread.sleep(100)}}
    @Test fun systemWakeWithoutATransitionDoesNotWriteAReceipt() {
        val name=runtime.testDatabase(true).get(30,TimeUnit.SECONDS)
        try {
            fun observe(expected:StoredState) {
                val completed=CountDownLatch(1)
                runtime.receive(null){completed.countDown()}
                assertTrue(completed.await(30,TimeUnit.SECONDS))
                assertEquals(expected,runtime.testRead().get(30,TimeUnit.SECONDS))
                assertEquals(expected.token.revision,runtime.latest.revision)
            }
            val now=System.currentTimeMillis()
            val created=DomainEngine.execute(DomainEngine.initial("UTC"),DomainEngine.command("CreateProject",
                "projectId" to "complex-0","title" to "Observation","blueprintId" to "builtin-small-workshop",
                "subtasks" to JSONArray().put(JSONObject().put("id","read").put("title","Read"))),now)
            check(created.ok){created.error!!}
            val backup=BackupCodec.read(BackupCodec.write(created.state,DomainTime.format(now)))
            runtime.testOperation{it.importBackup("system-wake-fixture",backup,now)}.get(30,TimeUnit.SECONDS)
            val idle=runtime.testOperation{Operation(it.load())}.get(30,TimeUnit.SECONDS).state
            assertNull(idle.recovery.plan)
            observe(idle)
            val idleWorld=checkNotNull(runtime.committedWorld)
            val confirmed=runtime.testOperation{it.confirm("system-wake-confirm",spec().copy(focusMs=600000),now)}.get(30,TimeUnit.SECONDS).state
            val confirmedWorld=checkNotNull(runtime.committedWorld)
            assertEquals(confirmed.token.revision,confirmedWorld.identity.revision)
            assertNotEquals(idleWorld.identity,confirmedWorld.identity)
            assertEquals(idleWorld.sceneIdentity,confirmedWorld.sceneIdentity)
            val active=runtime.testOperation{it.start("system-wake-focus",true,now)}.get(30,TimeUnit.SECONDS).state
            val plan=checkNotNull(active.recovery.plan)
            assertEquals(PlanPhase.FOCUS,plan.phase)
            observe(active)
            assertEquals(plan.phaseEndsAt,runtime.latest.ticket?.end)
        } finally {
            runtime.testDatabase(false).get(30,TimeUnit.SECONDS)
            check(name.startsWith("p2-device-")&&context.deleteDatabase(name))
        }
    }
    @Test fun androidJsonNullPlansSurviveTheActualSqliteRoundTrip() {
        val at=DomainTime.millis("2026-10-23T08:00:00.000Z")
        val modes=listOf(PlanMode.MINIMAL to false,PlanMode.MARATHON to false,PlanMode.ROUNDS to false,PlanMode.ROUNDS to true)
        val cases=JSONArray()
        for((mode,habit) in modes){
            val name="p2-null-contract-${UUID.randomUUID()}.db"
            try { AndroidStateDatabase(context,name).use { db ->
                val store=NativeStateStore(db);store.initialize(initial());val coordinator=FocusCoordinator(store,name)
                val project=if(habit)"nullable-habit" else "complex-0"
                if(habit)coordinator.command("habit",DomainEngine.command("CreateHabitProject","projectId" to project,"title" to "空值习惯验证","blueprintId" to "builtin-small-workshop","targetRounds" to 10),at)
                val task=if(mode==PlanMode.MINIMAL||habit)null else "read"
                coordinator.confirm("confirm",PlanRequest(UUID.randomUUID().toString(),project,task,mode,3,1000,200),at)
                coordinator.start("start",true,at)
                val saved=store.load()!!;val active=saved.domain.json().getJSONObject("activeFocusSession")
                if(task==null)assertTrue(active.isNull("subtaskId"))else assertEquals(task,active.getString("subtaskId"))
                assertEquals(PlanPhase.FOCUS,saved.recovery.plan!!.phase)
                saved.recovery.validate(saved.domain,saved.token.replacementGeneration)
                cases.put(JSONObject().put("mode",mode.name).put("habit",habit).put("subtask",task?:JSONObject.NULL))
            }} finally { context.deleteDatabase(name) }
        }
        save("android-null-contract",JSONObject().put("completed",true).put("cases",cases)
            .put("platformOptStringNull",JSONObject().put("value",JSONObject.NULL).optString("value",null)?:JSONObject.NULL))
    }
    @Test fun realSqliteFullImportExportRollbackAndDailyMerge() {
        val name="p2-contract-${UUID.randomUUID()}.db"
        try{AndroidStateDatabase(context,name).use{db->
            val store=NativeStateStore(db);val first=store.initialize(initial());val backup=BackupCodec.read(BackupCodec.write(first.domain,DomainTime.format(System.currentTimeMillis()),compact=true))
            val replacement=store.importBackup(first.token,"import",backup,DomainTime.format(System.currentTimeMillis()))
            assertEquals(first.domain,store.load()!!.domain);assertEquals(1L,replacement.token.replacementGeneration)
            val root=store.backupRoots().single();val restored=store.restore(replacement.token,"restore",root.id,DomainTime.format(System.currentTimeMillis()))
            assertEquals(2L,restored.token.replacementGeneration);assertEquals(first.domain,BackupCodec.read(store.exportBackup(DomainTime.format(System.currentTimeMillis()))).domain)
            store.captureDaily(restored.token,"2026-10-22T08:00:00.000Z");store.captureDaily(restored.token,"2026-10-23T08:00:00.000Z")
            assertEquals(1,store.backupRoots().count{it.kind=="daily"});assertEquals(2,store.backupRoots().count{it.kind=="rollback"})
        }}finally{context.deleteDatabase(name)}
    }
    @Test fun androidVersionOneDatabaseUpgradesWithoutRecreatingOrLosingRecords() {
        val source="p2-contract-source-${UUID.randomUUID()}.db";val legacy="p2-contract-v1-${UUID.randomUUID()}.db"
        try {
            val names=mapOf("domain_values" to listOf("name","canonical"),"domain_records" to listOf("section","record_key","ordinal","canonical"),
                "blueprint_assets" to listOf("sha","canonical"),"local_recovery" to listOf("id","canonical"))
            val records=AndroidStateDatabase(context,source).use{db->NativeStateStore(db).initialize(initial());db.transaction{sql->names.mapValues{(table,columns)->sql.query("SELECT ${columns.joinToString(",")} FROM $table")}}}
            context.openOrCreateDatabase(legacy,ContextMode,null).use{raw->
                StateSchema.originalStatements.forEach{raw.execSQL(it)}
                for((table,rows)in records)for(row in rows){val columns=names.getValue(table);raw.execSQL("INSERT INTO $table(${columns.joinToString(",")}) VALUES(${columns.joinToString(","){"?"}})",row.toTypedArray())}
                raw.execSQL("INSERT INTO state_meta VALUES(1,1,7,4,?)",arrayOf(initial().sha256));raw.version=1
            }
            AndroidStateDatabase(context,legacy).use{db->val state=NativeStateStore(db).load()!!;assertEquals(initial(),state.domain);assertEquals(StateToken(7,4),state.token)}
        }finally{context.deleteDatabase(source);context.deleteDatabase(legacy)}
    }
    @Test fun androidWriteFailureAndCorruptionDoNotTurnIntoAnEmptyWorkspace() {
        val name="p2-contract-failure-${UUID.randomUUID()}.db"
        try{AndroidStateDatabase(context,name).use{db->
            val store=NativeStateStore(db);val before=store.initialize(initial())
            val broken=FocusCoordinator(NativeStateStore(db){if(it=="before-commit")error("Injected storage failure")},name)
            assertTrue(runCatching{broken.confirm("confirm",spec(),System.currentTimeMillis())}.isFailure);assertEquals(before,store.load())
            db.transaction{it.execute("UPDATE domain_values SET canonical='999' WHERE name='schemaVersion'")}
            assertTrue(runCatching{store.load()}.exceptionOrNull()is StorageCorruption)
            assertTrue(runCatching{store.initialize(initial())}.exceptionOrNull()is StorageCorruption)
            assertTrue(context.getDatabasePath(name).exists())
        }}finally{context.deleteDatabase(name)}
    }
    @Test fun foregroundWorldFocusReportStatsAndProcessRecoverableState() {
        runtime.testDatabase(true).get(30,TimeUnit.SECONDS)
        val journal=JSONArray();val report=JSONObject().put("initial",initial().canonical)
        fun run(block:(FocusCoordinator)->Operation):Operation{
            val result=runtime.testOperation(block).get(30,TimeUnit.SECONDS)
            val commands=JSONArray(result.journal.map{JSONObject().put("command",JSONObject(it.command)).put("now",it.now)})
            journal.put(JSONObject().put("commands",commands).put("after",result.state.domain.canonical).put("events",JSONArray(result.events.map{JSONObject(it)})))
            return result
        }
        var scenario:ActivityScenario<MainActivity>?=null
        try{
            run { c->c.importBackup("fixture",BackupCodec.read(BackupCodec.write(initial(),DomainTime.format(System.currentTimeMillis()))),System.currentTimeMillis()) }
            runtime.testRecording(true).get(30,TimeUnit.SECONDS)
            scenario=ActivityScenario.launch(Intent(context,MainActivity::class.java).putExtra("business",true).putExtra("fixture","ocean").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            waitUntil{runtime.latest.ready&&runtime.latest.error==null}
            val device=UiDevice.getInstance(instrumentation)
            fun visible(selector:BySelector):UiObject2 {
                repeat(8){
                    // Compose scroll semantics are refreshed after the input
                    // returns. On API 34+ the automation cache can still keep
                    // the old tree even after the button is visibly on screen.
                    // Refresh the public automation cache; keep real scrolling
                    // and the real button, never substitute a hidden command.
                    instrumentation.waitForIdleSync()
                    if(android.os.Build.VERSION.SDK_INT>=34)instrumentation.uiAutomation.clearCache()
                    val obj=device.wait(Until.findObject(selector),1200)
                    if(obj!=null&&obj.visibleBounds.height()>10)return obj
                    device.findObject(By.textContains("ERROR:"))?.let{error(it.text)}
                    device.swipe(device.displayWidth*3/4,device.displayHeight*4/5,device.displayWidth*3/4,device.displayHeight*2/5,25)
                };error("P2 control unavailable: $selector")
            }
            // The real start control is below the scroll fold on this phone;
            // accessibility only exposes its visible region. Find it through
            // real scrolling, rather than waiting for an off-screen text node.
            visible(By.text("开始专注"))
            val now=System.currentTimeMillis();run{c->c.confirm("confirm",spec(),now)}
            visible(By.desc("自动连续专注")).click()
            visible(By.text("开始专注")).click()
            waitUntil(20000){runtime.latest.phase=="REPORT"}
            assertEquals(3,runtime.latest.round)
            val slider=visible(By.clazz("android.widget.SeekBar")).visibleBounds
            device.click(slider.centerX(),slider.centerY())
            val submit=visible(By.text("一次提交本次推进"));val beforeSubmit=System.nanoTime()
            submit.click();waitUntil{runtime.latest.phase=="IDLE"}
            val expected=runtime.latest.projects.first{it.id=="complex-0"}.progress;assertTrue(expected in 1..5000)
            waitUntil{File(context.filesDir,"p2-construction-ocean.json").takeIf{it.isFile}?.let{JSONObject(it.readText()).let{v->v.getInt("progress")==expected&&v.getLong("updatedFrameSubmittedNs")>=beforeSubmit}}==true}
            assertEquals("IDLE",runtime.latest.phase)
            assertEquals(27,runtime.latest.completed)
            val final=run{Operation(it.load())}.state
            assertEquals(expected,final.domain.json().getJSONArray("projects").getJSONObject(0).let(DomainEngine::progress))
            assertTrue(runtime.latest.allocations.any{it.title=="正在建造的工坊"&&it.duration>=9000})
            visible(By.text("统计")).click();check(device.wait(Until.hasObject(By.text("时间花在哪里")),10000))
            device.takeScreenshot(File(context.filesDir,"p2-flow-statistics.png"))
            report.put("final",final.domain.canonical).put("attribution",FocusProjection.attribution(final.domain)).put("commands",JSONArray(runtime.testRecording().get(30,TimeUnit.SECONDS))).put("world",JSONObject(File(context.filesDir,"p2-construction-ocean.json").readText())).put("completed",true)
        }catch(error:Throwable){
            report.put("failure",error.toString()).put("failurePhase",runtime.latest.phase).put("failureMessage",runtime.latest.message)
            val device=UiDevice.getInstance(instrumentation)
            runCatching{device.dumpWindowHierarchy(File(context.filesDir,"p2-flow-failure.xml"));device.takeScreenshot(File(context.filesDir,"p2-flow-failure.png"))}
            throw error
        }
        finally{save("foreground-flow",report);scenario?.close();runtime.testDatabase(false).get(30,TimeUnit.SECONDS)}
    }
    companion object { private const val ContextMode=0 }
}
