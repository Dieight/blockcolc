package com.blockcolc.world

import java.util.TimeZone

/** Provider facts have no camera, geometry, quality, UI theme or player. */
data class NativeAtmosphereInputs(val zone:String,val ocean:Boolean=false,val coordinates:NativeCoordinates?=null,val weather:NativeWeatherOverride?=null,val timeMinutes:Int?=null) {
    init {require(zone in TimeZone.getAvailableIDs());require(timeMinutes==null||timeMinutes in 0..1439)}
    fun visualTime(time:Long):Long {
        val minutes=timeMinutes?:return time
        val zoneId=TimeZone.getTimeZone(zone).toZoneId()
        val date=java.time.Instant.ofEpochMilli(time).atZone(zoneId).toLocalDate()
        // LocalDateTime.atZone follows JS Date.setHours: advance through a
        // DST gap and prefer the earlier offset during an overlap.
        return date.atTime(minutes/60,minutes%60).atZone(zoneId).toInstant().toEpochMilli()
    }
    fun sample(time:Long)=NativeEnvironment.facts(time,this)
}

data class NativeAtmosphereFacts(val time:Long,val inputs:NativeAtmosphereInputs,val sun:NativeSunState,val weather:NativeWeather,val visualTime:Long=time)

/** Owner-thread state machine with injected worker/delivery lanes. Only the
 * captured immutable request is used by the worker. A cancelled task may still
 * finish, so generation is checked again when its result reaches the owner. */
class NativeAtmosphereClock(
    private val now:()->Long,
    private val schedule:(Long,Runnable)->(() -> Unit),
    private val deliver:(Runnable)->Unit,
    private val onValue:(NativeAtmosphereFacts)->Unit,
    private val onFailure:(Exception)->Unit,
    private val sample:(NativeAtmosphereInputs,Long)->NativeAtmosphereFacts={input,time->input.sample(time)}
):AutoCloseable {
    private var input:NativeAtmosphereInputs?=null
    private var active=false;private var closed=false;private var generation=0L
    private var cancel:(()->Unit)?=null
    var latest:NativeAtmosphereFacts?=null;private set
    fun configure(input:NativeAtmosphereInputs?,active:Boolean){
        if(closed)return
        if(this.input==input&&this.active==active)return
        this.input=input;this.active=active
        restart()
    }
    fun refresh(){if(!closed)restart()}
    private fun restart(){
        generation++;cancel?.invoke();cancel=null
        val selected=input
        if(active&&selected!=null)queue(selected,generation,0)
    }
    private fun queue(selected:NativeAtmosphereInputs,version:Long,delay:Long){
        cancel=schedule(delay,Runnable{
            val result=try{Result.success(sample(selected,now()))}catch(error:Exception){Result.failure(error)}
            deliver(Runnable delivery@{
                if(closed||!active||version!=generation||input!=selected)return@delivery
                cancel=null
                try{
                    result.onSuccess{latest=it;onValue(it)}.onFailure{onFailure(it as Exception)}
                }finally{
                    // Observers may synchronously stop or replace the request.
                    if(!closed&&active&&version==generation&&input==selected)queue(selected,version,60_000)
                }
            })
        })
    }
    override fun close(){if(closed)return;closed=true;generation++;cancel?.invoke();cancel=null}
}
