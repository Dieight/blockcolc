package com.blockcolc.presentation

import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.focus.FocusCoordinator
import com.blockcolc.storage.JdbcStateDatabase
import com.blockcolc.storage.NativeStateStore
import com.blockcolc.storage.PlanMode
import com.blockcolc.storage.PlanPhase
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Matrix verification across all focus modes (ROUNDS, MARATHON, MINIMAL/End-Time),
 * project kinds (finite large project + habit project), and completion paths
 * (normal completion, early completion, multi-round early + cancel, interruption). */
class FocusAndReportMatrixTest {
    @get:Rule val temporary = TemporaryFolder()
    private val createdAt = DomainTime.millis("2026-11-28T07:59:00.000Z")
    private val now = DomainTime.millis("2026-11-28T08:00:00.000Z")

    private class MemoryPrefs : PreferencesStorage {
        var text: String? = null
        override fun read() = text
        override fun write(canonical: String) { text = canonical }
    }

    private fun twoProjects(): com.blockcolc.domain.DomainDocument {
        var doc = DomainEngine.initial("Asia/Shanghai")
        val p1 = DomainEngine.command(
            "CreateProject",
            "projectId" to "large-1",
            "title" to "工坊",
            "blueprintId" to "builtin-small-workshop",
            "subtasks" to JSONArray()
                .put(JSONObject().put("id", "sub-1").put("title", "确定目标"))
                .put(JSONObject().put("id", "sub-2").put("title", "完成核心工作")),
        )
        doc = DomainEngine.execute(doc, p1, createdAt).also { check(it.ok) }.state
        val p2 = DomainEngine.command(
            "CreateHabitProject",
            "projectId" to "habit-1",
            "title" to "每日阅读",
            "blueprintId" to "builtin-small-workshop",
            "targetRounds" to 10,
        )
        doc = DomainEngine.execute(doc, p2, createdAt + 1_000L).also { check(it.ok) }.state
        doc = DomainEngine.execute(doc, DomainEngine.command("SwitchActiveProject", "projectId" to "large-1"), createdAt + 2_000L).also { check(it.ok) }.state
        return doc
    }

    private fun withWorkspace(block: (FocusCoordinator, FocusActions, PreferencesController) -> Unit) {
        val prefs = PreferencesController(MemoryPrefs())
        prefs.update { it.copy(focusMinutes = 25, habitFocusMinutes = 25, breakMinutes = 5, autoContinueFocus = false) }
        JdbcStateDatabase(temporary.newFolder().toPath().resolve("matrix.db")).use { db ->
            val store = NativeStateStore(db)
            store.initialize(twoProjects())
            val coordinator = FocusCoordinator(store, "matrix-test")
            block(coordinator, FocusActions(coordinator, prefs), prefs)
        }
    }

    private fun project(state: com.blockcolc.storage.StoredState, id: String): JSONObject {
        val projects = state.domain.json().getJSONArray("projects")
        return (0 until projects.length()).map(projects::getJSONObject).first { it.getString("id") == id }
    }

    @Test fun endTimeLargeEarlyAndNormalCompletionEnterUnifiedReportWithAllTargetsAndNoAutoAdvance() = withWorkspace { c, actions, _ ->
        // End-time workbench flow (PlanMode.MINIMAL) + legacy MARATHON on finite project both defer to unified report
        for ((index, mode) in listOf(PlanMode.MINIMAL, PlanMode.MARATHON).withIndex()) {
            val base = now + index * 3_600_000L
            val endAt = base + 25 * 60_000L
            actions.begin("b-$index", "plan-end-large-$index", FocusDraft("large-1", null, mode, DraftSchedule.EndAt(endAt)), base)
            val afterEarly = c.manual("early-$index", early = true, cancelPlan = false, category = null, note = null, now = base + 60_000L).state
            val large = project(afterEarly, "large-1")
            assertEquals("sub-1 must not auto-advance in $mode", 0, large.getJSONArray("subtasks").getJSONObject(0).getInt("progressBasisPoints"))
            assertEquals(PlanPhase.REPORT, afterEarly.recovery.plan?.phase)
            val pool = checkNotNull(ReportPool.from(afterEarly.domain, afterEarly.recovery))
            assertEquals(1, pool.totalRounds)
            assertEquals(setOf("sub-1", "sub-2", null), pool.targets.map { it.taskId }.toSet())
            assertTrue(pool.targets.any { it.projectId == "habit-1" && it.taskId == null })
            // Allocate explicitly to sub-2 (NOT sub-1!)
            val targetProgress = (index + 1) * 2500
            val submitted = actions.report("rep-$index", ReportDraft("plan-end-large-$index", tasks = listOf(TaskAllocation("large-1", "sub-2", targetProgress, 1))), base + 61_000L) { "r-$index" }.state
            assertNull(submitted.recovery.plan)
            val largeAfter = project(submitted, "large-1")
            assertEquals(0, largeAfter.getJSONArray("subtasks").getJSONObject(0).getInt("progressBasisPoints"))
            assertEquals(targetProgress, largeAfter.getJSONArray("subtasks").getJSONObject(1).getInt("progressBasisPoints"))
        }
    }

    @Test fun endTimeHabitEarlyAndNormalCompletionEnterUnifiedReportAndCanAllocateAcrossProjects() = withWorkspace { c, actions, _ ->
        c.command("sw", DomainEngine.command("SwitchActiveProject", "projectId" to "habit-1"), now)
        val endAt = now + 25 * 60_000L
        // Workbench End-Time mode uses PlanMode.MINIMAL so habit NEVER auto-advances and opens Unified Report!
        actions.begin("b2", "plan-end-habit", FocusDraft("habit-1", null, PlanMode.MINIMAL, DraftSchedule.EndAt(endAt)), now)
        val afterEarly = c.manual("early-2", early = true, cancelPlan = false, category = null, note = null, now = now + 60_000L).state
        assertEquals(0, project(afterEarly, "habit-1").getJSONObject("habit").getJSONArray("completedFocusSessionIds").length())
        assertEquals(PlanPhase.REPORT, afterEarly.recovery.plan?.phase)
        val pool = checkNotNull(ReportPool.from(afterEarly.domain, afterEarly.recovery))
        assertTrue(pool.targets.any { it.projectId == "large-1" && it.taskId == "sub-2" })
        assertTrue(pool.targets.any { it.projectId == "habit-1" && it.taskId == null })
        // User allocates earned round from habit project to large-1/sub-2
        val submitted = actions.report("rep-2", ReportDraft("plan-end-habit", tasks = listOf(TaskAllocation("large-1", "sub-2", 5000, 1))), now + 61_000L) { "r-2" }.state
        assertNull(submitted.recovery.plan)
        assertEquals(5000, project(submitted, "large-1").getJSONArray("subtasks").getJSONObject(1).getInt("progressBasisPoints"))
        assertEquals(0, project(submitted, "habit-1").getJSONObject("habit").getJSONArray("completedFocusSessionIds").length())

        // Normal full-duration timer expiry on Habit End-Time also opens Unified Report and can allocate to Habit!
        val t2 = now + 3_600_000L
        actions.begin("b2b", "plan-end-habit-normal", FocusDraft("habit-1", null, PlanMode.MINIMAL, DraftSchedule.EndAt(t2 + 25 * 60_000L)), t2)
        val afterNormal = c.reconcile("due-2b", t2 + 25 * 60_000L).state
        assertEquals(PlanPhase.REPORT, afterNormal.recovery.plan?.phase)
        assertEquals(0, project(afterNormal, "habit-1").getJSONObject("habit").getJSONArray("completedFocusSessionIds").length())
        val afterHabitAlloc = actions.report("rep-2b", ReportDraft("plan-end-habit-normal", habits = listOf(HabitAllocation("habit-1", 1))), t2 + 25 * 60_000L + 1_000L) { "r-2b" }.state
        assertNull(afterHabitAlloc.recovery.plan)
        assertEquals(1, project(afterHabitAlloc, "habit-1").getJSONObject("habit").getJSONArray("completedFocusSessionIds").length())
    }

    @Test fun multiRoundEndTimeEarlyThenCancelOpensUnifiedReportForCompletedRounds() = withWorkspace { c, actions, _ ->
        val endAt = now + 55 * 60_000L // 2 rounds (25 + 5 + 25)
        actions.begin("bm1", "plan-multi-end", FocusDraft("large-1", null, PlanMode.MINIMAL, DraftSchedule.EndAt(endAt)), now)
        val afterR1 = c.manual("early-r1", early = true, cancelPlan = false, category = null, note = null, now = now + 60_000L).state
        assertEquals(PlanPhase.READY, afterR1.recovery.plan?.phase)
        assertEquals(1, afterR1.recovery.plan?.completedSessionIds?.size)
        // Cancel remaining schedule -> enters Unified Report for the 1 completed round
        val afterCancel = c.manual("cancel-r2", early = false, cancelPlan = true, category = "other", note = null, now = now + 70_000L).state
        assertEquals(PlanPhase.REPORT, afterCancel.recovery.plan?.phase)
        val pool = checkNotNull(ReportPool.from(afterCancel.domain, afterCancel.recovery))
        assertEquals(1, pool.totalRounds)
        assertEquals(setOf("sub-1", "sub-2", null), pool.targets.map { it.taskId }.toSet())
    }

    @Test fun roundsLargeNormalReportsSingleSubtaskWhileEarlyCompletesSelectedSubtask() = withWorkspace { c, actions, _ ->
        actions.begin("b3", "plan-r-normal", FocusDraft("large-1", "sub-2", PlanMode.ROUNDS, DraftSchedule.Rounds(1)), now)
        val finished = c.reconcile("due-3", now + 25 * 60_000L).state
        assertEquals(PlanPhase.REPORT, finished.recovery.plan?.phase)
        val pool = checkNotNull(ReportPool.from(finished.domain, finished.recovery))
        assertEquals(PlanMode.ROUNDS, pool.mode)
        assertEquals(listOf("sub-2"), pool.targets.map { it.taskId })
        actions.report("rep-3", ReportDraft("plan-r-normal", tasks = listOf(TaskAllocation("large-1", "sub-2", 2500, 1))), now + 25 * 60_000L + 1_000L) { "r-3" }

        val t2 = now + 30 * 60_000L
        actions.begin("b4", "plan-r-early", FocusDraft("large-1", "sub-1", PlanMode.ROUNDS, DraftSchedule.Rounds(1)), t2)
        val early = c.manual("early-4", early = true, cancelPlan = false, category = null, note = null, now = t2 + 10_000L).state
        assertNull(early.recovery.plan)
        val large = project(early, "large-1")
        assertEquals(10000, large.getJSONArray("subtasks").getJSONObject(0).getInt("progressBasisPoints"))
        assertEquals(2500, large.getJSONArray("subtasks").getJSONObject(1).getInt("progressBasisPoints"))
    }

    @Test fun roundsHabitAdvancesHabitImmediatelyWithoutReport() = withWorkspace { c, actions, _ ->
        c.command("sw", DomainEngine.command("SwitchActiveProject", "projectId" to "habit-1"), now)
        actions.begin("b5", "plan-r-habit", FocusDraft("habit-1", null, PlanMode.ROUNDS, DraftSchedule.Rounds(1)), now)
        val early = c.manual("early-5", early = true, cancelPlan = false, category = null, note = null, now = now + 10_000L).state
        assertNull(early.recovery.plan)
        assertEquals(1, project(early, "habit-1").getJSONObject("habit").getJSONArray("completedFocusSessionIds").length())
    }

    @Test fun detentMatchingAlignsWithRoundBoundaries() {
        val anchor = Math.floorDiv(now, 60_000L) * 60_000L
        val r1End = ClockSelection.detentEndMs(1, anchor, 25, 5)
        val r2End = ClockSelection.detentEndMs(2, anchor, 25, 5)
        assertEquals(1, ClockSelection.matchingDetentRound(r1End, anchor, 25, 5))
        assertEquals(2, ClockSelection.matchingDetentRound(r2End, anchor, 25, 5))
        assertNull(ClockSelection.matchingDetentRound(r1End + 300_000L, anchor, 25, 5))
    }

    @Test fun autoExtendHoldsCelebrationsDuringFocusAndReleasesAllOnUserFinish() = withWorkspace { c, actions, prefs ->
        prefs.update { it.copy(autoExtendFocus = true) }
        // Set daily goal = 1 so completing round 1 emits DailyGoalReached right at auto-extend boundary
        val date = DomainTime.localDate(DomainTime.format(now), "Asia/Shanghai")
        c.command("goal-1", DomainEngine.command("SetDailyGoal", "date" to date, "targetPomodoros" to 1), now)
        actions.begin("b-ext", "plan-ext", FocusDraft("large-1", "sub-1", PlanMode.ROUNDS, DraftSchedule.Rounds(1)), now)
        val due = c.reconcile("due-ext", now + 25 * 60_000L)
        assertNotNull("Auto-extend should enter extension focus", due.state.recovery.plan?.extensionStartedAt)
        assertEquals(TimerSurface.FOCUS, TimerPresentation.from(due.state.domain, due.state.recovery, prefs.load().value, now + 25 * 60_000L).surface)
        val celebrations = CelebrationQueue()
        celebrations.accept(due.events, due.replayed)
        // While still in active FOCUS (auto-extending), real celebration bursts stay held (not dropped, not played early!)
        assertNull(celebrations.peek(worldReady = false))
        // User finishes after 1.6 rounds -> leaves FOCUS -> celebration bursts release right when the user ends focus!
        val ended = c.finishExtension("end-ext", now + 40 * 60_000L)
        assertEquals(PlanPhase.REPORT, ended.state.recovery.plan?.phase)
        assertEquals(TimerSurface.REPORT, TimerPresentation.from(ended.state.domain, ended.state.recovery, prefs.load().value, now + 40 * 60_000L).surface)
        celebrations.accept(ended.events, ended.replayed)
        assertEquals(CelebrationKind.GOAL, celebrations.take(worldReady = true)?.kind)
    }
}
