package com.blockcolc.cloud

import org.json.JSONObject
import java.util.UUID

data class PendingAccountPreferences(val account:String,val receipt:String,val change:String)

/** Small account-scoped preference outbox. It contains no credentials or
 * workspace facts. A newer local choice cannot be cleared by an older reply. */
class AccountPreferenceOutbox(private val load:()->String?,private val save:(String?)->Unit){
    private fun records():JSONObject=load()?.let{require(it.length<=65536);JSONObject(it)}?:JSONObject()
    @Synchronized fun pending(account:String):PendingAccountPreferences?{
        val row=records().optJSONObject(account)?:return null
        val change=row.getString("change");checked(JSONObject(change))
        return PendingAccountPreferences(account,row.getString("receipt"),change)
    }
    @Synchronized fun stage(account:String,change:JSONObject):PendingAccountPreferences{
        require(account.matches(Regex("[a-f0-9-]{36}")));checked(change);require(change.length()>0)
        val all=records();require(all.has(account)||all.length()<16)
        val merged=pending(account)?.let{JSONObject(it.change)}?:JSONObject()
        change.keys().forEach{key->merged.put(key,change.get(key))}
        val ticket=PendingAccountPreferences(account,UUID.randomUUID().toString(),merged.toString())
        all.put(account,JSONObject().put("receipt",ticket.receipt).put("change",ticket.change));save(all.toString())
        return ticket
    }
    @Synchronized fun acknowledge(ticket:PendingAccountPreferences):Boolean{
        val all=records();if(all.optJSONObject(ticket.account)?.optString("receipt")!=ticket.receipt)return false
        all.remove(ticket.account);save(if(all.length()==0)null else all.toString());return true
    }
    @Synchronized fun overlay(account:JSONObject):JSONObject{
        val pending=pending(account.optString("id"))?:return account
        return JSONObject(account.toString()).also{out->JSONObject(pending.change).let{change->change.keys().forEach{out.put(it,change.get(it))}}}
    }
    companion object {
        private val fields=setOf("status","name","time","daily")
        private fun checked(change:JSONObject){
            require(change.keys().asSequence().all{it=="friendsEnabled"||it=="sharing"})
            if(change.has("friendsEnabled"))require(change.get("friendsEnabled") is Boolean)
            if(change.has("sharing")){
                val sharing=change.getJSONObject("sharing");require(sharing.keys().asSequence().toSet()==fields)
                require(fields.all{sharing.get(it) is Boolean})
            }
        }
        fun editable(account:JSONObject):JSONObject=JSONObject().put("friendsEnabled",account.optBoolean("friendsEnabled"))
            .put("sharing",JSONObject().also{out->fields.forEach{out.put(it,account.optJSONObject("sharing")?.optBoolean(it)?:false)}})
        fun difference(before:JSONObject,after:JSONObject):JSONObject{
            checked(before);checked(after)
            val change=JSONObject()
            if(before.getBoolean("friendsEnabled")!=after.getBoolean("friendsEnabled"))change.put("friendsEnabled",after.getBoolean("friendsEnabled"))
            if(fields.any{before.getJSONObject("sharing").getBoolean(it)!=after.getJSONObject("sharing").getBoolean(it)})change.put("sharing",JSONObject(after.getJSONObject("sharing").toString()))
            return change
        }
    }
}
