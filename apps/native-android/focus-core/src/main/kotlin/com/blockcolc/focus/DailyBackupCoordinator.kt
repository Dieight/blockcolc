package com.blockcolc.focus

import com.blockcolc.domain.DomainTime
import java.time.Instant
import java.time.ZoneId

/** Called only on the existing application actor. Wall time selects the day;
 * monotonic time controls retry, so changing the clock cannot suppress a retry.
 * A successful callback means the storage transaction has returned. */
class DailyBackupCoordinator(
    private val now:()->Long,
    private val elapsed:()->Long,
    private val capture:(date:String,at:Long)->Unit,
    private val changed:(failed:Boolean)->Unit = {},
) {
    private var visible=false
    private var owner:String?=null
    private var zone="UTC"
    private var completed:String?=null
    private var retryAt=0L
    private var running=false
    fun foreground(value:Boolean){visible=value}
    fun context(identity:String,timeZone:String){
        DomainTime.zone(timeZone)
        if(owner!=identity||zone!=timeZone){owner=identity;zone=timeZone;completed=null;retryAt=0}
    }
    /** Delay until the next foreground check, or null while hidden/uninitialized.
     * TIME_SET/TIMEZONE_CHANGED and resume call this again and replace the timer. */
    fun check(earliestCaptureElapsed:Long=0L):Long? {
        if(!visible||owner==null||running)return null
        val at=now();val target=DomainTime.addDays(DomainTime.localDate(DomainTime.format(at),zone),-1)
        if(completed!=target&&elapsed()>=maxOf(retryAt,earliestCaptureElapsed)){
            val capturedOwner=owner
            running=true
            try{
                capture(target,at)
                if(owner==capturedOwner){completed=target;retryAt=0;changed(false)}
            }catch(error:Exception){
                retryAt=elapsed()+60_000
                changed(true)
            }finally{running=false}
        }
        val midnight=Instant.ofEpochMilli(now()).atZone(ZoneId.of(zone)).toLocalDate().plusDays(1).atStartOfDay(ZoneId.of(zone)).toInstant().toEpochMilli()
        val nextDay=(midnight-now()).coerceAtLeast(1)
        return if(completed!=target)minOf(nextDay,(maxOf(retryAt,earliestCaptureElapsed)-elapsed()).coerceAtLeast(1))else nextDay
    }
}
