package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ExternalFocusProjectionTest {
    @Test fun firstFragmentAddsTimeAndTheSecondCompletesOneRoundAcrossMidnight() {
        val created = DomainEngine.execute(DomainEngine.initial(), DomainEngine.command(
            "CreateHabitProject", "projectId" to "reading", "title" to "读书", "blueprintId" to "builtin-small-workshop", "targetRounds" to 10,
        ), DomainTime.millis("2026-11-25T20:00:00.000Z"))
        assertTrue(created.ok)
        val state = created.state.json()
        val sessions = state.getJSONArray("focusHistory")
        fun add(id: String, start: String, end: String, minutes: Long, credited: Boolean) {
            sessions.put(JSONObject().put("id", id).put("projectId", "reading").put("subtaskId", JSONObject.NULL)
                .put("startedAt", start).put("endsAt", end).put("plannedDurationMs", minutes * 60000)
                .put("timeZoneAtStart", "UTC").put("status", "completed").put("completedAt", end)
                .put("completedLocalDate", DomainTime.localDate(end,"UTC")).put("actualDurationMs", minutes * 60000)
                .put("external", JSONObject().put("source", "Partner").put("roundMs", 1500000).put("credited", credited)))
        }
        add("external-focus:test:0", "2026-11-25T23:40:00.000Z", "2026-11-25T23:55:00.000Z", 15, false)
        val first = WorkspaceProjection.from(DomainDocument.fromJson(state), DomainTime.millis("2026-11-25T23:59:00.000Z"))
        assertEquals(15 * 60000L, first.days.single().durationMs)
        assertEquals(0, first.days.single().completed)
        add("external-focus:test:1", "2026-11-25T23:55:00.000Z", "2026-11-26T00:05:00.000Z", 10, true)
        state.getJSONArray("projects").getJSONObject(0).getJSONObject("habit")
            .getJSONArray("completedFocusSessionIds").put("external-focus:test:1")
        val result = WorkspaceProjection.from(DomainDocument.fromJson(state), DomainTime.millis("2026-11-26T08:00:00.000Z"))
        assertEquals(listOf(20 * 60000L, 5 * 60000L), result.days.map { it.durationMs })
        assertEquals(listOf(0, 1), result.days.map { it.completed })
        assertEquals(1, result.projects.single().habitApplied)
        assertEquals(result.days.map { it.durationMs }, result.days.map { day -> day.targets.sumOf { it.durationMs } })
    }
}
