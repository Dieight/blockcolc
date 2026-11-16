package com.blockcolc.preview

import android.content.Context

/** Durable fencing at the application writer and OS deadline entry. A
 * view-only device may render a deadline, but cannot settle it. Offline
 * execution keeps the last acknowledged owner; reconnect checks its fence. */
internal class CloudExecutionGate(context:Context,private val name:String="cloud-execution"){
    private val prefs=context.getSharedPreferences(name,Context.MODE_PRIVATE)
    @Volatile private var bound=prefs.getBoolean("bound",false)
    @Volatile private var owned=prefs.getBoolean("owned",false)
    fun canExecute()=!bound||owned
    fun update(bound:Boolean,owned:Boolean):Boolean {
        if(this.bound==bound&&this.owned==owned)return false
        check(prefs.edit().putBoolean("bound",bound).putBoolean("owned",owned).commit());this.bound=bound;this.owned=owned;return true
    }
}
