package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainTime
import com.blockcolc.storage.*
import org.json.JSONObject

enum class TimerSurface { IDLE, PREPARED, FOCUS, REST, WAITING, REPORT }
data class TimerPresentation(val surface:TimerSurface,val planId:String?,val mode:PlanMode?,val completedRounds:Int,val totalRounds:Int,
    val projectId:String?,val taskTitle:String?,val deadline:String?,val remainingMs:Long,val minimalReport:Boolean,
    val mayCancelUnstarted:Boolean,val mayCancelRunning:Boolean,val subtaskId:String?=null){
    companion object {
        fun from(domain:DomainDocument,recovery:RecoveryContext,preferences:ClientPreferences,now:Long):TimerPresentation = from(domain.json(),recovery,preferences,now)
        fun from(s:JSONObject,recovery:RecoveryContext,preferences:ClientPreferences,now:Long):TimerPresentation{
            val p=recovery.plan;val active=s.optJSONObject("activeFocusSession")
            val surface=when{
                active!=null->TimerSurface.FOCUS
                p==null->TimerSurface.IDLE
                p.phase==PlanPhase.REPORT->TimerSurface.REPORT
                p.phase==PlanPhase.REST->TimerSurface.REST
                p.hasStarted->TimerSurface.WAITING
                else->TimerSurface.PREPARED
            }
            val project=p?.projectId?:active?.getString("projectId")?:if(s.isNull("activeProjectId"))null else s.getString("activeProjectId")
            val owner=s.getJSONArray("projects").let{a->(0 until a.length()).map{a.getJSONObject(it)}.find{it.getString("id")==project}}
            val task=if(active!=null&&!active.isNull("subtaskId"))active.getString("subtaskId") else p?.subtaskId
            val title=if(p?.mode==PlanMode.ROUNDS||p==null)owner?.getJSONArray("subtasks")?.let{a->(0 until a.length()).map{a.getJSONObject(it)}.find{it.getString("id")==task}?.getString("title")} else null
            val completed=p?.completedSessionIds?.size?:0
            val deadline=active?.getString("endsAt")?:p?.phaseEndsAt
            val exact=p?.exactEndAt
            val remaining=when{
                deadline!=null->maxOf(0,DomainTime.millis(deadline)-now)
                p==null->(if(owner?.getString("kind")=="habit")preferences.habitFocusMinutes else preferences.focusMinutes)*60000L
                exact!=null->maxOf(0,DomainTime.millis(exact)-now)
                else->{val rounds=maxOf(0,p.totalRounds-completed);rounds*p.focusDurationMs+maxOf(0,rounds-1)*p.restDurationMs}
            }
            return TimerPresentation(surface,p?.id,p?.mode,completed,p?.totalRounds?:1,project,title,deadline?:p?.exactEndAt,remaining,
                p?.mode in setOf(PlanMode.MINIMAL,PlanMode.MARATHON),
                p?.mode==PlanMode.MARATHON&&surface==TimerSurface.PREPARED,
                p!=null&&p.mode!=PlanMode.ROUNDS&&p.totalRounds>1&&surface in setOf(TimerSurface.FOCUS,TimerSurface.REST),task)
        }
    }
}
