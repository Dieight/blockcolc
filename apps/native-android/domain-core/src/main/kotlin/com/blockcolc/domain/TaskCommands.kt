package com.blockcolc.domain

import org.json.JSONArray
import org.json.JSONObject

internal object TaskCommands {
    fun run(m: DomainMutation): Boolean = with(m) {
        when (type) {
            "AddQuickNote" -> {
                val id = text("noteId"); val value = text("text")
                require(id.length <= 128 && JsonChecks.trim(value).length <= 200 && array("quickNotes").length() < 100)
                if (objects("quickNotes").any { it.getString("id") == id }) fail("DUPLICATE_ID")
                array("quickNotes").put(JSONObject().put("id", id).put("text", JsonChecks.trim(value)).put("completed", false).put("createdAt", now)); event("QuickNotesChanged")
            }
            "SetQuickNoteCompleted", "RenameQuickNote", "DeleteQuickNote" -> {
                val id = str("noteId"); val notes = objects("quickNotes"); val note = notes.find { it.getString("id") == id } ?: fail("INVALID_INPUT")
                when (type) {
                    "SetQuickNoteCompleted" -> note.put("completed", bool("completed"))
                    "RenameQuickNote" -> { val value = JsonChecks.trim(text("text")); require(value.length <= 200); note.put("text", value) }
                    else -> s.put("quickNotes", JSONArray(notes.filter { it !== note }))
                }; event("QuickNotesChanged")
            }
            "CreateProject", "CreateHabitProject" -> {
                if (focus() != null) fail("ACTIVE_FOCUS_PREVENTS_PROJECT_SWITCH")
                if (hasUnreported()) fail("UNREPORTED_FOCUS_PREVENTS_PROJECT_SWITCH")
                val id = text("projectId"); val title = JsonChecks.trim(text("title")); val blueprintId = text("blueprintId"); val isHabit = type == "CreateHabitProject"
                val target = if (isHabit) number("targetRounds", 10, 30) else 0
                val bp = if (!c.has("importedBlueprint") || c.isNull("importedBlueprint")) JSONObject.NULL else blueprint(c.get("importedBlueprint"))
                if (bp is JSONObject) require(bp.getString("id") == blueprintId)
                if (project(id) != null) fail("DUPLICATE_ID")
                val taskList = if (isHabit) emptyList() else JsonChecks.objects(c.get("subtasks"), "$.command.subtasks")
                if (!isHabit) {
                    require(taskList.isNotEmpty()); val ids = taskList.map { it.get("id") }
                    if (ids.toSet().size != ids.size) fail("DUPLICATE_ID")
                    val unavailable = allTaskIds()
                    taskList.forEach { t -> JsonChecks.text(t.get("id"), "subtaskId"); JsonChecks.text(t.get("title"), "title"); if (t.getString("id") in unavailable) fail("DUPLICATE_ID") }
                }
                val tasks = JSONArray(taskList.mapIndexed { i, t -> JSONObject().put("id", t.get("id")).put("title", JsonChecks.trim(t.getString("title"))).put("order", i).put("progressBasisPoints", 0) })
                val h = if (isHabit) JSONObject().put("cycleNumber", 1).put("targetRounds", target).put("completedFocusSessionIds", JSONArray()).put("awaitingNextBuilding", false) else JSONObject.NULL
                val p = JSONObject().put("id", id).put("title", title).put("kind", if (isHabit) "habit" else "finite").put("settlementIndex", nextPlot()).put("blueprintId", blueprintId).put("importedBlueprint", bp)
                    .put("createdAt", now).put("status", "active").put("subtaskStructureLocked", isHabit).put("subtasks", tasks).put("habit", h)
                if (array("projects").length() == 0 && s.getJSONObject("worldSettings").getString("worldSeed") == "world-default") s.getJSONObject("worldSettings").put("worldSeed", "world-$id")
                array("projects").put(p)
                if (!s.isNull("activeProjectId")) { val before = active(); before.put("status", "paused"); event("ProjectPaused", "projectId" to before.getString("id")) }
                s.put("activeProjectId", id)
                array("projectConditions").put(JSONObject().put("projectId", id).put("conditionBasisPoints", 10000).put("inactivityAnchorAt", if (s.getJSONObject("decayPolicy").getBoolean("enabled")) now else JSONObject.NULL).put("assessedMissedPlannedDays", 0))
                event("ProjectCreated", "projectId" to id)
                if (isHabit) event("HabitBuildingSelected", "projectId" to id, "cycleNumber" to 1, "targetRounds" to target)
            }
            "SelectNextHabitBuilding" -> {
                val p = active(); val h = habit(p); require(h.getBoolean("awaitingNextBuilding"))
                if (focus() != null) fail("FOCUS_ALREADY_ACTIVE")
                val bpId = text("blueprintId"); val target = number("targetRounds", 10, 30)
                val bp = if (!c.has("importedBlueprint") || c.isNull("importedBlueprint")) JSONObject.NULL else blueprint(c.get("importedBlueprint"))
                if (bp is JSONObject) require(bp.getString("id") == bpId)
                p.put("blueprintId", bpId).put("importedBlueprint", bp); h.put("targetRounds", target).put("completedFocusSessionIds", JSONArray()).put("awaitingNextBuilding", false)
                condition(p.getString("id")).put("conditionBasisPoints", 10000).put("inactivityAnchorAt", if (s.getJSONObject("decayPolicy").getBoolean("enabled")) now else JSONObject.NULL).put("assessedMissedPlannedDays", 0)
                event("HabitBuildingSelected", "projectId" to p.getString("id"), "cycleNumber" to h.getLong("cycleNumber"), "targetRounds" to target)
            }
            "SwitchActiveProject" -> {
                val id = text("projectId")
                if (focus() != null) fail("ACTIVE_FOCUS_PREVENTS_PROJECT_SWITCH"); if (hasUnreported()) fail("UNREPORTED_FOCUS_PREVENTS_PROJECT_SWITCH")
                val p = project(id); if (p == null || p.getString("status") == "deleted") fail("PROJECT_NOT_FOUND")
                if (p.getString("status") == "monument") fail("PROJECT_IS_MONUMENT")
                if (p.getString("status") == "active") return true
                if (!s.isNull("activeProjectId")) { val before = active(); before.put("status", "paused"); event("ProjectPaused", "projectId" to before.getString("id")) }
                p.put("status", "active"); s.put("activeProjectId", id); event("ProjectActivated", "projectId" to id)
            }
            "RenameProject" -> { val p = active(); p.put("title", JsonChecks.trim(text("title"))); event("ProjectRenamed", "projectId" to p.getString("id")) }
            "DeleteActiveProject" -> {
                val p = active(); val id = p.getString("id")
                if (str("projectId") != id) fail("PROJECT_DELETE_TARGET_MISMATCH"); if (focus() != null) fail("ACTIVE_FOCUS_PREVENTS_PROJECT_DELETION")
                p.put("status", "deleted"); s.put("activeProjectId", JSONObject.NULL); condition(id).put("inactivityAnchorAt", JSONObject.NULL).put("assessedMissedPlannedDays", 0); event("ProjectDeleted", "projectId" to id)
            }
            "AddSubtask", "RemoveSubtask", "RenameSubtask", "ReorderSubtasks" -> {
                val p = active()
                if (p.getString("kind") != "finite") fail(if (type == "RenameSubtask") "SUBTASK_NOT_FOUND" else "SUBTASK_STRUCTURE_LOCKED")
                val ts = tasks(p)
                if (type in setOf("AddSubtask", "RemoveSubtask") && p.getBoolean("subtaskStructureLocked")) fail("SUBTASK_STRUCTURE_LOCKED")
                when (type) {
                    "AddSubtask" -> { val id = text("subtaskId"); val title = text("title"); if (id in allTaskIds()) fail("DUPLICATE_ID")
                        p.getJSONArray("subtasks").put(JSONObject().put("id", id).put("title", JsonChecks.trim(title)).put("order", ts.size).put("progressBasisPoints", 0)); event("SubtaskAdded", "subtaskId" to id) }
                    "RemoveSubtask" -> { val id = str("subtaskId"); val t = ts.find { it.getString("id") == id } ?: fail("SUBTASK_NOT_FOUND"); require(ts.size > 1)
                        if (focus()?.optString("subtaskId") == id) fail("SUBTASK_IN_USE")
                        if (objects("focusHistory").any { it.opt("subtaskId") == id } || objects("progressReports").any { it.getString("subtaskId") == id }) fail("SUBTASK_HAS_HISTORY")
                        p.put("subtasks", JSONArray(ts.filter { it !== t }.mapIndexed { i, v -> v.put("order", i) })); array("retiredSubtaskIds").put(id); event("SubtaskRemoved", "subtaskId" to id) }
                    "RenameSubtask" -> { val title = text("title"); val t = ts.find { it.getString("id") == str("subtaskId") } ?: fail("SUBTASK_NOT_FOUND"); t.put("title", JsonChecks.trim(title)); event("SubtaskRenamed", "subtaskId" to t.getString("id")) }
                    else -> { val order = ids(c.getJSONArray("orderedSubtaskIds")); require(order.size == ts.size && order.toSet() == ts.map { it.getString("id") }.toSet())
                        val byId = ts.associateBy { it.getString("id") }; p.put("subtasks", JSONArray(order.mapIndexed { i, id -> byId.getValue(id).put("order", i) })); event("SubtasksReordered") }
                }
            }
            "ImportDecorationBlueprint", "ImportBuildingBlueprint" -> {
                val decoration = type == "ImportDecorationBlueprint"; val bp = blueprint(c.get("blueprint"), decoration); val id = bp.getString("id")
                val key = if (decoration) "decorationBlueprintResources" else "buildingBlueprintResources"; val event = if (decoration) "DecorationBlueprintImported" else "BuildingBlueprintImported"
                val existing = objects(key).find { it.getString("id") == id }
                if (existing != null) {
                    val before = existing.getJSONObject("blueprint"); if (StrictJson.render(before) == StrictJson.render(bp)) return true
                    require(enrichment(before, bp)); existing.put("blueprint", bp)
                } else {
                    require(decoration || array(key).length() < MAX_BUILDING_BLUEPRINTS)
                    val r = JSONObject().put("id", id).put("blueprint", bp).put("importedAt", now); if (!decoration) r.put("displayName", bp.getString("title")); array(key).put(r)
                }; event(event, "resourceId" to id)
            }
            "RenameBuildingBlueprint" -> {
                val id = text("blueprintId"); val value = JsonChecks.trim(text("displayName")); require(value.length <= 80)
                val r = objects("buildingBlueprintResources").find { it.getString("id") == id } ?: fail("INVALID_INPUT")
                if (r.getString("displayName") == value) return true
                r.put("displayName", value); event("BuildingBlueprintRenamed", "resourceId" to id, "displayName" to value)
            }
            "DeleteBuildingBlueprint" -> {
                val id = text("blueprintId"); val rs = objects("buildingBlueprintResources"); if (rs.none { it.getString("id") == id }) return true
                s.put("buildingBlueprintResources", JSONArray(rs.filter { it.getString("id") != id })); event("BuildingBlueprintDeleted", "resourceId" to id)
            }
            else -> return false
        }; true
    }
    private fun enrichment(before: JSONObject, after: JSONObject): Boolean {
        fun strip(bp: JSONObject): JSONObject = (StrictJson.copy(bp) as JSONObject).also { x -> val vs = x.getJSONArray("voxels"); for (i in 0 until vs.length()) for (key in listOf("sourceBlockState", "sign", "campfire")) vs.getJSONObject(i).remove(key) }
        if (StrictJson.render(strip(before)) != StrictJson.render(strip(after))) return false
        val a = before.getJSONArray("voxels"); val b = after.getJSONArray("voxels"); var enriched = false
        for (i in 0 until a.length()) for (key in listOf("sourceBlockState", "sign", "campfire")) {
            val x = a.getJSONObject(i); val y = b.getJSONObject(i)
            if (!x.has(key)) { if (y.has(key)) enriched = true }
            else if (!y.has(key) || StrictJson.render(x.get(key)) != StrictJson.render(y.get(key))) return false
        }
        return enriched
    }
}
