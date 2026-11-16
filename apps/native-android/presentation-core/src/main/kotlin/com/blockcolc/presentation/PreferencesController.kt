package com.blockcolc.presentation

interface PreferencesStorage {
    fun read():String?
    /** Atomically replaces; the platform adapter syncs and checks the adopted
     * bytes before returning. This is not a promise about sudden-power-loss
     * durability beyond the underlying filesystem policy. */
    fun write(canonical:String)
}
data class PreferencesState(val value:ClientPreferences,val readFailed:Boolean=false)

/** A local-only writer. Android calls this on its IO actor; no UI or backup
 * owns a second preference value. Failure leaves the last adopted value intact. */
class PreferencesController(private val storage:PreferencesStorage) {
    private var adopted:PreferencesState?=null
    @Synchronized fun load():PreferencesState {
        adopted?.let{return it}
        val next=try{PreferencesState(storage.read()?.let(ClientPreferences::parseText)?:ClientPreferences())}
        catch(error:Exception){PreferencesState(ClientPreferences(),true)}
        adopted=next;return next
    }
    @Synchronized fun update(change:(ClientPreferences)->ClientPreferences):PreferencesState {
        val before=load();val candidate=change(before.value);candidate.validate()
        if(candidate==before.value&&!before.readFailed)return before
        storage.write(candidate.canonical())
        return PreferencesState(candidate).also{adopted=it}
    }
}
