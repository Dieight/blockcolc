package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainTime
import com.blockcolc.focus.PlanRequest
import com.blockcolc.storage.PlanMode
import com.blockcolc.storage.RecoveryContext
import org.json.JSONObject

data class TaskChoice(val id:String,val title:String,val progress:Int)
data class ProjectChoice(val id:String,val title:String,val habit:Boolean,val current:Boolean,val canStart:Boolean,val tasks:List<TaskChoice>)

object FocusChoices {
    fun projects(domain:DomainDocument):List<ProjectChoice> = projects(domain.focusControlJson())
    fun projects(s:JSONObject):List<ProjectChoice> {
        val a=s.getJSONArray("projects");val active=if(s.isNull("activeProjectId"))null else s.getString("activeProjectId")
        return (0 until a.length()).map{a.getJSONObject(it)}.filter{it.getString("status") in setOf("active","paused")}.map{p->
            val tasks=p.getJSONArray("subtasks");val habit=p.getString("kind")=="habit"
            ProjectChoice(p.getString("id"),p.getString("title"),habit,p.getString("id")==active,
                !habit||!p.getJSONObject("habit").getBoolean("awaitingNextBuilding"),
                (0 until tasks.length()).map{tasks.getJSONObject(it)}.filter{it.getInt("progressBasisPoints")<10000}.map{TaskChoice(it.getString("id"),it.getString("title"),it.getInt("progressBasisPoints"))})
        }.sortedWith(compareBy<ProjectChoice>{if(it.current)0 else if(it.habit)1 else 2})
    }
}
sealed interface DraftSchedule {
    data class Rounds(val count:Int):DraftSchedule
    data class EndAt(val epochMs:Long):DraftSchedule
}
data class FocusDraft(val projectId:String,val subtaskId:String?,val mode:PlanMode,val schedule:DraftSchedule,
    val replacingUnstartedPlanId:String?=null) {
    /** Called again at confirmation against the latest saved state. Building
     * this request never switches a project, commits a plan or starts a timer. */
    fun prepare(id:String,domain:DomainDocument,recovery:RecoveryContext,preferences:ClientPreferences,now:Long):PlanRequest {
        preferences.validate();require(id.isNotBlank())
        require(recovery.plan==null&&domain.activeFocusSession()==null){"A saved plan/session already exists"}
        val owner=FocusChoices.projects(domain).find{it.id==projectId}?:error("Project is unavailable")
        require(owner.canStart){"Choose the next habit building first"}
        // Marathon recovery retains its original bookkeeping anchor. It does
        // not select a report target: attribution is still deferred until the
        // shared report. A deadline editor therefore need not choose a task.
        val task=if(mode==PlanMode.MINIMAL||owner.habit)null else {
            val candidate=subtaskId?:if(mode==PlanMode.MARATHON)owner.tasks.firstOrNull()?.id else null
            candidate?.takeIf{id->owner.tasks.any{it.id==id}}?:error("Choose an unfinished subtask")
        }
        val minutes=if(owner.habit&&mode==PlanMode.ROUNDS)preferences.habitFocusMinutes else preferences.focusMinutes
        val end=(schedule as? DraftSchedule.EndAt)?.epochMs
        require(end==null||mode!=PlanMode.ROUNDS){"End-time plans use marathon/minimal settlement"}
        val rounds=when(val plan=schedule){
            is DraftSchedule.Rounds->plan.count.also{require(it in 1..24)}
            is DraftSchedule.EndAt->{
                val duration=Math.subtractExact(plan.epochMs,now)
                val result=EndTimeSchedule.forDuration(duration,minutes,preferences.breakMinutes,25)?:error("Choose a future deadline")
                require(result.rounds<=24){"A plan cannot exceed 24 rounds"};result.rounds
            }
        }
        return PlanRequest(id,owner.id,task,mode,rounds,minutes*60000L,preferences.breakMinutes*60000L,end?.let(DomainTime::format),preferences.autoExtendFocus)
    }
}
data class EndTimeSchedule(val rounds:Int,val breaks:Int,val usableMs:Long) {
    companion object {
        /** Formal planRoundsForDuration, including terminal short rest. Callers
         * request max+1 to detect an excessive plan rather than silently cap it. */
        fun forDuration(durationMs:Long,focusMinutes:Int,breakMinutes:Int,maxRounds:Int=24):EndTimeSchedule? {
            require(focusMinutes in 1..180&&breakMinutes in 0..60&&maxRounds>0)
            if(durationMs<=0)return null
            val focus=focusMinutes*60000L;val rest=breakMinutes*60000L;val cycle=focus+rest
            val count=1+(durationMs-1)/cycle;val capped=minOf(count,maxRounds.toLong()).toInt()
            val breaks=if(rest>0)maxOf(0,capped-1)+(if(durationMs>capped*focus+(capped-1)*rest)1 else 0)else 0
            return EndTimeSchedule(capped,breaks,minOf(durationMs,capped*cycle))
        }
    }
}
