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

/** Exercises the same typed commands, coordinator, SQLite transaction and
 * committed events as production, including a failure before COMMIT. */
class RewardCommitTest {
    @get:Rule val temporary=TemporaryFolder()
    private val at=DomainTime.millis("2026-12-25T08:00:00.000Z")
    private fun withCoordinator(block:(FocusCoordinator,NativeStateStore,JdbcStateDatabase)->Unit){
        JdbcStateDatabase(temporary.newFolder().toPath().resolve("rewards.db")).use{db->
            val store=NativeStateStore(db);store.initialize(DomainEngine.initial("UTC"));block(FocusCoordinator(store,"rewards"),store,db)
        }
    }
    private fun create(c:FocusCoordinator)=WorkspaceCommands.commit(c,"create",WorkspaceMutation.CreateProject("p","Work","house",listOf(WorkspaceMutation.NewSubtask("t","Task"))),at)
    private fun feed(q:CelebrationQueue,op:Operation){q.accept(op.events,op.replayed)}
    private fun daily(id:String="daily-one",title:String="Daily")=JSONObject().put("schemaVersion",1).put("id",id).put("title",title)
        .put("bounds",JSONObject().put("minX",0).put("maxX",0).put("minY",0).put("maxY",0).put("minZ",0).put("maxZ",0))
        .put("voxels",JSONArray().put(JSONObject().put("x",0).put("y",0).put("z",0).put("materialId","stone").put("buildOrder",4000).put("stage","details")))

    @Test fun atomicPoolMatchesTheOrderedImportsWithoutMutatingItsSources(){
        val empty=DomainEngine.initial("UTC")
        val packaged=listOf(daily("daily-one"),daily("daily-two"))
        val ids=packaged.map{it.getString("id")}
        val source=packaged.associateBy{it.getString("id")}
        val original=packaged.map(StrictJson::render)
        val commands=original.map{wire->
            val body=JSONObject(wire)
            body.getJSONArray("voxels").getJSONObject(0).put("stage","walls")
            DomainEngine.command("ImportDecorationBlueprint","blueprint" to body)
        }
        val events=mutableListOf<String>()
        val expected=commands.fold(empty){state,command->
            val result=DomainEngine.execute(state,command,at)
            assertTrue(result.error,result.ok)
            events.addAll(result.events)
            result.state
        }
        withCoordinator{c,_,_->
            val imports=mutableListOf<Operation>()
            assertEquals(2,DailyRewardRegistration.prepare(c,ids,source::getValue,{"pool-$it"},at){imports.add(it)})
            val saved=imports.single()
            assertEquals(expected,saved.state.domain)
            assertEquals(events,saved.events)
            assertEquals(commands.map{ExecutedCommand(StrictJson.render(it),at)},saved.journal)
            assertEquals(original,packaged.map(StrictJson::render))
        }
        val failed=DomainEngine.importDecorationBlueprints(empty,listOf(packaged.first(),daily("broken").also{it.remove("bounds")}),at)
        assertFalse(failed.ok)
        assertSame(empty,failed.state)
        assertTrue(failed.events.isEmpty())
    }

    @Test fun packagedDailyRegistrationPreservesSavedConflictsAndDoesNoWritesOrPayloadReadsOnRestart()=withCoordinator{c,_,db->
        WorkspaceCommands.commit(c,"saved",WorkspaceMutation.RegisterDailyReward("daily-one",daily(title="Saved user version").toString()),at)
        val saved=c.load().domain.json().getJSONArray("decorationBlueprintResources").getJSONObject(0).toString()
        var reads=0;var commits=0
        fun prepare()=DailyRewardRegistration.prepare(c,listOf("daily-one","daily-two"),{reads++;daily(it)},{"register-$it"},at){commits++}
        db.transaction{it.execute("CREATE TRIGGER daily_fail BEFORE INSERT ON domain_records WHEN NEW.section='decorationBlueprintResources' BEGIN SELECT RAISE(ABORT,'injected'); END")}
        val before=c.load();assertTrue(runCatching{prepare()}.isFailure);assertEquals(before,c.load());assertEquals(0,commits)
        db.transaction{it.execute("DROP TRIGGER daily_fail")}
        assertEquals(1,prepare());assertEquals(2,reads);assertEquals(1,commits)
        val after=c.load();assertEquals(0,prepare());assertEquals(after,c.load());assertEquals(2,reads)
        val resources=after.domain.json().getJSONArray("decorationBlueprintResources")
        assertEquals(saved,resources.getJSONObject(0).toString());assertEquals("walls",resources.getJSONObject(1).getJSONObject("blueprint").getJSONArray("voxels").getJSONObject(0).getString("stage"))
        assertEquals(0,after.domain.json().getJSONArray("decorationRewards").length())
    }

    @Test fun theWholeMissingPoolRollsBackWhenItsSecondResourceCannotBeSaved()=withCoordinator{c,_,db->
        val before=c.load();var commits=0
        fun prepare()=DailyRewardRegistration.prepare(c,listOf("daily-one","daily-two"),{daily(it)},{"pool-$it"},at){commits++}
        db.transaction{it.execute("CREATE TRIGGER second_daily_fail BEFORE INSERT ON domain_records WHEN NEW.section='decorationBlueprintResources' AND NEW.record_key='daily-two' BEGIN SELECT RAISE(ABORT,'injected'); END")}
        assertTrue(runCatching{prepare()}.isFailure);assertEquals(before,c.load());assertEquals(0,commits)
        db.transaction{it.execute("DROP TRIGGER second_daily_fail")}
        assertEquals(2,prepare());assertEquals(1,commits)
        assertEquals(before.token.revision+1,c.load().token.revision)
        assertEquals(2,c.load().domain.json().getJSONArray("decorationBlueprintResources").length())
    }

    @Test fun anOverdueFocusWaitsForTheWholePoolAndOnlyReconcilePublishesItsCompletion()=withCoordinator{c,_,_->
        create(c);WorkspaceCommands.commit(c,"goal",WorkspaceMutation.DailyGoal("2026-12-25",1),at)
        c.begin("begin",PlanRequest("one","p","t",PlanMode.ROUNDS,1,1000,0),false,at)
        val before=c.load();val queue=CelebrationQueue();val imported=mutableListOf<Operation>()
        DailyRewardRegistration.prepare(c,listOf("daily-one","daily-two"),{daily(it)},{"pool-$it"},at+2000){imported.add(it);feed(queue,it)}
        val prepared=c.load();assertEquals(before.recovery,prepared.recovery)
        assertEquals(before.domain.json().getJSONObject("activeFocusSession").toString(),prepared.domain.json().getJSONObject("activeFocusSession").toString())
        assertEquals(before.token.revision+1,prepared.token.revision);assertEquals(0,prepared.domain.json().getJSONArray("focusHistory").length())
        assertEquals(2,prepared.domain.json().getJSONArray("decorationBlueprintResources").length());assertNull(queue.take())
        assertEquals(1,imported.size);assertTrue(imported.single().events.all{JSONObject(it).getString("type")=="DecorationBlueprintImported"})
        val completed=c.reconcile("due",at+2000);feed(queue,completed)
        assertEquals(1,completed.state.domain.json().getJSONArray("focusHistory").length())
        assertEquals(1,completed.state.domain.json().getJSONArray("decorationRewards").length())
        assertEquals(CelebrationKind.GOAL,queue.take()!!.kind)
        feed(queue,c.reconcile("due",at+2000));assertNull(queue.take())
    }

    @Test fun birthdayNeedsNoFocusOrPlotAndSameYearSettingsChangesRestartAndReplayCannotGrantTwice()=withCoordinator{c,store,_->
        val queue=CelebrationQueue()
        WorkspaceCommands.commit(c,"birthday",WorkspaceMutation.Birthday(true,12,25),at)
        assertTrue(BirthdayObservation.due(c.load().domain,at))
        val award=WorkspaceCommands.commit(c,"observe",WorkspaceMutation.ObserveBirthday,at);feed(queue,award)
        assertEquals(0,award.state.domain.json().getJSONArray("focusHistory").length())
        val reward=award.state.domain.json().getJSONArray("birthdayRewards").getJSONObject(0)
        assertTrue(reward.isNull("settlementIndex"));assertFalse(BirthdayObservation.due(award.state.domain,at))
        assertEquals(CelebrationKind.BIRTHDAY,queue.take()!!.kind)
        feed(queue,WorkspaceCommands.commit(c,"observe",WorkspaceMutation.ObserveBirthday,at+1));assertNull(queue.take())
        val reopened=FocusCoordinator(store,"rewards")
        WorkspaceCommands.commit(reopened,"off",WorkspaceMutation.Birthday(false,12,25),at)
        WorkspaceCommands.commit(reopened,"changed",WorkspaceMutation.Birthday(true,12,26),at)
        assertFalse(BirthdayObservation.due(reopened.load().domain,at+86400000))
        feed(queue,WorkspaceCommands.commit(reopened,"next-day",WorkspaceMutation.ObserveBirthday,at+86400000));assertNull(queue.take())
        assertEquals(1,reopened.load().domain.json().getJSONArray("birthdayRewards").length())
        create(reopened)
        val world=WorldFacts.from(reopened.load().domain)
        assertEquals(1,world.buildings.sumOf{it.rewards.count{r->r.blueprint.kind==WorldAssetKind.BIRTHDAY}})
    }

    @Test fun birthdaySaveFailurePublishesNoRewardOrCelebrationAndTheSameRequestCanBeRetried()=withCoordinator{c,_,db->
        WorkspaceCommands.commit(c,"birthday",WorkspaceMutation.Birthday(true,12,25),at)
        val before=c.load();val queue=CelebrationQueue()
        db.transaction{it.execute("CREATE TRIGGER reward_fail BEFORE INSERT ON domain_records WHEN NEW.section='birthdayRewards' BEGIN SELECT RAISE(ABORT,'injected'); END")}
        assertTrue(runCatching{feed(queue,WorkspaceCommands.commit(c,"observe",WorkspaceMutation.ObserveBirthday,at))}.isFailure)
        assertEquals(before,c.load());assertNull(queue.take());assertTrue(BirthdayObservation.due(c.load().domain,at))
        db.transaction{it.execute("DROP TRIGGER reward_fail")}
        feed(queue,WorkspaceCommands.commit(c,"observe",WorkspaceMutation.ObserveBirthday,at))
        assertEquals(CelebrationKind.BIRTHDAY,queue.take()!!.kind)
        feed(queue,WorkspaceCommands.commit(c,"observe",WorkspaceMutation.ObserveBirthday,at));assertNull(queue.take())
    }

    @Test fun birthdayAndHolidayAwardsStayIndependentInEachFocusModeAndRepeatedCompletionsDoNotDuplicate() {
        for(mode in PlanMode.entries)withCoordinator{c,store,_->
            create(c);WorkspaceCommands.commit(c,"birthday",WorkspaceMutation.Birthday(true,12,25),at)
            DailyRewardRegistration.prepare(c,listOf("daily-one"),{daily(it)},{"register-$it"},at)
            WorkspaceCommands.commit(c,"goal",WorkspaceMutation.DailyGoal("2026-12-25",1),at)
            val queue=CelebrationQueue()
            // Alternate which reward is first; the second must remain eligible.
            if(mode==PlanMode.ROUNDS)feed(queue,WorkspaceCommands.commit(c,"observe",WorkspaceMutation.ObserveBirthday,at))
            fun complete(coordinator:FocusCoordinator,id:String,time:Long){
                val request=PlanRequest(id,"p",if(mode==PlanMode.MINIMAL)null else "t",mode,1,1000,0)
                coordinator.begin("begin-$id",request,false,time)
                val completed=coordinator.reconcile("complete-$id",time+1000);feed(queue,completed)
                feed(queue,coordinator.reconcile("complete-$id",time+1000))
                val entry=JSONObject().put("reportId","report-$id").put("projectId","p").put("subtaskId","t").put("progressBasisPoints",0).put("rounds",1)
                if(mode==PlanMode.ROUNDS)feed(queue,coordinator.command("report-$id",DomainEngine.command("ReportSubtaskProgress","reportId" to "report-$id","subtaskId" to "t",
                    "focusSessionIds" to JSONArray(coordinator.load().recovery.plan!!.completedSessionIds),"progressBasisPoints" to 0),time+1000))
                else feed(queue,coordinator.report("report-$id",JSONArray().put(entry),JSONArray(),time+1000))
            }
            complete(c,"first",at)
            if(mode!=PlanMode.ROUNDS)feed(queue,WorkspaceCommands.commit(c,"observe",WorkspaceMutation.ObserveBirthday,at+1001))
            val reopened=FocusCoordinator(store,"rewards");complete(reopened,"second",at+2000)
            val state=reopened.load().domain.json()
            assertEquals(mode.name,1,state.getJSONArray("holidayRewards").length());assertEquals(1,state.getJSONArray("birthdayRewards").length())
            assertEquals(1,state.getJSONArray("decorationRewards").length())
            assertEquals("christmas",state.getJSONArray("holidayRewards").getJSONObject(0).getString("holidayId"))
            val kinds=generateSequence{queue.take()}.map{it.kind}.toList()
            assertEquals(1,kinds.count{it==CelebrationKind.BIRTHDAY});assertEquals(1,kinds.count{it==CelebrationKind.GOAL})
            assertEquals(0,kinds.count{it==CelebrationKind.BUILDING})
        }
    }

    @Test fun realHabitCompletionAndGoalFromTheSameCommitPlayInSequenceWithoutReplay()=withCoordinator{c,_,_->
        WorkspaceCommands.commit(c,"habit",WorkspaceMutation.CreateHabit("h","Habit","house",10),at)
        WorkspaceCommands.commit(c,"goal",WorkspaceMutation.DailyGoal("2026-12-25",10),at)
        DailyRewardRegistration.prepare(c,listOf("daily-one"),{daily(it)},{"register-$it"},at)
        c.begin("begin",PlanRequest("ten","h",null,PlanMode.ROUNDS,10,1000,0),true,at)
        val completed=c.reconcile("due",at+10000);val queue=CelebrationQueue();feed(queue,completed)
        assertEquals(10,completed.state.domain.json().getJSONArray("focusHistory").length())
        assertEquals(1,completed.state.domain.json().getJSONArray("habitBuildings").length())
        assertEquals(listOf(CelebrationKind.BUILDING,CelebrationKind.GOAL),List(2){queue.take()!!.kind})
        feed(queue,c.reconcile("due",at+10000));assertNull(queue.take())
    }

    @Test fun addingThePackagedPoolDoesNotRetrospectivelyAwardAnAlreadyReachedGoal()=withCoordinator{c,_,_->
        create(c);WorkspaceCommands.commit(c,"goal",WorkspaceMutation.DailyGoal("2026-12-25",1),at)
        c.begin("begin",PlanRequest("one","p","t",PlanMode.ROUNDS,1,1000,0),false,at)
        c.reconcile("due",at+1000)
        assertFalse(c.load().domain.json().getJSONArray("dailyGoals").getJSONObject(0).isNull("reachedAt"))
        val queue=CelebrationQueue();DailyRewardRegistration.prepare(c,listOf("daily-one"),{daily(it)},{"register-$it"},at+2000){feed(queue,it)}
        assertEquals(0,c.load().domain.json().getJSONArray("decorationRewards").length());assertNull(queue.take())
    }

    @Test fun birthdayObservationUsesTheDomainTimeZoneAndLeapDayFallback(){
        var doc=DomainEngine.initial("Asia/Shanghai")
        val instant=DomainTime.millis("2027-02-27T16:00:00.000Z")
        doc=DomainEngine.execute(doc,DomainEngine.command("ConfigureBirthday","enabled" to true,"month" to 2,"day" to 29),instant).state
        assertFalse(BirthdayObservation.due(doc,instant-1));assertTrue(BirthdayObservation.due(doc,instant))
        val granted=DomainEngine.execute(doc,WorkspaceCommands.encode(WorkspaceMutation.ObserveBirthday).command,instant)
        assertTrue(granted.ok);assertFalse(BirthdayObservation.due(granted.state,instant))
        assertFalse(BirthdayObservation.due(doc,DomainTime.millis("2028-02-28T04:00:00.000Z")))
        assertTrue(BirthdayObservation.due(doc,DomainTime.millis("2028-02-29T04:00:00.000Z")))
    }
}
