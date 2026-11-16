package com.blockcolc.presentation

import com.blockcolc.domain.*
import com.blockcolc.focus.*
import com.blockcolc.storage.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class WorkspaceCommandsTest {
    @get:Rule val temporary=TemporaryFolder()
    private val now=DomainTime.millis("2026-10-25T00:00:00.000Z")
    @Test fun allPageIntentFieldsMapToTheExistingDomainWireWithoutTranslatingUserText(){
        fun cmd(type:String,vararg fields:Pair<String,Any?>)=DomainEngine.command(type,*fields)
        val title="计时 English 中间插入"
        val cases=listOf(
            WorkspaceMutation.CreateProject("p",title,"house",listOf(WorkspaceMutation.NewSubtask("t",title))) to cmd("CreateProject","projectId" to "p","title" to title,"blueprintId" to "house","subtasks" to JSONArray().put(JSONObject().put("id","t").put("title",title))),
            WorkspaceMutation.CreateHabit("h",title,"house",12) to cmd("CreateHabitProject","projectId" to "h","title" to title,"blueprintId" to "house","targetRounds" to 12),
            WorkspaceMutation.NextHabitBuilding("h","house",12) to cmd("SelectNextHabitBuilding","blueprintId" to "house","targetRounds" to 12),
            WorkspaceMutation.SwitchProject("p") to cmd("SwitchActiveProject","projectId" to "p"),
            WorkspaceMutation.DeleteProject("p") to cmd("DeleteActiveProject","projectId" to "p"),
            WorkspaceMutation.RenameProject("p",title) to cmd("RenameProject","title" to title),
            WorkspaceMutation.AddSubtask("p","t",title) to cmd("AddSubtask","subtaskId" to "t","title" to title),
            WorkspaceMutation.RenameSubtask("p","t",title) to cmd("RenameSubtask","subtaskId" to "t","title" to title),
            WorkspaceMutation.RemoveSubtask("p","t") to cmd("RemoveSubtask","subtaskId" to "t"),
            WorkspaceMutation.ReorderSubtasks("p",listOf("b","a")) to cmd("ReorderSubtasks","orderedSubtaskIds" to JSONArray(listOf("b","a"))),
            WorkspaceMutation.AddNote("n",title) to cmd("AddQuickNote","noteId" to "n","text" to title),
            WorkspaceMutation.RenameNote("n",title) to cmd("RenameQuickNote","noteId" to "n","text" to title),
            WorkspaceMutation.CompleteNote("n",true) to cmd("SetQuickNoteCompleted","noteId" to "n","completed" to true),
            WorkspaceMutation.DeleteNote("n") to cmd("DeleteQuickNote","noteId" to "n"),
            WorkspaceMutation.DailyGoal("2026-10-25",0) to cmd("DisableDailyGoal","date" to "2026-10-25"),
            WorkspaceMutation.DailyGoal("2026-10-25",8) to cmd("SetDailyGoal","date" to "2026-10-25","targetPomodoros" to 8),
            WorkspaceMutation.Integrity(true,2,15) to cmd("ConfigureFocusIntegrity","enabled" to true,"maxEffectiveExcursions" to 2,"excursionThresholdSeconds" to 15),
            WorkspaceMutation.Calendar("UTC",listOf(0,6)) to cmd("ConfigureCalendar","timeZone" to "UTC","restWeekdays" to JSONArray(listOf(0,6))),
            WorkspaceMutation.Birthday(true,2,29) to cmd("ConfigureBirthday","enabled" to true,"month" to 2,"day" to 29),
            WorkspaceMutation.ObserveBirthday to cmd("ObserveBirthday"),
            WorkspaceMutation.Environment("mosaic-coast") to cmd("ConfigureWorldEnvironment","environmentStyle" to "mosaic-coast")
        )
        for((intent,wire)in cases)assertEquals(intent.javaClass.simpleName,StrictJson.render(wire),StrictJson.render(WorkspaceCommands.encode(intent).command))
        assertEquals("p",WorkspaceCommands.encode(WorkspaceMutation.RenameProject("p",title)).expectedProject)
        assertEquals("h",WorkspaceCommands.encode(WorkspaceMutation.NextHabitBuilding("h","house",12)).expectedProject)
        assertNull(WorkspaceCommands.encode(WorkspaceMutation.AddNote("n",title)).expectedProject)
    }
    private fun coordinator(block:(FocusCoordinator,JdbcStateDatabase)->Unit){
        JdbcStateDatabase(temporary.newFolder().toPath().resolve("state.db")).use{db->
            val store=NativeStateStore(db);store.initialize(DomainEngine.initial("UTC"));block(FocusCoordinator(store,"typed"),db)
        }
    }
    private fun create(c:FocusCoordinator,id:String)=WorkspaceCommands.commit(c,"create-$id",WorkspaceMutation.CreateProject(id,id,"house",listOf(WorkspaceMutation.NewSubtask("t-$id","task-$id"))),now)
    private fun blueprint(id:String)=JSONObject().put("schemaVersion",1).put("id",id).put("title","自添名字")
        .put("bounds",JSONObject().put("minX",0).put("maxX",0).put("minY",0).put("maxY",0).put("minZ",0).put("maxZ",0))
        .put("voxels",JSONArray().put(JSONObject().put("x",0).put("y",0).put("z",0).put("materialId","stone").put("buildOrder",10000).put("stage","details").put("sourceBlockId","minecraft:stone")))
    @Test fun typedBlueprintLibraryRespects36DeduplicatesAndKeepsExistingTaskSnapshots()=coordinator{c,_->
        for(i in 0 until 36)WorkspaceCommands.commit(c,"import-$i",WorkspaceMutation.ImportBlueprint(blueprint("user-$i").toString(),false),now)
        val full=c.load();WorkspaceCommands.commit(c,"duplicate",WorkspaceMutation.ImportBlueprint(blueprint("user-0").toString(),false),now)
        assertEquals(36,c.load().domain.json().getJSONArray("buildingBlueprintResources").length())
        assertTrue(runCatching{WorkspaceCommands.commit(c,"overflow",WorkspaceMutation.ImportBlueprint(blueprint("user-36").toString(),false),now)}.isFailure)
        assertEquals(full.domain,c.load().domain)
        WorkspaceCommands.commit(c,"named",WorkspaceMutation.RenameBlueprint("user-0","用户名称 unchanged"),now)
        WorkspaceCommands.commit(c,"project",WorkspaceMutation.CreateProject("p","P","user-0",listOf(WorkspaceMutation.NewSubtask("t","T"))),now){blueprint(it)}
        WorkspaceCommands.commit(c,"delete",WorkspaceMutation.DeleteBlueprint("user-0"),now)
        val state=c.load().domain.json();assertEquals(35,state.getJSONArray("buildingBlueprintResources").length())
        assertEquals("user-0",state.getJSONArray("projects").getJSONObject(0).getJSONObject("importedBlueprint").getString("id"))
        assertTrue(WorkspaceCommands.commit(c,"project",WorkspaceMutation.CreateProject("p","P","user-0",listOf(WorkspaceMutation.NewSubtask("t","T"))),now){error("A replay must not resolve a deleted source")}.replayed)
        assertTrue(runCatching{WorkspaceCommands.commit(c,"stale",WorkspaceMutation.CreateHabit("q","Q","user-0",10),now){error("Removed selection")}}.isFailure)
        assertEquals(1,c.load().domain.json().getJSONArray("projects").length())
    }
    @Test fun failedBlueprintImportRenameAndDeleteKeepSavedFactsAndCanBeRetried()=coordinator{c,db->
        WorkspaceCommands.commit(c,"seed",WorkspaceMutation.ImportBlueprint(blueprint("one").toString(),false),now)
        fun fail(){db.transaction{it.execute("CREATE TRIGGER blueprint_fail BEFORE UPDATE ON domain_records WHEN NEW.section='buildingBlueprintResources' BEGIN SELECT RAISE(FAIL,'injected'); END")}}
        fun recover(){db.transaction{it.execute("DROP TRIGGER blueprint_fail")}}
        val before=c.load();fail()
        assertTrue(runCatching{WorkspaceCommands.commit(c,"rename-blueprint",WorkspaceMutation.RenameBlueprint("one","重试名字"),now)}.isFailure)
        assertEquals(before,c.load());recover()
        WorkspaceCommands.commit(c,"rename-blueprint",WorkspaceMutation.RenameBlueprint("one","重试名字"),now)
        assertEquals("重试名字",c.load().domain.json().getJSONArray("buildingBlueprintResources").getJSONObject(0).getString("displayName"))
        db.transaction{it.execute("CREATE TRIGGER blueprint_insert_fail BEFORE INSERT ON domain_records WHEN NEW.section='buildingBlueprintResources' BEGIN SELECT RAISE(FAIL,'injected'); END")}
        val renamed=c.load();assertTrue(runCatching{WorkspaceCommands.commit(c,"new-blueprint",WorkspaceMutation.ImportBlueprint(blueprint("two").toString(),false),now)}.isFailure)
        assertEquals(renamed,c.load());db.transaction{it.execute("DROP TRIGGER blueprint_insert_fail")}
        WorkspaceCommands.commit(c,"new-blueprint",WorkspaceMutation.ImportBlueprint(blueprint("two").toString(),false),now)
        db.transaction{it.execute("CREATE TRIGGER blueprint_delete_fail BEFORE DELETE ON domain_records WHEN OLD.section='buildingBlueprintResources' BEGIN SELECT RAISE(FAIL,'injected'); END")}
        val two=c.load();assertTrue(runCatching{WorkspaceCommands.commit(c,"delete-blueprint",WorkspaceMutation.DeleteBlueprint("one"),now)}.isFailure)
        assertEquals(two,c.load());db.transaction{it.execute("DROP TRIGGER blueprint_delete_fail")}
        WorkspaceCommands.commit(c,"delete-blueprint",WorkspaceMutation.DeleteBlueprint("one"),now)
        assertEquals(1,c.load().domain.json().getJSONArray("buildingBlueprintResources").length())
    }
    @Test fun staleProjectEditorsCannotRenameTheNewActiveProjectAndReplayIsCheckedBeforeTheGuard()=coordinator{c,_->
        create(c,"p");create(c,"q")
        val before=c.load()
        val failure=runCatching{WorkspaceCommands.commit(c,"rename",WorkspaceMutation.RenameProject("p","changed"),now)}.exceptionOrNull()
        assertEquals("PROJECT_CONTEXT_CHANGED",(failure as FocusFailure).reason);assertEquals(before,c.load())
        WorkspaceCommands.commit(c,"switch",WorkspaceMutation.SwitchProject("p"),now)
        val saved=WorkspaceCommands.commit(c,"rename",WorkspaceMutation.RenameProject("p","changed"),now)
        assertFalse(saved.replayed)
        WorkspaceCommands.commit(c,"switch-back",WorkspaceMutation.SwitchProject("q"),now)
        val after=c.load()
        assertTrue(WorkspaceCommands.commit(c,"rename",WorkspaceMutation.RenameProject("p","changed"),now).replayed)
        assertEquals(after,c.load())
        assertTrue(runCatching{WorkspaceCommands.commit(c,"rename",WorkspaceMutation.RenameProject("q","changed"),now)}.isFailure)
        assertEquals(after,c.load())
    }
    @Test fun typedNoteFailureKeepsFactsAndRetryUsesTheSameAuthoritativeWriter()=coordinator{c,db->
        WorkspaceCommands.commit(c,"add",WorkspaceMutation.AddNote("n","中间中文"),now)
        val before=c.load()
        db.transaction{it.execute("CREATE TRIGGER typed_fail BEFORE UPDATE ON domain_records WHEN NEW.section='quickNotes' BEGIN SELECT RAISE(FAIL,'injected'); END")}
        assertTrue(runCatching{WorkspaceCommands.commit(c,"edit",WorkspaceMutation.RenameNote("n","中间插入中文"),now)}.isFailure)
        assertEquals(before,c.load());db.transaction{it.execute("DROP TRIGGER typed_fail")}
        WorkspaceCommands.commit(c,"edit",WorkspaceMutation.RenameNote("n","中间插入中文"),now)
        assertEquals("中间插入中文",c.load().domain.json().getJSONArray("quickNotes").getJSONObject(0).getString("text"))
    }
    @Test fun queuedCollectionsAreCapturedBeforeTheActorRuns(){
        val ids=mutableListOf("a","b");val days=mutableListOf(0,6);val tasks=mutableListOf(WorkspaceMutation.NewSubtask("a","A"))
        val order=WorkspaceCommands.freeze(WorkspaceMutation.ReorderSubtasks("p",ids)) as WorkspaceMutation.ReorderSubtasks
        val calendar=WorkspaceCommands.freeze(WorkspaceMutation.Calendar("UTC",days)) as WorkspaceMutation.Calendar
        val create=WorkspaceCommands.freeze(WorkspaceMutation.CreateProject("p","P","house",tasks)) as WorkspaceMutation.CreateProject
        ids.reverse();days.clear();tasks.clear()
        assertEquals(listOf("a","b"),order.ids);assertEquals(listOf(0,6),calendar.restWeekdays);assertEquals(1,create.subtasks.size)
    }
    @Test fun typedFocusDecisionNeverAutomaticallyRestartsAfterManualCompletion()=coordinator{c,_->
        create(c,"p")
        c.begin("begin",PlanRequest("plan","p",null,PlanMode.MINIMAL,2,60000,0),true,now)
        WorkspaceCommands.decide(c,"early",FocusDecision.CompleteEarly,now+1000)
        assertEquals(1,c.load().recovery.plan!!.completedSessionIds.size);assertNull(c.load().recovery.automatic)
        c.reconcile("later",now+120000)
        assertTrue(c.load().domain.json().isNull("activeFocusSession"));assertEquals(PlanPhase.READY,c.load().recovery.plan!!.phase)
        WorkspaceCommands.decide(c,"cancel",FocusDecision.Cancel(FocusEndReason.OTHER),now+120001)
        assertEquals(PlanPhase.REPORT,c.load().recovery.plan!!.phase)
    }
    @Test fun interruptingWithoutAReasonKeepsTheRoundIncompleteAndRequiresManualRestart()=coordinator{c,_->
        create(c,"p")
        c.begin("begin",PlanRequest("plan","p",null,PlanMode.MINIMAL,2,60000,0),true,now)
        WorkspaceCommands.decide(c,"interrupt",FocusDecision.Interrupt(),now+1000)
        val saved=c.load();val history=saved.domain.json().getJSONArray("focusHistory")
        assertEquals(1,history.length());assertEquals("interrupted",history.getJSONObject(0).getString("status"))
        assertTrue(history.getJSONObject(0).isNull("interruptionCategory"))
        assertEquals(0,saved.recovery.plan!!.completedSessionIds.size);assertNull(saved.recovery.automatic)
        c.reconcile("later",now+120000)
        assertTrue(c.load().domain.json().isNull("activeFocusSession"))
    }
    @Test fun featurePagesCannotReachTheDiagnosticRuntimeOrBuildDomainJson(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/domain/src/index.ts").isFile}
        val pages=File(root,"apps/native-android/app/src/main/kotlin/com/blockcolc/preview/ui").walkTopDown().filter{it.extension=="kt"}
        val forbidden=listOf("PreviewRuntime","PreviewSnapshot","DomainEngine","org.json","AndroidStateDatabase","NativeStateStore")
        for(page in pages){val text=page.readText();for(symbol in forbidden)assertFalse("${page.name} reaches implementation detail $symbol",text.contains(symbol))}
    }
}
