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
    @Test fun partiallyAllocatedReportSharesShortTimeAndLeavesUnassignedFullRoundsUnknown(){
        val(doc,recovery)=state();val pool=ReportPool.from(doc,recovery)!!
        val draft=ReportDraft("plan",listOf(TaskAllocation("second","two",0,1)),listOf(HabitAllocation("habit",1)))
        assertEquals(mapOf("habit:habit" to 75000L,"task:two" to 75000L),draft.assignedDurations(pool))
        val result=DomainEngine.execute(doc,draft.command(pool){"report"},now+400000)
        assertTrue(result.error,result.ok)
        val a=FocusProjection.reportedAttribution(result.state).getJSONArray("sessions")
        assertEquals("habit-project",a.getJSONObject(0).getString("kind"));assertEquals("habit",a.getJSONObject(0).getString("projectId"))
        assertEquals("two",a.getJSONObject(1).getString("subtaskId"));assertEquals("unallocated",a.getJSONObject(2).getString("kind"))
        assertEquals(listOf(75000L,75000L,120000L),(0 until a.length()).map{FocusProjection.reportedDuration(a.getJSONObject(it))})
        assertEquals(listOf(60000L,90000L,120000L),(0 until a.length()).map{a.getJSONObject(it).getLong("actualDurationMs")})
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
    @Test fun reportTimeIncludesTheShortExtensionWithoutOfferingItAsAnAllocatableRound(){
        val (doc,recovery)=state()
        val plan=recovery.plan!!
        val start=now+270000L
        val id=plan.extensionSessionId(1)
        val active=DomainEngine.execute(doc,DomainEngine.command("StartFocus","sessionId" to id,"projectId" to plan.projectId,
            "subtaskId" to null,"plannedDurationMs" to plan.focusDurationMs,"marathon" to true,"deferredSettlement" to true),start)
        assertTrue(active.error,active.ok)
        for(tail in listOf(0L,59000L,60000L)){
            val stopped=DomainEngine.execute(active.state,DomainEngine.command("FinishExtendedRound"),start+tail)
            assertTrue(stopped.error,stopped.ok)
            val credited=if(tail>=plan.focusDurationMs/2)1 else 0
            val extended=plan.copy(extendAfterPlan=true,extensionStartedAt=DomainTime.format(start),extensionRounds=credited)
            val pool=ReportPool.from(stopped.state,recovery.copy(plan=extended))!!
            assertEquals(270000L+tail,pool.totalDurationMs)
            assertEquals(3+credited,pool.totalRounds)
            val draft=ReportDraft(plan.id,listOf(TaskAllocation("first","one",2500,3+credited)))
            assertEquals(270000L+tail,draft.assignedDurations(pool)["task:one"])
            val ids=draft.command(pool){"report"}.getJSONArray("focusSessionIds")
            assertEquals(3+credited,ids.length())
            if(credited==1)assertEquals(id,ids.getString(3))
            val saved=DomainEngine.execute(stopped.state,draft.command(pool){"report"},start+tail+1)
            assertTrue(saved.error,saved.ok)
            val allocations=FocusProjection.reportedAttribution(saved.state).getJSONArray("sessions")
            val rows=List(allocations.length()){allocations.getJSONObject(it)}
            assertEquals(270000L+tail,rows.sumOf(FocusProjection::reportedDuration))
            assertEquals(270000L+tail,rows.filter{it.optString("subtaskId")=="one"}.sumOf(FocusProjection::reportedDuration))
            assertEquals(3+credited,rows.count{it.optString("subtaskId")=="one"})
        }
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
