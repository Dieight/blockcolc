package com.blockcolc.focus

/** Host monotonic lease covers the actual onStop even if the active session changed.
 * A failed launch, resume without stop, timeout, or consumption ends the lease. */
class SystemNavigation(private val monotonic:()->Long,private val ttlMs:Long=30000){
    private var until:Long?=null
    @Synchronized fun begin(){until=monotonic()+ttlMs}
    @Synchronized fun cancel(){until=null}
    @Synchronized fun backgroundReason(locked:Boolean):String{
        val valid=until?.let{monotonic()<it}==true;until=null
        return if(locked)"screen-lock"else if(valid)"system-exempt"else"app-switch"
    }
}
