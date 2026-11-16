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

class FocusActionsTest {
    @get:Rule val temporary=TemporaryFolder()
    private val now=DomainTime.millis("2026-10-24T08:00:00.000Z")
    private class Memory:PreferencesStorage{var text:String?=null;var fail=false;override fun read()=text;override fun write(canonical:String){check(!fail);text=canonical}}
    private fun initial():DomainDocument{
        val command=DomainEngine.command("CreateProject","projectId" to "p","title" to "写作","blueprintId" to "cottage",
            "subtasks" to JSONArray().put(JSONObject().put("id","t").put("title","一页")))
        val result=DomainEngine.execute(DomainEngine.initial(),command,now);check(result.ok);return result.state
    }
    @Test fun confirmPersistsReadyWithoutStartingAndPreferenceChangesNeverRetimeTheSavedPlan(){
        val prefs=PreferencesController(Memory());prefs.update{it.copy(focusMinutes=25,breakMinutes=5)}
        val path=temporary.newFolder().toPath().resolve("state.db")
        JdbcStateDatabase(path).use{db->
            val store=NativeStateStore(db);store.initialize(initial());val c=FocusCoordinator(store,"test");val actions=FocusActions(c,prefs)
            val draft=FocusDraft("p","t",PlanMode.MARATHON,DraftSchedule.EndAt(now+27*60000))
            val ready=actions.confirm("confirm","plan",draft,now).state
            assertEquals(PlanPhase.READY,ready.recovery.plan!!.phase);assertTrue(ready.domain.json().isNull("activeFocusSession"))
            prefs.update{it.copy(focusMinutes=90,breakMinutes=0,autoContinueFocus=true)}
            val started=actions.start("start",now).state;val session=started.domain.json().getJSONObject("activeFocusSession")
            assertEquals(25*60000L,session.getLong("plannedDurationMs"));assertEquals(300000L,started.recovery.plan!!.restDurationMs)
        }
        JdbcStateDatabase(path,create=false).use{db->
            val c=FocusCoordinator(NativeStateStore(db),"test");val until=now+27*60000
            c.reconcile("focus-end",now+25*60000)
            assertEquals(PlanPhase.REST,c.load().recovery.plan!!.phase);assertEquals(DomainTime.format(until),c.load().recovery.plan!!.phaseEndsAt)
            c.reconcile("rest-end",until)
            assertEquals(PlanPhase.REPORT,c.load().recovery.plan!!.phase);assertEquals(1,c.load().domain.json().getJSONArray("focusHistory").length())
        }
    }
    @Test fun manualEarlyCompletionRevokesAutoAndTheLastRoundNeverResetsTheDenominator(){
        val memory=Memory();val prefs=PreferencesController(memory);prefs.update{it.copy(focusMinutes=1,breakMinutes=0,autoContinueFocus=true)}
        JdbcStateDatabase(temporary.newFolder().toPath().resolve("state.db")).use{db->
            val store=NativeStateStore(db);store.initialize(initial());val c=FocusCoordinator(store,"test");val a=FocusActions(c,prefs)
            a.confirm("confirm","plan",FocusDraft("p","t",PlanMode.MINIMAL,DraftSchedule.Rounds(2)),now);a.start("start1",now)
            c.manual("early",true,false,null,null,now+1000);c.reconcile("wait",now+100000)
            val waiting=c.load();assertEquals(PlanPhase.READY,waiting.recovery.plan!!.phase);assertNull(waiting.recovery.automatic);assertTrue(waiting.domain.json().isNull("activeFocusSession"))
            a.start("start2",now+101000);assertEquals(2,c.load().recovery.plan!!.totalRounds);assertEquals(1,c.load().recovery.plan!!.completedSessionIds.size)
            c.reconcile("due",now+161000);assertEquals(2,c.load().recovery.plan!!.completedSessionIds.size)
            val reported=a.report("report",ReportDraft("plan",listOf(TaskAllocation("p","t",2500,2))),now+161001){"r"}.state
            assertNull(reported.recovery.plan);assertEquals(2500,reported.domain.json().getJSONArray("projects").getJSONObject(0).getJSONArray("subtasks").getJSONObject(0).getInt("progressBasisPoints"))
            assertEquals(2,FocusProjection.attribution(reported.domain).getJSONArray("sessions").length())
        }
    }
    @Test fun badDraftAndFailedPreferencesLeaveTheConfirmedStateUntouched(){
        val memory=Memory();val prefs=PreferencesController(memory)
        JdbcStateDatabase(temporary.newFolder().toPath().resolve("state.db")).use{db->
            val store=NativeStateStore(db);store.initialize(initial());val c=FocusCoordinator(store,"test");val a=FocusActions(c,prefs);val before=c.load()
            val draft=FocusDraft("p","missing",PlanMode.ROUNDS,DraftSchedule.Rounds(3))
            assertTrue(runCatching{a.confirm("bad","plan",draft,now)}.isFailure);assertEquals(before,c.load())
            memory.fail=true;assertTrue(runCatching{prefs.update{it.copy(focusMinutes=5)}}.isFailure)
            a.confirm("good","plan",draft.copy(subtaskId="t"),now)
            assertEquals(45*60000L,c.load().recovery.plan!!.focusDurationMs)
            val confirmed=c.load();assertTrue(runCatching{a.confirm("overwrite","other",draft.copy(subtaskId="t"),now)}.isFailure);assertEquals(confirmed,c.load())
        }
    }
    @Test fun firstManualInterruptionIsNotANeverStartedPlanAndOldLocalEncodingKeepsThisDistinction(){
        val prefs=PreferencesController(Memory())
        JdbcStateDatabase(temporary.newFolder().toPath().resolve("state.db")).use{db->
            val store=NativeStateStore(db);store.initialize(initial());val c=FocusCoordinator(store,"test");val a=FocusActions(c,prefs)
            val draft=FocusDraft("p","t",PlanMode.MARATHON,DraftSchedule.Rounds(2))
            a.confirm("confirm1","unstarted",draft,now)
            assertEquals(TimerSurface.PREPARED,TimerPresentation.from(c.load().domain,c.load().recovery,prefs.load().value,now).surface)
            c.manual("cancel1",false,true,null,null,now);assertNull(c.load().recovery.plan)
            a.confirm("confirm2","started",draft,now);a.start("start",now)
            c.manual("interrupt",false,false,"other",null,now+1000)
            val ready=c.load();assertTrue(ready.recovery.plan!!.hasStarted)
            val view=TimerPresentation.from(ready.domain,ready.recovery,prefs.load().value,now+1000)
            assertEquals(TimerSurface.WAITING,view.surface);assertFalse(view.mayCancelUnstarted);assertFalse(view.mayCancelRunning)
            assertTrue(runCatching{c.manual("cancel-without-reason",false,true,null,null,now+1001)}.isFailure);assertEquals(ready,c.load())
            val legacy=JSONObject(ready.recovery.canonical());legacy.getJSONObject("plan").remove("hasStarted")
            db.transaction{it.execute("UPDATE local_recovery SET canonical=? WHERE id=1",listOf(legacy.toString()))}
            assertTrue(c.load().recovery.plan!!.hasStarted)
            c.manual("cancel2",false,true,"other",null,now+1002);assertNull(c.load().recovery.plan)
            a.confirm("confirm3","new",draft,now+1003)
            val fresh=JSONObject(c.load().recovery.canonical());fresh.getJSONObject("plan").remove("hasStarted")
            db.transaction{it.execute("UPDATE local_recovery SET canonical=? WHERE id=1",listOf(fresh.toString()))}
            assertFalse(c.load().recovery.plan!!.hasStarted)
        }
    }
    @Test fun interruptingOrdinarySingleRoundReturnsToIdleButDoesNotDestroyItsInterruptionFact(){
        val prefs=PreferencesController(Memory())
        JdbcStateDatabase(temporary.newFolder().toPath().resolve("state.db")).use{db->
            val store=NativeStateStore(db);store.initialize(initial());val c=FocusCoordinator(store,"test");val a=FocusActions(c,prefs)
            a.confirm("confirm","single",FocusDraft("p","t",PlanMode.ROUNDS,DraftSchedule.Rounds(1)),now);a.start("start",now)
            val saved=c.manual("interrupt",false,false,"other",null,now+1000).state
            assertNull(saved.recovery.plan);assertEquals("interrupted",saved.domain.json().getJSONArray("focusHistory").getJSONObject(0).getString("status"))
            assertEquals(TimerSurface.IDLE,TimerPresentation.from(saved.domain,saved.recovery,prefs.load().value,now+1001).surface)
        }
    }
    @Test fun ordinaryEarlyCompletionUsesFormalImmediateTaskCompletionWithoutAnEmptyReportOrAutomaticRestart(){
        val prefs=PreferencesController(Memory());prefs.update{it.copy(focusMinutes=1,breakMinutes=0,autoContinueFocus=true)}
        JdbcStateDatabase(temporary.newFolder().toPath().resolve("state.db")).use{db->
            val store=NativeStateStore(db);store.initialize(initial());val c=FocusCoordinator(store,"test");val a=FocusActions(c,prefs)
            c.command("second-task",DomainEngine.command("AddSubtask","subtaskId" to "other","title" to "下一件事"),now)
            a.confirm("confirm","ordinary",FocusDraft("p","t",PlanMode.ROUNDS,DraftSchedule.Rounds(2)),now);a.start("start",now)
            c.manual("early",true,false,null,null,now+1000)
            val saved=c.load();assertNull(saved.recovery.plan);assertNull(saved.recovery.automatic)
            val project=saved.domain.json().getJSONArray("projects").getJSONObject(0)
            assertEquals("active",project.getString("status"));assertEquals(10000,project.getJSONArray("subtasks").getJSONObject(0).getInt("progressBasisPoints"))
            assertEquals(1,saved.domain.json().getJSONArray("progressReports").length());assertTrue(saved.domain.json().isNull("activeFocusSession"))
            assertNull(ReportPool.from(saved.domain,saved.recovery))
            c.reconcile("later",now+100000)
            assertNull(c.load().recovery.plan);assertEquals(1,c.load().domain.json().getJSONArray("focusHistory").length())
        }
    }
}
