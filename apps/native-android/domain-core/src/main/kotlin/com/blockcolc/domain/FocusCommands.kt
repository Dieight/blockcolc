package com.blockcolc.domain

import org.json.JSONArray
import org.json.JSONObject

internal object FocusCommands {
    fun run(m: DomainMutation): Boolean = with(m) {
        when (type) {
            "StartFocus" -> {
                if (c.has("deferredSettlement")) require(c.get("deferredSettlement") == true)
                val deferred = c.opt("deferredSettlement") == true
                if (deferred) require(c.opt("marathon") == true && c.get("subtaskId") == JSONObject.NULL)
                val p = if (c.has("projectId")) project(str("projectId")) else active()
                if (p == null || c.has("projectId") && p.getString("status") == "deleted") fail("PROJECT_NOT_FOUND")
                if (c.has("projectId") && p.getString("status") == "monument") fail("PROJECT_IS_MONUMENT")
                if (focus() != null) fail("FOCUS_ALREADY_ACTIVE")
                val id = text("sessionId"); if (objects("focusHistory").any { it.getString("id") == id }) fail("DUPLICATE_ID")
                val taskId = c.get("subtaskId")
                if (p.getString("kind") == "habit") {
                    if (taskId != JSONObject.NULL) fail("SUBTASK_NOT_FOUND")
                    if (habit(p).getBoolean("awaitingNextBuilding") && !deferred) fail("HABIT_BUILDING_SELECTION_REQUIRED")
                } else if (!deferred && (taskId !is String || tasks(p).none { it.getString("id") == taskId })) fail("SUBTASK_NOT_FOUND")
                val nominal = number("plannedDurationMs", 1)
                val deadline = if (c.has("deadlineAt")) runCatching { java.time.Instant.parse(str("deadlineAt")).toEpochMilli() }.getOrElse { fail("FOCUS_DEADLINE_PASSED") } else Long.MAX_VALUE
                val start = DomainTime.millis(now); if (deadline <= start) fail("FOCUS_DEADLINE_PASSED")
                val duration = minOf(nominal, if (deadline == Long.MAX_VALUE) nominal else deadline - start); val end = DomainTime.format(Math.addExact(start, duration))
                val a = JSONObject().put("id", id).put("projectId", p.getString("id")).put("subtaskId", taskId).put("startedAt", now).put("endsAt", end).put("plannedDurationMs", duration).put("timeZoneAtStart", s.getJSONObject("calendar").getString("timeZone"))
                    .put("integrity", JSONObject().put("effectiveExcursions", 0).put("backgroundedAt", JSONObject.NULL).put("backgroundReason", JSONObject.NULL).put("exemptionPending", false))
                if (c.opt("marathon") == true) a.put("marathon", true); if (deferred) a.put("deferredSettlement", true)
                s.put("activeFocusSession", a); event("FocusStarted", "sessionId" to id, "endsAt" to end)
            }
            "CompleteFocus" -> {
                val a = focus() ?: fail("FOCUS_NOT_ACTIVE"); if (DomainTime.millis(now) < DomainTime.millis(a.getString("endsAt"))) fail("FOCUS_NOT_ELAPSED")
                complete(m, a)
            }
            "CompleteFocusEarly" -> {
                val a = focus() ?: fail("FOCUS_NOT_ACTIVE"); if (DomainTime.millis(now) >= DomainTime.millis(a.getString("endsAt"))) fail("FOCUS_ALREADY_ELAPSED")
                val reportId = text("reportId"); val p = project(a.getString("projectId")) ?: fail("PROJECT_NOT_FOUND")
                val actual = maxOf(0, DomainTime.millis(now) - DomainTime.millis(a.getString("startedAt")))
                val session = base(a).put("status", "completed-early").put("completedAt", now).put("completedLocalDate", DomainTime.localDate(now, a.getString("timeZoneAtStart"))).put("actualDurationMs", actual)
                if (p.getString("kind") == "habit" && a.opt("deferredSettlement") != true) {
                    array("focusHistory").put(session); s.put("activeFocusSession", JSONObject.NULL); event("FocusCompletedEarly", "sessionId" to a.getString("id"), "subtaskId" to null, "actualDurationMs" to actual)
                    RewardRules.repair(m, p.getString("id"), now); RewardRules.advanceHabit(m, p, session); RewardRules.reach(m, session.getString("completedLocalDate"), now, p.getString("id")); return true
                }
                if (objects("progressReports").any { it.getString("id") == reportId }) fail("DUPLICATE_ID")
                if (a.opt("marathon") == true) {
                    array("focusHistory").put(session); s.put("activeFocusSession", JSONObject.NULL); event("FocusCompletedEarly", "sessionId" to a.getString("id"), "subtaskId" to null, "actualDurationMs" to actual)
                    RewardRules.repair(m, p.getString("id"), now); RewardRules.reach(m, session.getString("completedLocalDate"), now, p.getString("id")); return true
                }
                val t = tasks(p).find { it.getString("id") == a.opt("subtaskId") } ?: fail("SUBTASK_NOT_FOUND")
                array("focusHistory").put(session); s.put("activeFocusSession", JSONObject.NULL); t.put("progressBasisPoints", 10000)
                array("progressReports").put(JSONObject().put("id", reportId).put("projectId", p.getString("id")).put("subtaskId", t.getString("id")).put("focusSessionIds", JSONArray().put(a.getString("id"))).put("progressBasisPoints", 10000).put("reportedAt", now))
                event("FocusCompletedEarly", "sessionId" to a.getString("id"), "subtaskId" to t.getString("id"), "actualDurationMs" to actual)
                event("SubtaskProgressReported", "subtaskId" to t.getString("id"), "progressBasisPoints" to 10000)
                lock(m, p, 10000); RewardRules.repair(m, p.getString("id"), now); seal(m, p)
                RewardRules.reach(m, session.getString("completedLocalDate"), now, p.getString("id"))
            }
            "CancelFocus" -> {
                val a = focus() ?: fail("FOCUS_NOT_ACTIVE"); if (DomainTime.millis(now) >= DomainTime.millis(a.getString("endsAt"))) fail("FOCUS_ALREADY_ELAPSED")
                val category = if (!c.has("interruptionCategory") || c.isNull("interruptionCategory")) JSONObject.NULL else JsonChecks.choice(c.get("interruptionCategory"), "category", "external-interruption task-blocked fatigue priority-changed device-or-app other")
                val session = base(a).put("status", "interrupted").put("interruptedAt", now).put("interruptionReason", "user-cancelled").put("interruptionCategory", category).put("actualDurationMs", maxOf(0, DomainTime.millis(now) - DomainTime.millis(a.getString("startedAt"))))
                if (c.has("interruptionNote")) { val note = JsonChecks.trim(text("interruptionNote")); require(note.length <= 200); session.put("interruptionNote", note) }
                array("focusHistory").put(session); s.put("activeFocusSession", JSONObject.NULL); event("FocusInterrupted", "sessionId" to a.getString("id"), "reason" to "user-cancelled", "category" to category)
            }
            "ConfigureFocusIntegrity" -> {
                val enabled = bool("enabled"); val max = number("maxEffectiveExcursions", 1, 5)
                val threshold = if (c.has("excursionThresholdSeconds")) number("excursionThresholdSeconds", 1, 60) else s.getJSONObject("focusIntegrityPolicy").getLong("excursionThresholdSeconds")
                s.put("focusIntegrityPolicy", JSONObject().put("enabled", enabled).put("maxEffectiveExcursions", max).put("excursionThresholdSeconds", threshold))
                event("FocusIntegrityConfigured", "enabled" to enabled, "maxEffectiveExcursions" to max, "excursionThresholdSeconds" to threshold)
            }
            "GrantFocusLifecycleExemption" -> {
                val a = focus() ?: return true; val integrity = a.getJSONObject("integrity"); if (integrity.getBoolean("exemptionPending")) return true
                integrity.put("exemptionPending", true); event("FocusLifecycleExemptionGranted", "sessionId" to a.getString("id"))
            }
            "RecordFocusBackgrounded", "RecordFocusForegrounded" -> {
                val a = focus() ?: return true
                if (DomainTime.millis(now) >= DomainTime.millis(a.getString("endsAt"))) { complete(m, a); return true }
                val i = a.getJSONObject("integrity")
                if (type == "RecordFocusBackgrounded") {
                    if (!i.isNull("backgroundedAt")) return true
                    val reason = if (i.getBoolean("exemptionPending")) "system-exempt" else str("reason")
                    i.put("exemptionPending", false).put("backgroundedAt", now).put("backgroundReason", reason)
                    event("FocusBackgrounded", "sessionId" to a.getString("id"), "reason" to reason, "backgroundedAt" to now)
                } else {
                    if (i.isNull("backgroundedAt") || i.isNull("backgroundReason")) return true
                    val from = i.getString("backgroundedAt"); val reason = i.getString("backgroundReason"); i.put("backgroundedAt", JSONObject.NULL).put("backgroundReason", JSONObject.NULL)
                    val policy = s.getJSONObject("focusIntegrityPolicy")
                    val counts = policy.getBoolean("enabled") && DomainTime.millis(now) - DomainTime.millis(from) > policy.getLong("excursionThresholdSeconds") * 1000 && reason in setOf("app-switch", "web-visibility")
                    if (!counts) return true
                    val excursions = i.getLong("effectiveExcursions") + 1; i.put("effectiveExcursions", excursions)
                    event("FocusExcursionRecorded", "sessionId" to a.getString("id"), "effectiveExcursions" to excursions, "maxEffectiveExcursions" to policy.getLong("maxEffectiveExcursions"))
                    if (excursions < policy.getLong("maxEffectiveExcursions")) return true
                    array("focusHistory").put(base(a).put("status", "interrupted").put("interruptedAt", now).put("interruptionReason", "app-switch-limit").put("interruptionCategory", JSONObject.NULL).put("actualDurationMs", maxOf(0, DomainTime.millis(now) - DomainTime.millis(a.getString("startedAt")))))
                    s.put("activeFocusSession", JSONObject.NULL); event("FocusInterrupted", "sessionId" to a.getString("id"), "reason" to "app-switch-limit", "category" to null)
                }
            }
            "ReportSubtaskProgress" -> {
                val p = active(); val progress = number("progressBasisPoints", 0, 10000); val reportId = text("reportId")
                if (objects("progressReports").any { it.getString("id") == reportId }) fail("DUPLICATE_ID")
                val t = tasks(p).find { it.getString("id") == str("subtaskId") } ?: fail("SUBTASK_NOT_FOUND")
                if (progress < t.getLong("progressBasisPoints")) fail("PROGRESS_CANNOT_DECREASE")
                val supporting = ids(c.getJSONArray("focusSessionIds")); if (supporting.isEmpty() || supporting.toSet().size != supporting.size) fail("PROGRESS_REQUIRES_COMPLETED_FOCUS")
                val history = objects("focusHistory").associateBy { it.getString("id") }
                if (supporting.any { id -> val f = history[id]; f == null || f.getString("status") != "completed" || f.getString("projectId") != p.getString("id") || f.opt("subtaskId") != t.getString("id") }) fail("PROGRESS_REQUIRES_COMPLETED_FOCUS")
                val consumed = objects("progressReports").flatMap { ids(it.getJSONArray("focusSessionIds")) }.toSet(); if (supporting.any { it in consumed }) fail("FOCUS_ALREADY_REPORTED")
                val wouldSeal = progress == 10000L && tasks(p).all { it === t || it.getLong("progressBasisPoints") == 10000L }
                if (wouldSeal && focus() != null) fail("ACTIVE_FOCUS_PREVENTS_SEALING")
                t.put("progressBasisPoints", progress)
                array("progressReports").put(JSONObject().put("id", reportId).put("projectId", p.getString("id")).put("subtaskId", t.getString("id")).put("focusSessionIds", JSONArray(supporting)).put("progressBasisPoints", progress).put("reportedAt", now))
                event("SubtaskProgressReported", "subtaskId" to t.getString("id"), "progressBasisPoints" to progress); lock(m, p, progress)
                if (wouldSeal) seal(m, p)
            }
            "ReportMarathonFocus" -> marathon(m)
            else -> return false
        }; true
    }
    fun complete(m: DomainMutation, active: JSONObject) = with(m) {
        val at = active.getString("endsAt"); val session = base(active).put("status", "completed").put("completedAt", at).put("completedLocalDate", DomainTime.localDate(at, active.getString("timeZoneAtStart"))).put("actualDurationMs", active.getLong("plannedDurationMs"))
        array("focusHistory").put(session); s.put("activeFocusSession", JSONObject.NULL); event("FocusCompleted", "sessionId" to session.getString("id"))
        RewardRules.repair(m, session.getString("projectId"), at)
        val p = project(session.getString("projectId")) ?: error("Missing completed project")
        if (p.getString("kind") == "habit" && session.opt("deferredSettlement") != true) RewardRules.advanceHabit(m, p, session)
        RewardRules.reach(m, session.getString("completedLocalDate"), at, session.getString("projectId"))
    }
    private fun lock(m: DomainMutation, project: JSONObject, progress: Long) { if (progress > 0 && !project.getBoolean("subtaskStructureLocked")) { project.put("subtaskStructureLocked", true); m.event("SubtaskStructureLocked") } }
    private fun seal(m: DomainMutation, p: JSONObject) = with(m) {
        if (p.getString("status") == "monument" || tasks(p).any { it.getLong("progressBasisPoints") != 10000L }) return
        if (focus() != null) fail("ACTIVE_FOCUS_PREVENTS_SEALING")
        p.put("status", "monument"); if (s.opt("activeProjectId") == p.getString("id")) s.put("activeProjectId", JSONObject.NULL)
        event("ProjectSealedAsMonument", "projectId" to p.getString("id"))
    }
    private fun marathon(m: DomainMutation) = with(m) {
        val ids = ids(c.getJSONArray("focusSessionIds")); if (ids.isEmpty() || ids.toSet().size != ids.size) fail("PROGRESS_REQUIRES_COMPLETED_FOCUS")
        val history = objects("focusHistory").associateBy { it.getString("id") }
        val sessions = ids.map { id -> val f = history[id]; if (f == null || f.getString("status") !in setOf("completed", "completed-early") || f.opt("marathon") != true) fail("PROGRESS_REQUIRES_COMPLETED_FOCUS"); f }
        val host = sessions[0].getString("projectId"); if (sessions.any { it.getString("projectId") != host }) fail("PROGRESS_REQUIRES_COMPLETED_FOCUS")
        val consumed = objects("progressReports").flatMap { ids(it.getJSONArray("focusSessionIds")) }.toSet() + objects("habitBuildings").flatMap { ids(it.getJSONArray("focusSessionIds")) } + objects("projects").filter { it.getString("kind") == "habit" }.flatMap { ids(habit(it).getJSONArray("completedFocusSessionIds")) }
        if (sessions.any { it.getString("id") in consumed || it.has("settledAt") }) fail("FOCUS_ALREADY_REPORTED")
        val habits = (c.opt("habitAllocations") as? JSONArray)?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } }.orEmpty()
        habits.forEach { JsonChecks.int(it.get("rounds"), "rounds", 1) }
        if (habits.map { it.get("projectId") }.toSet().size != habits.size) fail("DUPLICATE_ID")
        val habitRounds = habits.sumOf { it.getLong("rounds") }; if (habitRounds > sessions.size) fail("HABIT_ROUNDS_EXCEED_TARGET")
        for (a in habits) {
            val p = project(a.getString("projectId")); if (p == null || p.getString("kind") != "habit" || p.getString("status") == "deleted") fail("PROJECT_NOT_FOUND")
            val h = habit(p); if (h.getBoolean("awaitingNextBuilding")) fail("HABIT_BUILDING_SELECTION_REQUIRED")
            if (a.getLong("rounds") > h.getLong("targetRounds") - h.getJSONArray("completedFocusSessionIds").length()) fail("HABIT_ROUNDS_EXCEED_TARGET")
        }
        val entries = (c.opt("entries") as? JSONArray)?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } }.orEmpty()
        if (habitRounds == sessions.size.toLong() && entries.isNotEmpty()) fail("MARATHON_SPLIT_INVALID")
        if (entries.map { it.get("subtaskId") }.toSet().size != entries.size) fail("DUPLICATE_ID")
        val reportIds = entries.map { it.get("reportId") }; if (reportIds.toSet().size != entries.size || objects("progressReports").any { it.get("id") in reportIds }) fail("DUPLICATE_ID")
        val explicit = entries.any { it.has("rounds") }
        if (explicit && entries.any { !it.has("rounds") || runCatching { JsonChecks.int(it.get("rounds"), "rounds", 1) }.isFailure }) fail("MARATHON_SPLIT_INVALID")
        val ordered = sessions.sortedWith { a, b -> a.getString("completedAt").compareTo(b.getString("completedAt")).takeIf { it != 0 } ?: localeCompare(a.getString("id"), b.getString("id")) }
        val contexts = entries.map { e ->
            for (key in listOf("reportId", "projectId", "subtaskId")) JsonChecks.text(e.get(key), key)
            JsonChecks.int(e.get("progressBasisPoints"), "progressBasisPoints", 0, 10000)
            val p = project(e.getString("projectId")); if (p == null || p.getString("kind") != "finite" || p.getString("status") == "deleted") fail("SUBTASK_NOT_FOUND")
            val t = tasks(p).find { it.getString("id") == e.getString("subtaskId") } ?: fail("SUBTASK_NOT_FOUND")
            if (e.getLong("progressBasisPoints") < t.getLong("progressBasisPoints")) fail("PROGRESS_CANNOT_DECREASE"); p to t
        }
        val remainder = ordered.drop(habitRounds.toInt())
        if (explicit && entries.sumOf { it.getLong("rounds") } > remainder.size) fail("MARATHON_SPLIT_INVALID")
        var offset = 0
        for (a in habits) { val p = project(a.getString("projectId"))!!; repeat(a.getInt("rounds")) { RewardRules.advanceHabit(m, p, ordered[offset++]) } }
        offset = 0
        for ((i, entry) in entries.withIndex()) {
            val (p, task) = contexts[i]; val assigned = if (explicit) remainder.drop(offset).take(entry.getInt("rounds")) else remainder
            if (explicit) offset += entry.getInt("rounds")
            val progress = entry.getLong("progressBasisPoints"); task.put("progressBasisPoints", progress)
            val r = JSONObject().put("id", entry.getString("reportId")).put("projectId", p.getString("id")).put("subtaskId", task.getString("id")).put("focusSessionIds", JSONArray(assigned.map { it.getString("id") })).put("progressBasisPoints", progress).put("reportedAt", now)
            if (explicit) r.put("allocation", "explicit") else r.put("shared", true)
            array("progressReports").put(r); event("SubtaskProgressReported", "subtaskId" to task.getString("id"), "progressBasisPoints" to progress); lock(m, p, progress)
        }
        entries.forEach { seal(m, project(it.getString("projectId"))!!) }; sessions.forEach { if (!it.has("settledAt")) it.put("settledAt", now) }
    }
}
