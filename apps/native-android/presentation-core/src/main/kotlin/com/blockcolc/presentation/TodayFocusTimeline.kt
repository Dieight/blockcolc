package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainTime
import com.blockcolc.focus.FocusProjection
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneOffset

data class TodayFocusSeries(val key:String,val title:String,val milliseconds:List<Long>,val totalMs:Long,val unallocated:Boolean)
data class TodayFocusTimeline(val date:String,val totalMs:Long,val completedRounds:Int,val targetRounds:Int?,val series:List<TodayFocusSeries>)

/** Occupied civil-time intervals. The main statistics keep their separate
 * completion-day convention, including for sessions spanning midnight. */
object TodayFocusProjection {
    fun from(domain:DomainDocument,date:String):TodayFocusTimeline =
        from(domain.json(),date,FocusProjection.attribution(domain).getJSONArray("sessions").let{a->List(a.length()){a.getJSONObject(it)}})

    internal fun from(state:JSONObject,date:String,attribution:List<JSONObject>):TodayFocusTimeline {
        val day=LocalDate.parse(date);require(day.toString()==date)
        val zone=state.getJSONObject("calendar").getString("timeZone")
        val nominal=day.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        val earliest=nominal-15*3600000L;val latest=nominal+39*3600000L
        val history=state.getJSONArray("focusHistory").let{a->List(a.length()){a.getJSONObject(it)}}
        val sources=history.associateBy{it.getString("id")}
        data class Row(val title:String,val unknown:Boolean,val buckets:LongArray=LongArray(96),var total:Long=0)
        val rows=linkedMapOf<String,Row>()
        for(a in attribution){
            val source=sources[a.getString("sessionId")]?:continue
            val duration=a.getLong("actualDurationMs");if(duration<=0)continue
            val start=DomainTime.millis(source.getString("startedAt"))
            val end=minOf(DomainTime.millis(a.getString("endedAt")),start+duration,latest)
            if(end<=earliest)continue
            val unknown=a.getString("kind")=="unallocated"
            val key=if(unknown)"unallocated"else JSONArray().put(a.opt("projectId")).put(a.opt("subtaskId")).toString()
            var at=maxOf(start,earliest)
            while(at<end){
                val until=minOf(end,(Math.floorDiv(at,60000L)+1)*60000L)
                val local=DomainTime.localDateTime(at,zone)
                if(local.toLocalDate()==day){
                    val row=rows.getOrPut(key){
                        val title=a.getString("projectTitle")+if(a.isNull("subtaskId")||a.isNull("targetTitle"))""else " · "+a.getString("targetTitle")
                        Row(title,unknown)
                    }
                    row.buckets[local.hour*4+local.minute/15]+=until-at;row.total+=until-at
                }
                at=until
            }
        }
        val series=rows.entries.sortedBy{it.key}.map{(key,row)->TodayFocusSeries(key,row.title,row.buckets.toList(),row.total,row.unknown)}
        val goals=state.getJSONArray("dailyGoals")
        val goal=(0 until goals.length()).map{goals.getJSONObject(it)}.find{it.getString("date")==date}
        val target=if(goal==null)8 else if(goal.getBoolean("enabled"))goal.getInt("targetPomodoros")else null
        val completed=history.count{it.getString("status")!="interrupted"&&it.getString("completedLocalDate")==date}
        return TodayFocusTimeline(date,series.sumOf{it.totalMs},completed,target,series)
    }
}
