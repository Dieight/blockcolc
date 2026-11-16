package com.blockcolc.presentation

import com.blockcolc.domain.StrictJson
import org.json.JSONArray
import org.json.JSONObject

/** Records the pre-existing achievement baseline for one database generation.
 * New earned facts remain eligible across process death; closing their popup
 * is separately recorded by AchievementReceipts. Neither file grants items. */
class AchievementAttention(private val storage:AchievementReceiptStorage){
    private var loaded:Pair<String,Set<String>>?=null
    fun observe(context:String,unlocked:Set<String>):Set<String>{
        require(context.length in 1..512)
        val allowed=AchievementProjection.definitions.map{it.id}.toSet()
        require(unlocked.all{it in allowed})
        var state=loaded
        if(state==null){
            state=storage.read()?.let{raw->
                val value=StrictJson.parse(raw,65536) as? JSONObject?:error("Invalid achievement baseline")
                require(value.getInt("version")==1)
                val a=value.getJSONArray("baseline");require(a.length()<=64)
                value.getString("context") to (0 until a.length()).map{a.getString(it)}.toSet().intersect(allowed)
            }
        }
        if(state?.first!=context){
            val next=StrictJson.render(JSONObject().put("version",1).put("context",context).put("baseline",JSONArray(unlocked.sorted())))
            storage.write(next);check(storage.read()==next){"Achievement baseline could not be verified"}
            state=context to unlocked.toSet()
        }
        loaded=state
        return unlocked-state!!.second
    }
}
