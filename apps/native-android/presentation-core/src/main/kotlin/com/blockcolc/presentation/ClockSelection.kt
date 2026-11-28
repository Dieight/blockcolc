package com.blockcolc.presentation

import kotlin.math.*

data class RoundDetent(val round:Int,val endMs:Long)
object ClockSelection {
    const val DWELL_MS=250L
    fun steps(deltaDp:Double)=sign(deltaDp).toInt()*floor(abs(deltaDp)/12+.5).toInt()
    fun roundSteps(deltaDp:Double)=sign(deltaDp).toInt()*floor(abs(deltaDp)/26+.5).toInt()
    fun remainingGoalRounds(enabled:Boolean,target:Int,completed:Int):Int? =
        if(!enabled)null else (target-completed).takeIf{it in 1..24}
    fun crossesGoalRound(from:Int,to:Int,goalRemaining:Int?):Boolean {
        val target=goalRemaining?:return false
        return (from<target&&to>=target)||(from>target&&to<=target)
    }
    fun shift(current:Long?,steps:Int,now:Long):Long? {
        val base=current?:Math.floorDiv(now,60000)*60000
        val candidate=base+steps*300000L
        return if(candidate<=now)null else minOf(Math.floorDiv(now+86400000,60000)*60000,candidate)
    }
    fun timeOfDay(minutes:Int,reference:Long,zone:String):Long {
        require(minutes in 0..1439)
        val zoneId=java.util.TimeZone.getTimeZone(zone).toZoneId()
        val date=java.time.Instant.ofEpochMilli(reference).atZone(zoneId).toLocalDate()
        return date.atTime(minutes/60,minutes%60).atZone(zoneId).toInstant().toEpochMilli()
    }
    fun shiftTimeOfDay(current:Long?,steps:Int,reference:Long,zone:String):Long {
        val local=java.time.Instant.ofEpochMilli(current?:reference).atZone(java.util.TimeZone.getTimeZone(zone).toZoneId())
        val minutes=(local.hour*60L+local.minute+steps*5L).coerceIn(0,1435).toInt()
        return timeOfDay(minutes,reference,zone)
    }
    fun detent(from:Long,to:Long,anchor:Long,focusMinutes:Int,breakMinutes:Int):RoundDetent? {
        require(focusMinutes in 1..180&&breakMinutes in 0..60)
        val ascending=to>=from
        val rounds=(1..24).filter{round->val boundary=anchor+(round*focusMinutes+(round-1)*breakMinutes)*60000L
            if(ascending)boundary>from&&boundary<=to else boundary>to-1&&boundary<=from-1}
        val round=if(ascending)rounds.firstOrNull()else rounds.lastOrNull()
        round?:return null
        val minutes=round*focusMinutes+(round-1)*breakMinutes
        val end=Math.floorDiv(anchor,60000)*60000+ceil(minutes/5.0).toLong()*300000
        if(!ascending&&end>=from)return null
        return RoundDetent(round,end)
    }
}
