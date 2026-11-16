package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainTime
import com.blockcolc.domain.StrictJson
import com.blockcolc.focus.FocusCoordinator
import com.blockcolc.focus.PlanRequest
import com.blockcolc.preview.blueprints.NativeBlueprintLibrary
import com.blockcolc.storage.BackupCodec
import com.blockcolc.storage.NativeStateStore
import com.blockcolc.storage.PlanMode
import com.blockcolc.storage.PlanPhase
import com.blockcolc.storage.android.AndroidStateDatabase
import com.blockcolc.world.generation.BuiltinBlueprintCatalog
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

/** Builds a NEW test database from the user's locally exported backup. Does
 * not select it or touch any existing database, preferences, or formal App. */
class P3StartupFixtureTest {
    @Test fun prepareMediumInFlightPlanWithoutSelectingIt(){
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val name=checkNotNull(InstrumentationRegistry.getArguments().getString("fixtureDatabase"))
        require(name.matches(Regex("p2-fast-core-[a-f0-9]{12}\\.db")))
        val context=instrumentation.targetContext
        assertFalse(context.getDatabasePath(name).exists())
        val root=DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()}).json()
        val projects=root.getJSONArray("projects")
        val project=(0 until projects.length()).map(projects::getJSONObject).single{it.getString("id")=="complex-0"}
        val tasks=project.getJSONArray("subtasks")
        val task=(0 until tasks.length()).map(tasks::getJSONObject).single{it.getString("id")=="read"}
        val title="冷启动续做"
        task.put("title",title)
        val catalog=BuiltinBlueprintCatalog.load()
        val now=System.currentTimeMillis()
        val date=DomainTime.format(now)
        val resources=root.getJSONArray("buildingBlueprintResources")
        val imports=catalog.entries.filter{it.category=="supplemental"}.sortedByDescending{it.bytes}.take(3)
        for(entry in imports)resources.put(JSONObject().put("id",entry.id).put("displayName",entry.displayName)
            .put("blueprint",NativeBlueprintLibrary.importedSnapshot(catalog.content(entry.id).json())).put("importedAt",date))
        val daily=root.getJSONArray("decorationBlueprintResources")
        val existing=(0 until daily.length()).map{daily.getJSONObject(it).getString("id")}.toSet()
        for(entry in catalog.entries.filter{it.category=="daily"&&it.id !in existing})
            daily.put(JSONObject().put("id",entry.id).put("blueprint",NativeBlueprintLibrary.importedSnapshot(catalog.content(entry.id).json())).put("importedAt",date))
        val document=DomainDocument.fromOwnedJson(root)
        val receipt=AndroidStateDatabase(context,name).use{sql->
            val store=NativeStateStore(sql)
            store.initialize(document)
            val state=FocusCoordinator(store,name).begin("cold-resume-start",
                PlanRequest("cold-resume-plan","complex-0","read",PlanMode.ROUNDS,2,45*60000L,300000L),false,now).state
            assertEquals(PlanPhase.FOCUS,state.recovery.plan?.phase)
            assertEquals("cold-resume-plan",state.recovery.plan?.id)
            JSONObject().put("database",name).put("databaseSelected",false).put("wireBytes",StrictJson.utf8Size(state.domain.canonical))
                .put("projects",projects.length()).put("importedAssets",imports.size).put("taskTitle",title)
                .put("domainSha",state.domain.sha256).put("revision",state.token.revision).put("localRecovery",state.recovery.canonical())
                .put("activeSession",StrictJson.render(checkNotNull(state.domain.activeFocusSession())))
        }
        instrumentation.sendStatus(2,android.os.Bundle().apply{putString("p3StartupFixture",receipt.toString())})
    }
    @Test fun prepareSeparateThreeRoundReportDatabaseWithoutSelectingIt(){
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val args=InstrumentationRegistry.getArguments();val name=checkNotNull(args.getString("fixtureDatabase"))
        val environment=checkNotNull(args.getString("p3Environment"))
        require(name.matches(Regex("p2-report-[a-f0-9]{12}\\.db"))&&environment in listOf("ocean-island","mosaic-coast"))
        assertFalse(context.getDatabasePath(name).exists())
        val source=com.blockcolc.domain.DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()})
        val now=System.currentTimeMillis()-3600000
        val changed=com.blockcolc.domain.DomainEngine.execute(source,com.blockcolc.domain.DomainEngine.command("ConfigureWorldEnvironment","environmentStyle" to environment),now)
        assertTrue(changed.error,changed.ok)
        AndroidStateDatabase(context,name).use{sql->
            val store=NativeStateStore(sql);store.initialize(changed.state)
            val c=com.blockcolc.focus.FocusCoordinator(store,name)
            val catalog=com.blockcolc.world.generation.BuiltinBlueprintCatalog.load()
            com.blockcolc.presentation.DailyRewardRegistration.prepare(c,catalog.entries.filter{it.category=="daily"}.map{it.id},
                blueprint={catalog.content(it).json()},requestId={"fixture-register:${java.util.UUID.randomUUID()}"},now=now)
            c.confirm("fixture-confirm",com.blockcolc.focus.PlanRequest("fixture-plan","complex-0",null,com.blockcolc.storage.PlanMode.MINIMAL,3,60000,0),now)
            repeat(3){i->c.start("fixture-start-$i",false,now+i*2000+1);c.manual("fixture-early-$i",true,false,"other",null,now+i*2000+1001)}
            val state=store.load()!!;val facts=state.domain.projectionJson()
            assertEquals(25,facts.getJSONArray("projects").length())
            assertEquals(com.blockcolc.storage.PlanPhase.REPORT,state.recovery.plan!!.phase)
            assertEquals(3,state.recovery.plan!!.totalRounds);assertTrue(state.domain.focusControlJson().isNull("activeFocusSession"))
            val projects=facts.getJSONArray("projects");val project=(0 until projects.length()).map{projects.getJSONObject(it)}.single{it.getString("id")=="complex-0"}
            File(context.filesDir,"$name.fixture.json").writeText(JSONObject().put("schema",1).put("database",name).put("databaseSelected",false)
                .put("environment",environment).put("projects",25).put("rounds",3).put("phase","REPORT")
                .put("stateSha256",state.domain.sha256).put("projectId","complex-0").put("projectTitle",project.getString("title")).toString())
        }
    }
    @Test fun prepareSeparateDatabaseFromCapturedBackup() {
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val args = InstrumentationRegistry.getArguments()
        val sourceName = checkNotNull(args.getString("capture"))
        val databaseName = checkNotNull(args.getString("fixtureDatabase"))
        require(sourceName.matches(Regex("p3-startup-capture-[a-f0-9-]{36}\\.json")))
        require(databaseName.matches(Regex("p2-startup-[a-f0-9]{12}\\.db")))
        val source = File(context.filesDir, sourceName)
        require(source.isFile && source.length() in 1..100L * 1024 * 1024)
        check(!context.getDatabasePath(databaseName).exists())
        val bytes = source.readBytes()
        val backup = BackupCodec.read(bytes)
        assertTrue(backup.domain.json().isNull("activeFocusSession"))
        AndroidStateDatabase(context, databaseName).use { sql ->
            val store = NativeStateStore(sql)
            store.initialize(backup.domain)
            assertEquals(backup.domain, store.load()!!.domain)
        }
        val state = backup.domain.json()
        val receipt = JSONObject().put("schema", 1).put("database", databaseName)
            .put("source", sourceName).put("sourceSha256", MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) })
            .put("projects", state.getJSONArray("projects").length())
            .put("domainUnchanged", true).put("databaseSelected", false)
        File(context.filesDir, "$databaseName.fixture.json").writeText(receipt.toString())
    }
}
