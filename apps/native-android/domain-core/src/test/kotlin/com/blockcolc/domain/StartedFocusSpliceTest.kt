package com.blockcolc.domain

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class StartedFocusSpliceTest {
    private val now=DomainTime.millis("2026-10-24T08:00:00.000Z")
    private fun large(active:String="work", importedHabit:Boolean=false):DomainDocument {
        var state=DomainEngine.initial("UTC")
        for(command in listOf(
            DomainEngine.command("CreateProject","projectId" to "work","title" to "写作😀","blueprintId" to "glaze","subtasks" to JSONArray().put(JSONObject().put("id","first").put("title","第一章"))),
            DomainEngine.command("CreateHabitProject","projectId" to "habit","title" to "阅读","blueprintId" to "glaze","targetRounds" to 10),
            DomainEngine.command("SwitchActiveProject","projectId" to active))){
            val result=DomainEngine.execute(state,command,now);check(result.ok);state=result.state
        }
        val root=state.json()
        val voxels=JSONArray()
        for(x in 0..63)for(y in 0..7)for(z in 0..7)voxels.put(JSONObject().put("x",x).put("y",y).put("z",z).put("materialId","glass").put("stage","foundation").put("buildOrder",0))
        val body=JSONObject().put("schemaVersion",1).put("id","glaze").put("title","窗台😀")
            .put("bounds",JSONObject().put("minX",0).put("maxX",63).put("minY",0).put("maxY",7).put("minZ",0).put("maxZ",7)).put("voxels",voxels)
        root.getJSONArray("buildingBlueprintResources").put(JSONObject().put("id","glaze").put("displayName","窗台😀").put("blueprint",body).put("importedAt",DomainTime.format(now)))
        root.getJSONArray("projects").getJSONObject(0).put("importedBlueprint",body)
        if(importedHabit){
            val habitBody=StrictJson.copy(body) as JSONObject
            habitBody.getJSONArray("voxels").getJSONObject(0).put("materialId","stone")
            root.getJSONArray("projects").getJSONObject(1).put("importedBlueprint",habitBody)
        }
        return DomainDocument.fromOwnedJson(root).also{assertTrue(it.canSpliceStartedFocus)}
    }
    private fun command(project:String="work",task:Any= "first",deferred:Boolean=false)=DomainEngine.command("StartFocus","sessionId" to "session","projectId" to project,"subtaskId" to task,"plannedDurationMs" to 60000L).also{
        if(deferred)it.put("marathon",true).put("deferredSettlement",true)
    }
    /** Independent old whole-tree execution uses the same business command,
     * then checks every shape, reference and canonical blueprint body. */
    private fun whole(state:DomainDocument,command:JSONObject,at:Long=now):DomainOutcome=try{
        val mutation=DomainMutation(state.json(),StrictJson.copy(command) as JSONObject,DomainTime.format(at))
        check(TaskCommands.run(mutation)||FocusCommands.run(mutation));DomainOutcome(true,DomainDocument.adopt(mutation.s),mutation.events.map(StrictJson::render))
    }catch(error:CommandFailure){DomainOutcome(false,state,error=error.code)}
    catch(error:Exception){DomainOutcome(false,state,error="INVALID_INPUT")}
    @Test fun normalHabitAndDeferredStartsMatchWholeValidationAndKeepExactBlueprintSpans(){
        for((active,cmd) in listOf("work" to command(),"habit" to command("habit",JSONObject.NULL),"work" to command(task=JSONObject.NULL,deferred=true))){
            val before=large(active);val expected=whole(before,cmd);val actual=DomainEngine.execute(before,cmd,now)
            assertTrue(actual.ok);assertEquals(expected,actual)
            assertEquals(actual.state,DomainDocument.parse(actual.state.canonical))
            for((section,id) in listOf("projects" to "work","buildingBlueprintResources" to "glaze"))assertEquals(before.blueprintCanonical(section,id),actual.state.blueprintCanonical(section,id))
            assertEquals(before.projectionJson().getJSONArray("projects").toString(),actual.state.projectionJson().getJSONArray("projects").toString())
            assertEquals("session",actual.state.activeFocusSession()!!.getString("id"))
            val exported=actual.state.json();exported.getJSONArray("projects").getJSONObject(0).getJSONObject("importedBlueprint").getJSONArray("voxels").getJSONObject(0).put("x",999)
            assertEquals(actual.state,DomainDocument.parse(actual.state.canonical))
            val finished=DomainEngine.execute(actual.state,DomainEngine.command("CompleteFocus"),now+60000)
            assertTrue(finished.error,finished.ok);assertEquals(finished.state,DomainDocument.parse(finished.state.canonical))
        }
    }
    @Test fun invalidSessionsAndReferenceFailuresRetainTheWholeExecutionResult(){
        val state=large()
        for(cmd in listOf(command("missing"),command(task="missing"),command().put("plannedDurationMs",0),command().put("deadlineAt",DomainTime.format(now)),command("habit",JSONObject.NULL))){
            val expected=whole(state,cmd);assertFalse(expected.ok);assertEquals(expected,DomainEngine.execute(state,cmd,now))
        }
        val started=DomainEngine.execute(state,command(),now).state
        assertEquals(whole(started,command()),DomainEngine.execute(started,command(),now))
    }
    @Test fun visibilityChangesReuseTheValidatedSessionRowButAnExpiredRoundStillCompletes(){
        val live=DomainEngine.execute(large(),command(),now).state
        val leave=DomainEngine.command("RecordFocusBackgrounded","reason" to "app-switch")
        val enter=DomainEngine.command("RecordFocusForegrounded")
        val away=DomainEngine.execute(live,leave,now+2_000)
        assertEquals(whole(live,leave,now+2_000),away)
        assertNotNull(away.state.activeFocusWireFrom(live))
        val back=DomainEngine.execute(away.state,enter,now+6_000)
        assertEquals(whole(away.state,enter,now+6_000),back)
        assertNotNull(back.state.activeFocusWireFrom(away.state))
        assertEquals(live,back.state)

        val expired=DomainEngine.execute(away.state,enter,now+61_000)
        assertEquals(whole(away.state,enter,now+61_000),expired)
        assertNull(expired.state.activeFocusWireFrom(away.state))
        assertNull(expired.state.activeFocusSession())
        assertEquals(1,expired.state.projectionJson().getJSONArray("focusHistory").length())
    }
    @Test fun anotherFieldChangeFallsBackAndAnInvalidActiveSessionCannotInheritValidation(){
        val state=large();val view=state.projectionJson();val before=StrictJson.render(view)
        view.put("activeFocusSession",JSONObject().put("id","broken"))
        assertThrows(StateInputException::class.java){state.updateActiveFocus(view,before)}
        view.getJSONArray("quickNotes").put(JSONObject().put("id","extra"))
        assertNull(state.updateActiveFocus(view,before));assertNull(state.activeFocusSession())
    }

    @Test fun reportingRetainsExactBodiesAndCopiesTheCorrectImportedHabitSnapshot() {
        val source = large(importedHabit = true)
        fun finished(rounds: Int, deferred: Boolean): DomainDocument {
            var current = source
            repeat(rounds) { i ->
                val at = now + i * 61_000L
                val start = command(task = if (deferred) JSONObject.NULL else "first", deferred = deferred).put("sessionId", "round-$i")
                val live = DomainEngine.execute(current, start, at)
                assertTrue(live.error, live.ok)
                val done = DomainEngine.execute(live.state, DomainEngine.command("CompleteFocus"), at + 60_000)
                assertTrue(done.error, done.ok)
                current = done.state
            }
            return current
        }
        val ordinary = DomainEngine.command("ReportSubtaskProgress", "reportId" to "report", "subtaskId" to "first",
            "focusSessionIds" to JSONArray().put("round-0"), "progressBasisPoints" to 5000)
        val marathon = DomainEngine.command("ReportMarathonFocus", "focusSessionIds" to JSONArray(List(10) { "round-$it" }),
            "entries" to JSONArray(), "habitAllocations" to JSONArray().put(JSONObject().put("projectId", "habit").put("rounds", 10)))
        val samples = listOf(finished(1, false) to ordinary, finished(10, true) to marathon)
        val at = now + 610_000
        for ((before, report) in samples) {
            val actual = DomainEngine.execute(before, report, at)
            assertTrue(actual.error, actual.ok)
            assertEquals(whole(before, report, at), actual)
            assertEquals(before.blueprintCanonical("projects", "work"), actual.state.blueprintCanonical("projects", "work"))
            assertEquals(before.blueprintCanonical("buildingBlueprintResources", "glaze"), actual.state.blueprintCanonical("buildingBlueprintResources", "glaze"))
            assertEquals(whole(actual.state, report, at), DomainEngine.execute(actual.state, report, at))
        }
        val sealed = DomainEngine.execute(samples.last().first, marathon, at).state
        val habitBody = source.blueprintCanonical("projects", "habit")
        assertNotEquals(source.blueprintCanonical("projects", "work"), habitBody)
        assertEquals(habitBody, sealed.blueprintCanonical("habitBuildings", "habit-building:habit:1"))
    }

    @Test fun selectingAndCompletingAnImportedHabitKeepExactBodiesAndRewards() {
        val source = large(importedHabit = true)
        val select = DomainEngine.command("SwitchActiveProject", "projectId" to "habit")
        val turned = DomainEngine.execute(source, select, now)
        assertTrue(turned.error, turned.ok)
        assertEquals(whole(source, select), turned)
        val habitBody = source.blueprintCanonical("projects", "habit")
        assertNotNull(habitBody)
        var current = turned.state
        repeat(10) { i ->
            val at = now + i * 61_000L
            val start = command("habit", JSONObject.NULL).put("sessionId", "habit-$i")
            val live = DomainEngine.execute(current, start, at)
            assertTrue(live.error, live.ok)
            val complete = if (i == 0) DomainEngine.command("CompleteFocusEarly", "reportId" to "early") else DomainEngine.command("CompleteFocus")
            val deadline = at + if (i == 0) 30_000L else 60_000L
            val actual = DomainEngine.execute(live.state, complete, deadline)
            assertTrue(actual.error, actual.ok)
            assertEquals(habitBody, actual.state.blueprintCanonical("projects", "habit"))
            assertEquals(source.blueprintCanonical("buildingBlueprintResources", "glaze"), actual.state.blueprintCanonical("buildingBlueprintResources", "glaze"))
            if (i == 0 || i == 7 || i == 9) assertEquals(whole(live.state, complete, deadline), actual)
            current = actual.state
        }
        assertEquals(10, current.focusControlJson().getJSONArray("focusHistory").length())
        assertEquals(habitBody, current.blueprintCanonical("habitBuildings", "habit-building:habit:1"))
        assertTrue(current.focusControlJson().getJSONArray("projects").getJSONObject(1).getJSONObject("habit").getBoolean("awaitingNextBuilding"))
    }
}
