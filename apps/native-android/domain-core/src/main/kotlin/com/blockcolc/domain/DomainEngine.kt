package com.blockcolc.domain

import org.json.JSONArray
import org.json.JSONObject

data class DomainOutcome(val ok: Boolean, val state: DomainDocument, val events: List<String> = emptyList(), val error: String? = null)
internal class CommandFailure(val code: String) : RuntimeException(code)

/** One pure executor; foreground, scheduler and notifications use exactly these commands. */
object DomainEngine {
    fun initial(timeZone: String = "UTC", restWeekdays: List<Int> = listOf(0, 6)): DomainDocument {
        DomainTime.zone(timeZone); require(restWeekdays.all { it in 0..6 } && restWeekdays.toSet().size == restWeekdays.size)
        val s = JSONObject().put("schemaVersion", 15).put("activeProjectId", JSONObject.NULL).put("activeFocusSession", JSONObject.NULL)
        for (name in DomainValidation.ARRAYS.split(' ')) s.put(name, JSONArray())
        s.put("calendar", JSONObject().put("timeZone", timeZone).put("restWeekdays", JSONArray(restWeekdays.sorted())))
        s.put("decayPolicy", JSONObject().put("enabled", false).put("gracePlannedDays", 2).put("repairMultiplierBasisPoints", 20000).put("damagePerMissedPlannedDayBasisPoints", JSONObject.NULL))
        s.put("focusIntegrityPolicy", JSONObject().put("enabled", false).put("maxEffectiveExcursions", 3).put("excursionThresholdSeconds", 3))
        s.put("worldSettings", JSONObject().put("worldSeed", "world-default").put("terrainGenerationVersion", 4).put("environmentStyle", "ocean-island"))
        s.put("birthday", JSONObject().put("enabled", false).put("month", 1).put("day", 1))
        return DomainDocument.adopt(s)
    }
    fun execute(state: DomainDocument, command: JSONObject, nowMs: Long): DomainOutcome = PipelineCost.section("domain.execute") { try {
        if(state.canSpliceStartedFocus&&command.opt("type")=="StartFocus"){
            val view=state.projectionJson();val before=StrictJson.render(view)
            val mutation=DomainMutation(view,StrictJson.copy(command) as JSONObject,DomainTime.format(nowMs))
            check(FocusCommands.run(mutation))
            state.startedFocus(view,before)?.let{return@section DomainOutcome(true,it,mutation.events.map(StrictJson::render))}
            // A future command extension that changes another field must use
            // full adoption rather than silently discarding that change.
        }
        val mutation = DomainMutation(state.json(), StrictJson.copy(command) as JSONObject, DomainTime.format(nowMs))
        val handled = TaskCommands.run(mutation) || FocusCommands.run(mutation) || PolicyCommands.run(mutation)
        require(handled) { "Unknown command" }
        val next = DomainDocument.adopt(mutation.s)
        DomainOutcome(true, if (next == state) state else next, mutation.events.map(StrictJson::render))
    } catch (e: CommandFailure) { DomainOutcome(false, state, error = e.code) }
    catch (e: Exception) { DomainOutcome(false, state, error = "INVALID_INPUT") } }
    /** Package installation applies only decoration imports. Each command
     * checks and normalizes its own body as usual. Only the finished set of
     * resources needs a new whole-document validation. */
    fun importDecorationBlueprints(state:DomainDocument,blueprints:List<JSONObject>,nowMs:Long):DomainOutcome =
        PipelineCost.section("domain.import-decoration-pool"){
            try{
                require(blueprints.size in 1..256)
                val root=state.json()
                val now=DomainTime.format(nowMs)
                val events=ArrayList<String>()
                for(blueprint in blueprints){
                    val mutation=DomainMutation(root,command("ImportDecorationBlueprint","blueprint" to blueprint),now)
                    check(TaskCommands.run(mutation))
                    events.addAll(mutation.events.map(StrictJson::render))
                }
                val next=DomainDocument.adopt(root)
                DomainOutcome(true,if(next==state)state else next,events)
            }catch(e:CommandFailure){DomainOutcome(false,state,error=e.code)}
            catch(e:Exception){DomainOutcome(false,state,error="INVALID_INPUT")}
        }
    fun command(type: String, vararg fields: Pair<String, Any?>) = JSONObject().put("type", type).also { c -> fields.forEach { (key, value) -> c.put(key, value ?: JSONObject.NULL) } }
    fun progress(project: JSONObject): Int = if (project.getString("kind") == "habit") {
        val h = project.getJSONObject("habit"); if (h.getBoolean("awaitingNextBuilding")) 10000 else h.getJSONArray("completedFocusSessionIds").length() * 10000 / h.getInt("targetRounds")
    } else {
        val tasks = JsonChecks.objects(project.get("subtasks"), "subtasks"); if (tasks.isEmpty()) 0 else (tasks.sumOf { it.getLong("progressBasisPoints") } / tasks.size).toInt()
    }
}

internal class DomainMutation(val s: JSONObject, val c: JSONObject, val now: String) {
    val events = arrayListOf<JSONObject>()
    val type get() = str("type")
    fun str(key: String) = JsonChecks.string(c.get(key), "$.command.$key")
    fun text(key: String) = JsonChecks.text(c.get(key), "$.command.$key")
    fun number(key: String, min: Long = 0, max: Long = JsonChecks.SAFE) = JsonChecks.int(c.get(key), "$.command.$key", min, max)
    fun bool(key: String) = JsonChecks.bool(c.get(key), "$.command.$key")
    fun objects(key: String) = JsonChecks.objects(s.get(key), "$.$key")
    fun array(key: String) = s.getJSONArray(key)
    fun ids(a: JSONArray): List<String> = (0 until a.length()).map { JsonChecks.string(a.get(it), "$.ids[$it]") }
    fun fail(code: String): Nothing = throw CommandFailure(code)
    fun event(type: String, vararg values: Pair<String, Any?>) { events.add(DomainEngine.command(type, *values)) }
    fun project(id: String) = objects("projects").find { it.getString("id") == id }
    fun active(): JSONObject {
        if (s.isNull("activeProjectId")) fail("PROJECT_NOT_FOUND")
        val p = project(s.getString("activeProjectId")) ?: error("Missing project")
        if (p.getString("status") != "active") fail("PROJECT_IS_MONUMENT"); return p
    }
    fun focus() = if (s.isNull("activeFocusSession")) null else s.getJSONObject("activeFocusSession")
    fun condition(id: String) = objects("projectConditions").first { it.getString("projectId") == id }
    fun habit(p: JSONObject): JSONObject { require(p.getString("kind") == "habit" && !p.isNull("habit")); return p.getJSONObject("habit") }
    fun tasks(p: JSONObject) = JsonChecks.objects(p.get("subtasks"), "subtasks")
    fun nextPlot(): Long = (objects("projects") + objects("habitBuildings")).maxOfOrNull { it.getLong("settlementIndex") }?.plus(1) ?: 0
    fun allTaskIds() = ids(array("retiredSubtaskIds")).toSet() + objects("projects").flatMap { tasks(it).map { t -> t.getString("id") } }
    fun hasUnreported(): Boolean {
        if (s.isNull("activeProjectId")) return false
        val id = s.getString("activeProjectId"); if (project(id)?.getString("kind") == "habit") return false
        val reported = objects("progressReports").flatMap { ids(it.getJSONArray("focusSessionIds")) }.toSet()
        return objects("focusHistory").any { it.getString("status") == "completed" && it.getString("projectId") == id && it.opt("marathon") != true && it.getString("id") !in reported }
    }
    fun ensureGoal(date: String): JSONObject = objects("dailyGoals").find { it.getString("date") == date } ?: JSONObject().put("date", date).put("targetPomodoros", 8).put("reachedAt", JSONObject.NULL).put("enabled", true).also { array("dailyGoals").put(it) }
    fun completions(date: String) = objects("focusHistory").filter { it.getString("status") != "interrupted" && it.getString("completedLocalDate") == date }
    fun blueprint(value: Any, decoration: Boolean = false): JSONObject {
        val bp = StrictJson.copy(value) as JSONObject; DomainValidation.blueprint(bp, "$.command.blueprint", decoration); return bp
    }
    fun base(active: JSONObject) = (StrictJson.copy(active) as JSONObject).also { it.remove("integrity") }
    fun localeCompare(a: String, b: String): Int = java.text.Collator.getInstance(java.util.Locale.US).compare(a, b)
}
