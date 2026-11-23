package com.blockcolc.focus

import com.blockcolc.domain.*
import com.blockcolc.storage.*
import org.json.JSONArray
import org.json.JSONObject

data class PlanRequest(val id: String, val projectId: String, val subtaskId: String?, val mode: PlanMode,
    val rounds: Int, val focusMs: Long, val restMs: Long, val exactEndAt: String? = null,val extendAfterPlan:Boolean=false)
data class DeadlineTicket(val database: String, val generation: Long, val plan: String?, val session: String?, val phase: String, val end: String) {
    fun json() = DomainEngine.command("deadline", "database" to database, "generation" to generation, "plan" to plan, "session" to session, "phase" to phase, "end" to end)
    companion object { fun parse(x: JSONObject) = DeadlineTicket(x.getString("database"), x.getLong("generation"), if (x.isNull("plan")) null else x.getString("plan"), if (x.isNull("session")) null else x.getString("session"), x.getString("phase"), x.getString("end")) }
}
data class ExecutedCommand(val command: String, val now: Long)
data class Operation(val state: StoredState, val events: List<String> = emptyList(), val replayed: Boolean = false, val journal: List<ExecutedCommand> = emptyList(),val signals:List<String> = emptyList())
class FocusFailure(val reason: String): IllegalStateException(reason)
/** COMMIT returned successfully, but a subsequent read could not produce the
 * display state. This must never be reported as an uncommitted user action. */
class CommittedStateUnavailable(val receipt:CommitReceipt,cause:Exception):IllegalStateException("COMMITTED_STATE_UNAVAILABLE",cause)

/** The only application writer. The Android host runs this on one IO actor.
 * All phase changes, facts and authorization are committed together, then published. */
class FocusCoordinator(private val store: NativeStateStore, val databaseIdentity: String) {
    fun load() = store.load() ?: throw StorageConflict("NOT_INITIALIZED")
    fun deadline(state: StoredState): DeadlineTicket? {
        val p = state.recovery.plan
        val active = state.domain.activeFocusSession()
        val end = p?.phaseEndsAt ?: active?.getString("endsAt") ?: return null
        if (p != null && p.phase !in setOf(PlanPhase.FOCUS, PlanPhase.REST)) return null
        return DeadlineTicket(databaseIdentity, state.token.replacementGeneration, p?.id, active?.getString("id"), p?.phase?.name ?: "IMPORTED_FOCUS", end)
    }
    @Synchronized fun confirm(requestId: String, spec: PlanRequest, now: Long): Operation {
        val intent = spec.json("confirm")
        return change(requestId, intent) { m -> m.confirm(spec,now) }
    }
    @Synchronized fun begin(requestId:String,spec:PlanRequest,automatic:Boolean,now:Long):Operation=change(requestId,spec.json("begin").put("automatic",automatic)){m->
        m.confirm(spec,now);m.start(requestId,automatic,now)
    }
    @Synchronized fun amend(requestId:String,expectedPlanId:String,spec:PlanRequest,now:Long):Operation=change(requestId,spec.json("amend").put("expectedPlanId",expectedPlanId)){m->
        val p=m.context.plan?:throw FocusFailure("PLAN_NOT_FOUND")
        require(p.id==expectedPlanId&&p.phase==PlanPhase.READY&&!p.hasStarted&&m.active()==null){"Only a never-started confirmed plan can be edited"}
        m.context=RecoveryContext();m.confirm(spec,now)
    }
    @Synchronized fun acknowledgeReturnReminder(requestId:String,key:String):Operation=change(requestId,DomainEngine.command("ack-return-reminder","key" to key)){m->
        if(m.context.returnReminder?.let{it.database==databaseIdentity&&it.key==key}==true)m.context=m.context.copy(returnReminder=null)
    }
    /** Reconcile first, then record the host-classified transition against the current session. */
    @Synchronized fun lifecycle(requestId:String,foreground:Boolean,reason:String,now:Long):Operation=change(requestId,DomainEngine.command("lifecycle","foreground" to foreground,"reason" to reason)){m->
        m.advance(now)
        m.recordLifecycle(foreground,reason,now)
    }
    /** Android visibility events have no external acknowledgement. Repeated
     * foreground events and idle page returns can keep the verified revision. */
    @Synchronized fun observeLifecycle(foreground:Boolean,reason:String,now:Long,newRequest:()->String):Operation =
        observe(DomainEngine.command("lifecycle","foreground" to foreground,"reason" to reason),newRequest){m->
            m.advance(now)
            val integrity=m.active()?.getJSONObject("integrity")?:return@observe
            val backgrounded=!integrity.isNull("backgroundedAt")
            if(foreground==backgrounded)m.recordLifecycle(foreground,reason,now)
        }
    @Synchronized fun revokeAutomatic(requestId:String):Operation=change(requestId,DomainEngine.command("revoke-automatic")){m->
        m.context=m.context.copy(automatic=null)
    }
    @Synchronized fun start(requestId: String, automatic: Boolean, now: Long): Operation = change(requestId, DomainEngine.command("start", "automatic" to automatic)) { m ->
        m.start(requestId,automatic,now)
    }
    @Synchronized fun reconcile(requestId: String, now: Long, ticket: DeadlineTicket? = null): Operation {
        val current = load()
        if (ticket != null && ticket != deadline(current)) return Operation(current, replayed = true)
        // A scheduler can wake slightly early (or wall time can move back).
        // Such a delivery is not an acknowledged deadline: persisting its
        // stable request ID would suppress the later, actually-due delivery.
        if (ticket != null && now < DomainTime.millis(ticket.end)) return Operation(current, replayed = true)
        return change(requestId, DomainEngine.command("reconcile", "ticket" to ticket?.json()),current) { m -> m.advance(now) }
    }
    /** Opening the process observes current facts; it is not an externally
     * acknowledged command. Only an actual recovery transition needs a receipt.
     * User commands and delivered deadline tickets still use reconcile/change. */
    @Synchronized fun resume(now:Long,newRequest:()->String):Operation =
        observe(DomainEngine.command("reconcile","ticket" to null),newRequest){it.advance(now)}

    private fun observe(intent:JSONObject,newRequest:()->String,work:(Mutation)->Unit):Operation {
        val before=load();val mutation=Mutation(before,databaseIdentity);work(mutation)
        normalizeReminder(mutation,before)
        if(mutation.doc==before.domain&&mutation.context==before.recovery&&mutation.events.isEmpty()&&mutation.journal.isEmpty()&&mutation.signals.isEmpty()&&mutation.rollback==null)
            return Operation(before)
        return persist(newRequest(),StrictJson.sha(StrictJson.render(intent)),before,mutation)
    }
    @Synchronized fun manual(requestId: String, early: Boolean, cancelPlan: Boolean, category: String?, note: String?, now: Long): Operation =
        change(requestId, DomainEngine.command("manual", "early" to early, "cancelPlan" to cancelPlan, "category" to category, "note" to note)) { m ->
            val active = m.active()
            if (active != null && DomainTime.millis(active.getString("endsAt")) <= now) { m.advance(now); return@change }
            val p = m.context.plan
            if(p?.extensionStartedAt!=null)throw FocusFailure("EXTENSION_REQUIRES_FINISH")
            if(cancelPlan&&p!=null){require(p.mode!=PlanMode.ROUNDS){"Ordinary rounds do not cancel the whole plan"};require(category!=null||active==null&&!p.hasStarted&&p.completedSessionIds.isEmpty()){"Choose a cancellation reason"}}
            m.context = m.context.copy(automatic = null)
            if (active != null) {
                val command = if (early) DomainEngine.command("CompleteFocusEarly", "reportId" to "early:$requestId") else DomainEngine.command("CancelFocus", "interruptionCategory" to category)
                if (!early && !note.isNullOrBlank()) command.put("interruptionNote", note)
                m.command(command, now)
            }
            if (p == null) return@change
            val ids = if (active != null && early) p.completedSessionIds + active.getString("id") else p.completedSessionIds
            val next = p.copy(completedSessionIds = ids, phase = PlanPhase.READY, currentSessionId = null, phaseEndsAt = null, terminalRest = false)
            val owner = m.project(next.projectId)
            val finished = ids.size >= p.totalRounds || owner?.getString("status") == "monument" || owner?.optJSONObject("habit")?.getBoolean("awaitingNextBuilding") == true
            m.context = when {
                cancelPlan -> m.finish(next.copy(cancelled=true,cancellationCategory=category,cancellationNote=note?.trim()?.takeIf{it.isNotEmpty()}))
                !early&&p.mode==PlanMode.ROUNDS&&p.totalRounds==1&&ids.isEmpty() -> RecoveryContext()
                // Ordinary CompleteFocusEarly already completes and reports
                // this subtask in the formal domain. End its schedule instead
                // of offering an empty report or starting a finished task.
                early&&p.mode==PlanMode.ROUNDS&&owner?.getString("kind")=="finite" -> m.finish(next)
                finished -> m.finish(next)
                else -> RecoveryContext(next)
            }
        }
    @Synchronized fun finishExtension(requestId:String,now:Long):Operation=change(requestId,DomainEngine.command("finish-extension")){m->
        if(m.context.plan?.extensionStartedAt==null||m.active()==null)throw FocusFailure("FOCUS_NOT_ACTIVE")
        // Account for full boundaries before deciding whether the tail earns a round.
        do { m.advance(now) } while(m.active()?.let{DomainTime.millis(it.getString("endsAt"))<=now}==true)
        val plan=checkNotNull(m.context.plan)
        val id=checkNotNull(m.active()).getString("id")
        m.command(DomainEngine.command("FinishExtendedRound"),now)
        val rounds=plan.extensionRounds+if(m.history(id)?.getString("status")=="completed")1 else 0
        m.endExtension(plan.copy(extensionRounds=rounds),now)
    }
    /** Package preparation is one restricted transaction before startup
     * reconciliation. Advancing between imports could settle an overdue focus
     * with only the first candidate present in the daily reward pool. */
    @Synchronized fun registerDailyRewardBlueprints(requestId:String,blueprints:List<JSONObject>,now:Long):Operation {
        require(blueprints.size in 1..256)
        val captured=blueprints.map{JSONObject(StrictJson.render(it))}
        return change(requestId,DomainEngine.command("register-daily-rewards","blueprints" to JSONArray(captured))){m->
            val result=DomainEngine.importDecorationBlueprints(m.doc,captured,now)
            if(!result.ok)throw FocusFailure(result.error!!)
            m.doc=result.state
            m.events.addAll(result.events)
            for(blueprint in captured){
                val command=DomainEngine.command("ImportDecorationBlueprint","blueprint" to blueprint)
                m.journal.add(ExecutedCommand(StrictJson.render(command),now))
            }
        }
    }
    fun workspaceContext(generation:Long)="$databaseIdentity:$generation"

    @Synchronized fun command(requestId: String, command: JSONObject, now: Long, expectedProjectId:String?=null,
        expectedWorkspace:String?=null,prepareCommand:((DomainDocument,JSONObject)->JSONObject)?=null): Operation = change(requestId,
        if(expectedProjectId==null)command else DomainEngine.command("guarded-command","projectId" to expectedProjectId,"command" to command),
        current=expectedWorkspace?.let{expected->
            load().also{current->
                if(workspaceContext(current.token.replacementGeneration)!=expected)throw FocusFailure("WORKSPACE_CHANGED")
            }
        }) { m ->
        if(expectedProjectId!=null&&m.doc.json().opt("activeProjectId")!=expectedProjectId)throw FocusFailure("PROJECT_CONTEXT_CHANGED")
        // Source selection is resolved only for a new transaction. Replaying
        // an acknowledged creation must not consult a subsequently deleted
        // library entry, or change the original user-intent receipt identity.
        val prepared=prepareCommand?.invoke(m.doc,StrictJson.copy(command) as JSONObject)?:command
        val type = command.getString("type")
        require(type !in setOf("StartFocus", "CompleteFocus", "CompleteFocusEarly", "CancelFocus", "FinishExtendedRound")) { "Use plan commands for focus transitions" }
        if(type in setOf("CreateProject","CreateHabitProject","SwitchActiveProject"))require(m.context.plan==null){"A confirmed plan still owns the task context"}
        if (type == "DeleteActiveProject") {
            require(m.context.plan == null) { "Cancel the plan before deleting its project" }
            m.rollback = RollbackRequest(DomainTime.format(now), "before-delete", command.getString("projectId"))
        }
        val previous = m.active()
        val reporting=m.context.plan
        if(prepared.has("partialExtensionSessionId")){
            require(reporting?.phase==PlanPhase.REPORT&&reporting.extensionStartedAt!=null&&
                prepared.getString("partialExtensionSessionId")==reporting.extensionSessionId(reporting.extensionRounds+1))
        }
        if(type=="ReportMarathonFocus") {
            if(reporting?.phase!=PlanPhase.REPORT)throw FocusFailure("PLAN_NOT_REPORTING")
            val ids=command.getJSONArray("focusSessionIds")
            require((0 until ids.length()).map{ids.getString(it)}.toSet()==m.unsettled(reporting).toSet()){"Report must settle this plan, not unrelated history"}
        }
        if(type=="ReportSubtaskProgress"&&reporting?.phase==PlanPhase.REPORT){
            val ids=command.getJSONArray("focusSessionIds")
            val submitted=List(ids.length()){ids.getString(it)}
            require(submitted.toSet()==m.unsettled(reporting).toSet()&&submitted.size==submitted.distinct().size)
            if(m.doc.json().opt("activeProjectId")!=reporting.projectId)
                m.command(DomainEngine.command("SwitchActiveProject","projectId" to reporting.projectId),now)
        }
        m.command(prepared, now)
        val p = m.context.plan
        if (previous != null && m.active() == null) m.afterObservedEnd(previous, now)
        if (type == "ReportMarathonFocus") {
            m.context = RecoveryContext()
        } else if (type == "ReportSubtaskProgress" && p?.phase == PlanPhase.REPORT) {
            m.afterReport(p, now)
        }
        m.advance(now)
    }
    @Synchronized fun report(requestId: String, entries: JSONArray, habits: JSONArray, now: Long): Operation {
        return change(requestId, DomainEngine.command("report", "entries" to entries, "habitAllocations" to habits)) { m ->
            val p = m.context.plan ?: throw FocusFailure("PLAN_NOT_FOUND")
            if (p.phase != PlanPhase.REPORT || p.mode == PlanMode.ROUNDS) throw FocusFailure("PLAN_NOT_REPORTING")
            m.command(DomainEngine.command("ReportMarathonFocus", "focusSessionIds" to JSONArray(m.unsettled(p)), "entries" to entries, "habitAllocations" to habits), now)
            m.context = RecoveryContext()
        }
    }
    @Synchronized fun importBackup(requestId: String, backup: ParsedBackup, now: Long): Operation {
        store.replacementReceipt(requestId,backup.checksum)?.let { return Operation(load(),replayed=true) }
        val s = load(); val receipt=store.importBackup(s.token, requestId, backup, DomainTime.format(now)); return Operation(readCommitted(receipt))
    }
    @Synchronized fun restore(requestId: String, root: String, now: Long): Operation {
        store.replacementReceipt(requestId,StrictJson.sha("restore:$root"))?.let { return Operation(load(),replayed=true) }
        val s = load(); val receipt=store.restore(s.token, requestId, root, DomainTime.format(now)); return Operation(readCommitted(receipt))
    }
    private fun change(requestId: String, intent: JSONObject,current:StoredState?=null,work: (Mutation) -> Unit): Operation {
        // A synchronized preflight may already hold this immutable snapshot.
        // The write boundary still reloads and validates actual rows/CAS; this
        // removes only the duplicate read before mutation preparation.
        val before = current?:load(); val sha = StrictJson.sha(StrictJson.render(intent))
        store.receipt(before.token.replacementGeneration, requestId, sha)?.let { return Operation(load(), replayed = true) }
        val m = Mutation(before,databaseIdentity); work(m)
        normalizeReminder(m,before)
        return persist(requestId,sha,before,m)
    }
    private fun normalizeReminder(m:Mutation,before:StoredState){
        m.context.returnReminder?.let{r->if(r.database!=databaseIdentity||!r.matches(m.context.plan,before.token.replacementGeneration))m.context=m.context.copy(returnReminder=null)}
    }
    private fun persist(requestId:String,sha:String,before:StoredState,m:Mutation):Operation {
        // The sole persisted boundary validates domain/recovery consistency.
        // Repeating that whole-domain projection here does not add protection.
        // Record no-op receipts too: an acknowledged lifecycle/report callback
        // cannot later acquire a different meaning after another phase change.
        val receipt=PipelineCost.section("storage.commit"){store.commit(before.token, requestId, m.doc, m.context, sha, m.rollback)}
        val saved=PipelineCost.section("storage.commit-readback"){readCommitted(receipt)}
        return Operation(saved, m.events, journal=m.journal,signals=m.signals)
    }
    private fun readCommitted(receipt:CommitReceipt):StoredState=try{load()}catch(error:Exception){throw CommittedStateUnavailable(receipt,error)}
    private fun PlanRequest.json(type: String) = DomainEngine.command(type, "id" to id, "projectId" to projectId, "subtaskId" to subtaskId, "mode" to mode.name, "rounds" to rounds, "focusMs" to focusMs, "restMs" to restMs, "exactEndAt" to exactEndAt).also{
        if(extendAfterPlan)it.put("extendAfterPlan",true)
    }
    private class Mutation(val base: StoredState,val database:String) {
        private var parsedControls:JSONObject?=null
        private val image:JSONObject get()=parsedControls?:doc.focusControlJson().also{parsedControls=it}
        var doc = base.domain
            set(value) { field = value; parsedControls=null }
        var context = base.recovery; var rollback: RollbackRequest? = null; val events = arrayListOf<String>(); val journal=arrayListOf<ExecutedCommand>();val signals=arrayListOf<String>()
        fun command(cmd: JSONObject, now: Long) {
            val result = DomainEngine.execute(doc, cmd, now); if (!result.ok) throw FocusFailure(result.error!!)
            doc = result.state; events += result.events
            journal.add(ExecutedCommand(StrictJson.render(cmd),now))
        }
        fun active() = doc.activeFocusSession()
        fun recordLifecycle(foreground:Boolean,reason:String,now:Long){
            val before=active()
            command(if(foreground)DomainEngine.command("RecordFocusForegrounded")else DomainEngine.command("RecordFocusBackgrounded","reason" to reason),now)
            if (before != null && active() == null) afterObservedEnd(before, now)
        }
        fun afterObservedEnd(previous: JSONObject, now: Long) {
            val fact = checkNotNull(history(previous.getString("id")))
            val plan = context.plan
            when {
                fact.optString("interruptionReason") == "app-switch-limit" -> stopAfterIntegrity(now)
                plan != null -> afterCompletion(plan, fact, false)
                else -> recoverPending()
            }
        }
        private fun stopAfterIntegrity(now: Long) {
            // Keep valid rounds in history when leaving the plan. Pooled
            // rounds with no report stay unallocated and cannot reopen a report.
            val plan=context.plan
            val pending=plan?.let(::unsettled).orEmpty()
            val pooled=when{
                plan==null->emptyList()
                plan.mode!=PlanMode.ROUNDS->pending
                plan.extensionStartedAt!=null->pending.filter{history(it)?.optBoolean("deferredSettlement")==true}
                else->emptyList()
            }
            if (pooled.isNotEmpty()) command(DomainEngine.command("ReportMarathonFocus", "focusSessionIds" to JSONArray(pooled),
                "entries" to JSONArray(), "habitAllocations" to JSONArray()), now)
            if(plan?.extensionStartedAt!=null&&plan.mode==PlanMode.ROUNDS&&plan.subtaskId!=null&&pending.isNotEmpty()){
                val task=checkNotNull(project(plan.projectId)).getJSONArray("subtasks")
                val current=(0 until task.length()).map(task::getJSONObject).first{it.getString("id")==plan.subtaskId}
                command(DomainEngine.command("ReportSubtaskProgress","reportId" to "integrity:${plan.id}","subtaskId" to plan.subtaskId,
                    "focusSessionIds" to JSONArray(pending),"progressBasisPoints" to current.getLong("progressBasisPoints")),now)
            }
            context = RecoveryContext()
        }
        private fun stoppedWaitingPlan(plan: SavedPlan): Boolean {
            if (plan.phase != PlanPhase.READY || !plan.hasStarted) return false
            val facts = image.getJSONArray("focusHistory")
            val latest = facts.optJSONObject(facts.length() - 1) ?: return false
            return latest.optString("interruptionReason") == "app-switch-limit" &&
                latest.getString("id").startsWith("session:${plan.id}:")
        }
        fun confirm(spec:PlanRequest,now:Long){
            require(active()==null&&context.plan==null){"A plan is already pending"}
            require(spec.rounds in 1..24&&spec.focusMs in 1..10800000&&spec.restMs in 0..3600000&&spec.id.isNotBlank())
            val end=spec.exactEndAt?.let{DomainTime.millis(it)};require(end==null||end>now)
            if(image.opt("activeProjectId")!=spec.projectId)command(DomainEngine.command("SwitchActiveProject","projectId" to spec.projectId),now)
            context=RecoveryContext(SavedPlan(spec.id,spec.projectId,spec.subtaskId,spec.mode,spec.rounds,emptyList(),PlanPhase.READY,spec.focusMs,spec.restMs,exactEndAt=spec.exactEndAt,extendAfterPlan=spec.extendAfterPlan))
        }
        fun start(requestId:String,automatic:Boolean,now:Long){
            val p=context.plan?:throw FocusFailure("PLAN_NOT_FOUND");if(p.phase!=PlanPhase.READY)throw FocusFailure("PLAN_NOT_READY")
            val grant=if(automatic&&p.completedSessionIds.size+1<p.totalRounds)ContinuationGrant("grant:$requestId",base.token.replacementGeneration,p.completedSessionIds.lastOrNull())else null
            context=RecoveryContext(p,grant);startAt(now,requestId)
        }
        fun project(id: String) = objects("projects").firstOrNull { it.getString("id") == id }
        private fun objects(name: String): List<JSONObject> { val a = image.getJSONArray(name); return List(a.length()) { a.getJSONObject(it) } }
        fun history(id: String) = objects("focusHistory").firstOrNull { it.getString("id") == id }
        fun unsettled(p: SavedPlan): List<String> {
            fun ids(a: JSONArray) = List(a.length()) { a.getString(it) }
            val used = (objects("progressReports").flatMap { ids(it.getJSONArray("focusSessionIds")) } +
                objects("habitBuildings").flatMap { ids(it.getJSONArray("focusSessionIds")) } +
                objects("projects").flatMap { it.optJSONObject("habit")?.let { h -> ids(h.getJSONArray("completedFocusSessionIds")) }.orEmpty() }).toSet()
            return objects("focusHistory").mapNotNull{s->
                s.getString("id").takeIf{p.completed(it)&&!s.has("settledAt")&&it !in used}
            }
        }
        fun finish(p: SavedPlan): RecoveryContext = if (unsettled(p).isNotEmpty()) RecoveryContext(p.copy(phase = PlanPhase.REPORT, currentSessionId = null, phaseEndsAt = null, terminalRest = false)) else RecoveryContext()
        fun recoverPending() {
            if(context.plan!=null||active()!=null)return
            val reported=objects("progressReports").flatMap{it.getJSONArray("focusSessionIds").let{a->List(a.length()){a.getString(it)}}}.toSet()
            val candidate=objects("focusHistory").lastOrNull{f->
                f.getString("status")!="interrupted"&&!f.has("settledAt")&&f.getString("id") !in reported&&project(f.getString("projectId"))?.let{p->
                    p.getString("status")!="deleted"&&(f.opt("deferredSettlement")==true||p.getString("kind")!="habit")
                }==true
            }?:return
            val mode=if(candidate.opt("deferredSettlement")==true)PlanMode.MINIMAL else if(candidate.opt("marathon")==true)PlanMode.MARATHON else PlanMode.ROUNDS
            val owner=candidate.getString("projectId")
            val sessions=if(mode==PlanMode.ROUNDS)listOf(candidate.getString("id")) else objects("focusHistory").filter{it.getString("projectId")==owner&&it.opt("marathon")==true&&it.getString("status")!="interrupted"&&!it.has("settledAt")&&it.getString("id") !in reported}.take(24).map{it.getString("id")}
            val recovered=SavedPlan("recovered:${candidate.getString("id")}",owner,if(candidate.isNull("subtaskId"))null else candidate.getString("subtaskId"),mode,sessions.size,sessions,PlanPhase.REPORT,
                // This is a report entrance, not a restored schedule. The full
                // imported duration remains in the fact; no future round uses it.
                minOf(candidate.getLong("plannedDurationMs"),10800000),0)
            context=finish(recovered)
        }
        fun startAt(at: Long, nonce: String) {
            val p = context.plan ?: return
            val extending=p.extensionStartedAt!=null
            val exact=p.exactEndAt.takeUnless{extending}
            val duration = minOf(p.focusDurationMs, exact?.let { DomainTime.millis(it) - at } ?: Long.MAX_VALUE)
            if (duration <= 0) { context = finish(p); return }
            val sessionId = if(extending)p.extensionSessionId(p.extensionRounds+1)else "session:${p.id}:${p.completedSessionIds.size + 1}:${StrictJson.sha(nonce).take(16)}"
            val cmd = DomainEngine.command("StartFocus", "sessionId" to sessionId, "projectId" to p.projectId, "subtaskId" to p.subtaskId, "plannedDurationMs" to duration)
            // A filled habit building needs an explicit next-blueprint choice.
            // Time can continue without advancing that building a second time.
            val deferred=p.mode==PlanMode.MINIMAL||extending&&project(p.projectId)?.optJSONObject("habit")?.optBoolean("awaitingNextBuilding")==true
            if (p.mode != PlanMode.ROUNDS||deferred) cmd.put("marathon", true)
            if (deferred) cmd.put("deferredSettlement", true)
            if (exact != null) cmd.put("deadlineAt", exact)
            command(cmd, at)
            context = context.copy(plan = p.copy(phase = PlanPhase.FOCUS, currentSessionId = sessionId, phaseEndsAt = active()!!.getString("endsAt"), terminalRest = false,hasStarted=true))
        }
        fun afterReport(p: SavedPlan, at: Long) {
            val owner = project(p.projectId)
            if (p.cancelled || p.extensionStartedAt!=null || p.completedSessionIds.size >= p.totalRounds || owner?.getString("status") == "monument") { context = RecoveryContext(); return }
            rest(p, at)
        }
        private fun startExtension(p:SavedPlan,at:Long){
            context=RecoveryContext(p.copy(extensionStartedAt=DomainTime.format(at),restStartedAt=null))
            startAt(at,p.id)
        }
        fun endExtension(p:SavedPlan,now:Long){
            if(p.mode==PlanMode.ROUNDS&&p.subtaskId==null){
                val pooled=unsettled(p)
                if(pooled.isNotEmpty())command(DomainEngine.command("ReportMarathonFocus","focusSessionIds" to JSONArray(pooled),
                    "entries" to JSONArray(),"habitAllocations" to JSONArray()),now)
            }
            context=finish(p)
        }
        fun afterCompletion(p: SavedPlan, done: JSONObject, manual: Boolean) {
            val id = done.getString("id")
            val at = DomainTime.millis(done.getString("completedAt"))
            if(p.extensionStartedAt!=null){
                context=RecoveryContext(p.copy(extensionRounds=p.extensionRounds+1))
                startAt(at,p.id)
                return
            }
            val next = p.copy(completedSessionIds = (p.completedSessionIds + id).distinct(), currentSessionId = null, phaseEndsAt = null, terminalRest = false)
            context = context.copy(plan = next, automatic = if (manual) null else context.automatic?.copy(predecessorSessionId = id))
            val owner = project(p.projectId)!!
            val exact = p.exactEndAt?.let(DomainTime::millis)
            if(!manual&&next.completedSessionIds.size==p.totalRounds&&p.extendAfterPlan&&(exact==null||exact<=at)){
                startExtension(next,at);return
            }
            if (p.mode == PlanMode.ROUNDS && owner.getString("kind") != "habit") { context = context.copy(plan = next.copy(phase = PlanPhase.REPORT)); return }
            if (owner.getString("kind") == "habit" && p.mode != PlanMode.MINIMAL && owner.getJSONObject("habit").getBoolean("awaitingNextBuilding")) { context = RecoveryContext(); return }
            if (next.completedSessionIds.size >= p.totalRounds) {
                if (exact != null && exact > at && p.restDurationMs > 0) {
                    context = RecoveryContext(next.copy(phase = PlanPhase.REST, restStartedAt=DomainTime.format(at), phaseEndsAt = DomainTime.format(minOf(exact, at + p.restDurationMs)), terminalRest = true))
                } else context = finish(next)
            } else rest(next, at)
        }
        private fun rest(p: SavedPlan, at: Long) {
            val end = minOf(at + p.restDurationMs, p.exactEndAt?.let(DomainTime::millis) ?: Long.MAX_VALUE)
            if (end <= at) {
                context = context.copy(plan = p.copy(phase = PlanPhase.READY, phaseEndsAt = null, terminalRest = false))
                if (context.automatic != null) startAt(at, "${context.automatic!!.id}:${p.completedSessionIds.size + 1}")
            } else context = context.copy(plan = p.copy(phase = PlanPhase.REST, restStartedAt=DomainTime.format(at), phaseEndsAt = DomainTime.format(end), terminalRest = p.exactEndAt?.let { end >= DomainTime.millis(it) } == true))
        }
        fun advance(now: Long) {
            repeat(50) {
                val p = context.plan
                val active = active()
                if (active != null) {
                    val end = DomainTime.millis(active.getString("endsAt")); if (end > now) return
                    command(DomainEngine.command("CompleteFocus"), now)
                    if (p != null) afterCompletion(p, history(active.getString("id"))!!, false)
                    else {
                        // Reconstruct a manual report entrance from the imported
                        // fact, never an automatic schedule from history.
                        recoverPending();return
                    }
                } else if (p?.phase == PlanPhase.REST && DomainTime.millis(p.phaseEndsAt!!) <= now) {
                    val at = DomainTime.millis(p.phaseEndsAt!!)
                    if (p.terminalRest) {
                        if(p.extendAfterPlan){startExtension(p,at);return@repeat}
                        context = finish(p);return
                    }
                    context = context.copy(plan = p.copy(phase = PlanPhase.READY, phaseEndsAt = null))
                    if (context.automatic != null) startAt(at, "${context.automatic!!.id}:${p.completedSessionIds.size + 1}") else {
                        if(p.mode!=PlanMode.ROUNDS&&p.completedSessionIds.size<p.totalRounds){
                            context=context.copy(returnReminder=ReturnReminder(database,base.token.replacementGeneration,p.id,p.completedSessionIds.size,p.phaseEndsAt!!))
                            signals += JSONObject().put("type","ReturnToFocusReady").put("planId",p.id).toString()
                        }
                        return
                    }
                } else {
                    if (p == null) recoverPending()
                    else if (stoppedWaitingPlan(p)) stopAfterIntegrity(now)
                    return
                }
            }
            // An indefinitely extended plan can be many rounds overdue after
            // a process stop. Persist this batch and let its next ticket resume.
            if(context.plan?.extensionStartedAt==null)error("Plan reconciliation exceeded bounded phase count")
        }
    }
}
