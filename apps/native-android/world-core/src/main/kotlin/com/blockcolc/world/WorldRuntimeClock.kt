package com.blockcolc.world

/** Visible render time only. Resume does not integrate an Android background
 * gap, and one shared texel drives all source cloud / night-field materials. */
class WorldRuntimeClock {
    var seconds=0f;private set
    var cloudSeconds=0f;private set
    var cascadeSeconds=0f;private set
    var weatherElapsedMs=0.0;private set
    val weatherSeconds:Float get()=(weatherElapsedMs*.001).toFloat()
    private var previous:Long?=null
    private var nightWasActive=false
    fun advance(nowNs:Long,nightActive:Boolean=true):Boolean {
        require(nowNs>=0)
        val before=previous;previous=nowNs;val continuedNight=nightActive&&nightWasActive;nightWasActive=nightActive
        if(before==null||nowNs<=before)return false
        val dt=(nowNs-before)/1e9
        if(continuedNight)seconds+=dt.coerceAtMost(2.0).toFloat()
        cloudSeconds+=dt.coerceAtMost(1.0).toFloat()
        // Production waterfalls cap each visible frame at 250ms, separately
        // from the one-second cloud and two-second night-field caps.
        cascadeSeconds+=dt.coerceAtMost(.25).toFloat()
        // Source precipitation integrates the visible interval without the
        // cloud/night caps. pause() still excludes the whole background gap.
        weatherElapsedMs+=dt*1000.0;return true
    }
    fun pause(){previous=null;nightWasActive=false}
}
