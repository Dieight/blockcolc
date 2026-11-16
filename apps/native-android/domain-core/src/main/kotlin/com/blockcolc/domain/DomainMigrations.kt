package com.blockcolc.domain

import com.blockcolc.domain.JsonChecks.arr
import com.blockcolc.domain.JsonChecks.choice
import com.blockcolc.domain.JsonChecks.instant
import com.blockcolc.domain.JsonChecks.millis
import com.blockcolc.domain.JsonChecks.obj
import com.blockcolc.domain.JsonChecks.shape
import com.blockcolc.domain.JsonChecks.text
import com.blockcolc.domain.JsonChecks.trim
import org.json.JSONArray
import org.json.JSONObject

/** Legacy domain migration is separate from retired V1–V3 world generation. */
internal object DomainMigrations {
    fun current(root: JSONObject): JSONObject {
        fun version() = root.opt("schemaVersion").let { if (it is Number && it.toDouble() == it.toInt().toDouble()) it.toInt() else -1 }
        fun bump(to: Int) { root.put("schemaVersion", to) }
        fun entries(name: String) = arr(root.get(name), "$.$name").mapIndexed { i, v -> obj(v, "$.$name[$i]") }
        if (version() == 1) {
            shape(root, "$", "schemaVersion projects activeProjectId retiredSubtaskIds activeFocusSession focusHistory progressReports dailyGoals calendar decayPolicy projectConditions", "buildingBlueprintResources")
            for (p in entries("projects")) {
                shape(p, "$.projects[]", "id title blueprintId createdAt status subtaskStructureLocked subtasks", "importedBlueprint")
                if (!p.has("importedBlueprint")) p.put("importedBlueprint", JSONObject.NULL)
            }
            if (!root.isNull("activeFocusSession")) {
                val s = shape(root.get("activeFocusSession"), "$.activeFocusSession", "id projectId subtaskId startedAt endsAt plannedDurationMs timeZoneAtStart")
                s.put("integrity", JSONObject().put("effectiveExcursions", 0).put("backgroundedAt", JSONObject.NULL).put("backgroundReason", JSONObject.NULL).put("exemptionPending", false))
            }
            for (s in entries("focusHistory")) {
                val status = choice(s.get("status"), "$.focusHistory[].status", "completed interrupted")
                shape(s, "$.focusHistory[]", "id projectId subtaskId startedAt endsAt plannedDurationMs timeZoneAtStart status " + if (status == "completed") "completedAt completedLocalDate" else "interruptedAt")
                if (status == "interrupted") s.put("interruptionReason", "user-cancelled")
            }
            root.put("focusIntegrityPolicy", JSONObject().put("enabled", true).put("maxEffectiveExcursions", 3)); bump(2)
        }
        if (version() == 2) {
            if (!root.has("decorationBlueprintResources")) root.put("decorationBlueprintResources", JSONArray())
            if (!root.has("decorationRewards")) root.put("decorationRewards", JSONArray())
            for (s in entries("focusHistory")) {
                val status = choice(s.get("status"), "$.focusHistory[].status", "completed interrupted")
                if (status == "completed") s.put("actualDurationMs", s.get("plannedDurationMs"))
                else {
                    s.put("interruptionCategory", JSONObject.NULL)
                    s.put("actualDurationMs", millis(instant(s.get("interruptedAt"), "$.focusHistory[].interruptedAt")) - millis(instant(s.get("startedAt"), "$.focusHistory[].startedAt")))
                }
            }
            bump(3)
        }
        if (version() == 3) { if (!root.has("buildingBlueprintResources")) root.put("buildingBlueprintResources", JSONArray()); bump(4) }
        if (version() == 4) {
            entries("projects").forEachIndexed { i, p -> p.put("kind", "finite").put("habit", JSONObject.NULL).put("settlementIndex", i) }
            root.put("habitBuildings", JSONArray()); bump(5)
        }
        if (version() == 5) {
            val first = (root.opt("projects") as? JSONArray)?.let { a -> (0 until a.length()).mapNotNull { a.opt(it) as? JSONObject }.firstOrNull { it.opt("id") is String }?.optString("id") }
            root.put("worldSettings", JSONObject().put("worldSeed", if (first != null && trim(first).isNotEmpty()) "legacy-$first" else "world-default").put("terrainGenerationVersion", 2).put("environmentStyle", "natural-valley")); bump(6)
        }
        if (version() == 6) {
            for (r in entries("buildingBlueprintResources")) {
                shape(r, "$.buildingBlueprintResources[]", "id blueprint importedAt")
                val blueprint = obj(r.get("blueprint"), "$.buildingBlueprintResources[].blueprint")
                r.put("displayName", trim(text(blueprint.get("title"), "$.buildingBlueprintResources[].blueprint.title")).take(80))
            }
            val completions = entries("focusHistory").filter { it.optString("status") in listOf("completed", "completed-early") && it.opt("completedLocalDate") is String && it.opt("completedAt") is String }.groupBy { it.getString("completedLocalDate") }
            for (g in entries("dailyGoals")) {
                val target = g.opt("targetPomodoros") as? Number
                if (g.opt("enabled") == true && g.opt("reachedAt") == JSONObject.NULL && g.opt("date") is String && target != null && target.toDouble() > 0 && target.toDouble() == kotlin.math.floor(target.toDouble())) {
                    val dates = completions[g.getString("date")].orEmpty().map { it.getString("completedAt") }.sorted()
                    if (target.toDouble() <= dates.size.toDouble()) g.put("reachedAt", dates[target.toInt() - 1])
                }
            }
            obj(root.get("worldSettings"), "$.worldSettings").put("terrainGenerationVersion", 3); bump(7)
        }
        if (version() == 7) {
            val w = obj(root.get("worldSettings"), "$.worldSettings")
            if (w.opt("terrainGenerationVersion").let { it is Number && it.toDouble() in listOf(2.0, 3.0) }) w.put("terrainGenerationVersion", 4)
            val reports = (root.opt("progressReports") as? JSONArray)?.let { (0 until it.length()).map { i -> it.get(i) } }.orEmpty()
            val uses = HashMap<String, Int>()
            for (r in reports.filterIsInstance<JSONObject>()) (r.opt("focusSessionIds") as? JSONArray)?.let { ids -> for (i in 0 until ids.length()) (ids.opt(i) as? String)?.let { id -> uses[id] = (uses[id] ?: 0) + 1 } }
            for (r in reports.filterIsInstance<JSONObject>()) (r.opt("focusSessionIds") as? JSONArray)?.let { ids -> if ((0 until ids.length()).any { (uses[ids.opt(it)] ?: 0) > 1 }) r.put("shared", true) }
            bump(8)
        }
        if (version() == 8) bump(9)
        if (version() == 9) bump(10)
        if (version() == 10) {
            root.remove("todayNextSteps")
            val sessions = (root.opt("focusHistory") as? JSONArray)?.let { a -> (0 until a.length()).map { a.get(it) } }.orEmpty() + listOf(root.opt("activeFocusSession"))
            requireInput(sessions.none { it is JSONObject && it.has("deferredSettlement") }, "$.schemaVersion", "Deferred settlement requires schema 11")
            bump(11)
        }
        if (version() == 11) {
            shape(root.get("focusIntegrityPolicy"), "$.focusIntegrityPolicy", "enabled maxEffectiveExcursions").put("excursionThresholdSeconds", 3); bump(12)
        }
        if (version() == 12) { requireInput(!root.has("holidayRewards"), "$.holidayRewards", "Requires schema 13"); root.put("holidayRewards", JSONArray()); bump(13) }
        if (version() == 13) { requireInput(!root.has("quickNotes"), "$.quickNotes", "Requires schema 14"); root.put("quickNotes", JSONArray()); bump(14) }
        if (version() == 14) {
            requireInput(!root.has("birthday") && !root.has("birthdayRewards"), "$.birthday", "Requires schema 15")
            root.put("birthday", JSONObject().put("enabled", false).put("month", 1).put("day", 1)); root.put("birthdayRewards", JSONArray()); bump(15)
        }
        return root
    }
}
