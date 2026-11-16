package com.blockcolc.domain

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

internal object PolicyCommands {
    fun run(m: DomainMutation): Boolean = with(m) {
        when (type) {
            "ConfigureBirthday" -> {
                val enabled = bool("enabled"); val month = number("month", 1, 12).toInt(); val day = number("day", 1, 31).toInt()
                require(day <= LocalDate.of(2000, month, 1).lengthOfMonth())
                s.put("birthday", JSONObject().put("enabled", enabled).put("month", month).put("day", day)); event("BirthdayConfigured")
            }
            "ObserveBirthday" -> {
                val date = LocalDate.parse(DomainTime.localDate(now, s.getJSONObject("calendar").getString("timeZone"))); val b = s.getJSONObject("birthday")
                if (!b.getBoolean("enabled") || date.monthValue != b.getInt("month") || date.dayOfMonth != minOf(b.getInt("day"), date.lengthOfMonth()) || objects("birthdayRewards").any { it.getInt("year") == date.year }) return true
                val owner = objects("projects").find { it.getString("id") == s.optString("activeProjectId") && it.getString("status") != "deleted" } ?: objects("projects").find { it.getString("status") != "deleted" }
                array("birthdayRewards").put(JSONObject().put("year", date.year).put("date", date.toString()).put("awardedAt", now).put("settlementIndex", owner?.get("settlementIndex") ?: JSONObject.NULL))
                event("BirthdayRewardGranted", "year" to date.year, "date" to date.toString())
            }
            "SetDailyGoal" -> {
                val date = DomainTime.date(str("date")); val target = number("targetPomodoros", 1); val goal = ensureGoal(date)
                goal.put("targetPomodoros", target).put("enabled", true); event("DailyGoalSet", "date" to date, "targetPomodoros" to target)
                RewardRules.reach(m, date, now)
            }
            "DisableDailyGoal" -> {
                val date = DomainTime.date(str("date")); val g = ensureGoal(date); if (!g.getBoolean("enabled")) return true
                g.put("enabled", false); event("DailyGoalDisabled", "date" to date)
            }
            "ConfigureCalendar" -> {
                val zone = DomainTime.zone(str("timeZone")); val days = JsonChecks.arr(c.get("restWeekdays"), "restWeekdays").map { JsonChecks.int(it, "weekday", 0, 6) }
                require(days.toSet().size == days.size); s.put("calendar", JSONObject().put("timeZone", zone).put("restWeekdays", JSONArray(days.sorted())))
                resetAnchors(m); event("CalendarConfigured")
            }
            "ConfigureWorldEnvironment" -> {
                val style = JsonChecks.choice(c.get("environmentStyle"), "environmentStyle", "natural-valley classic-island ocean-island mosaic-coast")
                val world = s.getJSONObject("worldSettings"); if (world.getString("environmentStyle") == style) return true
                world.put("environmentStyle", style); event("WorldEnvironmentConfigured", "environmentStyle" to style)
            }
            "EnableDecay" -> {
                val rate = number("damagePerMissedPlannedDayBasisPoints", 1, 10000); val grace = number("gracePlannedDays")
                s.getJSONObject("decayPolicy").put("enabled", true).put("damagePerMissedPlannedDayBasisPoints", rate).put("gracePlannedDays", grace)
                resetAnchors(m); event("DecayEnabled")
            }
            "DisableDecay" -> {
                s.getJSONObject("decayPolicy").put("enabled", false).put("damagePerMissedPlannedDayBasisPoints", JSONObject.NULL)
                objects("projectConditions").forEach { it.put("inactivityAnchorAt", JSONObject.NULL).put("assessedMissedPlannedDays", 0) }; event("DecayDisabled")
            }
            "AssessDecay" -> {
                val policy = s.getJSONObject("decayPolicy"); if (!policy.getBoolean("enabled")) fail("DECAY_DISABLED")
                val rate = policy.getLong("damagePerMissedPlannedDayBasisPoints"); val cal = s.getJSONObject("calendar"); val restDays = idsAsInts(cal.getJSONArray("restWeekdays"))
                for (p in objects("projects")) {
                    if (p.getString("status") !in setOf("active", "paused") || p.getString("kind") == "habit" && habit(p).getBoolean("awaitingNextBuilding")) continue
                    val runtime = condition(p.getString("id")); val anchor = runtime.getString("inactivityAnchorAt")
                    val start = LocalDate.parse(DomainTime.localDate(anchor, cal.getString("timeZone"))); val end = LocalDate.parse(DomainTime.localDate(now, cal.getString("timeZone")))
                    val elapsed = maxOf(0, java.time.temporal.ChronoUnit.DAYS.between(start, end)); val wholeWeeks = elapsed / 7
                    var planned = wholeWeeks * (7 - restDays.size)
                    for (i in 1..(elapsed % 7)) if (start.plusDays(wholeWeeks * 7 + i).dayOfWeek.value % 7 !in restDays) planned++
                    val missed = maxOf(0, planned - policy.getLong("gracePlannedDays")); val newly = maxOf(0, missed - runtime.getLong("assessedMissedPlannedDays"))
                    runtime.put("assessedMissedPlannedDays", maxOf(runtime.getLong("assessedMissedPlannedDays"), missed))
                    if (newly == 0L) continue
                    val condition = maxOf(0, runtime.getLong("conditionBasisPoints") - newly * rate)
                    runtime.put("conditionBasisPoints", condition); event("BuildingConditionDecayed", "projectId" to p.getString("id"), "conditionBasisPoints" to condition, "newlyMissedPlannedDays" to newly)
                }
            }
            else -> return false
        }; true
    }
    private fun idsAsInts(array: JSONArray) = (0 until array.length()).map { array.getInt(it) }.toSet()
    private fun resetAnchors(m: DomainMutation) = with(m) {
        if (s.getJSONObject("decayPolicy").getBoolean("enabled")) for (p in objects("projects")) {
            if (p.getString("status") !in setOf("active", "paused") || p.getString("kind") == "habit" && habit(p).getBoolean("awaitingNextBuilding")) continue
            condition(p.getString("id")).put("inactivityAnchorAt", now).put("assessedMissedPlannedDays", 0)
        }
    }
}

internal object RewardRules {
    fun repair(m: DomainMutation, projectId: String, at: String) = with(m) {
        val policy = s.getJSONObject("decayPolicy"); if (!policy.getBoolean("enabled")) return
        val p = project(projectId); if (p == null || p.getString("status") == "monument" || policy.isNull("damagePerMissedPlannedDayBasisPoints")) return
        val runtime = condition(projectId); val before = runtime.getLong("conditionBasisPoints")
        val after = minOf(10000, before + policy.getLong("damagePerMissedPlannedDayBasisPoints") * policy.getLong("repairMultiplierBasisPoints") / 10000)
        runtime.put("conditionBasisPoints", after).put("inactivityAnchorAt", at).put("assessedMissedPlannedDays", 0)
        if (after != before) event("BuildingConditionRepaired", "projectId" to projectId, "conditionBasisPoints" to after)
    }
    fun advanceHabit(m: DomainMutation, project: JSONObject, session: JSONObject) = with(m) {
        val h = habit(project); require(!h.getBoolean("awaitingNextBuilding"))
        val id = session.getString("id"); val supported = h.getJSONArray("completedFocusSessionIds")
        require(id !in ids(supported) && objects("habitBuildings").none { id in ids(it.getJSONArray("focusSessionIds")) })
        supported.put(id); val count = supported.length(); val target = h.getInt("targetRounds"); val projectId = project.getString("id")
        event("HabitBuildingProgressed", "projectId" to projectId, "completedRounds" to count, "targetRounds" to target)
        if (count < target) return; require(count == target)
        val cycle = h.getLong("cycleNumber"); val buildingId = "habit-building:$projectId:$cycle"; require(objects("habitBuildings").none { it.getString("id") == buildingId })
        val plot = project.getLong("settlementIndex"); project.put("settlementIndex", nextPlot())
        array("habitBuildings").put(JSONObject().put("id", buildingId).put("habitProjectId", projectId).put("habitTitle", project.getString("title")).put("cycleNumber", cycle)
            .put("settlementIndex", plot).put("blueprintId", project.getString("blueprintId")).put("importedBlueprint", StrictJson.copy(project.get("importedBlueprint")))
            .put("targetRounds", target).put("focusSessionIds", StrictJson.copy(supported)).put("completedAt", session.getString(if (session.getString("status") == "interrupted") "interruptedAt" else "completedAt")))
        h.put("cycleNumber", cycle + 1).put("completedFocusSessionIds", JSONArray()).put("awaitingNextBuilding", true)
        condition(projectId).put("conditionBasisPoints", 10000).put("inactivityAnchorAt", JSONObject.NULL).put("assessedMissedPlannedDays", 0)
        event("HabitBuildingCompleted", "projectId" to projectId, "buildingId" to buildingId, "cycleNumber" to cycle)
    }
    fun reach(m: DomainMutation, date: String, at: String, projectId: String? = null) = with(m) {
        if (projectId != null) holiday(m, date, at, projectId)
        val g = ensureGoal(date)
        if (!g.getBoolean("enabled") || !g.isNull("reachedAt") || completions(date).size < g.getLong("targetPomodoros")) return
        g.put("reachedAt", at); event("DailyGoalReached", "date" to date); decoration(m, date, at, projectId)
    }
    private fun holiday(m: DomainMutation, date: String, at: String, projectId: String) = with(m) {
        val session = objects("focusHistory").lastOrNull() ?: return
        if (session.getString("status") == "interrupted" || session.getString("completedLocalDate") != date || session.getString("projectId") != projectId) return
        val p = project(projectId) ?: return
        val building = objects("habitBuildings").find { session.getString("id") in ids(it.getJSONArray("focusSessionIds")) }
        val plot = building?.getLong("settlementIndex") ?: p.getLong("settlementIndex")
        for ((holidayId, year) in HolidayDates.onDate(date)) {
            if (objects("holidayRewards").any { it.getString("holidayId") == holidayId && it.getInt("year") == year }) continue
            val ordinal = objects("holidayRewards").count { it.getLong("settlementIndex") == plot }; val angle = (ordinal + 1) * 2.399963229728653; val radius = 84 + kotlin.math.sqrt(ordinal.toDouble()) * 22
            val position = JSONObject().put("x", kotlin.math.floor(kotlin.math.cos(angle) * radius + 0.5).toLong()).put("z", kotlin.math.floor(kotlin.math.sin(angle) * radius + 0.5).toLong())
            array("holidayRewards").put(JSONObject().put("holidayId", holidayId).put("year", year).put("date", date).put("projectId", projectId).put("settlementIndex", plot)
                .put("sourceSessionId", session.getString("id")).put("awardedAt", at).put("position", position).put("rotationQuarterTurns", ordinal % 4))
            event("HolidayRewardGranted", "holidayId" to holidayId, "year" to year, "projectId" to projectId)
        }
    }
    private fun decoration(m: DomainMutation, date: String, at: String, completingProjectId: String?) = with(m) {
        val resources = objects("decorationBlueprintResources").sortedWith { a, b -> localeCompare(a.getString("id"), b.getString("id")) }
        if (resources.isEmpty() || objects("decorationRewards").any { it.getString("date") == date }) return
        val projectId = completingProjectId ?: completions(date).maxByOrNull { it.getString("completedAt") }?.getString("projectId") ?: return
        var hash = 0x811c9dc5.toInt(); "decoration-reward:$date:$projectId".forEach { hash = (hash xor it.code) * 0x01000193 }
        val seed = hash.toLong() and 0xffffffffL; val resourceId = resources[(seed % resources.size).toInt()].getString("id")
        val side = (seed shr 10) % 4; val offset = 58 + (seed shr 12) % 8; val lateral = (seed shr 16) % 13 - 6
        val position = when (side.toInt()) { 0 -> offset to lateral; 1 -> lateral to offset; 2 -> -offset to lateral; else -> lateral to -offset }
        array("decorationRewards").put(JSONObject().put("date", date).put("projectId", projectId).put("resourceId", resourceId).put("awardedAt", at)
            .put("position", JSONObject().put("x", position.first).put("z", position.second)).put("rotationQuarterTurns", (seed shr 8) % 4))
        event("DecorationRewardGranted", "date" to date, "projectId" to projectId, "resourceId" to resourceId)
    }
}
