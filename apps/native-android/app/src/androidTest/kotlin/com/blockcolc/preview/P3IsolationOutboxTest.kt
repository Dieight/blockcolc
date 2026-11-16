package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.*
import com.blockcolc.focus.*
import com.blockcolc.presentation.*
import com.blockcolc.storage.*
import com.blockcolc.storage.android.AndroidStateDatabase
import com.blockcolc.world.generation.BuiltinBlueprintCatalog
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** No permission changes, settings launches, network sink or ADB. Runtime isolation is restored in finally. */
class P3IsolationOutboxTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun receiptsIdentity()=listOf("achievement-display-receipts.json","achievement-display-receipts.json.bak","achievement-display-receipts.json.new","achievement-attention.json","achievement-attention.json.bak","achievement-attention.json.new").map{name->
        val file=File(context.filesDir,name)
        if(file.exists())MessageDigest.getInstance("SHA-256").digest(file.readBytes()).toList()else null
    }
    @Test fun firstWorkspaceWaitsUntilTheFirstFocusCanAwardAndLeavesOriginalPresentationIntact(){
        val runtime=PreviewRuntime.get(context);val original=runtime.testRead().get(30,TimeUnit.SECONDS);val files=receiptsIdentity()
        runtime.testDatabase(true,prepareAssets=false).get(30,TimeUnit.SECONDS)
        try{
            val first=runtime.testRead().get(30,TimeUnit.SECONDS);val second=runtime.testRead().get(30,TimeUnit.SECONDS)
            assertEquals(0,first.domain.json().getJSONArray("decorationBlueprintResources").length())
            assertEquals(first.token,second.token);assertEquals(first.domain.sha256,second.domain.sha256)
            runtime.start()
            assertEquals(second,runtime.testRead().get(30,TimeUnit.SECONDS))
            runtime.dispatch(WorkspaceMutation.CreateProject("first","First","builtin-small-workshop",listOf(WorkspaceMutation.NewSubtask("read","Read"))),"create-first")
            val created=runtime.testRead().get(30,TimeUnit.SECONDS)
            assertTrue(created.domain.registeredDailyRewardIds().isEmpty())
            assertEquals("first",created.domain.projectionJson().getString("activeProjectId"))
            runtime.dispatch(WorkspaceMutation.DailyGoal(checkNotNull(runtime.latest.workspace).today,1),"first-goal")
            assertTrue(runtime.testRead().get(30,TimeUnit.SECONDS).domain.registeredDailyRewardIds().isEmpty())
            runtime.beginFocus(FocusDraft("first","read",PlanMode.ROUNDS,DraftSchedule.Rounds(1)),"first-focus")
            val active=runtime.testRead().get(30,TimeUnit.SECONDS)
            assertTrue(active.domain.registeredDailyRewardIds().isEmpty())
            assertNotNull(active.domain.activeFocusSession())
            runtime.decideFocus(FocusDecision.CompleteEarly,"first-completion")
            val completed=runtime.testRead().get(30,TimeUnit.SECONDS)
            val expectedIds=BuiltinBlueprintCatalog.load().entries.filter{it.category=="daily"}.map{it.id}.toSet()
            assertEquals(expectedIds,completed.domain.registeredDailyRewardIds())
            val rewards=completed.domain.projectionJson().getJSONArray("decorationRewards")
            assertEquals(1,rewards.length())
            assertTrue(rewards.getJSONObject(0).getString("resourceId") in expectedIds)
            assertNull(completed.domain.activeFocusSession())
            assertEquals(files,receiptsIdentity())
        }finally{runtime.testDatabase(false).get(30,TimeUnit.SECONDS)}
        val restored=runtime.testRead().get(30,TimeUnit.SECONDS)
        assertEquals(original.token,restored.token);assertEquals(original.domain.sha256,restored.domain.sha256)
        assertEquals(original.recovery,restored.recovery);assertEquals(files,receiptsIdentity())
    }
    @Test fun syntheticAcknowledgementAndConsumedCelebrationDoNotTouchFormalPresentation(){
        val runtime=PreviewRuntime.get(context);val before=receiptsIdentity();val formal=runtime.celebrations
        var formalVersion=0;instrumentation.runOnMainSync{formalVersion=formal.version}
        runtime.testDatabase(true).get(30,TimeUnit.SECONDS)
        try{
            assertNotSame(formal,runtime.celebrations)
            val isolated=runtime.celebrations
            instrumentation.runOnMainSync{
                isolated.accept(listOf(JSONObject().put("type","DailyGoalReached").put("date","2099-01-01").toString()),false)
                assertNotNull(isolated.take());assertNull(isolated.peek())
            }
            val done=CountDownLatch(1);var failed=true
            runtime.acknowledgeAchievements(listOf("synthetic-only")){_,error->failed=error;done.countDown()}
            assertTrue(done.await(10,TimeUnit.SECONDS));assertFalse(failed)
            assertEquals(before,receiptsIdentity())
        }finally{runtime.testDatabase(false).get(30,TimeUnit.SECONDS)}
        assertSame(formal,runtime.celebrations);assertEquals(before,receiptsIdentity())
        instrumentation.runOnMainSync{assertEquals(formalVersion,formal.version)}
    }
    @Test fun isolatedFirstUseAndTutorialNeverReadOrWriteTheRealFirstUseFlags(){
        val runtime=PreviewRuntime.get(context)
        val preferences=context.getSharedPreferences("native-ui",android.content.Context.MODE_PRIVATE)
        val original=preferences.all.toMap()
        runtime.testDatabase(true,prepareAssets=false).get(30,TimeUnit.SECONDS)
        try{
            runtime.testFirstUse(true,true).get(30,TimeUnit.SECONDS)
            assertTrue(runtime.latest.setupRequired);assertTrue(runtime.latest.tutorialPending)
            runtime.finishTutorial();runtime.testRead().get(30,TimeUnit.SECONDS)
            assertFalse(runtime.latest.tutorialPending);assertTrue(runtime.latest.setupRequired)
            assertEquals(original,preferences.all)
        }finally{runtime.testDatabase(false).get(30,TimeUnit.SECONDS)}
        assertEquals(original,preferences.all)
    }
    @Test fun obsoleteDeadlineCannotRegisterAssetsInTheCurrentlyObservedDatabase(){
        val runtime=PreviewRuntime.get(context)
        runtime.testDatabase(true,prepareAssets=false).get(30,TimeUnit.SECONDS)
        try{
            val before=runtime.testRead().get(30,TimeUnit.SECONDS);val done=CountDownLatch(1)
            val ticket=DeadlineTicket("p2-obsolete.db",0,"old-plan","old-session","FOCUS",DomainTime.format(System.currentTimeMillis()-1000))
            runtime.receive(StrictJson.render(ticket.json())){done.countDown()}
            assertTrue(done.await(30,TimeUnit.SECONDS))
            val after=runtime.testRead().get(30,TimeUnit.SECONDS)
            assertEquals(before.token,after.token);assertEquals(before.domain.sha256,after.domain.sha256)
            assertEquals(0,after.domain.json().getJSONArray("decorationBlueprintResources").length())
        }finally{runtime.testDatabase(false).get(30,TimeUnit.SECONDS)}
    }
    @Test fun sqliteReopenKeepsOutboxAndAckDoesNotChangeFocusFacts(){
        val name="p2-outbox-${UUID.randomUUID()}.db";val at=DomainTime.millis("2026-10-29T00:00:00.000Z")
        try{
            var key="";var facts=""
            AndroidStateDatabase(context,name).use{db->
                val store=NativeStateStore(db)
                val created=DomainEngine.execute(DomainEngine.initial("UTC"),DomainEngine.command("CreateProject","projectId" to "p","title" to "Test","blueprintId" to "cottage","subtasks" to JSONArray().put(JSONObject().put("id","s").put("title","Step"))),at)
                assertTrue(created.ok);store.initialize(created.state)
                val c=FocusCoordinator(store,name);c.begin("begin",PlanRequest("plan","p",null,PlanMode.MINIMAL,2,1000,300),false,at)
                c.reconcile("natural",at+1300);val state=c.load()
                key=state.recovery.returnReminder!!.key;facts=state.domain.canonical
            }
            AndroidStateDatabase(context,name).use{db->
                val c=FocusCoordinator(NativeStateStore(db),name)
                assertEquals(key,c.load().recovery.returnReminder!!.key)
                c.acknowledgeReturnReminder("posted:$key",key)
                assertNull(c.load().recovery.returnReminder);assertEquals(facts,c.load().domain.canonical)
                assertTrue(c.acknowledgeReturnReminder("posted:$key",key).replayed)
            }
        }finally{context.deleteDatabase(name)}
    }
}
