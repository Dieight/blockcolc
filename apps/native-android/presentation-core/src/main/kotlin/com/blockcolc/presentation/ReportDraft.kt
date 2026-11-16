package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.storage.PlanMode
import com.blockcolc.storage.PlanPhase
import com.blockcolc.storage.RecoveryContext
import org.json.JSONArray
import org.json.JSONObject

data class ReportSession(val id:String,val durationMs:Long)
data class ReportTarget(val projectId:String,val projectTitle:String,val taskId:String?,val title:String,val progress:Int,val maxRounds:Int,
    val projectProgress:Int=0,val habitCycle:Int?=null,val habitCompleted:Int?=null,val habitTarget:Int?=null)
data class ReportPool(val planId:String,val mode:PlanMode,val sessions:List<ReportSession>,val targets:List<ReportTarget>){
    val totalRounds get()=sessions.size
    companion object {
        fun from(domain:DomainDocument,recovery:RecoveryContext):ReportPool? {
            if(recovery.plan?.phase!=PlanPhase.REPORT)return null
            return from(domain.json(),recovery)
        }
        fun from(s:JSONObject,recovery:RecoveryContext):ReportPool? {
            val plan=recovery.plan?.takeIf{it.phase==PlanPhase.REPORT}?:return null
            fun rows(key:String)=s.getJSONArray(key).let{a->List(a.length()){a.getJSONObject(it)}}
            fun ids(x:JSONObject,key:String)=x.getJSONArray(key).let{a->List(a.length()){a.getString(it)}}
            val projects=rows("projects")
            val used=(rows("progressReports").flatMap{ids(it,"focusSessionIds")}+
                rows("habitBuildings").flatMap{ids(it,"focusSessionIds")}+
                projects.flatMap{it.optJSONObject("habit")?.let{h->ids(h,"completedFocusSessionIds")}.orEmpty()}).toSet()
            val sessions=rows("focusHistory").filter{it.getString("id") in plan.completedSessionIds&&it.getString("id") !in used&&
                it.getString("status")!="interrupted"&&!it.has("settledAt")}
                .sortedWith(compareBy<JSONObject>{DomainTime.millis(it.getString("completedAt"))}.thenBy{it.getString("id")})
                .map{ReportSession(it.getString("id"),it.getLong("actualDurationMs"))}
            val targets=projects.filter{it.getString("status")!="deleted"}.flatMap{p->
                val projectId=p.getString("id");val title=p.getString("title")
                if(plan.mode==PlanMode.ROUNDS&&projectId!=plan.projectId)emptyList()
                else if(p.getString("kind")=="habit"){
                    val h=p.getJSONObject("habit")
                    if(plan.mode==PlanMode.ROUNDS||h.getBoolean("awaitingNextBuilding"))emptyList()
                    else listOf(ReportTarget(projectId,title,null,title,0,minOf(sessions.size,h.getInt("targetRounds")-h.getJSONArray("completedFocusSessionIds").length()),
                        habitCycle=h.getInt("cycleNumber"),habitCompleted=h.getJSONArray("completedFocusSessionIds").length(),habitTarget=h.getInt("targetRounds")))
                }else p.getJSONArray("subtasks").let{a->
                    val tasks=List(a.length()){a.getJSONObject(it)}
                    val progress=if(tasks.isEmpty())0 else tasks.sumOf{it.getLong("progressBasisPoints")}.div(tasks.size).toInt()
                    tasks.filter{if(plan.mode==PlanMode.ROUNDS)it.getString("id")==plan.subtaskId else it.getInt("progressBasisPoints")<10000}
                        .map{ReportTarget(projectId,title,it.getString("id"),it.getString("title"),it.getInt("progressBasisPoints"),sessions.size,projectProgress=progress)}
                }
            }
            return ReportPool(plan.id,plan.mode,sessions,targets)
        }
    }
}

data class TaskAllocation(val projectId:String,val taskId:String,val progress:Int,val rounds:Int=0)
data class HabitAllocation(val projectId:String,val rounds:Int)
data class ReportDraft(val planId:String,val tasks:List<TaskAllocation> = emptyList(),val habits:List<HabitAllocation> = emptyList()){
    val allocated get()=tasks.sumOf{it.rounds.toLong()}+habits.sumOf{it.rounds.toLong()}
    fun validate(pool:ReportPool){
        require(pool.planId==planId&&pool.totalRounds>0){"This report is no longer pending"}
        require(tasks.map{it.taskId}.distinct().size==tasks.size&&habits.map{it.projectId}.distinct().size==habits.size){"Duplicate allocation"}
        require(tasks.all{it.rounds>=0}&&habits.all{it.rounds>0})
        require(allocated<=pool.totalRounds){"Too many allocated rounds"}
        for(task in tasks){
            val target=pool.targets.find{it.projectId==task.projectId&&it.taskId==task.taskId}?:error("Task is no longer available")
            require(task.progress in target.progress..10000&&task.rounds<=target.maxRounds){"Invalid task progress or rounds"}
            require(task.rounds>0||task.progress==target.progress){"Advancing progress requires an explicit round"}
        }
        for(habit in habits){
            val target=pool.targets.find{it.projectId==habit.projectId&&it.taskId==null}?:error("Habit is no longer available")
            require(habit.rounds<=target.maxRounds){"The habit building cannot receive these rounds"}
        }
        if(pool.mode==PlanMode.ROUNDS){
            require(tasks.size==1&&tasks.single().rounds==1&&habits.isEmpty()&&pool.totalRounds==1){"An ordinary report belongs to its single pending subtask"}
        }
    }
    /** Rebuilt against saved state immediately before submit; caller supplies
     * fresh report IDs. No shared/guessed attribution or optimistic progress. */
    fun command(pool:ReportPool,newId:()->String):JSONObject {
        validate(pool)
        if(pool.mode==PlanMode.ROUNDS){val t=tasks.single();return DomainEngine.command("ReportSubtaskProgress","reportId" to newId(),
            "subtaskId" to t.taskId,"focusSessionIds" to JSONArray(pool.sessions.map{it.id}),"progressBasisPoints" to t.progress)}
        val entries=JSONArray(tasks.filter{it.rounds>0}.map{t->JSONObject().put("reportId",newId()).put("projectId",t.projectId)
            .put("subtaskId",t.taskId).put("progressBasisPoints",t.progress).put("rounds",t.rounds)})
        val habitEntries=JSONArray(habits.map{JSONObject().put("projectId",it.projectId).put("rounds",it.rounds)})
        return DomainEngine.command("ReportMarathonFocus","focusSessionIds" to JSONArray(pool.sessions.map{it.id}),"entries" to entries,"habitAllocations" to habitEntries)
    }
    /** Preview follows the formal habit-first, then ordinary-target assignment
     * order. Partial final rounds keep their actual duration, not a mean. */
    fun assignedDurations(pool:ReportPool):Map<String,Long>{
        validate(pool);val result=linkedMapOf<String,Long>();var offset=0
        for(h in habits){result["habit:${h.projectId}"]=pool.sessions.drop(offset).take(h.rounds).sumOf{it.durationMs};offset+=h.rounds}
        for(t in tasks){if(t.rounds>0){result["task:${t.taskId}"]=pool.sessions.drop(offset).take(t.rounds).sumOf{it.durationMs};offset+=t.rounds}}
        return result
    }
}
