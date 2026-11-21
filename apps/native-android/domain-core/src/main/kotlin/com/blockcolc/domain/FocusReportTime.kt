package com.blockcolc.domain

data class ReportedFocusTime(val id:String,val elapsedMs:Long,val plannedMs:Long)

/** Reallocate the time of incomplete rounds without altering their actual
 * intervals or awarding another round. Recipients are in settlement order. */
object FocusReportTime {
    fun distribute(sessions:List<ReportedFocusTime>,recipients:List<String>):Map<String,Long>{
        if(recipients.isEmpty())return emptyMap()
        val nominal=sessions.maxOfOrNull{it.plannedMs}?:return emptyMap()
        val remainder=sessions.filter{it.elapsedMs<nominal}
        val total=remainder.sumOf{it.elapsedMs}
        if(total==0L)return emptyMap()
        val actual=sessions.associate{it.id to it.elapsedMs}
        val base=sessions.associate{it.id to if(it.elapsedMs<nominal)0L else it.elapsedMs}
        return buildMap{
            remainder.forEach{put(it.id,0L)}
            recipients.forEachIndexed{index,id->
                val share=total/recipients.size+if(index<total%recipients.size)1L else 0L
                put(id,base.getValue(id)+share)
            }
        }.filter{(id,ms)->actual.getValue(id)!=ms}
    }
}
