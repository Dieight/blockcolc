package com.blockcolc.presentation

import com.blockcolc.domain.*
import com.blockcolc.storage.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TimerPresentationTest {
    private val now=DomainTime.millis("2026-10-24T08:00:00.000Z")
    private fun initial():DomainDocument{
        val r=DomainEngine.execute(DomainEngine.initial(),DomainEngine.command("CreateProject","projectId" to "p","title" to "Building","blueprintId" to "cottage",
            "subtasks" to JSONArray().put(JSONObject().put("id","t").put("title","Only ordinary rounds show this task"))),now)
        check(r.ok);return r.state
    }
    private fun active(mode:PlanMode):DomainDocument{
        val command=DomainEngine.command("StartFocus","sessionId" to "session:plan:1:nonce","projectId" to "p","subtaskId" to if(mode==PlanMode.MINIMAL)null else "t","plannedDurationMs" to 25*60000)
        if(mode!=PlanMode.ROUNDS)command.put("marathon",true)
        if(mode==PlanMode.MINIMAL)command.put("deferredSettlement",true)
        val result=DomainEngine.execute(initial(),command,now);check(result.ok);return result.state
    }
    @Test fun onlyOrdinaryRunningFocusIncludesTheSubtaskAndAllModesUseTheSameSavedCountdown(){
        for(mode in PlanMode.entries){
            val doc=active(mode);val session=doc.json().getJSONObject("activeFocusSession")
            val plan=SavedPlan("plan","p",if(mode==PlanMode.MINIMAL)null else "t",mode,3,emptyList(),PlanPhase.FOCUS,25*60000,5*60000,
                session.getString("id"),session.getString("endsAt"))
            val context=RecoveryContext(plan);context.validate(doc,0)
            val view=TimerPresentation.from(doc,context,ClientPreferences(focusMinutes=90),now+1000)
            assertEquals(TimerSurface.FOCUS,view.surface);assertEquals(25*60000-1000L,view.remainingMs)
            assertEquals(3,view.totalRounds);assertEquals(0,view.completedRounds)
            assertEquals(mode==PlanMode.ROUNDS,view.taskTitle!=null);assertEquals(mode!=PlanMode.ROUNDS,view.minimalReport)
            assertEquals(mode!=PlanMode.ROUNDS,view.mayCancelRunning)
        }
    }
    @Test fun waitingIncludesFutureRestAndNeverOffersTheRunningCancellationOrMarathonEditor(){
        val result=DomainEngine.execute(active(PlanMode.MINIMAL),DomainEngine.command("CompleteFocus"),now+25*60000)
        assertTrue(result.error,result.ok);val doc=result.state
        val plan=SavedPlan("plan","p",null,PlanMode.MINIMAL,3,listOf("session:plan:1:nonce"),PlanPhase.READY,25*60000,5*60000)
        val view=TimerPresentation.from(doc,RecoveryContext(plan),ClientPreferences(),now+25*60000)
        assertEquals(TimerSurface.WAITING,view.surface);assertEquals(55*60000L,view.remainingMs);assertFalse(view.mayCancelRunning);assertFalse(view.mayCancelUnstarted)
        val resting=TimerPresentation.from(doc,RecoveryContext(plan.copy(phase=PlanPhase.REST,phaseEndsAt=DomainTime.format(now+30*60000))),ClientPreferences(),now+26*60000)
        assertEquals(TimerSurface.REST,resting.surface);assertEquals(4*60000L,resting.remainingMs)
        val reporting=TimerPresentation.from(doc,RecoveryContext(plan.copy(phase=PlanPhase.REPORT)),ClientPreferences(),now+26*60000)
        assertEquals(TimerSurface.REPORT,reporting.surface);assertTrue(reporting.minimalReport)
    }
    @Test fun confirmedUnstartedMarathonRetainsItsDeadlineAndCanCancelWithoutPretendingToHaveFocused(){
        val doc=initial();val end=DomainTime.format(now+27*60000)
        val context=RecoveryContext(SavedPlan("plan","p","t",PlanMode.MARATHON,1,emptyList(),PlanPhase.READY,25*60000,5*60000,exactEndAt=end))
        val view=TimerPresentation.from(doc,context,ClientPreferences(),now+1000)
        assertEquals(TimerSurface.PREPARED,view.surface);assertEquals(end,view.deadline);assertEquals(27*60000-1000L,view.remainingMs)
        assertTrue(view.mayCancelUnstarted);assertFalse(view.mayCancelRunning)
        val original=JSONObject(context.canonical());original.getJSONObject("plan").put("hasStarted","true")
        assertTrue(runCatching{RecoveryContext.parse(original.toString(),doc)}.isFailure)
    }
}
