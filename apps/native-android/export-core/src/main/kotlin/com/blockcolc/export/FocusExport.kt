package com.blockcolc.export

import com.blockcolc.storage.*
import com.blockcolc.domain.DomainTime
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** The only business fields crossing the optional export boundary. */
object FocusExport {
    private val zone=ZoneOffset.ofHours(8)
    fun date(now:Long):LocalDate=Instant.ofEpochMilli(now).atOffset(zone).toLocalDate()
    fun project(state:StoredState,from:LocalDate,now:Long):Pair<JSONObject,JSONArray>{
        return projectData(state.domain.focusControlJson(),state.recovery,from,now)
    }
    fun presence(state:StoredState,now:Long):JSONObject {
        val data=state.domain.focusControlJson()
        return liveSnapshot(data,state.recovery,now,presenceDayDuration(data.getJSONArray("focusHistory"),now),cloudPresence=true)
    }

    internal fun presenceDayDuration(history:JSONArray,now:Long):Long {
        val since=date(now).atStartOfDay().toInstant(zone).toEpochMilli()
        val ranges=buildList{
            for(index in 0 until history.length()){
                val session=history.getJSONObject(index)
                val start=DomainTime.millis(session.getString("startedAt"))
                val end=minOf(now,start+session.getLong("actualDurationMs"))
                val from=maxOf(since,start)
                if(end>from)add(from to end)
            }
        }.sortedBy{it.first}
        var total=0L
        var cursor=since
        for((from,to) in ranges){
            if(to>cursor){total+=to-maxOf(cursor,from);cursor=to}
        }
        return total
    }

    internal fun projectData(data:JSONObject,recovery:RecoveryContext,from:LocalDate,now:Long,cloudPresence:Boolean=false):Pair<JSONObject,JSONArray>{
        val today=date(now);require(!from.isAfter(today))
        require(java.time.temporal.ChronoUnit.DAYS.between(from,today)<20_000)
        val active=data.optJSONObject("activeFocusSession")
        val history=data.getJSONArray("focusHistory");val totals=HashMap<LocalDate,Long>();val ids=HashSet<String>()
        for(i in 0 until history.length()){
            val row=history.getJSONObject(i);require(ids.add(row.getString("id")))
            val start=DomainTime.millis(row.getString("startedAt"));val duration=row.getLong("actualDurationMs")
            require(duration>=0);val end=Math.addExact(start,duration);require(end<=now)
            var day=maxOf(from,date(start));val last=minOf(today,date(end-1))
            while(!day.isAfter(last)&&duration>0){
                val lower=day.atStartOfDay().toInstant(zone).toEpochMilli()
                val amount=maxOf(0,minOf(end,lower+86_400_000)-maxOf(start,lower))
                val total=Math.addExact(totals[day]?:0,amount);require(total<=86_400_000);totals[day]=total;day=day.plusDays(1)
            }
        }
        val days=JSONArray();var day=from
        while(!day.isAfter(today)){
            val lower=day.atStartOfDay().toInstant(zone).toEpochMilli();val upper=lower+86_400_000
            val unresolved=active!=null&&DomainTime.millis(active.getString("startedAt"))<upper&&DomainTime.millis(active.getString("endsAt"))>lower
            days.put(JSONObject().put("date",day.toString()).put("actualFocusMs",totals[day]?:0).put("confirmed",upper<=now&&!unresolved));day=day.plusDays(1)
        }
        val snapshot=liveSnapshot(data,recovery,now,totals[today]?:0,cloudPresence)
        return JSONObject().put("capturedAt",DomainTime.format(now)).put("value",snapshot) to days
    }

    private fun liveSnapshot(data:JSONObject,recovery:RecoveryContext,now:Long,todayDuration:Long,cloudPresence:Boolean):JSONObject {
        var start:Long?=null;var end:Long?=null;var name:String?=null
        val active=data.optJSONObject("activeFocusSession")
        if(active!=null){
            start=DomainTime.millis(active.getString("startedAt"));end=DomainTime.millis(active.getString("endsAt"))
            name=when{active.optBoolean("deferredSettlement")->"极简模式";active.optBoolean("marathon")->"马拉松";else->"专注中"}
            val extension=if(cloudPresence)recovery.plan?.extensionStartedAt else null
            if(extension!=null){start=DomainTime.millis(extension);end=null;name="专注中"}
            else if(cloudPresence&&active.optBoolean("marathon")){
                name="专注中"
                end=recovery.plan?.exactEndAt?.let(DomainTime::millis)?:end
            }else if(name=="专注中"){
                val projects=data.getJSONArray("projects")
                for(i in 0 until projects.length()) {val project=projects.getJSONObject(i);if(project.getString("id")==active.getString("projectId")){
                    val tasks=project.getJSONArray("subtasks");for(j in 0 until tasks.length()){val task=tasks.getJSONObject(j);if(task.getString("id")==active.optString("subtaskId"))name=task.getString("title")}
                }}
            }
        }else{
            val plan=recovery.plan
            if(plan?.phase==PlanPhase.REST&&plan.phaseEndsAt!=null&&DomainTime.millis(plan.phaseEndsAt!!)>now){
                // A normal report can occur long after completion; only the saved REST transition is exact.
                start=DomainTime.millis(plan.restStartedAt?:error("Exact saved rest start unavailable"));end=DomainTime.millis(plan.phaseEndsAt!!);name="休息"
            }
        }
        if(start!=null)require((end==null||end>start)&&start<=now)
        return JSONObject().put("currentName",name?:JSONObject.NULL).put("startedAt",start?.let(DomainTime::format)?:JSONObject.NULL)
            .put("estimatedElapsedMs",if(start==null)0 else minOf(now,end?:now)-start).put("estimatedEndsAt",end?.let(DomainTime::format)?:JSONObject.NULL).put("todayActualFocusMs",todayDuration)
    }
}
