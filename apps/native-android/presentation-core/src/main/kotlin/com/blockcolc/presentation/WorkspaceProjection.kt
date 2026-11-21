package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainTime
import com.blockcolc.focus.FocusProjection
import java.time.LocalDate
import org.json.JSONObject

data class DailyTarget(val date:String,val target:Int,val enabled:Boolean,val completed:Int,val reached:Boolean)
data class IntegritySettings(val enabled:Boolean,val excursions:Int,val thresholdSeconds:Int)
data class BirthdaySettings(val enabled:Boolean,val month:Int?,val day:Int?)
data class WorkspaceSettings(val timeZone:String,val restWeekdays:List<Int>,val integrity:IntegritySettings,val birthday:BirthdaySettings,val environment:String)
data class ProjectDetails(val id:String,val structureLocked:Boolean,val habitTarget:Int?,val habitApplied:Int,val habitCycle:Int?,val awaitingBuilding:Boolean)
data class TimeTarget(val key:String,val projectId:String?,val taskId:String?,val projectTitle:String,val title:String?,val durationMs:Long,val unknown:Boolean)
data class DayStatistics(val date:String,val durationMs:Long,val completed:Int,val interrupted:Int,val goal:Int,val targets:List<TimeTarget>)
data class StatisticsRange(val start:String,val end:String,val durationMs:Long,val completed:Int,val interrupted:Int,val goal:Long,val activeDays:Int,val targets:List<TimeTarget>)
enum class WorkspaceDetails { PREPARING, READY, FAILED }
data class WorkspaceProjection(val today:String,val settings:WorkspaceSettings,val projects:List<ProjectDetails>,val dailyTargets:List<DailyTarget>,val days:List<DayStatistics>,val achievements:List<AchievementProgress> = emptyList(),val memories:WorldMemories=WorldMemories(emptyList(),emptyList(),emptyList()),val todayTimeline:TodayFocusTimeline?=null,val details:WorkspaceDetails=WorkspaceDetails.READY){
    val todayGoal get()=dailyTargets.find{it.date==today}?:DailyTarget(today,8,true,days.find{it.date==today}?.completed?:0,false)
    fun range(first:String,last:String):StatisticsRange{
        LocalDate.parse(first);LocalDate.parse(last)
        val start=minOf(first,last);val end=maxOf(first,last);val selected=days.filter{it.date in start..end}
        val count=java.time.temporal.ChronoUnit.DAYS.between(LocalDate.parse(start),LocalDate.parse(end))+1
        val goal=count*8+dailyTargets.filter{it.date in start..end}.sumOf{(if(it.enabled)it.target.toLong()else 0L)-8}
        val targets=selected.flatMap{it.targets}.groupBy{it.key}.values.map{values->values.first().copy(durationMs=values.sumOf{it.durationMs})}.filter{it.durationMs>0}.sortedByDescending{it.durationMs}
        return StatisticsRange(start,end,selected.sumOf{it.durationMs},selected.sumOf{it.completed},selected.sumOf{it.interrupted},goal,selected.count{it.durationMs>0},targets)
    }
    companion object {
        fun from(domain:DomainDocument,now:Long):WorkspaceProjection = from(domain.projectionJson(),now)
        fun from(s:JSONObject,now:Long):WorkspaceProjection = prepare(s,now).complete()

        /** Reads a detached, validated snapshot. The caller owns it and must
         * keep it read-only while the detail computation is in flight. */
        fun prepare(s:JSONObject,now:Long):WorkspacePreparation{
            fun rows(name:String)=s.getJSONArray(name).let{a->List(a.length()){a.getJSONObject(it)}}
            val calendar=s.getJSONObject("calendar");val zone=calendar.getString("timeZone");val today=DomainTime.localDate(DomainTime.format(now),zone)
            val integrity=s.getJSONObject("focusIntegrityPolicy");val birthday=s.getJSONObject("birthday")
            val settings=WorkspaceSettings(zone,calendar.getJSONArray("restWeekdays").let{a->List(a.length()){a.getInt(it)}},
                IntegritySettings(integrity.getBoolean("enabled"),integrity.getInt("maxEffectiveExcursions"),integrity.getInt("excursionThresholdSeconds")),
                BirthdaySettings(birthday.getBoolean("enabled"),if(birthday.isNull("month"))null else birthday.getInt("month"),if(birthday.isNull("day"))null else birthday.getInt("day")),
                s.getJSONObject("worldSettings").getString("environmentStyle"))
            val projects=rows("projects").map{p->val habit=p.optJSONObject("habit");ProjectDetails(p.getString("id"),p.getBoolean("subtaskStructureLocked"),
                habit?.getInt("targetRounds"),habit?.getJSONArray("completedFocusSessionIds")?.length()?:0,habit?.getInt("cycleNumber"),habit?.getBoolean("awaitingNextBuilding")==true)}
            data class Totals(var duration:Long=0,var completed:Int=0,var interrupted:Int=0)
            val totals=HashMap<String,Totals>()
            val sessionDates=HashMap<String,String>()
            for(session in rows("focusHistory")){
                val interrupted=session.getString("status")=="interrupted"
                val date=if(interrupted)DomainTime.localDate(session.getString("interruptedAt"),session.getString("timeZoneAtStart"))
                    else session.getString("completedLocalDate")
                sessionDates[session.getString("id")]=date
                val day=totals.getOrPut(date){Totals()}
                day.duration+=session.getLong("actualDurationMs")
                if(interrupted)day.interrupted++ else day.completed++
            }
            val goals=rows("dailyGoals").map{g->DailyTarget(g.getString("date"),g.getInt("targetPomodoros"),g.getBoolean("enabled"),totals[g.getString("date")]?.completed?:0,!g.isNull("reachedAt"))}
            val goalsByDate=goals.associateBy{it.date}
            val dates=(totals.keys+goalsByDate.keys+today).sorted()
            val days=dates.map{date->
                val day=totals[date]
                DayStatistics(date,day?.duration?:0,day?.completed?:0,day?.interrupted?:0,
                    goalsByDate[date]?.let{if(it.enabled)it.target else 0}?:8,emptyList())
            }
            return WorkspacePreparation(WorkspaceProjection(today,settings,projects,goals,days,details=WorkspaceDetails.PREPARING),s,sessionDates)
        }
    }
}

/** Date and goal totals come from verified history. Attribution and world
 * memories can then be computed independently from the same snapshot. */
class WorkspacePreparation internal constructor(val summary:WorkspaceProjection,private val state:JSONObject,private val sessionDates:Map<String,String>){
    fun complete():WorkspaceProjection{
        val attribution=FocusProjection.reportedAttribution(state).getJSONArray("sessions").let{a->List(a.length()){a.getJSONObject(it)}}
        val byDate=attribution.groupBy{sessionDates.getValue(it.getString("sessionId"))}
        val days=summary.days.map{day->
            val targets=byDate[day.date].orEmpty().groupBy{a->if(a.getString("kind")=="unallocated")"unknown" else a.getString("kind")+":"+a.getString("targetId")}.map{(key,items)->
                val first=items.first();val unknown=first.getString("kind")=="unallocated"
                TimeTarget(key,if(first.isNull("projectId"))null else first.getString("projectId"),if(first.isNull("subtaskId"))null else first.getString("subtaskId"),
                    first.getString("projectTitle"),if(first.isNull("targetTitle"))null else first.getString("targetTitle"),items.sumOf(FocusProjection::reportedDuration),unknown)
            }.sortedByDescending{it.durationMs}
            day.copy(targets=targets)
        }
        return summary.copy(days=days,achievements=AchievementProjection.from(state),memories=WorldMemoryProjection.from(state,attribution),
            todayTimeline=TodayFocusProjection.from(state,summary.today,attribution),details=WorkspaceDetails.READY)
    }
}
