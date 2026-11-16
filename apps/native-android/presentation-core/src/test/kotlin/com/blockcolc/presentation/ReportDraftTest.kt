package com.blockcolc.presentation

import com.blockcolc.domain.*
import com.blockcolc.focus.FocusProjection
import com.blockcolc.storage.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ReportDraftTest {
    private val now=DomainTime.millis("2026-10-24T08:00:00.000Z")
    private fun state():Pair<DomainDocument,RecoveryContext>{
        var doc=DomainEngine.initial();var at=now
        fun run(cmd:JSONObject){val result=DomainEngine.execute(doc,cmd,at);check(result.ok){result.error?:"Failed"};doc=result.state}
        for((p,t) in listOf("first" to "one","second" to "two"))run(DomainEngine.command("CreateProject","projectId" to p,"title" to p,"blueprintId" to "cottage","subtasks" to JSONArray().put(JSONObject().put("id",t).put("title",t))))
        run(DomainEngine.command("CreateHabitProject","projectId" to "habit","title" to "Walk","blueprintId" to "cottage","targetRounds" to 10))
        run(DomainEngine.command("SwitchActiveProject","projectId" to "first"))
        for((index,ms) in listOf(60000L,90000L,120000L).withIndex()){
            run(DomainEngine.command("StartFocus","sessionId" to "f$index","projectId" to "first","subtaskId" to null,"plannedDurationMs" to ms,"marathon" to true,"deferredSettlement" to true))
            at+=ms;run(DomainEngine.command("CompleteFocus"))
        }
        return doc to RecoveryContext(SavedPlan("plan","first",null,PlanMode.MINIMAL,3,listOf("f0","f1","f2"),PlanPhase.REPORT,120000,0))
    }
    @Test fun partialAllocationUsesActualDurationsKeepsUnchangedProgressAndLeavesTheRestUnknown(){
        val(doc,recovery)=state();val pool=ReportPool.from(doc,recovery)!!
        val draft=ReportDraft("plan",listOf(TaskAllocation("second","two",0,1)),listOf(HabitAllocation("habit",1)))
        assertEquals(mapOf("habit:habit" to 60000L,"task:two" to 90000L),draft.assignedDurations(pool))
        val result=DomainEngine.execute(doc,draft.command(pool){"report"},now+400000)
        assertTrue(result.error,result.ok)
        val a=FocusProjection.attribution(result.state).getJSONArray("sessions")
        assertEquals("habit-project",a.getJSONObject(0).getString("kind"));assertEquals("habit",a.getJSONObject(0).getString("projectId"))
        assertEquals("two",a.getJSONObject(1).getString("subtaskId"));assertEquals("unallocated",a.getJSONObject(2).getString("kind"))
        assertTrue(ReportPool.from(result.state,recovery)!!.sessions.isEmpty())
    }
    @Test fun advancingWithoutRoundsIsRejectedButKeepingProgressWithoutRoundsAndDiscardingAreValid(){
        val(doc,recovery)=state();val pool=ReportPool.from(doc,recovery)!!
        assertTrue(runCatching{ReportDraft("plan",listOf(TaskAllocation("first","one",2500,0))).validate(pool)}.isFailure)
        val unchanged=ReportDraft("plan",listOf(TaskAllocation("first","one",0,0)))
        assertEquals(0,unchanged.command(pool){"id"}.getJSONArray("entries").length())
        val discarded=DomainEngine.execute(doc,ReportDraft("plan").command(pool){"id"},now+400000)
        assertTrue(discarded.error,discarded.ok)
        val rows=FocusProjection.attribution(discarded.state).getJSONArray("sessions")
        assertTrue((0 until rows.length()).all{rows.getJSONObject(it).getString("reason")=="discarded"})
    }
    @Test fun stalePoolDuplicateTargetsOverAllocationAndExceedingHabitCapacityFailBeforeAnyCommand(){
        val(doc,recovery)=state();val pool=ReportPool.from(doc,recovery)!!;val original=doc.canonical
        val invalid=listOf(
            ReportDraft("old"),
            ReportDraft("plan",listOf(TaskAllocation("first","one",0,1),TaskAllocation("first","one",0,1))),
            ReportDraft("plan",listOf(TaskAllocation("first","one",0,3)),listOf(HabitAllocation("habit",1))),
            ReportDraft("plan",listOf(TaskAllocation("second","one",0,1))),
            ReportDraft("plan",habits=listOf(HabitAllocation("habit",4))))
        for(draft in invalid)assertTrue(runCatching{draft.command(pool){"id"}}.isFailure)
        val reduced=pool.copy(targets=pool.targets.map{if(it.taskId==null)it.copy(maxRounds=1)else it})
        assertTrue(runCatching{ReportDraft("plan",habits=listOf(HabitAllocation("habit",2))).validate(reduced)}.isFailure)
        assertEquals(original,doc.canonical)
    }
    @Test fun ordinaryRoundCannotBeAllocatedToAnotherTaskOrDiscarded(){
        val(doc,recovery)=state();val saved=recovery.plan!!
        val ordinary=ReportPool.from(doc,recovery.copy(plan=saved.copy(mode=PlanMode.ROUNDS,subtaskId="one",completedSessionIds=listOf("f2"))))!!
        assertEquals(listOf("one"),ordinary.targets.map{it.taskId})
        assertTrue(runCatching{ReportDraft("plan").validate(ordinary)}.isFailure)
        assertTrue(runCatching{ReportDraft("plan",listOf(TaskAllocation("second","two",0,1))).validate(ordinary)}.isFailure)
        val command=ReportDraft("plan",listOf(TaskAllocation("first","one",2500,1))).command(ordinary){"report"}
        assertEquals("ReportSubtaskProgress",command.getString("type"));assertEquals("f2",command.getJSONArray("focusSessionIds").getString(0))
    }
}
