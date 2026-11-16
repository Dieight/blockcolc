package com.blockcolc.presentation

import com.blockcolc.domain.*
import com.blockcolc.storage.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class FocusDraftTest {
    private val now=DomainTime.millis("2026-10-24T08:00:00.000Z")
    private fun state():DomainDocument {
        var doc=DomainEngine.initial()
        for(cmd in listOf(
            DomainEngine.command("CreateProject","projectId" to "first","title" to "阅读","blueprintId" to "cottage","subtasks" to JSONArray().put(JSONObject().put("id","read").put("title","一章"))),
            DomainEngine.command("CreateHabitProject","projectId" to "habit","title" to "散步","blueprintId" to "cottage","targetRounds" to 10),
            DomainEngine.command("CreateProject","projectId" to "current","title" to "写作","blueprintId" to "cottage","subtasks" to JSONArray().put(JSONObject().put("id","write").put("title","一页"))))) {
            val result=DomainEngine.execute(doc,cmd,now);check(result.ok);doc=result.state
        };return doc
    }
    @Test fun selectionOrderingMatchesTheSavedProjectAndHabitRowsDoNotPretendToHaveSubtasks(){
        val choices=FocusChoices.projects(state());assertEquals(listOf("current","habit","first"),choices.map{it.id});assertTrue(choices[1].habit);assertTrue(choices[1].tasks.isEmpty())
    }
    @Test fun aDraftDoesNotSwitchOrStartAndMinimalDoesNotLeakTheSelectedSubtask(){
        val doc=state();val before=doc.canonical
        val draft=FocusDraft("first","read",PlanMode.MINIMAL,DraftSchedule.EndAt(now+27*60000))
        val planned=draft.prepare("plan",doc,RecoveryContext(),ClientPreferences(focusMinutes=25),now)
        assertNull(planned.subtaskId);assertEquals(1,planned.rounds);assertEquals(DomainTime.format(now+27*60000),planned.exactEndAt)
        assertEquals(before,doc.canonical);assertEquals("current",doc.json().getString("activeProjectId"))
    }
    @Test fun habitsUseTheirOwnDurationAndAnExistingPlanCannotBeOverwritten(){
        val doc=state();val draft=FocusDraft("habit",null,PlanMode.ROUNDS,DraftSchedule.Rounds(2));val pref=ClientPreferences(habitFocusMinutes=15)
        val planned=draft.prepare("plan",doc,RecoveryContext(),pref,now);assertEquals(900000L,planned.focusMs);assertNull(planned.subtaskId)
        val context=RecoveryContext(SavedPlan("old","habit",null,PlanMode.ROUNDS,2,emptyList(),PlanPhase.READY,900000,300000))
        assertTrue(runCatching{draft.prepare("new",doc,context,pref,now)}.isFailure)
    }
    @Test fun staleTasksPastEndsAndExcessivePlansAreRejectedRatherThanRetargeted(){
        val doc=state();val base=FocusDraft("first","read",PlanMode.MARATHON,DraftSchedule.EndAt(now+26*30*60000))
        assertTrue(runCatching{base.prepare("id",doc,RecoveryContext(),ClientPreferences(focusMinutes=25),now)}.isFailure)
        assertTrue(runCatching{base.copy(schedule=DraftSchedule.EndAt(now)).prepare("id",doc,RecoveryContext(),ClientPreferences(),now)}.isFailure)
        assertTrue(runCatching{base.copy(mode=PlanMode.ROUNDS,subtaskId="write",schedule=DraftSchedule.Rounds(2)).prepare("id",doc,RecoveryContext(),ClientPreferences(),now)}.isFailure)
    }
    @Test fun marathonUsesOnlyTheProjectAndCanBeConfirmedWithoutASubtask(){
        val doc=state();val before=doc.canonical
        for(task in listOf(null,"read")){
            val request=FocusDraft("first",task,PlanMode.MARATHON,DraftSchedule.EndAt(now+57*60000)).prepare("id",doc,RecoveryContext(),ClientPreferences(focusMinutes=25,breakMinutes=5),now)
            assertEquals("read",request.subtaskId);assertEquals(2,request.rounds);assertEquals(DomainTime.format(now+57*60000),request.exactEndAt)
        }
        assertTrue(runCatching{FocusDraft("first","stale-task",PlanMode.MARATHON,DraftSchedule.Rounds(2)).prepare("id",doc,RecoveryContext(),ClientPreferences(),now)}.isFailure)
        assertEquals(before,doc.canonical)
    }
    @Test fun habitMarathonAndMinimalUseNormalMinutesAndOnlyFixedHabitRoundsUseHabitMinutes(){
        val prefs=ClientPreferences(focusMinutes=25,habitFocusMinutes=15)
        for(mode in PlanMode.entries){
            val draft=FocusDraft("habit",null,mode,DraftSchedule.Rounds(2))
            val request=draft.prepare("plan",state(),RecoveryContext(),prefs,now)
            assertEquals(if(mode==PlanMode.ROUNDS)15*60000L else 25*60000L,request.focusMs)
        }
    }
}
