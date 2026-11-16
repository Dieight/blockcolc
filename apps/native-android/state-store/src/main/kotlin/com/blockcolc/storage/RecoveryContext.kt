package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainTime
import com.blockcolc.domain.PipelineCost
import com.blockcolc.domain.StateInputException
import com.blockcolc.domain.StrictJson
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

enum class PlanMode { ROUNDS, MINIMAL, MARATHON }
enum class PlanPhase { READY, FOCUS, REST, REPORT }
data class SavedPlan(
    val id: String, val projectId: String, val subtaskId: String?, val mode: PlanMode,
    val totalRounds: Int, val completedSessionIds: List<String>, val phase: PlanPhase,
    val focusDurationMs: Long, val restDurationMs: Long,
    val currentSessionId: String? = null, val phaseEndsAt: String? = null, val exactEndAt: String? = null,
    val terminalRest: Boolean = false,
    val cancelled: Boolean = false, val cancellationCategory: String? = null, val cancellationNote: String? = null,
    val hasStarted:Boolean = phase!=PlanPhase.READY || completedSessionIds.isNotEmpty(),
    val restStartedAt:String?=null,
)
data class ContinuationGrant(val id: String, val replacementGeneration: Long, val predecessorSessionId: String?)

/** Durable platform outbox in local recovery, committed with the REST -> READY transition. */
data class ReturnReminder(val database:String,val generation:Long,val plan:String,val completed:Int,val restEnd:String){
    val key:String get()=StrictJson.sha(listOf(database,generation,plan,completed,restEnd).joinToString("|"))
    fun matches(p:SavedPlan?,g:Long)=generation==g&&p!=null&&p.id==plan&&p.phase==PlanPhase.READY&&p.mode!=PlanMode.ROUNDS&&p.completedSessionIds.size==completed&&completed in 1 until p.totalRounds
}

/** Local-only control state. Never included in a domain export or inferred from imported history. */
data class RecoveryContext(val plan: SavedPlan? = null, val automatic: ContinuationGrant? = null,val returnReminder:ReturnReminder?=null) {
    fun validate(domain: DomainDocument, generation: Long): Unit = PipelineCost.section("recovery.validate") {
        fun check(ok: Boolean, detail: String) { if (!ok) throw StateInputException("INVALID_RECOVERY", "$.localRecovery", detail) }
        val p = plan
        returnReminder?.let{r->check(r.database.isNotBlank()&&r.matches(p,generation),"Stale return reminder");check(runCatching{Instant.parse(r.restEnd)}.isSuccess,"Invalid reminder boundary")}
        if (p == null) { check(automatic == null, "Authorization has no plan"); return@section }
        check(p.id.isNotBlank() && p.projectId.isNotBlank(), "Missing plan identity")
        check(p.totalRounds in 1..24 && p.completedSessionIds.size <= p.totalRounds && p.completedSessionIds.toSet().size == p.completedSessionIds.size, "Invalid round counts")
        check(p.focusDurationMs in 1..10800000 && p.restDurationMs in 0..3600000, "Invalid schedule inputs")
        fun instant(s: String?) { if (s != null) check(runCatching { Instant.parse(s).toEpochMilli() }.isSuccess, "Invalid absolute deadline") }
        instant(p.phaseEndsAt); instant(p.exactEndAt)
        val state = domain.focusControlJson(); val projects = state.getJSONArray("projects")
        val owner = (0 until projects.length()).map { projects.getJSONObject(it) }.find { it.getString("id") == p.projectId }
        check(owner != null && (owner.getString("status") in setOf("active", "paused") || p.phase == PlanPhase.REPORT && owner.getString("status") == "monument"), "Plan owner unavailable"); owner!!
        val tasks = owner.getJSONArray("subtasks")
        if (p.mode == PlanMode.ROUNDS && owner.getString("kind") != "habit") check((0 until tasks.length()).any { tasks.getJSONObject(it).getString("id") == p.subtaskId }, "Unknown planned subtask")
        else if (p.mode == PlanMode.MINIMAL || owner.getString("kind") == "habit") check(p.subtaskId == null, "Deferred/habit plan has subtask")
        else check((0 until tasks.length()).any { tasks.getJSONObject(it).getString("id") == p.subtaskId }, "Unknown marathon subtask")
        check(!p.terminalRest || p.phase == PlanPhase.REST && p.exactEndAt == p.phaseEndsAt, "Invalid terminal rest")
        check(!p.cancelled || p.phase==PlanPhase.REPORT&&automatic==null,"Cancelled plan cannot continue")
        check(p.cancellationCategory==null||p.cancellationCategory in setOf("external-interruption","task-blocked","fatigue","priority-changed","device-or-app","other"),"Invalid cancellation category")
        check(p.cancellationNote==null||p.cancellationNote.isNotBlank()&&p.cancellationNote.length<=200,"Invalid cancellation note")
        val history = state.getJSONArray("focusHistory")
        val byId = (0 until history.length()).map { history.getJSONObject(it) }.associateBy { it.getString("id") }
        check(p.hasStarted||byId.keys.none{it.startsWith("session:${p.id}:")},"Unstarted plan already has a persisted session")
        for (id in p.completedSessionIds) {
            val s = byId[id]
            check(s != null && s.getString("status") != "interrupted" && s.getString("projectId") == p.projectId, "Missing completed plan round")
        }
        val active = if (state.isNull("activeFocusSession")) null else state.getJSONObject("activeFocusSession")
        check(p.hasStarted || p.phase==PlanPhase.READY&&p.completedSessionIds.isEmpty(),"Unstarted plan has completed or active phases")
        if (p.phase == PlanPhase.FOCUS) {
            // Android's org.json turns JSONObject.NULL into the literal "null"
            // in optString; the JVM oracle library instead returns the fallback.
            // A deferred/habit session has a real JSON null, not a task named null.
            check(active != null && active.getString("id") == p.currentSessionId && active.getString("projectId") == p.projectId &&
                (if(active.isNull("subtaskId"))null else active.getString("subtaskId")) == p.subtaskId, "Plan/active session mismatch")
            check(active!!.getString("endsAt") == p.phaseEndsAt && p.completedSessionIds.size < p.totalRounds, "Plan deadline/count mismatch")
        } else {
            check(active == null && p.currentSessionId == null, "Non-focus plan has active session")
            if (p.phase == PlanPhase.REST) check(p.phaseEndsAt != null && p.completedSessionIds.isNotEmpty(), "Rest requires completion and deadline")
            else check(p.phaseEndsAt == null, "Unexpected phase deadline")
            if (p.phase == PlanPhase.READY) check(p.completedSessionIds.size < p.totalRounds, "Finished plan is not ready")
            if (p.phase == PlanPhase.REPORT) check(p.completedSessionIds.isNotEmpty(), "Empty report")
        }
        if(p.phase==PlanPhase.REST&&p.restStartedAt!=null) check(DomainTime.millis(p.restStartedAt)<DomainTime.millis(p.phaseEndsAt!!),"Invalid exact rest interval")
        automatic?.let { a ->
            check(a.id.isNotBlank() && a.replacementGeneration == generation, "Stale automatic authorization")
            check(a.predecessorSessionId == p.completedSessionIds.lastOrNull(), "Authorization predecessor mismatch")
            // A regular-round report may retain the explicit grant, but it has no
            // automatic deadline. The coordinator requires a committed report first.
        }
    }
    fun canonical(): String {
        fun nullable(s: String?) = s ?: JSONObject.NULL
        val p = plan?.let { p -> JSONObject().put("id", p.id).put("projectId", p.projectId).put("subtaskId", nullable(p.subtaskId)).put("mode", p.mode.name)
            .put("totalRounds", p.totalRounds).put("completedSessionIds", JSONArray(p.completedSessionIds)).put("phase", p.phase.name)
            .put("focusDurationMs", p.focusDurationMs).put("restDurationMs", p.restDurationMs).put("currentSessionId", nullable(p.currentSessionId))
            .put("phaseEndsAt", nullable(p.phaseEndsAt)).put("exactEndAt", nullable(p.exactEndAt)).put("terminalRest", p.terminalRest)
            .put("cancelled",p.cancelled).put("cancellationCategory",nullable(p.cancellationCategory)).put("cancellationNote",nullable(p.cancellationNote)).put("hasStarted",p.hasStarted).also{if(p.restStartedAt!=null)it.put("restStartedAt",p.restStartedAt)} }
        val a = automatic?.let { a -> JSONObject().put("id", a.id).put("replacementGeneration", a.replacementGeneration).put("predecessorSessionId", nullable(a.predecessorSessionId)) }
        return StrictJson.render(JSONObject().put("schema", 1).put("plan", p ?: JSONObject.NULL).put("automatic", a ?: JSONObject.NULL).also{x->returnReminder?.let{r->x.put("returnReminder",JSONObject().put("database",r.database).put("generation",r.generation).put("plan",r.plan).put("completed",r.completed).put("restEnd",r.restEnd))}})
    }
    companion object {
        fun parse(text: String,domain:DomainDocument?=null): RecoveryContext {
            fun keys(x: JSONObject, names: String) { require(x.keys().asSequence().toSet() == names.split(' ').toSet()) }
            fun text(x: JSONObject, key: String): String { val value = x.get(key); require(value is String); return value }
            fun nullable(x: JSONObject, key: String) = if (x.isNull(key)) null else x.get(key).also { require(it is String) } as String
            fun number(x: JSONObject, key: String): Long { val n = x.get(key); require(n is Number && n.toDouble().isFinite() && n.toDouble() == n.toLong().toDouble() && kotlin.math.abs(n.toDouble()) <= 9007199254740991.0); return n.toLong() }
            val x = StrictJson.parse(text) as JSONObject; keys(x, "schema plan automatic"+(if(x.has("returnReminder"))" returnReminder"else"")); require(number(x, "schema") == 1L)
            val p = if (x.isNull("plan")) null else x.getJSONObject("plan").let { p ->
                val legacy = !p.has("terminalRest")
                val cancellation=p.has("cancelled")
                val started=p.has("hasStarted")
                keys(p, "id projectId subtaskId mode totalRounds completedSessionIds phase focusDurationMs restDurationMs currentSessionId phaseEndsAt exactEndAt" + (if (legacy) "" else " terminalRest")+(if(cancellation)" cancelled cancellationCategory cancellationNote" else "")+(if(started)" hasStarted" else "")+(if(p.has("restStartedAt"))" restStartedAt" else ""))
                val ids = p.getJSONArray("completedSessionIds"); val rounds = number(p, "totalRounds"); require(rounds in 1..24)
                SavedPlan(text(p, "id"), text(p, "projectId"), nullable(p, "subtaskId"), PlanMode.valueOf(text(p, "mode")), rounds.toInt(),
                    (0 until ids.length()).map { ids.get(it).also { require(it is String) } as String }, PlanPhase.valueOf(text(p, "phase")),
                    number(p, "focusDurationMs"), number(p, "restDurationMs"), nullable(p, "currentSessionId"), nullable(p, "phaseEndsAt"), nullable(p, "exactEndAt"),
                    if (legacy) false else p.get("terminalRest").also { require(it is Boolean) } as Boolean,
                    if(cancellation)p.get("cancelled").also{require(it is Boolean)} as Boolean else false,
                    if(cancellation)nullable(p,"cancellationCategory")else null,if(cancellation)nullable(p,"cancellationNote")else null,
                    if(started)p.get("hasStarted").also{require(it is Boolean)} as Boolean else {
                        // Older native plans used plan-scoped, stable session
                        // identities. Only a matching saved fact proves a
                        // paused first round; unrelated project history does not.
                        val history=domain?.json()?.getJSONArray("focusHistory")
                        text(p,"phase")!="READY"||ids.length()>0||history?.let{a->(0 until a.length()).any{i->a.getJSONObject(i).getString("id").startsWith("session:${text(p,"id")}:")}}==true
                    },if(p.has("restStartedAt"))nullable(p,"restStartedAt")else null)
            }
            val a = if (x.isNull("automatic")) null else x.getJSONObject("automatic").let { a ->
                keys(a, "id replacementGeneration predecessorSessionId"); ContinuationGrant(text(a, "id"), number(a, "replacementGeneration"), nullable(a, "predecessorSessionId"))
            }
            val reminder=if(x.has("returnReminder"))x.getJSONObject("returnReminder").let{r->
                keys(r,"database generation plan completed restEnd")
                val completed=number(r,"completed");require(completed in 1..24)
                ReturnReminder(text(r,"database"),number(r,"generation"),text(r,"plan"),completed.toInt(),text(r,"restEnd"))
            }else null
            return RecoveryContext(p, a,reminder)
        }
    }
}
