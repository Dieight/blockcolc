package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.*
import com.blockcolc.focus.*
import com.blockcolc.presentation.*
import com.blockcolc.storage.*
import com.blockcolc.storage.android.AndroidStateDatabase
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

/** No Activity, real preview DB pointer, permission or user plan is changed. */
class P3FocusIntentTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private val at=DomainTime.millis("2026-10-24T08:00:00.000Z")
    private fun initial(habit:Boolean):DomainDocument{
        val cmd=if(habit)DomainEngine.command("CreateHabitProject","projectId" to "p","title" to "Habit","blueprintId" to "cottage","targetRounds" to 10)
        else DomainEngine.command("CreateProject","projectId" to "p","title" to "Work","blueprintId" to "cottage","subtasks" to JSONArray()
            .put(JSONObject().put("id","t").put("title","First")).put(JSONObject().put("id","second").put("title","Second")))
        val result=DomainEngine.execute(DomainEngine.initial(),cmd,at);check(result.ok);return result.state
    }
    private fun prefs(value:ClientPreferences)=PreferencesController(object:PreferencesStorage{
        override fun read()=value.canonical();override fun write(canonical:String)=error("Read-only test preferences")
    })
    private fun withName(block:(String)->Unit){
        val name="p3-intent-${UUID.randomUUID()}.db"
        try{block(name)}finally{check(name.startsWith("p3-intent-"));check(context.deleteDatabase(name))}
    }
    @Test fun realAndroidSqliteKeepsNewConfirmedAndManuallyPausedFirstRoundsDistinctAcrossReopen(){
        for(mode in PlanMode.entries)for(habit in listOf(false,true))withName{name->
            val preferences=prefs(ClientPreferences(focusMinutes=1,habitFocusMinutes=2,breakMinutes=0,autoContinueFocus=true))
            AndroidStateDatabase(context,name).use{db->
                val store=NativeStateStore(db);store.initialize(initial(habit));val c=FocusCoordinator(store,name);val a=FocusActions(c,preferences)
                a.confirm("confirm","plan",FocusDraft("p",if(mode==PlanMode.MINIMAL||habit)null else "t",mode,DraftSchedule.Rounds(2)),at)
                assertFalse(c.load().recovery.plan!!.hasStarted);assertTrue(c.load().domain.json().isNull("activeFocusSession"))
                a.start("start",at)
                val duration=if(habit&&mode==PlanMode.ROUNDS)120000L else 60000L
                assertEquals(duration,c.load().domain.json().getJSONObject("activeFocusSession").getLong("plannedDurationMs"))
                c.manual("interrupt",false,false,null,null,at+1000)
                assertTrue(c.load().recovery.plan!!.hasStarted);assertNull(c.load().recovery.automatic)
            }
            AndroidStateDatabase(context,name).use{db->
                val store=NativeStateStore(db);val c=FocusCoordinator(store,name)
                val before=c.load();assertEquals(PlanPhase.READY,before.recovery.plan!!.phase);assertTrue(before.recovery.plan!!.hasStarted)
                val view=TimerPresentation.from(before.domain,before.recovery,preferences.load().value,at+2000)
                assertEquals(TimerSurface.WAITING,view.surface);assertFalse(view.mayCancelUnstarted);assertFalse(view.mayCancelRunning)
                val old=JSONObject(before.recovery.canonical());old.getJSONObject("plan").remove("hasStarted")
                db.transaction{it.execute("UPDATE local_recovery SET canonical=? WHERE id=1",listOf(old.toString()))}
                assertTrue(c.load().recovery.plan!!.hasStarted)
                val a=FocusActions(c,preferences);a.start("second-start",at+3000)
                c.manual("early",true,false,null,null,at+4000)
                val after=c.load();val p=after.domain.json().getJSONArray("projects").getJSONObject(0)
                if(mode==PlanMode.ROUNDS&&!habit){
                    assertNull(after.recovery.plan);assertEquals(10000,p.getJSONArray("subtasks").getJSONObject(0).getInt("progressBasisPoints"))
                }else{
                    assertEquals(PlanPhase.READY,after.recovery.plan!!.phase);assertEquals(1,after.recovery.plan!!.completedSessionIds.size)
                    if(habit)assertEquals(if(mode==PlanMode.MINIMAL)0 else 1,p.getJSONObject("habit").getJSONArray("completedFocusSessionIds").length())
                }
                assertNull(after.recovery.automatic);assertTrue(after.domain.json().isNull("activeFocusSession"))
            }
        }
    }
    @Test fun exactDeadlineAndUnifiedAllocationRoundTripOnTheActualAndroidJsonLibrary()=withName{name->
        val preferences=prefs(ClientPreferences(focusMinutes=25,breakMinutes=5))
        AndroidStateDatabase(context,name).use{db->
            val store=NativeStateStore(db);store.initialize(initial(false));val c=FocusCoordinator(store,name);val a=FocusActions(c,preferences)
            a.confirm("confirm","plan",FocusDraft("p","t",PlanMode.MINIMAL,DraftSchedule.EndAt(at+27*60000)),at)
            assertEquals(1,c.load().recovery.plan!!.totalRounds);assertNull(c.load().recovery.plan!!.subtaskId)
            a.start("start",at);c.reconcile("focus-end",at+25*60000)
            assertEquals(PlanPhase.REST,c.load().recovery.plan!!.phase);assertTrue(c.load().recovery.plan!!.terminalRest)
            c.reconcile("rest-end",at+27*60000);assertEquals(PlanPhase.REPORT,c.load().recovery.plan!!.phase)
            val result=a.report("report",ReportDraft("plan",listOf(TaskAllocation("p","t",0,1))),at+27*60000+1){"r"}.state
            assertNull(result.recovery.plan)
            val allocation=FocusProjection.attribution(result.domain).getJSONArray("sessions").getJSONObject(0)
            assertEquals("t",allocation.getString("subtaskId"));assertEquals(25*60000L,allocation.getLong("actualDurationMs"))
        }
    }
}
