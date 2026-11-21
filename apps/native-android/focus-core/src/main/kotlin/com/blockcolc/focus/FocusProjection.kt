package com.blockcolc.focus

import com.blockcolc.domain.*
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.floor

/** Read-only projection; ambiguous legacy rounds stay unknown, never guessed from their host. */
object FocusProjection {
    fun attribution(doc: DomainDocument): JSONObject = attribution(doc.focusControlJson())
    /** Read an actor-owned snapshot without retaining or mutating it. */
    fun attribution(s: JSONObject): JSONObject=project(s,false)
    fun reportedAttribution(doc:DomainDocument):JSONObject=reportedAttribution(doc.focusControlJson())
    fun reportedAttribution(s:JSONObject):JSONObject=project(s,true)

    private fun project(s:JSONObject,redistributeShortTime:Boolean):JSONObject {
        fun objects(name: String) = s.getJSONArray(name).let { a -> List(a.length()) { a.getJSONObject(it) } }
        fun ids(x: JSONObject, key: String) = x.getJSONArray(key).let { a -> List(a.length()) { a.getString(it) } }
        val projects = objects("projects").associateBy { it.getString("id") }
        val reports = HashMap<String,MutableList<JSONObject>>()
        for(report in objects("progressReports"))for(session in ids(report,"focusSessionIds"))
            reports.getOrPut(session){ArrayList()}.add(report)
        val habits = hashMapOf<String, MutableList<JSONObject>>()
        fun target(kind: String, project: JSONObject?, id: String, title: String, projectId: String?, projectTitle: String, task: JSONObject? = null) =
            JSONObject().put("kind", kind).put("projectId", projectId ?: JSONObject.NULL).put("projectTitle", project?.getString("title") ?: projectTitle)
                .put("subtaskId", task?.getString("id") ?: JSONObject.NULL).put("subtaskTitle", task?.getString("title") ?: JSONObject.NULL).put("targetId", id).put("targetTitle", title)
        for (b in objects("habitBuildings")) {
            val id = b.getString("habitProjectId"); val title = b.getString("habitTitle")
            val t = target("habit-building", projects[id], b.getString("id"), "$title · 第 ${b.getLong("cycleNumber")} 座", id, title)
            ids(b, "focusSessionIds").forEach { habits.getOrPut(it) { arrayListOf() }.add(t) }
        }
        for ((id, p) in projects) p.optJSONObject("habit")?.let { h ->
            val t = target("habit-project", p, id, p.getString("title"), id, p.getString("title"))
            ids(h, "completedFocusSessionIds").forEach { habits.getOrPut(it) { arrayListOf() }.add(t) }
        }
        val finiteTargets=HashMap<String,Map<String,JSONObject>>()
        fun finite(p: JSONObject, taskId: String): JSONObject? {
            val projectId=p.getString("id")
            return finiteTargets.getOrPut(projectId){
                val tasks=p.getJSONArray("subtasks")
                buildMap {
                    for(i in 0 until tasks.length()){
                        val task=tasks.getJSONObject(i);val id=task.getString("id")
                        if(id !in this)put(id,target("finite-subtask",p,id,task.getString("title"),projectId,p.getString("title"),task))
                    }
                }
            }[taskId]
        }
        val history=objects("focusHistory")
        val rows = history.sortedWith(compareBy<JSONObject> { it.getString(if (it.getString("status") == "interrupted") "interruptedAt" else "completedAt") }.thenBy { it.getString("id") }).map { f ->
            val sessionId=f.getString("id")
            var candidate:JSONObject?=null
            var conflict=false
            fun consider(target:JSONObject){
                val previous=candidate
                if(previous!=null&&previous.getString("targetId")!=target.getString("targetId"))conflict=true
                candidate=target
            }
            var shared=false
            for(report in reports[sessionId].orEmpty()){
                if(report.opt("shared")==true){shared=true;continue}
                val project=projects[report.getString("projectId")]?:continue
                val attributed=finite(project,report.getString("subtaskId"))?:continue
                consider(attributed)
            }
            for(habit in habits[sessionId].orEmpty())consider(habit)
            val reason = when {
                conflict || shared && candidate!=null -> "conflicting-owners"
                candidate!=null -> null
                shared -> "legacy-shared"
                f.opt("marathon") == true -> if (f.getString("status") == "interrupted") "interrupted-marathon" else if (f.has("settledAt")) "discarded" else "not-reported"
                f.opt("deferredSettlement") == true -> "not-reported"
                else -> null
            }
            val owner = if (reason != null) null else candidate ?: projects[f.getString("projectId")]?.let { p ->
                if (p.getString("kind") == "habit") target("habit-project", p, p.getString("id"), p.getString("title"), p.getString("id"), p.getString("title"))
                else if (f.isNull("subtaskId")) null else finite(p, f.getString("subtaskId"))
            }
            val out = JSONObject().put("sessionId", sessionId).put("endedAt", f.getString(if (f.getString("status") == "interrupted") "interruptedAt" else "completedAt"))
                .put("timeZoneAtStart", f.getString("timeZoneAtStart")).put("actualDurationMs", f.getLong("actualDurationMs")).put("status", f.getString("status"))
            if (owner != null) { owner.keys().forEach { out.put(it, owner.get(it)) }; out.put("reason", JSONObject.NULL) }
            else {
                out.put("kind", "unallocated").put("projectTitle", "未分配 / 不可追溯").put("reason", reason ?: "missing-session")
                for (key in listOf("projectId", "subtaskId", "subtaskTitle", "targetId", "targetTitle")) out.put(key, JSONObject.NULL)
            }; out
        }
        if(redistributeShortTime)attributeReportTimes(history,rows)
        val unknown = rows.filter { it.getString("kind") == "unallocated" }
        val completed = unknown.count { it.getString("status") != "interrupted" && it.getLong("actualDurationMs") > 0 }
        val interrupted = unknown.count { it.getString("status") == "interrupted" && reportedDuration(it) > 0 }
        return JSONObject().put("sessions", JSONArray(rows)).put("unallocated", JSONObject().put("rounds", completed + interrupted).put("completedRounds", completed).put("interruptedRounds", interrupted).put("minutes", floor(unknown.sumOf(::reportedDuration) / 60000.0 + .5).toLong()))
    }

    private fun attributeReportTimes(history:List<JSONObject>,rows:List<JSONObject>){
        val byId=rows.associateBy{it.getString("sessionId")}
        val batches=history.filter{it.has("settledAt")}.groupBy{it.getString("projectId") to it.getString("settledAt")}
        for(sessions in batches.values){
            val recipients=sessions.filter{item->
                item.getString("status")!="interrupted"&&byId.getValue(item.getString("id")).getString("kind")!="unallocated"
            }.sortedWith(compareBy<JSONObject>{DomainTime.millis(it.getString("completedAt"))}.thenBy{it.getString("id")})
            val durations=FocusReportTime.distribute(sessions.map{
                ReportedFocusTime(it.getString("id"),it.getLong("actualDurationMs"),it.getLong("plannedDurationMs"))
            },recipients.map{it.getString("id")})
            for((id,ms) in durations)byId.getValue(id).put("reportedDurationMs",ms)
        }
    }

    fun reportedDuration(row:JSONObject)=row.optLong("reportedDurationMs",row.getLong("actualDurationMs"))
}
