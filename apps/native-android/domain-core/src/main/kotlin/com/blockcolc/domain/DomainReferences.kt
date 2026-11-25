package com.blockcolc.domain

import com.blockcolc.domain.DomainValidation.objects
import com.blockcolc.domain.JsonChecks.arr
import com.blockcolc.domain.JsonChecks.nil
import com.blockcolc.domain.JsonChecks.unique
import org.json.JSONObject

/** Cross-record rules ported from packages/domain/src/validation.ts, not a focus-only projection. */
internal object DomainReferences {
    fun validate(root: JSONObject) {
        fun check(ok: Boolean, path: String, detail: String) = requireInput(ok, path, detail)
        fun ids(x: JSONObject, name: String) = arr(x.get(name), name).map { it as String }
        fun namedUnique(list: List<JSONObject>, key: String, path: String) = unique(list.map { it.get(key) }, path)
        val projects = objects(root, "projects"); namedUnique(projects, "id", "$.projects[].id")
        val byProject = projects.associateBy { it.getString("id") }
        val active = projects.filter { it.getString("status") == "active" }
        check(if (root.isNull("activeProjectId")) active.isEmpty() else active.size == 1 && active[0].getString("id") == root.getString("activeProjectId"), "$.activeProjectId", "Must reference the sole active project")
        val tasks = LinkedHashMap<String, Pair<String, JSONObject>>()
        for (p in projects) for (t in objects(p, "subtasks")) check(tasks.put(t.getString("id"), p.getString("id") to t) == null, "$.projects[].subtasks[].id", "Duplicate subtask")
        val retired = ids(root, "retiredSubtaskIds"); unique(retired, "$.retiredSubtaskIds")
        check(retired.none { it in tasks }, "$.retiredSubtaskIds", "Contains current subtask")
        val conditions = objects(root, "projectConditions"); namedUnique(conditions, "projectId", "$.projectConditions[].projectId")
        check(conditions.size == projects.size, "$.projectConditions", "Exactly one condition per project required")
        val decay = root.getJSONObject("decayPolicy").getBoolean("enabled")
        for (r in conditions) {
            val p = byProject[r.getString("projectId")]; check(p != null, "$.projectConditions[].projectId", "Unknown project"); p!!
            val anchored = !r.isNull("inactivityAnchorAt"); val assessed = r.getLong("assessedMissedPlannedDays")
            check(!anchored || r.getString("inactivityAnchorAt") >= p.getString("createdAt"), "$.projectConditions[].inactivityAnchorAt", "Precedes project")
            check(anchored || assessed == 0L, "$.projectConditions[].assessedMissedPlannedDays", "No anchor")
            val awaiting = p.getString("kind") == "habit" && p.getJSONObject("habit").getBoolean("awaitingNextBuilding")
            val unfinished = p.getString("status") in listOf("active", "paused")
            check(!unfinished || !decay || awaiting || anchored, "$.projectConditions[].inactivityAnchorAt", "Unfinished project needs anchor")
            check(!(awaiting || p.getString("status") == "deleted" || !decay) || (!anchored && assessed == 0L), "$.projectConditions[]", "Decay runtime must be reset")
        }
        fun ownership(projectId: String, taskId: Any, path: String, deferred: Boolean = false) {
            val p = byProject[projectId]; check(p != null, "$path.projectId", "Unknown project"); p!!
            if (deferred && taskId == nil) return
            if (p.getString("kind") == "habit") check(taskId == nil, "$path.subtaskId", "Habit subtask must be null")
            else check(taskId is String && tasks[taskId]?.first == projectId, "$path.subtaskId", "Subtask does not belong to project")
        }
        val history = objects(root, "focusHistory"); namedUnique(history, "id", "$.focusHistory[].id"); val sessions = history.associateBy { it.getString("id") }
        for ((i, s) in history.withIndex()) {
            ownership(s.getString("projectId"), s.get("subtaskId"), "$.focusHistory[$i]", s.opt("deferredSettlement") == true)
            check(s.getString("startedAt") >= byProject.getValue(s.getString("projectId")).getString("createdAt"), "$.focusHistory[$i].startedAt", "Precedes project")
        }
        val current = if (root.isNull("activeFocusSession")) null else root.getJSONObject("activeFocusSession")
        if (current != null) {
            check(current.getString("id") !in sessions, "$.activeFocusSession.id", "Duplicate history ID")
            ownership(current.getString("projectId"), current.get("subtaskId"), "$.activeFocusSession", current.opt("deferredSettlement") == true)
            check(current.getString("projectId") == root.optString("activeProjectId") || current.opt("marathon") == true, "$.activeFocusSession.projectId", "Not active project")
            check(current.getString("startedAt") >= byProject.getValue(current.getString("projectId")).getString("createdAt"), "$.activeFocusSession.startedAt", "Precedes project")
        }
        check(history.zipWithNext().all { (a, b) -> a.getString("startedAt") <= b.getString("startedAt") }, "$.focusHistory", "History must be chronological")
        val chronological = (history + listOfNotNull(current)).sortedBy { it.getString("startedAt") }
        check(chronological.zipWithNext().all { (a, b) -> b.getString("startedAt") >= end(a) }, "$.focusHistory", "Overlapping focus intervals")
        check(current == null || history.none { current.getString("startedAt") < end(it) }, "$.activeFocusSession.startedAt", "Active focus precedes history")
        val reports = objects(root, "progressReports"); namedUnique(reports, "id", "$.progressReports[].id")
        val used = HashSet<String>(); val shared = HashSet<String>(); val reportsByTask = LinkedHashMap<String, MutableList<JSONObject>>()
        for ((i, report) in reports.withIndex()) {
            val path = "$.progressReports[$i]"; ownership(report.getString("projectId"), report.get("subtaskId"), path)
            val supported = ids(report, "focusSessionIds"); check(supported.isNotEmpty(), "$path.focusSessionIds", "Empty report"); unique(supported, "$path.focusSessionIds")
            for (id in supported) {
                val s = sessions[id]; check(s != null && countsAsFocusRound(s), "$path.focusSessionIds", "Unknown/incomplete focus"); s!!
                val explicit = report.optString("allocation") == "explicit"
                check(!explicit || s.opt("marathon") == true, "$path.focusSessionIds", "Explicit allocation requires marathon")
                if (report.opt("shared") == true) { check(id !in used, "$path.focusSessionIds", "Already consumed by regular report"); shared.add(id) }
                else {
                    check(explicit || (s.getString("projectId") == report.getString("projectId") && s.get("subtaskId") == report.get("subtaskId")), "$path.focusSessionIds", "Inconsistent ownership")
                    check(id !in used && id !in shared, "$path.focusSessionIds", "Session reused"); used.add(id)
                }
                check(s.getString("completedAt") <= report.getString("reportedAt"), "$path.reportedAt", "Precedes focus completion")
            }
            reportsByTask.getOrPut(report.getString("subtaskId")) { arrayListOf() }.add(report)
        }
        for ((taskId, pair) in tasks) {
            var progress = 0L; var at = ""
            for (r in reportsByTask[taskId].orEmpty()) {
                check(r.getString("reportedAt") >= at && r.getLong("progressBasisPoints") >= progress, "$.progressReports", "Nonmonotonic report")
                progress = r.getLong("progressBasisPoints"); at = r.getString("reportedAt")
            }
            check(pair.second.getLong("progressBasisPoints") == progress, "$.projects[].subtasks[].progressBasisPoints", "Does not match latest report")
        }
        val buildings = objects(root, "habitBuildings"); namedUnique(buildings, "id", "$.habitBuildings[].id")
        unique((projects + buildings).map { it.getLong("settlementIndex") }, "$.projects[].settlementIndex")
        val habitUsed = HashSet<String>()
        fun habitUse(id: String, projectId: String, path: String): String {
            val s = sessions[id]; check(s != null && countsAsFocusRound(s), path, "Unknown/incomplete habit focus"); s!!
            check(s.opt("marathon") == true || (s.getString("projectId") == projectId && s.isNull("subtaskId")), path, "Inconsistent habit ownership")
            check(id !in used && habitUsed.add(id), path, "Session reused by habit cycle"); return s.getString("completedAt")
        }
        for ((i, b) in buildings.withIndex()) {
            val path = "$.habitBuildings[$i]"; val projectId = b.getString("habitProjectId"); val p = byProject[projectId]
            check(p != null && p.getString("kind") == "habit", "$path.habitProjectId", "Unknown habit project"); p!!
            check(b.getLong("cycleNumber") < p.getJSONObject("habit").getLong("cycleNumber"), "$path.cycleNumber", "Cycle does not precede current")
            val latest = ids(b, "focusSessionIds").map { habitUse(it, projectId, "$path.focusSessionIds") }.maxOrNull()
            check(latest == b.getString("completedAt"), "$path.completedAt", "Wrong final completion")
        }
        for (p in projects.filter { it.getString("kind") == "habit" }) for (id in ids(p.getJSONObject("habit"), "completedFocusSessionIds")) habitUse(id, p.getString("id"), "$.projects[].habit.completedFocusSessionIds")
        for (s in history) {
            val habit = byProject.getValue(s.getString("projectId")).getString("kind") == "habit"
            check(!s.has("external") || habit, "$.focusHistory", "External focus must belong to a habit")
            check(!habit || s.opt("deferredSettlement") == true || !countsAsFocusRound(s) || s.getString("id") in habitUsed,
                "$.focusHistory", "Habit completion not assigned to cycle")
        }
        val goals = objects(root, "dailyGoals"); namedUnique(goals, "date", "$.dailyGoals[].date")
        val completedByDate = history.filter(::countsAsFocusRound).groupBy { it.getString("completedLocalDate") }
        for ((i, goal) in goals.withIndex()) {
            val completions = completedByDate[goal.getString("date")].orEmpty()
            check(!goal.getBoolean("enabled") || !goal.isNull("reachedAt") || completions.size < goal.getLong("targetPomodoros"), "$.dailyGoals[$i].reachedAt", "Enabled goal must be reached")
            val first = if(goal.isNull("reachedAt")) null else completions.minOfOrNull { it.getString("completedAt") }
            check(goal.isNull("reachedAt") || (first != null && goal.getString("reachedAt") >= first), "$.dailyGoals[$i].reachedAt", "Invalid first completion")
        }
        val decorations = objects(root, "decorationBlueprintResources"); val resources = objects(root, "buildingBlueprintResources")
        namedUnique(decorations, "id", "$.decorationBlueprintResources[].id"); namedUnique(resources, "id", "$.buildingBlueprintResources[].id")
        check(resources.size <= MAX_BUILDING_BLUEPRINTS, "$.buildingBlueprintResources", "At most $MAX_BUILDING_BLUEPRINTS entries")
        val rewards = objects(root, "decorationRewards"); namedUnique(rewards, "date", "$.decorationRewards[].date")
        val goalsByDate = goals.associateBy { it.getString("date") }; val decorationIds = decorations.map { it.getString("id") }.toSet()
        for ((i, r) in rewards.withIndex()) {
            val path = "$.decorationRewards[$i]"; check(r.getString("projectId") in byProject, "$path.projectId", "Unknown project")
            check(r.getString("resourceId") in decorationIds, "$path.resourceId", "Unknown resource")
            val g = goalsByDate[r.getString("date")]; check(g != null && !g.isNull("reachedAt"), "$path.date", "Requires reached goal"); g!!
            check(r.getString("awardedAt") >= g.getString("reachedAt"), "$path.awardedAt", "Precedes daily goal")
        }
        val holidays = objects(root, "holidayRewards"); unique(holidays.map { it.getString("holidayId") + ":" + it.getLong("year") }, "$.holidayRewards")
        for ((i, r) in holidays.withIndex()) {
            val path = "$.holidayRewards[$i]"; val s = sessions[r.getString("sourceSessionId")]
            check(s != null && s.getString("status") != "interrupted" && s.getString("projectId") == r.getString("projectId") && s.getString("completedLocalDate") == r.getString("date") && s.getString("completedAt") == r.getString("awardedAt"), path, "Invalid saved holiday completion")
            check(HolidayDates.contains(r.getString("holidayId"), r.getInt("year"), r.getString("date")), "$path.date", "Outside holiday window")
            val owner = projects.any { it.getString("id") == r.getString("projectId") && it.getLong("settlementIndex") == r.getLong("settlementIndex") } || buildings.any { it.getString("habitProjectId") == r.getString("projectId") && it.getLong("settlementIndex") == r.getLong("settlementIndex") }
            check(owner, "$path.settlementIndex", "Unknown construction plot")
        }
    }
    private fun end(s: JSONObject) = when (s.optString("status")) { "interrupted" -> s.getString("interruptedAt"); "completed", "completed-early" -> s.getString("completedAt"); else -> s.getString("endsAt") }
}
