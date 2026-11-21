package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.focus.FocusProjection
import org.json.JSONObject
import java.util.Collections

data class ArchiveTask(val id:String,val title:String,val durationMs:Long,val rounds:Int,val interrupted:Int,val interruptedMs:Long,val share:Int?)
data class BuildingArchive(val id:String,val projectId:String,val title:String,val cycleNumber:Long?,val completedAt:String?,val expectedRounds:Int?,
    val durationMs:Long,val rounds:Int,val interrupted:Int,val interruptedMs:Long,val unknownRounds:Int,val unknownMs:Long,val tasks:List<ArchiveTask>)
data class BuildingMemoryFact(val id:String,val projectId:String,val title:String,val cycleNumber:Long?,val status:String,val active:Boolean,val blueprint:String,
    val progress:Int,val condition:Int,val durationMs:Long,val completed:Int,val interrupted:Int,val interruptedMs:Long,val unknownRounds:Int,val unknownMs:Long,
    val lastFocusDate:String?,val nextTask:String?,val nextHabitRound:Int?,val habitTarget:Int?,val awaitingBuilding:Boolean)
data class RewardMemoryFact(val id:String,val resource:String,val title:String?,val kind:WorldAssetKind,val date:String,val holidayId:String?=null)
data class UnallocatedMemoryFact(val completed:Int=0,val interrupted:Int=0,val durationMs:Long=0){val rounds get()=completed+interrupted}
data class WorldMemories(val buildings:List<BuildingMemoryFact>,val rewards:List<RewardMemoryFact>,val archives:List<BuildingArchive>,val unallocated:UnallocatedMemoryFact=UnallocatedMemoryFact())

/** Read-only, exact ownership. A legacy shared session can be an explicit
 * unknown gap for a monument; it is never counted as its known task time. */
object WorldMemoryProjection {
    private fun <T> owned(values:List<T>)=Collections.unmodifiableList(values.toList())
    fun from(domain:DomainDocument):WorldMemories=from(domain.projectionJson(),null)
    internal fun from(state:JSONObject,knownAttribution:List<JSONObject>?):WorldMemories {
        fun rows(key:String)=state.getJSONArray(key).let{a->List(a.length()){a.getJSONObject(it)}}
        fun ids(row:JSONObject,key:String)=row.getJSONArray(key).let{a->List(a.length()){a.getString(it)}}
        val projects=rows("projects");val habits=rows("habitBuildings");val reports=rows("progressReports");val history=rows("focusHistory")
        val historyById=history.associateBy{it.getString("id")}
        val attribution=knownAttribution?:FocusProjection.reportedAttribution(state).getJSONArray("sessions").let{a->List(a.length()){a.getJSONObject(it)}}
        val bySession=attribution.associateBy{it.getString("sessionId")}
        val projectsById=projects.associateBy{it.getString("id")}
        val reportsByProject=reports.groupBy{it.getString("projectId")}
        fun known(row:JSONObject)=row.getString("kind")!="unallocated"
        fun complete(row:JSONObject)=row.getString("status")!="interrupted"&&row.getLong("actualDurationMs")>0
        fun interrupted(row:JSONObject)=row.getString("status")=="interrupted"&&row.getLong("actualDurationMs")>0
        fun duration(rows:List<JSONObject>)=rows.sumOf(FocusProjection::reportedDuration)
        val knownRows=attribution.filter(::known)
        val finiteByProject=knownRows.filter{it.getString("kind")=="finite-subtask"}.groupBy{it.optString("projectId")}
        val attributedByTarget=knownRows.groupBy{it.optString("targetId")}
        val marathonByProject=history.filter{it.optBoolean("marathon",false)}.groupBy{it.getString("projectId")}
        val sessionsByProject=HashMap<String,MutableList<JSONObject>>()
        val sessionsByTarget=HashMap<String,MutableList<JSONObject>>()
        // This traversal preserves stored history order for last-focus dates.
        for(session in history){
            val row=bySession[session.getString("id")]?.takeIf(::known)?:continue
            sessionsByProject.getOrPut(row.optString("projectId")){ArrayList()}.add(session)
            sessionsByTarget.getOrPut(row.optString("targetId")){ArrayList()}.add(session)
        }
        val archives=ArrayList<BuildingArchive>()
        for(project in projects.filter{it.getString("kind")=="finite"&&it.getString("status")=="monument"}){
            val id=project.getString("id");val sessions=finiteByProject[id].orEmpty()
            val projectReports=reportsByProject[id].orEmpty()
            val unknown=linkedSetOf<String>()
            for(report in projectReports)if(report.optBoolean("shared",false)||report.optString("allocation")=="explicit")
                for(session in ids(report,"focusSessionIds"))if(bySession[session]?.let(::known)!=true)unknown+=session
            for(session in marathonByProject[id].orEmpty()){
                val row=bySession[session.getString("id")]
                if(row?.let(::known)!=true&&row?.optString("reason")!="discarded"&&
                    (row==null||FocusProjection.reportedDuration(row)>0))unknown+=session.getString("id")
            }
            val unknownMs=unknown.sumOf{id->bySession[id]?.let(FocusProjection::reportedDuration)?:historyById[id]?.getLong("actualDurationMs")?:0L};val total=duration(sessions)
            val byTask=sessions.groupBy{it.optString("subtaskId")}
            val tasks=project.getJSONArray("subtasks").let{a->List(a.length()){a.getJSONObject(it)}}.map{task->
                val own=byTask[task.getString("id")].orEmpty();val spent=duration(own)
                ArchiveTask(task.getString("id"),task.getString("title"),spent,own.count(::complete),own.count(::interrupted),duration(own.filter(::interrupted)),
                    if(unknown.isEmpty()&&total>0)kotlin.math.floor(spent.toDouble()/total*100+.5).toInt()else null)
            }
            val completedAt=projectReports.filter{it.getInt("progressBasisPoints")==10000}.maxOfOrNull{it.getString("reportedAt")}
            archives+=BuildingArchive(id,id,project.getString("title"),null,completedAt,null,total,sessions.count(::complete),sessions.count(::interrupted),duration(sessions.filter(::interrupted)),unknown.size,unknownMs,owned(tasks))
        }
        for(habit in habits){
            val id=habit.getString("id");val own=attributedByTarget[id].orEmpty();val expected=ids(habit,"focusSessionIds").toSet();val knownIds=own.map{it.getString("sessionId")}.toSet();val unknown=expected-knownIds
            archives+=BuildingArchive(id,habit.getString("habitProjectId"),habit.getString("habitTitle"),habit.getLong("cycleNumber"),habit.getString("completedAt"),expected.size,
                duration(own),own.count(::complete),own.count(::interrupted),duration(own.filter(::interrupted)),unknown.size,unknown.mapNotNull{historyById[it]}.sumOf{it.getLong("actualDurationMs")},emptyList())
        }
        // Metadata only: a page refresh must not canonicalize or hash every
        // imported blueprint's voxels merely to display a memory title.
        data class MemoryInput(val id:String,val projectId:String,val title:String,val cycleNumber:Long?,val status:String,val active:Boolean,val blueprint:String,val completion:Int,val condition:Int)
        val visible=projects.filter{it.getString("status")!="deleted"&&it.optJSONObject("habit")?.getBoolean("awaitingNextBuilding")!=true}
        val conditions=rows("projectConditions").associateBy{it.getString("projectId")}
        val active=state.optString("activeProjectId")
        val inputs=visible.map{p->val id=p.getString("id");MemoryInput(id,id,p.getString("title"),null,p.getString("status"),id==active,p.getString("blueprintId"),DomainEngine.progress(p),conditions.getValue(id).getInt("conditionBasisPoints"))}+
            habits.map{h->MemoryInput(h.getString("id"),h.getString("habitProjectId"),h.getString("habitTitle"),h.getLong("cycleNumber"),"monument",false,h.getString("blueprintId"),10000,10000)}
        val archiveById=HashMap<String,BuildingArchive>()
        for(archive in archives)archiveById.getOrPut(archive.id){archive}
        val memories=inputs.map{building->
            val project=projectsById[building.id];val archive=archiveById[building.id]
            val habit=project?.optJSONObject("habit")
            val sessions=(if(building.cycleNumber!=null)sessionsByTarget[building.id] else sessionsByProject[building.id]).orEmpty()
            val last=sessions.lastOrNull()
            val lastDate=last?.let{if(it.getString("status")=="interrupted")DomainTime.localDate(it.getString("interruptedAt"),it.getString("timeZoneAtStart"))else it.getString("completedLocalDate")}
            val next=project?.takeIf{it.getString("kind")=="finite"}?.getJSONArray("subtasks")?.let{a->List(a.length()){a.getJSONObject(it)}.firstOrNull{it.getInt("progressBasisPoints")<10000}?.getString("title")}
            val habitCount=habit?.getJSONArray("completedFocusSessionIds")?.length();val habitTarget=habit?.getInt("targetRounds")
            BuildingMemoryFact(building.id,building.projectId,building.title,building.cycleNumber,building.status,building.active,building.blueprint,
                building.completion,building.condition,duration(sessions),sessions.count(::complete),sessions.count(::interrupted),duration(sessions.filter(::interrupted)),archive?.unknownRounds?:0,archive?.unknownMs?:0,lastDate,next,
                if(habitCount!=null&&habitTarget!=null)minOf(habitCount+1,habitTarget)else null,habitTarget,habit?.getBoolean("awaitingNextBuilding")==true)
        }
        val plots=(visible.map{it.getLong("settlementIndex")}+habits.map{it.getLong("settlementIndex")}).toSet()
        val resources=rows("decorationBlueprintResources").associateBy{it.getString("id")}
        val rewards=ArrayList<RewardMemoryFact>()
        if(plots.isNotEmpty())for(reward in rows("birthdayRewards"))rewards+=RewardMemoryFact("reward:birthday:${reward.getInt("year")}","builtin-birthday-cake-v1",null,WorldAssetKind.BIRTHDAY,reward.getString("date"))
        for(reward in rows("holidayRewards"))if(reward.getLong("settlementIndex") in plots){val holiday=reward.getString("holidayId");val year=reward.getInt("year")
            rewards+=RewardMemoryFact("reward:holiday:$holiday:$year","builtin-holiday-$holiday-v1",null,WorldAssetKind.HOLIDAY,reward.getString("date"),holiday)}
        val visibleIds=visible.map{it.getString("id")}.toSet()
        for(reward in rows("decorationRewards"))if(reward.getString("projectId") in visibleIds){val resource=resources[reward.getString("resourceId")]?:continue
            val id=resource.getString("id");val date=reward.getString("date")
            rewards+=RewardMemoryFact("reward:$date:$id",id,resource.getJSONObject("blueprint").optString("title").takeIf(String::isNotBlank),WorldAssetKind.EMBEDDED,date)}
        val unallocated=attribution.filter{!known(it)}
        return WorldMemories(owned(memories),owned(rewards),owned(archives),UnallocatedMemoryFact(unallocated.count(::complete),unallocated.count(::interrupted),duration(unallocated)))
    }
}
