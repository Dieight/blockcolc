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

class FocusActionsOracleTest {
    @get:Rule val temporary=TemporaryFolder()
    private class Memory(private val text:String):PreferencesStorage{override fun read()=text;override fun write(canonical:String)=error("Oracle does not change preferences")}
    @Test fun allManualFlowsMatchTheActualFormalUiOrchestratorAndApplicationService(){
        val cases=JSONObject(javaClass.getResource("/presentation-oracle.json")!!.readText()).getJSONArray("flows")
        assertEquals(96,cases.length())
        for(i in 0 until cases.length()){
            val c=cases.getJSONObject(i);val initial=DomainDocument.fromJson(c.getJSONObject("initial"));val prefs=PreferencesController(Memory(c.getJSONObject("preferences").toString()))
            JdbcStateDatabase(temporary.newFolder().toPath().resolve("state.db")).use{db->
                val store=NativeStateStore(db);store.initialize(initial);val coordinator=FocusCoordinator(store,"oracle");val actions=FocusActions(coordinator,prefs)
                val steps=c.getJSONArray("steps");val start=steps.getJSONObject(0).getLong("now")
                actions.confirm("confirm","plan",FocusDraft(c.getString("projectId"),if(c.isNull("subtaskId"))null else c.getString("subtaskId"),PlanMode.valueOf(c.getString("mode")),DraftSchedule.Rounds(c.getInt("rounds"))),start)
                actions.start("start",start)
                assertEquals(c.getString("name")+":start",steps.getJSONObject(0).getString("canonical"),summary(coordinator.load()))
                val manual=steps.getJSONObject(1);coordinator.manual("manual",manual.getString("action")=="early",false,null,null,manual.getLong("now"))
                assertEquals(c.getString("name")+":manual",manual.getString("canonical"),summary(coordinator.load()))
            }
        }
    }
    private fun summary(state:StoredState):String{
        val s=state.domain.json();val p=state.recovery.plan;val active=s.optJSONObject("activeFocusSession")
        fun rows(key:String)=s.getJSONArray(key).let{a->List(a.length()){a.getJSONObject(it)}}
        val histories=JSONArray(rows("focusHistory").map{JSONObject().put("status",it.getString("status")).put("actualDurationMs",it.getLong("actualDurationMs")).put("plannedDurationMs",it.getLong("plannedDurationMs"))})
        val reports=JSONArray(rows("progressReports").map{JSONObject().put("subtaskId",it.getString("subtaskId")).put("progressBasisPoints",it.getInt("progressBasisPoints")).put("rounds",it.getJSONArray("focusSessionIds").length())})
        val projects=JSONArray(rows("projects").map{x->JSONObject().put("id",x.getString("id")).put("status",x.getString("status"))
            .put("progress",JSONArray(x.getJSONArray("subtasks").let{a->List(a.length()){a.getJSONObject(it).getInt("progressBasisPoints")}}))
            .put("habitApplied",x.optJSONObject("habit")?.getJSONArray("completedFocusSessionIds")?.length()?:0)})
        return StrictJson.render(JSONObject().put("activeProjectId",s.get("activeProjectId"))
            .put("phase",if(active!=null)"FOCUS" else p?.phase?.name?:"IDLE").put("totalRounds",p?.totalRounds?:JSONObject.NULL)
            .put("completedRounds",p?.completedSessionIds?.size?:0).put("hasStarted",p?.hasStarted==true).put("automatic",state.recovery.automatic!=null)
            .put("mode",p?.mode?.name?:JSONObject.NULL).put("subtaskId",p?.subtaskId?:JSONObject.NULL).put("plannedDurationMs",active?.getLong("plannedDurationMs")?:JSONObject.NULL)
            .put("history",histories).put("reports",reports).put("projects",projects))
    }
}
