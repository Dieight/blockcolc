package com.blockcolc.focus

import com.blockcolc.domain.*
import com.blockcolc.storage.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class FocusCoordinatorTest {
    @get:Rule val temp = TemporaryFolder()
    private val at = DomainTime.millis("2026-10-01T08:00:00.000Z")
    private fun doc(): DomainDocument {
        var s = DomainEngine.initial("Asia/Shanghai")
        for (cmd in listOf(DomainEngine.command("CreateProject", "projectId" to "host", "title" to "阅读", "blueprintId" to "cottage", "subtasks" to JSONArray().put(JSONObject().put("id", "read").put("title", "读一章")).put(JSONObject().put("id", "write").put("title", "写笔记"))),
            DomainEngine.command("CreateHabitProject", "projectId" to "habit", "title" to "每天", "blueprintId" to "cottage", "targetRounds" to 10), DomainEngine.command("SwitchActiveProject", "projectId" to "host"))) {
            val r = DomainEngine.execute(s, cmd, at); check(r.ok) { r.error!! }; s = r.state
        }
        return s
    }
    private fun spec(mode: PlanMode = PlanMode.MINIMAL, rest: Long = 300, count: Int = 3, exact: Long? = null) = PlanRequest("p", "host", if (mode == PlanMode.MINIMAL) null else "read", mode, count, 1000, rest, exact?.let(DomainTime::format))
    private fun entries(progress: Int = 5000, rounds: Int = 1) = JSONArray().put(DomainEngine.command("entry", "reportId" to "r", "projectId" to "host", "subtaskId" to "read", "progressBasisPoints" to progress, "rounds" to rounds).also { it.remove("type") })
    private fun run(block: (JdbcStateDatabase, NativeStateStore, FocusCoordinator) -> Unit) {
        JdbcStateDatabase(temp.newFolder().toPath().resolve("state.db")).use { db -> val s = NativeStateStore(db); s.initialize(doc()); block(db, s, FocusCoordinator(s, "test-db")) }
    }
    @Test fun extendedOrdinaryRoundRecoversAndSettlesTheHalfRoundExactlyOnce()=run{_,store,c->
        c.begin("ordinary",spec(PlanMode.ROUNDS,count=1).copy(extendAfterPlan=true),false,at)
        val first=c.reconcile("due",at+1000).state
        val extending=first.recovery.plan!!
        assertEquals(PlanPhase.FOCUS,extending.phase)
        assertEquals(DomainTime.format(at+1000),extending.extensionStartedAt)
        assertEquals(extending.extensionSessionId(1),first.domain.activeFocusSession()!!.getString("id"))
        val resumed=FocusCoordinator(store,"test-db")
        val stop=resumed.finishExtension("finish-extra",at+2500).state
        val report=stop.recovery.plan!!
        assertEquals(PlanPhase.REPORT,report.phase)
        assertEquals(2,report.extensionRounds)
        val history=stop.domain.projectionJson().getJSONArray("focusHistory")
        val ids=(0 until history.length()).map{history.getJSONObject(it).getString("id")}
        assertEquals(listOf(1000L,1000L,500L),(0 until history.length()).map{history.getJSONObject(it).getLong("actualDurationMs")})
        assertTrue(ids.all(report::completed))
        assertTrue(resumed.finishExtension("finish-extra",at+2600).replayed)
        val settled=resumed.command("report-extra",DomainEngine.command("ReportSubtaskProgress","reportId" to "extra-report",
            "subtaskId" to "read","focusSessionIds" to JSONArray(ids),"progressBasisPoints" to 5000),at+2600).state
        assertNull(settled.recovery.plan)
        assertEquals(3,settled.domain.projectionJson().getJSONArray("progressReports").getJSONObject(0).getJSONArray("focusSessionIds").length())
    }

    @Test fun terminalRestAndShortTailDoNotCreateExtraCompletedRounds()=run{_,store,c->
        c.begin("timed",spec(count=1,exact=at+1200).copy(extendAfterPlan=true),false,at)
        val rest=c.reconcile("rest",at+1000).state.recovery.plan!!
        assertTrue(rest.terminalRest);assertNull(rest.extensionStartedAt)
        val reopened=FocusCoordinator(store,"test-db")
        val extended=reopened.reconcile("extend",at+1200).state
        assertEquals(DomainTime.format(at+1200),extended.recovery.plan!!.extensionStartedAt)
        val done=reopened.finishExtension("short-tail",at+1699).state
        assertEquals(0,done.recovery.plan!!.extensionRounds)
        val history=done.domain.projectionJson().getJSONArray("focusHistory")
        assertEquals("interrupted",history.getJSONObject(1).getString("status"))
        assertEquals(499L,history.getJSONObject(1).getLong("actualDurationMs"))
        assertEquals(1,done.recovery.plan!!.completedSessionIds.size)
    }

    @Test fun extendedHabitDoesNotDoubleAwardACompletedBuilding()=run{_,_,c->
        c.begin("habit",PlanRequest("habit-extra","habit",null,PlanMode.ROUNDS,1,1000,0,extendAfterPlan=true),false,at)
        val during=c.reconcile("due-habit",at+10500).state
        assertEquals(9,during.recovery.plan!!.extensionRounds)
        assertTrue(during.domain.activeFocusSession()!!.getBoolean("deferredSettlement"))
        val done=c.finishExtension("finish-habit",at+11500).state
        assertNull(done.recovery.plan)
        val facts=done.domain.projectionJson()
        assertEquals(1,facts.getJSONArray("habitBuildings").length())
        assertEquals(12,facts.getJSONArray("focusHistory").length())
        assertTrue(facts.getJSONArray("focusHistory").getJSONObject(11).has("settledAt"))
    }
    @Test fun initialStartCommitsPlanAndSessionTogetherAndReplayDoesNotStartAgain() = run { _, _, c ->
        val before=c.load()
        val request=spec(PlanMode.ROUNDS)
        val result=c.begin("begin",request,true,at)
        assertEquals(before.token.revision+1,result.state.token.revision)
        assertEquals(PlanPhase.FOCUS,result.state.recovery.plan!!.phase)
        assertTrue(result.state.recovery.plan!!.hasStarted)
        assertEquals("read",result.state.domain.json().getJSONObject("activeFocusSession").getString("subtaskId"))
        assertTrue(c.begin("begin",request,true,at+1).replayed)
        assertEquals(result.state,c.load())
    }
    @Test fun processResumeDoesNotWriteOrAllocateACommandForUnchangedFacts()=run{db,_,c->
        val before=c.load();assertEquals(before,c.resume(at){error("No transition needs an ID")}.state)
        assertEquals(0L,(db.transaction{it.query("SELECT COUNT(*) FROM command_receipts").single().single()} as Number).toLong())
        c.begin("begin",spec(),true,at);val active=c.load()
        assertEquals(active,c.resume(at+500){error("The future deadline is unchanged")}.state)
    }
    @Test fun hostVisibilityCommitsOnlyChangesToTheActualFocus()=run{db,_,c->
        val idle=c.load()
        assertEquals(idle,c.observeLifecycle(true,"app-switch",at){error("Idle return needs no receipt")}.state)
        val active=c.begin("begin",spec().copy(focusMs=20_000),true,at).state
        assertEquals(active,c.observeLifecycle(true,"app-switch",at+1){error("Already foreground")}.state)
        val background=c.observeLifecycle(false,"app-switch",at+100){"left"}.state
        assertEquals(active.token.revision+1,background.token.revision)
        assertFalse(background.domain.activeFocusSession()!!.getJSONObject("integrity").isNull("backgroundedAt"))
        assertEquals(background,c.observeLifecycle(false,"app-switch",at+200){error("Already backgrounded")}.state)
        val returned=c.observeLifecycle(true,"app-switch",at+500){"returned"}.state
        assertEquals(background.token.revision+1,returned.token.revision)
        assertTrue(returned.domain.activeFocusSession()!!.getJSONObject("integrity").isNull("backgroundedAt"))
        assertEquals(3L,(db.transaction{it.query("SELECT COUNT(*) FROM command_receipts").single().single()} as Number).toLong())
    }
    @Test fun processResumeCommitsAnOverdueTransitionOnceAndPreservesManualWaiting()=run{_,_,c->
        c.begin("begin",spec(),true,at);val before=c.load();var allocated=0
        val resumed=c.resume(at+1100){"resume-${++allocated}"}
        assertEquals(before.token.revision+1,resumed.state.token.revision)
        assertEquals(PlanPhase.REST,resumed.state.recovery.plan!!.phase)
        assertEquals(1,resumed.state.recovery.plan!!.completedSessionIds.size)
        assertEquals(resumed.state,c.resume(at+1101){error("The rest is not over")}.state);assertEquals(1,allocated)
        c.resume(at+1400){"resume-${++allocated}"}
        c.manual("manual-stop",true,false,null,null,at+1500)
        val waiting=c.load();assertNull(waiting.recovery.automatic)
        assertEquals(waiting,c.resume(at+60000){error("Manual waiting must not auto-start")}.state)
    }
    @Test fun reopenedForegroundKeepsTheSecondRoundOnItsOriginalClock()=run{db,_,started->
        started.command("policy", DomainEngine.command("ConfigureFocusIntegrity", "enabled" to true,
            "maxEffectiveExcursions" to 1, "excursionThresholdSeconds" to 2), at)
        started.begin("begin",spec().copy(focusMs=25_000,restMs=5_000),true,at)
        started.observeLifecycle(false,"screen-lock",at+500){"locked"}
        val first = FocusCoordinator(NativeStateStore(db), "test-db")
        val unlocked = first.observeLifecycle(true, "app-switch", at + 5000) { "unlocked" }.state
        assertEquals(DomainTime.format(at + 25_000), first.deadline(unlocked)?.end)
        assertEquals(0, unlocked.domain.activeFocusSession()!!.getJSONObject("integrity").getInt("effectiveExcursions"))
        first.observeLifecycle(false, "screen-lock", at + 5100) { "locked-again" }
        // Open a new reader and coordinator while the process was away
        // across both the first deadline and its automatic rest.
        val reopened=FocusCoordinator(NativeStateStore(db),"test-db")
        val restored=reopened.observeLifecycle(true,"app-switch",at+37_200){"cold-foreground"}.state
        val active=restored.domain.activeFocusSession()!!
        val plan=restored.recovery.plan!!
        assertEquals(PlanPhase.FOCUS,plan.phase)
        assertEquals(1,plan.completedSessionIds.size)
        assertEquals(DomainTime.format(at+30_000),active.getString("startedAt"))
        assertEquals(DomainTime.format(at+55_000),active.getString("endsAt"))
        assertEquals(active.getString("id"),plan.currentSessionId)
        assertEquals(17_800L,DomainTime.millis(plan.phaseEndsAt!!)-(at+37_200))
        assertEquals(restored,reopened.observeLifecycle(true,"app-switch",at+38_000){error("Repeated resume restarted a live round")}.state)
    }
    @Test fun failedInitialStartDoesNotSaveEvenItsProjectSwitchOrPlan() = run { _, _, c ->
        c.command("switch",DomainEngine.command("SwitchActiveProject","projectId" to "habit"),at)
        val before=c.load()
        assertThrows(Exception::class.java){c.begin("begin",spec(PlanMode.ROUNDS).copy(subtaskId="missing"),true,at)}
        assertEquals(before,c.load())
        c.begin("begin",spec(PlanMode.ROUNDS),false,at)
        assertEquals("host",c.load().domain.json().getString("activeProjectId"))
        assertNotNull(c.load().domain.json().optJSONObject("activeFocusSession"))
    }
    @Test fun amendmentIsAtomicAndCannotReplaceStartedOrStalePlan() = run { _, _, c ->
        c.confirm("confirm",spec(PlanMode.MARATHON),at)
        val before=c.load()
        assertThrows(Exception::class.java){c.amend("bad","p",spec(PlanMode.MARATHON).copy(rounds=25),at)}
        assertEquals(before,c.load())
        assertThrows(Exception::class.java){c.amend("stale","other",spec(),at)}
        assertEquals(before,c.load())
        val amended=c.amend("edit","p",spec(PlanMode.MARATHON).copy(id="p2",rounds=2),at)
        assertEquals("p2",amended.state.recovery.plan!!.id)
        assertEquals(2,amended.state.recovery.plan!!.totalRounds)
        assertTrue(amended.state.domain.json().isNull("activeFocusSession"))
        assertTrue(c.amend("edit","p",spec(PlanMode.MARATHON).copy(id="p2",rounds=2),at+1).replayed)
        c.start("start",false,at)
        val running=c.load()
        assertThrows(Exception::class.java){c.amend("running","p2",spec(),at+1)}
        assertEquals(running,c.load())
    }
    @Test fun confirmedPlansKeepTheirTaskContextUntilCancelled() = run { _, _, c ->
        c.confirm("confirm",spec(PlanMode.MARATHON),at)
        val before=c.load()
        assertThrows(Exception::class.java){c.command("switch",DomainEngine.command("SwitchActiveProject","projectId" to "habit"),at)}
        assertThrows(Exception::class.java){c.command("create",DomainEngine.command("CreateHabitProject","projectId" to "new","title" to "new","blueprintId" to "cottage","targetRounds" to 10),at)}
        assertEquals(before,c.load())
        c.manual("cancel",false,true,null,null,at)
        assertNull(c.load().recovery.plan)
        c.command("switch",DomainEngine.command("SwitchActiveProject","projectId" to "habit"),at)
        assertEquals("habit",c.load().domain.json().getString("activeProjectId"))
    }
    @Test fun automaticBackgroundCatchupUsesAbsoluteTimesAndPersistsAllThreeRoundsOnce() = run { _, _, c ->
        c.confirm("confirm", spec(), at); c.start("start", true, at)
        val ticket = c.deadline(c.load())!!
        val end = c.reconcile("due", at + 10000, ticket).state
        assertEquals(PlanPhase.REPORT, end.recovery.plan!!.phase); assertEquals(3, end.domain.json().getJSONArray("focusHistory").length())
        val history = end.domain.json().getJSONArray("focusHistory")
        for (i in 0..2) { val h = history.getJSONObject(i); assertEquals(at + i * 1300, DomainTime.millis(h.getString("startedAt"))); assertEquals(1000L, h.getLong("actualDurationMs")) }
        val stable = c.load(); assertTrue(c.reconcile("old", at + 20000, ticket).replayed); assertEquals(stable, c.load())
        c.report("report", entries(rounds = 2), JSONArray().put(JSONObject().put("projectId", "habit").put("rounds", 1)), at + 10000)
        assertNull(c.load().recovery.plan); assertTrue(c.report("report", entries(rounds = 2), JSONArray().put(JSONObject().put("projectId", "habit").put("rounds", 1)), at + 20000).replayed)
        val habit = c.load().domain.json().getJSONArray("projects").getJSONObject(1).getJSONObject("habit")
        assertEquals(1, habit.getJSONArray("completedFocusSessionIds").length())
    }
    @Test fun manualEarlyAndCancelRevokeAutomaticEvenWithZeroRest() = run { _, _, c ->
        c.confirm("confirm", spec(rest = 0), at); c.start("start", true, at)
        c.manual("early", true, false, null, null, at + 500)
        assertEquals(PlanPhase.READY, c.load().recovery.plan!!.phase); assertNull(c.load().recovery.automatic)
        c.reconcile("later", at + 10000); assertNull(c.load().domain.json().optJSONObject("activeFocusSession"))
        c.start("start2", false, at + 11000); c.manual("cancel", false, false, "other", null, at + 11200)
        assertEquals(1, c.load().recovery.plan!!.completedSessionIds.size); assertEquals(PlanPhase.READY, c.load().recovery.plan!!.phase)
        c.manual("whole-plan", false, true, "other", null, at + 11201)
        assertEquals(PlanPhase.REPORT, c.load().recovery.plan!!.phase)
        c.report("discard", JSONArray(), JSONArray(), at + 11202); assertNull(c.load().recovery.plan)
    }
    @Test fun regularRoundsRequireReportAndCountTheSameSessionOnlyOnce() = run { _, _, c ->
        c.confirm("confirm", spec(PlanMode.ROUNDS), at); c.start("start", true, at)
        c.reconcile("due", at + 1000); assertEquals(PlanPhase.REPORT, c.load().recovery.plan!!.phase)
        c.reconcile("no-auto-before-report", at + 50000); assertEquals(1, c.load().domain.json().getJSONArray("focusHistory").length())
        val first = c.load().recovery.plan!!.completedSessionIds.single()
        val report = DomainEngine.command("ReportSubtaskProgress", "reportId" to "r", "subtaskId" to "read", "focusSessionIds" to JSONArray().put(first), "progressBasisPoints" to 5000)
        c.command("report", report, at + 50000); assertEquals(PlanPhase.REST, c.load().recovery.plan!!.phase)
        assertEquals(DomainTime.format(at+50000),c.load().recovery.plan!!.restStartedAt)
        assertTrue(c.command("report", report, at + 50001).replayed)
        c.reconcile("break", at + 50300); assertEquals(PlanPhase.FOCUS, c.load().recovery.plan!!.phase)
        assertEquals(1, c.load().recovery.plan!!.completedSessionIds.size)
    }
    @Test fun exactEndIncludesPartialFocusOrOnlyTerminalRest() {
        run { _, _, c ->
            c.confirm("confirm", spec(count = 2, exact = at + 1800), at); c.start("start", true, at); c.reconcile("due", at + 10000)
            val history = c.load().domain.json().getJSONArray("focusHistory")
            assertEquals(2, history.length()); assertEquals(500L, history.getJSONObject(1).getLong("actualDurationMs")); assertEquals(at + 1800, DomainTime.millis(history.getJSONObject(1).getString("completedAt")))
        }
        run { _, _, c ->
            c.confirm("confirm", spec(count = 1, exact = at + 1200), at); c.start("start", true, at); c.reconcile("due", at + 1000)
            assertEquals(PlanPhase.REST, c.load().recovery.plan!!.phase); assertTrue(c.load().recovery.plan!!.terminalRest)
            c.reconcile("terminal", at + 1200); assertEquals(PlanPhase.REPORT, c.load().recovery.plan!!.phase); assertEquals(1, c.load().domain.json().getJSONArray("focusHistory").length())
        }
    }
    @Test fun importSameIdsRevokesOldDeadlineAndNeverGuessesAutomaticAuthorization() = run { _, s, c ->
        c.confirm("confirm", spec(), at); c.start("start", true, at); val old = c.deadline(c.load())!!
        val backup = BackupCodec.read(BackupCodec.write(c.load().domain, DomainTime.format(at)))
        c.importBackup("import", backup, at); assertNull(c.load().recovery.plan)
        assertTrue(c.importBackup("import",backup,at+1).replayed)
        val stable = c.load(); c.reconcile("old", at + 10000, old); assertEquals(stable, c.load())
        c.reconcile("new", at + 10000); assertEquals(1, c.load().domain.json().getJSONArray("focusHistory").length()); assertNull(c.load().recovery.automatic)
        assertEquals(1, s.backupRoots().size)
    }
    @Test fun importedActiveAndUnreportedHistoryRecoverManualReportNotAutomaticSchedule() = run { _, _, c ->
        c.confirm("confirm",spec(PlanMode.ROUNDS),at);c.start("start",true,at)
        val backup=BackupCodec.read(BackupCodec.write(c.load().domain,DomainTime.format(at)))
        c.importBackup("import",backup,at);c.reconcile("due",at+10000)
        assertEquals(PlanPhase.REPORT,c.load().recovery.plan!!.phase);assertNull(c.load().recovery.automatic)
        val session=c.load().recovery.plan!!.completedSessionIds.single()
        c.command("report",DomainEngine.command("ReportSubtaskProgress","reportId" to "r","subtaskId" to "read","focusSessionIds" to JSONArray().put(session),"progressBasisPoints" to 5000),at+10001)
        assertNull(c.load().recovery.plan);assertEquals(1,c.load().domain.json().getJSONArray("focusHistory").length())
    }
    @Test fun cancellingOrdinaryMultiRoundFocusPreservesTheAlreadyReportedRound()=run { _, _, c ->
        c.confirm("ordinary",spec(PlanMode.ROUNDS,rest=0),at)
        c.start("first",false,at)
        c.reconcile("first-due",at+1000)
        val completed=c.load().recovery.plan!!.completedSessionIds.single()
        c.command("first-report",DomainEngine.command("ReportSubtaskProgress","reportId" to "first-report",
            "subtaskId" to "read","focusSessionIds" to JSONArray().put(completed),"progressBasisPoints" to 5000),at+1001)
        val second=c.start("second",true,at+1002).state
        assertNotNull(second.recovery.automatic)
        val cancelled=c.manual("cancel-all",false,true,"fatigue",null,at+1500).state
        assertNull(cancelled.recovery.plan)
        assertNull(cancelled.recovery.automatic)
        assertNull(cancelled.domain.activeFocusSession())
        val facts=cancelled.domain.projectionJson()
        val history=facts.getJSONArray("focusHistory")
        assertEquals(2,history.length())
        assertEquals("completed",history.getJSONObject(0).getString("status"))
        assertEquals("interrupted",history.getJSONObject(1).getString("status"))
        assertEquals("fatigue",history.getJSONObject(1).getString("interruptionCategory"))
        assertEquals(completed,facts.getJSONArray("progressReports").getJSONObject(0).getJSONArray("focusSessionIds").getString(0))
        assertEquals(cancelled,c.resume(at+10000){error("The cancelled plan cannot restart")}.state)
    }

    @Test fun cancellationKeepsEarnedWorkAndReasonUntilItsSingleReportCommits() = run { _, _, c ->
        c.confirm("confirm",spec(PlanMode.MARATHON),at);c.start("start",false,at);c.reconcile("due",at+1000)
        c.manual("cancel-plan",false,true,"fatigue","",at+1100)
        assertTrue(c.load().recovery.plan!!.cancelled);assertEquals("fatigue",c.load().recovery.plan!!.cancellationCategory)
        c.report("report",entries(),JSONArray(),at+1101);assertNull(c.load().recovery.plan)
    }
    @Test fun failureBetweenRecordsAndMetadataDoesNotPublishOrLoseEarnedWork() = run { db, s, c ->
        c.confirm("confirm", spec(), at); c.start("start", true, at); val before = c.load()
        val broken = FocusCoordinator(NativeStateStore(db) { if (it == "before-meta") error("disk full") }, "test-db")
        assertTrue(runCatching { broken.reconcile("due", at + 10000) }.isFailure); assertEquals(before, c.load())
        c.reconcile("due", at + 10000); assertEquals(3, s.load()!!.domain.json().getJSONArray("focusHistory").length())
    }
    @Test fun everyManualReplayHasNoSideEffectsAndChangedPayloadCannotReuseId() = run { _, _, c ->
        c.confirm("confirm", spec(), at); c.start("start", true, at)
        c.manual("manual", false, false, "other", null, at + 500); val stable = c.load()
        assertTrue(c.manual("manual", false, false, "other", null, at + 900).replayed); assertEquals(stable, c.load())
        assertTrue(runCatching { c.manual("manual", true, false, null, null, at + 900) }.exceptionOrNull() is StorageConflict)
        c.start("again", false, at + 1000); assertEquals(PlanPhase.FOCUS, c.load().recovery.plan!!.phase)
    }
    @Test fun databaseIdentityAndGenerationProtectEveryDeadlineDelivery() = run { _, _, c ->
        c.confirm("confirm", spec(), at); c.start("start", true, at); val t = c.deadline(c.load())!!; val stable = c.load()
        for (bad in listOf(t.copy(database = "other"), t.copy(generation = 20), t.copy(plan = "old"), t.copy(session = "old"), t.copy(end = DomainTime.format(at)))) {
            c.reconcile("bad-${bad.hashCode()}", at + 10000, bad); assertEquals(stable, c.load())
        }
    }
    @Test fun earlyDeliveryCannotConsumeTheStableDeadlineRequestBeforeItIsDue() = run { _, _, c ->
        c.confirm("confirm",spec(),at);c.start("start",true,at)
        val first=c.deadline(c.load())!!
        c.reconcile("deadline:first",at+999,first)
        assertEquals(PlanPhase.FOCUS,c.load().recovery.plan!!.phase)
        c.reconcile("deadline:first",at+1000,first)
        assertEquals(PlanPhase.REST,c.load().recovery.plan!!.phase)
        val rest=c.deadline(c.load())!!
        c.reconcile("deadline:rest",at+1299,rest)
        assertEquals(PlanPhase.REST,c.load().recovery.plan!!.phase)
        c.reconcile("deadline:rest",at+1300,rest)
        assertEquals(PlanPhase.FOCUS,c.load().recovery.plan!!.phase)
        assertEquals(1,c.load().recovery.plan!!.completedSessionIds.size)
        c.reconcile("finish",at+10000)
        assertEquals(3,c.load().domain.json().getJSONArray("focusHistory").length())
    }
    @Test fun maximumPlanZeroRestAndDelayedMultiDayResumeAreBoundedAndExact() = run { _, _, c ->
        val p=spec(rest=0,count=24).copy(focusMs=10800000)
        c.confirm("confirm",p,at);c.start("start",true,at)
        c.reconcile("after-three-days",at+3*86400000L)
        val state=c.load();assertEquals(24,state.recovery.plan!!.completedSessionIds.size);assertEquals(PlanPhase.REPORT,state.recovery.plan!!.phase)
        val a=state.domain.json().getJSONArray("focusHistory");assertEquals(24,a.length())
        assertEquals(at+24*10800000L,DomainTime.millis(a.getJSONObject(23).getString("completedAt")))
    }
    @Test fun integrityInterruptionThroughTheCommandEntryClearsThePlanAndGrant() = run { _, _, c ->
        c.command("policy",DomainEngine.command("ConfigureFocusIntegrity","enabled" to true,"maxEffectiveExcursions" to 1,"excursionThresholdSeconds" to 1),at)
        c.confirm("confirm",spec().copy(focusMs=10000),at);c.start("start",true,at)
        c.command("bg",DomainEngine.command("RecordFocusBackgrounded","reason" to "app-switch"),at+1)
        c.command("fg",DomainEngine.command("RecordFocusForegrounded"),at+1002)
        assertEquals(RecoveryContext(), c.load().recovery)
        c.reconcile("later",at+100000);assertNull(c.load().domain.json().optJSONObject("activeFocusSession"))
    }
    @Test fun failedReadAfterSuccessfulCommitIsNotAnUncommittedCommand(){
        JdbcStateDatabase(temp.newFolder().toPath().resolve("ack.db")).use{base->
            var armed=false;var failNextRead=false
            val database=object:SqlDatabase{
                override fun <T> transaction(block:(SqlSession)->T):T{
                    if(failNextRead){failNextRead=false;throw java.io.IOException("injected read after actual COMMIT")}
                    var wrote=false
                    val result=base.transaction{sql->block(object:SqlSession{
                        override fun query(sqlText:String,args:List<Any?>)=sql.query(sqlText,args)
                        override fun execute(sqlText:String,args:List<Any?>):Int{
                            val result=sql.execute(sqlText,args)
                            if(armed&&sqlText.startsWith("INSERT INTO command_receipts"))wrote=true
                            return result
                        }
                    })}
                    if(wrote){armed=false;failNextRead=true}
                    return result
                }
                override fun close(){}
            }
            val store=NativeStateStore(database);store.initialize(doc());val c=FocusCoordinator(store,"ack")
            val before=c.load();armed=true
            val command=DomainEngine.command("AddQuickNote","noteId" to "saved","text" to "已经保存")
            val failure=runCatching{c.command("once",command,at)}.exceptionOrNull()
            assertTrue(failure is CommittedStateUnavailable)
            assertEquals(before.token.revision+1,(failure as CommittedStateUnavailable).receipt.token.revision)
            assertEquals("已经保存",c.load().domain.json().getJSONArray("quickNotes").getJSONObject(0).getString("text"))
            assertTrue(c.command("once",command,at+1).replayed)
            assertEquals(1,c.load().domain.json().getJSONArray("quickNotes").length())
        }
    }
    @Test fun returnSignalOnlyAtNaturalRestWithRemainingMinimalOrMarathonRounds() {
        for(mode in PlanMode.entries)run{_,_,c->
            c.begin("begin",spec(mode),false,at)
            val focus=c.reconcile("focus",at+1000)
            assertTrue(focus.signals.isEmpty())
            if(mode==PlanMode.ROUNDS){assertEquals(PlanPhase.REPORT,focus.state.recovery.plan!!.phase)}
            else{
                val rest=c.deadline(c.load())!!
                assertTrue(c.reconcile("early",at+1299,rest).signals.isEmpty())
                val ready=c.reconcile("rest",at+1300,rest)
                assertEquals(1,ready.signals.size)
                assertTrue(c.reconcile("rest",at+1400,rest).signals.isEmpty())
                assertTrue(c.reconcile("refresh",at+1400).signals.isEmpty())
            }
        }
    }
    @Test fun automaticAndTerminalRestNeverRequestReturnOrIntermediateReport()=run{_,_,c->
        c.begin("begin",spec(count=2),true,at)
        val next=c.reconcile("next",at+1300)
        assertTrue(next.signals.isEmpty());assertEquals(PlanPhase.FOCUS,next.state.recovery.plan!!.phase)
        assertEquals(at+2300,DomainTime.millis(c.deadline(next.state)!!.end))
        val final=c.reconcile("all",at+2300)
        assertTrue(final.signals.isEmpty());assertEquals(PlanPhase.REPORT,final.state.recovery.plan!!.phase)
        assertNull(final.state.recovery.automatic)
    }
    @Test fun notificationDrawerFocusLossDoesNotWriteExcursionAndSystemUiIsExempt()=run{_,_,c->
        c.command("policy",DomainEngine.command("ConfigureFocusIntegrity","enabled" to true,"maxEffectiveExcursions" to 1,"excursionThresholdSeconds" to 3),at)
        c.begin("begin",spec().copy(focusMs=60000),true,at)
        // Notification drawer loses window focus but does not stop Activity: only foreground callback.
        c.command("drawer",DomainEngine.command("RecordFocusForegrounded"),at+4000)
        c.command("exempt",DomainEngine.command("GrantFocusLifecycleExemption"),at+5000)
        c.command("settings",DomainEngine.command("RecordFocusBackgrounded","reason" to "app-switch"),at+5001)
        c.command("back",DomainEngine.command("RecordFocusForegrounded"),at+15000)
        val integrity=c.load().domain.json().getJSONObject("activeFocusSession").getJSONObject("integrity")
        assertEquals(0,integrity.getInt("effectiveExcursions"))
        c.command("bg",DomainEngine.command("RecordFocusBackgrounded","reason" to "app-switch"),at+16000)
        c.command("threshold",DomainEngine.command("RecordFocusForegrounded"),at+19000)
        assertNotNull(c.load().domain.json().optJSONObject("activeFocusSession"))
    }

    @Test fun revokingAutomaticKeepsCurrentDeadlineAndRequiresManualNextStart()=run{_,_,c->
        c.begin("begin",spec(),true,at)
        val ticket=c.deadline(c.load())
        c.revokeAutomatic("off")
        assertNull(c.load().recovery.automatic);assertEquals(ticket,c.deadline(c.load()))
        c.reconcile("rest",at+1300)
        assertEquals(PlanPhase.READY,c.load().recovery.plan!!.phase)
        assertTrue(c.revokeAutomatic("off").replayed)
    }

    @Test fun returnOutboxSurvivesReopenAndReplayUntilAcknowledgedWithoutResettling()=run{_,store,c->
        c.begin("begin",spec(),false,at)
        c.reconcile("rest-end",at+1300)
        val ready=c.load();val pending=ready.recovery.returnReminder!!
        val reopened=FocusCoordinator(store,"test-db")
        assertEquals(pending,reopened.load().recovery.returnReminder)
        assertEquals(pending,RecoveryContext.parse(ready.recovery.canonical(),ready.domain).returnReminder)
        assertTrue(reopened.reconcile("rest-end",at+1400).replayed)
        assertEquals(pending,reopened.load().recovery.returnReminder)
        val facts=reopened.load().domain.canonical
        reopened.acknowledgeReturnReminder("delivered",pending.key)
        assertNull(reopened.load().recovery.returnReminder);assertEquals(facts,reopened.load().domain.canonical)
        assertTrue(reopened.acknowledgeReturnReminder("delivered",pending.key).replayed)
    }
    @Test fun staleOutboxCannotCrossNextRoundOrReplacement()=run{_,_,c->
        c.begin("begin",spec(),false,at);c.reconcile("rest-end",at+1300)
        val pending=c.load().recovery.returnReminder!!
        c.start("next",false,at+1400);assertNull(c.load().recovery.returnReminder)
        c.acknowledgeReturnReminder("late-ack",pending.key)
        assertNotNull(c.load().domain.json().optJSONObject("activeFocusSession"))
        val backup=BackupCodec.read(BackupCodec.write(doc(),DomainTime.format(at)))
        c.importBackup("replace",backup,at+1500);assertNull(c.load().recovery.returnReminder)
    }
    @Test fun hostSystemStopAfterAutomaticHandoffExemptsTheNewSession()=run{_,_,c->
        c.command("policy",DomainEngine.command("ConfigureFocusIntegrity","enabled" to true,"maxEffectiveExcursions" to 1,"excursionThresholdSeconds" to 1),at)
        c.begin("begin",spec(rest=0).copy(focusMs=10000),true,at)
        c.lifecycle("system-stop",false,"system-exempt",at+10001)
        val active=c.load().domain.json().getJSONObject("activeFocusSession")
        assertEquals("system-exempt",active.getJSONObject("integrity").getString("backgroundReason"))
        c.lifecycle("resume",true,"app-switch",at+12002)
        assertEquals(0,c.load().domain.json().getJSONObject("activeFocusSession").getJSONObject("integrity").getInt("effectiveExcursions"))
        c.lifecycle("user-stop",false,"app-switch",at+13000)
        c.lifecycle("user-back",true,"app-switch",at+15001)
        assertNull(c.load().domain.json().optJSONObject("activeFocusSession"))
    }

    @Test fun integrityLimitStopsThePlanAndKeepsCompletedPooledRoundsUnallocated() = run { _, store, c ->
        c.command("policy", DomainEngine.command("ConfigureFocusIntegrity", "enabled" to true,
            "maxEffectiveExcursions" to 1, "excursionThresholdSeconds" to 2), at)
        c.begin("begin", spec(rest = 0).copy(focusMs = 10_000), true, at)
        c.reconcile("first-due", at + 10_000)
        c.observeLifecycle(false, "app-switch", at + 11_000) { "left" }
        val stopped = c.observeLifecycle(true, "app-switch", at + 14_000) { "back" }.state
        assertEquals(RecoveryContext(), stopped.recovery)
        assertNull(stopped.domain.activeFocusSession())
        val facts = stopped.domain.focusControlJson().getJSONArray("focusHistory")
        assertEquals(2, facts.length())
        assertEquals("completed", facts.getJSONObject(0).getString("status"))
        assertEquals(10_000L, facts.getJSONObject(0).getLong("actualDurationMs"))
        assertTrue(facts.getJSONObject(0).has("settledAt"))
        assertEquals("app-switch-limit", facts.getJSONObject(1).getString("interruptionReason"))
        assertEquals(0, stopped.domain.focusControlJson().getJSONArray("progressReports").length())
        val reopened = FocusCoordinator(store, "test-db")
        assertEquals(stopped, reopened.resume(at + 15_000) { error("No report or timer may reopen") }.state)
    }

    @Test fun olderPausedPlanAfterAnIntegrityFailureReturnsToIdleOnRecovery() = run { _, store, c ->
        c.command("policy", DomainEngine.command("ConfigureFocusIntegrity", "enabled" to true,
            "maxEffectiveExcursions" to 1, "excursionThresholdSeconds" to 2), at)
        c.begin("begin", spec(PlanMode.MARATHON).copy(focusMs = 10_000), true, at)
        val asleep = c.observeLifecycle(false, "app-switch", at + 1000) { "left" }.state
        val ended = DomainEngine.execute(asleep.domain, DomainEngine.command("RecordFocusForegrounded"), at + 4000)
        assertTrue(ended.error, ended.ok)
        val oldWaiting = asleep.recovery.plan!!.copy(phase = PlanPhase.READY, currentSessionId = null, phaseEndsAt = null)
        store.commit(asleep.token, "older-interruption", ended.state, RecoveryContext(oldWaiting))
        val recovered = c.resume(at + 5000) { "recover-old-waiting" }.state
        assertEquals(RecoveryContext(), recovered.recovery)
        assertEquals(ended.state, recovered.domain)
    }

    @Test fun failedOutboxAcknowledgementKeepsThePendingReceiptForRetry()=run{db,_,c->
        c.begin("begin",spec(),false,at);c.reconcile("rest",at+1300)
        val pending=c.load().recovery.returnReminder!!;val facts=c.load().domain.canonical
        db.transaction{it.execute("CREATE TRIGGER reject_notice BEFORE UPDATE ON local_recovery BEGIN SELECT RAISE(ABORT, 'notice failure'); END")}
        assertThrows(Exception::class.java){c.acknowledgeReturnReminder("notice",pending.key)}
        assertEquals(pending,c.load().recovery.returnReminder);assertEquals(facts,c.load().domain.canonical)
        db.transaction{it.execute("DROP TRIGGER reject_notice")}
        c.acknowledgeReturnReminder("notice",pending.key)
        assertNull(c.load().recovery.returnReminder);assertEquals(facts,c.load().domain.canonical)
    }

}
