package com.blockcolc.preview.migration

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainTime
import com.blockcolc.domain.StrictJson
import com.blockcolc.presentation.ClientPreferences
import com.blockcolc.storage.ContinuationGrant
import com.blockcolc.storage.PlanMode
import com.blockcolc.storage.PlanPhase
import com.blockcolc.storage.RecoveryContext
import com.blockcolc.storage.SavedPlan
import org.json.JSONObject

/** Converts the saved WebView plan alongside the verified domain snapshot.
 * A stored authorization can cross the upgrade only with its source revision. */
internal object LegacyFocusPlan {
    fun decode(domain: DomainDocument, metadata: JSONObject, preferences: ClientPreferences): RecoveryContext {
        val text = metadata.optionalText("plan") ?: return RecoveryContext()
        val parsed = StrictJson.parse(text, 1024 * 1024)
        if (parsed == JSONObject.NULL) return RecoveryContext()
        val source = parsed as JSONObject
        val projectId = source.getString("projectId")
        val subtaskId = source.optionalText("subtaskId")
        val mode = when (source.optionalText("mode")) {
            null, "rounds" -> PlanMode.ROUNDS
            "marathon" -> if (source.opt("deferredSettlement") == true) PlanMode.MINIMAL else PlanMode.MARATHON
            else -> error("LEGACY_PLAN_MODE")
        }
        val recordedIds = source.getJSONArray("reportedSessionIds")
        val completed = List(recordedIds.length()) { index -> recordedIds.get(index) as String }
        val rounds = source.number("totalRounds").also { require(it in 1..24) }.toInt()
        require(completed.size.toLong() == source.number("completedRounds") && completed.size <= rounds)

        val control = domain.focusControlJson()
        val projects = control.getJSONArray("projects")
        val owner = (0 until projects.length()).asSequence().map(projects::getJSONObject)
            .firstOrNull { it.getString("id") == projectId } ?: return RecoveryContext()
        val active = domain.activeFocusSession()
        val savedPhase = when (source.getString("status")) {
            "ready" -> PlanPhase.READY
            "focus" -> PlanPhase.FOCUS
            "break" -> PlanPhase.REST
            "report" -> PlanPhase.REPORT
            else -> error("LEGACY_PLAN_PHASE")
        }
        val savedSession = source.optionalText("currentSessionId")
        val authorization = source.optJSONObject("automaticContinuation")
        val reservation = authorization?.optJSONObject("reservation")
        val cancelling = source.opt("cancellationRequested") == true
        val validAuthorization = authorization?.takeIf {
            it.number("replacementRevision", 0) == metadata.number("replacementRevision") &&
                preferences.autoContinueFocus && !cancelling
        }
        val deadlinePolicy = source.optionalText("deadlinePolicy")
        require(deadlinePolicy == null || deadlinePolicy == "exact" && mode != PlanMode.ROUNDS)
        val exactEnd = if (deadlinePolicy == "exact") DomainTime.instant(source.getString("endAt")) else null
        val defaultFocusMinutes = if (owner.getString("kind") == "habit") preferences.habitFocusMinutes else preferences.focusMinutes
        val draft = SavedPlan(
            id = "legacy-" + StrictJson.sha(text).take(32),
            projectId = projectId,
            subtaskId = subtaskId,
            mode = mode,
            totalRounds = rounds,
            completedSessionIds = completed,
            phase = savedPhase,
            focusDurationMs = validAuthorization?.number("focusDurationMs") ?: defaultFocusMinutes * 60_000L,
            restDurationMs = validAuthorization?.number("breakDurationMs") ?: preferences.breakMinutes * 60_000L,
            exactEndAt = exactEnd,
            cancellationCategory = source.optionalText("cancellationReason"),
            cancellationNote = source.optionalText("cancellationNote"),
            hasStarted = source.opt("hasStarted") == true || savedPhase != PlanPhase.READY || completed.isNotEmpty(),
        )
        val history = control.getJSONArray("focusHistory")
        if (completed.any { id -> history.findById(id)?.let {
                it.getString("projectId") == projectId && it.getString("status") != "interrupted"
            } != true }) return RecoveryContext()
        val reservedId = reservation?.getString("sessionId")
        val reservedSession = reservedId?.let { id -> history.findById(id) }
        val committedReservation = active?.takeIf { it.getString("id") == reservedId } ?: reservedSession
        if (committedReservation != null) {
            val scheduled = checkNotNull(reservation).getString("scheduledAt")
            val requested = checkNotNull(authorization).number("focusDurationMs")
            val duration = exactEnd?.let { minOf(requested, DomainTime.millis(it) - DomainTime.millis(scheduled)) } ?: requested
            require(reservation.number("round") == completed.size + 1L &&
                scheduled == authorization.optionalText("nextRoundStartsAt") &&
                scheduled == committedReservation.getString("startedAt") &&
                duration == committedReservation.getLong("plannedDurationMs")) { "LEGACY_RESERVATION_MISMATCH" }
        }
        if (active == null && (cancelling || savedPhase == PlanPhase.FOCUS || reservedSession != null)) {
            val latest = reservedSession ?: savedSession?.let { history.findById(it) }
            return recoverWrittenRound(draft, owner, control, latest, validAuthorization, cancelling).also { it.validate(domain, 0) }
        }
        var end: String? = null
        var restStart: String? = null
        val terminalRest = active == null && savedPhase == PlanPhase.REST && source.opt("endAfterBreak") == true
        val phase = when {
            active != null -> {
                val sessionId = active.getString("id")
                if (savedPhase == PlanPhase.REPORT || completed.size == rounds || active.getString("projectId") != projectId ||
                    active.optionalText("subtaskId") != subtaskId || active.optBoolean("marathon") != (mode != PlanMode.ROUNDS) ||
                    active.optBoolean("deferredSettlement") != (mode == PlanMode.MINIMAL) ||
                    savedSession != null && savedSession != sessionId && reservedId != sessionId) {
                    return RecoveryContext()
                }
                // Manual StartFocus might reach durable storage before the
                // old view changes READY or records the resulting session ID.
                end = active.getString("endsAt")
                PlanPhase.FOCUS
            }
            savedPhase == PlanPhase.REST -> {
                end = DomainTime.instant(source.getString("breakEndsAt"))
                restStart = source.optionalText("breakStartedAt")?.let(DomainTime::instant)
                PlanPhase.REST
            }
            savedPhase == PlanPhase.READY && completed.isNotEmpty() && validAuthorization?.has("nextRoundStartsAt") == true -> {
                // A completed break is sometimes written as READY before the next
                // StartFocus commit. Carry its absolute deadline into the native
                // coordinator so a cold upgrade preserves the scheduled start.
                end = DomainTime.instant(validAuthorization.getString("nextRoundStartsAt"))
                require(exactEnd == null || DomainTime.millis(end) < DomainTime.millis(exactEnd))
                PlanPhase.REST
            }
            else -> savedPhase
        }
        val plan = draft.copy(
            phase = phase,
            currentSessionId = active?.getString("id"),
            phaseEndsAt = end,
            exactEndAt = exactEnd ?: end?.takeIf { terminalRest },
            terminalRest = terminalRest,
            hasStarted = draft.hasStarted || phase != PlanPhase.READY,
            restStartedAt = restStart,
        )
        return bound(plan, validAuthorization).also { it.validate(domain, 0) }
    }

    /** Older writes could commit the round before publishing the updated plan.
     * Resume from that exact saved session, with its original absolute schedule. */
    private fun recoverWrittenRound(
        draft: SavedPlan, owner: JSONObject, control: JSONObject, latest: JSONObject?,
        authorization: JSONObject?, cancelling: Boolean,
    ): RecoveryContext {
        if (latest != null) {
            require(latest.getString("projectId") == draft.projectId && latest.optionalText("subtaskId") == draft.subtaskId &&
                latest.optBoolean("marathon") == (draft.mode != PlanMode.ROUNDS) &&
                latest.optBoolean("deferredSettlement") == (draft.mode == PlanMode.MINIMAL)) { "LEGACY_WRITTEN_SESSION_MISMATCH" }
        }
        val status = latest?.getString("status")
        val completed = if (status == "completed" || status == "completed-early") {
            (draft.completedSessionIds + checkNotNull(latest).getString("id")).distinct()
        } else draft.completedSessionIds
        require(completed.size <= draft.totalRounds)
        val plan = draft.copy(completedSessionIds = completed, hasStarted = draft.hasStarted || latest != null)
        val habit = owner.optJSONObject("habit")
        val ordinary = plan.mode == PlanMode.ROUNDS && habit == null
        val history = control.getJSONArray("focusHistory")
        val reports = control.getJSONArray("progressReports")
        val reportBySession = reports.objects().flatMap { report ->
            val ids = report.getJSONArray("focusSessionIds")
            (0 until ids.length()).map { index -> ids.getString(index) to report }
        }.toMap()
        val reportable = habit == null || plan.mode == PlanMode.MINIMAL
        fun pending() = reportable && completed.any { id ->
            history.findById(id)?.let { !it.has("settledAt") && id !in reportBySession } == true
        }
        if (cancelling) {
            return if (pending()) RecoveryContext(plan.copy(phase = PlanPhase.REPORT, cancelled = true, hasStarted = true))
            else RecoveryContext()
        }
        if (latest == null) return RecoveryContext()
        if (status == "interrupted") {
            return if (plan.totalRounds > 1 || plan.mode != PlanMode.ROUNDS) RecoveryContext(plan.copy(phase = PlanPhase.READY))
            else RecoveryContext()
        }
        require(status == "completed" || status == "completed-early")
        if (ordinary && pending()) {
            return bound(plan.copy(phase = PlanPhase.REPORT), authorization.takeIf { status == "completed" })
        }
        if (plan.mode != PlanMode.MINIMAL && habit?.optBoolean("awaitingNextBuilding") == true) return RecoveryContext()
        if (status == "completed-early") {
            return when {
                ordinary -> RecoveryContext()
                completed.size < plan.totalRounds -> RecoveryContext(plan.copy(phase = PlanPhase.READY))
                pending() -> RecoveryContext(plan.copy(phase = PlanPhase.REPORT))
                else -> RecoveryContext()
            }
        }
        val exactEnd = plan.exactEndAt?.let(DomainTime::millis)
        val completedAt = latest.getString(if (authorization != null || exactEnd != null) "endsAt" else "completedAt")
        val reportAt = if (ordinary && authorization != null) reportBySession[latest.getString("id")]?.getString("reportedAt") else null
        val at = DomainTime.millis(reportAt ?: completedAt)
        val rest = if (ordinary && authorization == null) 0L else plan.restDurationMs
        val remaining = exactEnd?.minus(at)
        val terminal = remaining != null && remaining > 0 && (completed.size == plan.totalRounds || remaining <= rest)
        if (!terminal && (completed.size == plan.totalRounds || remaining != null && remaining <= 0)) {
            return if (pending()) RecoveryContext(plan.copy(phase = PlanPhase.REPORT)) else RecoveryContext()
        }
        if (terminal || rest > 0 || authorization != null) {
            val boundary = if (terminal) checkNotNull(exactEnd) else at + rest
            return bound(plan.copy(phase = PlanPhase.REST, phaseEndsAt = DomainTime.format(boundary), terminalRest = terminal,
                restStartedAt = if (boundary > at) DomainTime.format(at) else null), authorization)
        }
        return RecoveryContext(plan.copy(phase = PlanPhase.READY))
    }

    private fun bound(plan: SavedPlan, authorization: JSONObject?) = RecoveryContext(plan,
        authorization?.takeIf { !plan.terminalRest && plan.completedSessionIds.size < plan.totalRounds }?.let {
            ContinuationGrant(it.getString("authorizationId"), 0, plan.completedSessionIds.lastOrNull())
        })

    private fun org.json.JSONArray.objects() = (0 until length()).asSequence().map(::getJSONObject)
    private fun org.json.JSONArray.findById(id: String) = objects().firstOrNull { it.getString("id") == id }

    private fun JSONObject.optionalText(key: String): String? =
        if (isNull(key)) null else get(key) as String

    private fun JSONObject.number(key: String, fallback: Long? = null): Long {
        if (!has(key) && fallback != null) return fallback
        val raw = get(key) as Number
        val exact = raw.toLong()
        require(raw.toDouble() == exact.toDouble() && exact in 0..9_007_199_254_740_991L)
        return exact
    }
}
